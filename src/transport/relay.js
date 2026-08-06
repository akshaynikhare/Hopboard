/**
 * The relay connection: protocol, liveness, and which transport carries it.
 *
 * Everything above this file (main.js, and through it the whole app) sees one
 * interface — connect / send / close / isOpen / setFrameHandler — and never
 * learns how the bytes actually leave the machine. That boundary was designed
 * in from the start (PRD §4.3, docs/ARCHITECTURE.md §3) against the risk that
 * the deployed relay would not pass WebSocket upgrades. It turned out to be
 * needed for a different reason: the *client's* network.
 *
 * On a managed corporate network — the primary deployment context (PRD §5.4) —
 * a TLS-inspecting proxy may refuse the HTTP Upgrade that a WebSocket needs, or
 * accept the connection and then swallow it, leaving a socket that never opens
 * and never closes. So the transport is not a build-time decision:
 *
 *   1. Try WebSocket. Give it NET.PROBE_MS to become usable.
 *   2. Two consecutive attempts that never become usable is a policy, not a
 *      flaky moment — switch to SSE+POST, which is plain HTTP and needs no
 *      Upgrade, and say so out loud.
 *   3. If that is blocked too, keep alternating rather than giving up on one:
 *      a network that refuses both is a different problem, and the user is told
 *      exactly that instead of watching "Reconnecting" forever.
 *
 * The choice is remembered (storage.js), so someone behind that proxy pays the
 * probe once rather than on every load, and re-probes when the memory expires
 * or they move to another network.
 *
 * The two channels live in ws.js and sse.js and implement one contract. All the
 * protocol handling, heartbeat and backoff is here, once, for both.
 */

import { RELAY_URL, NET, TRANSPORT } from "../core/config.js";
import { emit, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as storage from "../core/storage.js";
import * as proto from "./protocol.js";
import * as wsChannel from "./ws.js";
import * as sseChannel from "./sse.js";

const CHANNELS = {
  [TRANSPORT.WS]:  wsChannel,
  [TRANSPORT.SSE]: sseChannel,
};
const OTHER = {
  [TRANSPORT.WS]:  TRANSPORT.SSE,
  [TRANSPORT.SSE]: TRANSPORT.WS,
};

/** What the status bar appends. The default transport needs no announcement. */
const NOTE = {
  [TRANSPORT.WS]:  "",
  [TRANSPORT.SSE]: "HTTP fallback",
};

/** Non-transport frames are handed up; the caller decrypts. */
let onFrame = () => {};
export const setFrameHandler = fn => { onFrame = fn; };

let channel = null;
let session = null;              // {roomHash, intent, url, name}
let wantOpen = false;
let opened = false;              // has the CURRENT attempt become usable?
let mode = TRANSPORT.WS;
let announced = null;            // last transport reported on the bus
let stuck = false;               // both transports have failed; cleared by any success
let unsupported = false;         // the relay is reachable but predates the fallback
let failures = { [TRANSPORT.WS]: 0, [TRANSPORT.SSE]: 0 };
let backoff = NET.BACKOFF_MIN_MS;
let heartbeat = null;
let probe = null;
let pingSentAt = 0;

/**
 * Which attempt is the current one.
 *
 * Rejoining, rotating the key and recovering from a collision all close the
 * connection and open a new one — while a reconnect timer from the old one may
 * still be pending. Without a generation to compare against, that timer wakes
 * up, sees `wantOpen`, and opens a second connection alongside the live one:
 * the user is in the room twice, sees their own clips echoed back, and one of
 * the two sockets is unreachable by anything. Every callback and timer below
 * captures this and does nothing if it has moved on.
 */
let epoch = 0;

/** Which transport is live right now. For the UI and for debugging. */
export const transport = () => mode;

export function connect({ roomHash, intent = "join", url = RELAY_URL, name = "" }) {
  channel?.close(1000);            // a second connect() replaces, never stacks
  session = { roomHash, intent, url, name };
  wantOpen = true;
  failures = { [TRANSPORT.WS]: 0, [TRANSPORT.SSE]: 0 };
  backoff = NET.BACKOFF_MIN_MS;
  mode = preferred();
  start();
}

export function send(obj) {
  return channel?.send(obj) ?? false;
}

export function close() {
  wantOpen = false;
  epoch++;                         // anything still pending belongs to a dead session
  stopTimers();
  channel?.close(1000);
  channel = null;
}

export const isOpen = () => channel?.isOpen() === true;

/* ------------------------------------------------------------------
   transport selection
------------------------------------------------------------------- */

/**
 * Where to start.
 *
 * A remembered choice wins: on a network that blocks WebSockets, re-probing
 * costs NET.PROBE_MS of "Connecting…" on every single load, and the answer is
 * the same every time. storage.js expires the memory on its own, so moving off
 * that network re-probes rather than pinning the user to the slower transport
 * forever.
 */
function preferred() {
  const remembered = storage.loadTransport();
  if (remembered && CHANNELS[remembered]?.available()) return remembered;
  return wsChannel.available() ? TRANSPORT.WS : TRANSPORT.SSE;
}

function switchTransport() {
  const next = OTHER[mode];
  if (!CHANNELS[next].available()) return;

  mode = next;
  failures[next] = 0;
  backoff = NET.BACKOFF_MIN_MS;    // the switch is a fresh start, not a retry

  // Loud, never silent — the same rule the file layer follows when a P2P
  // transfer falls back to the relay (FR-7.6). The fallback is slower and the
  // user is entitled to know which pipe their clipboard is going down.
  emit(EV.TOAST, next === TRANSPORT.SSE
    ? "WebSocket blocked — switched to the HTTP fallback"
    : "Retrying the WebSocket connection");
}

/** Neither transport is getting through: that is a network problem, not lag. */
function blocked() {
  return failures[TRANSPORT.WS] >= NET.SWITCH_AFTER
      && failures[TRANSPORT.SSE] >= NET.SWITCH_AFTER;
}

function announce() {
  const key = stuck ? `blocked:${unsupported}` : mode;
  if (key === announced) return;   // don't re-raise a banner on every reconnect
  announced = key;
  emit(EV.TRANSPORT, {
    mode: stuck ? null : mode,
    label: CHANNELS[mode].LABEL,
    blocked: stuck,
    // "the relay is old" and "the network is blocking us" present identically
    // and have opposite fixes, so the UI is given the difference rather than a
    // single sentence that has to cover both.
    unsupported,
  });
}

/* ------------------------------------------------------------------
   one attempt
------------------------------------------------------------------- */

function start() {
  stopTimers();
  opened = false;
  state.setConnection("connecting", detail());

  const gen = ++epoch;
  const current = fn => (...args) => { if (gen === epoch) fn(...args); };

  channel = CHANNELS[mode].create({
    url: session.url,
    roomHash: session.roomHash,
    onOpen: current(up),
    onFrame: current(handle),
    onDown: current(down),
  });

  // A blocked transport does not always fail — it hangs. An intercepting proxy
  // can accept the connection, drop the Upgrade (or buffer the event stream)
  // and then do nothing at all, with no error to react to. Without this timer
  // the app sits on "Connecting…" indefinitely and the fallback never runs,
  // which is the whole failure this file exists to handle.
  probe = setTimeout(() => {
    if (opened || gen !== epoch) return;
    channel?.close(4000);          // deliberate: the channel will not call down()
    channel = null;
    down({ code: 4000, reason: "no response" });
  }, NET.PROBE_MS);
}

function up() {
  clearTimeout(probe);
  probe = null;

  opened = true;
  stuck = false;
  unsupported = false;
  idRetries = 0;
  backoff = NET.BACKOFF_MIN_MS;
  failures[mode] = 0;
  storage.saveTransport(mode);

  state.setConnection("connected", detail());
  announce();

  send(proto.hello(session.intent, state.get().originId, session.name));

  heartbeat = setInterval(() => {
    pingSentAt = performance.now();
    send(proto.ping());
  }, NET.HEARTBEAT_MS);
}

function down({ code, reason }) {
  stopTimers();
  channel = null;
  if (mode === TRANSPORT.SSE) unsupported = reason === sseChannel.NO_FALLBACK;

  if (!wantOpen) return state.setConnection("idle");

  if (opened) {
    // Always rejoin: a reconnect is never a "create", or a transient drop would
    // look like a key collision and needlessly rotate the user's key.
    session = { ...session, intent: "join" };
  } else {
    failures[mode] += 1;
  }

  // 1012 = "service restart". Every push to main redeploys the relay and closes
  // every live socket with this code (OI-13) — observed for real during the M0
  // idle test. It is a planned, short outage rather than a fault, so reset the
  // backoff and come back promptly instead of treating it like a flaky network
  // and waiting out a doubled delay.
  if (code === 1012) backoff = NET.BACKOFF_MIN_MS;

  // Read before switching: switchTransport() zeroes the incoming transport's
  // counter, so asking afterwards always says "not blocked" and the user would
  // never be told that nothing at all is getting through.
  if (!opened && failures[mode] >= NET.SWITCH_AFTER) {
    if (blocked()) {
      stuck = true;
      storage.saveTransport(null);   // neither works; don't pin the next load to one
    }
    switchTransport();
  }

  // Jitter keeps a restart from producing a synchronised reconnect stampede
  // from every client at the same instant.
  const wait = Math.round(backoff * (0.8 + Math.random() * 0.4));
  backoff = Math.min(backoff * 2, NET.BACKOFF_MAX_MS);

  announce();

  if (stuck) {
    state.setConnection("offline", "relay unreachable");
  } else {
    state.setConnection("reconnecting",
      code === 1012 ? "relay restarting" : detail(`${(wait / 1000).toFixed(1)}s`));
  }

  const gen = epoch;
  setTimeout(() => { if (wantOpen && gen === epoch) start(); }, wait);
}

function stopTimers() {
  clearInterval(heartbeat);
  clearTimeout(probe);
  heartbeat = probe = null;
}

/** Status-bar text: whatever the state wants to say, plus the transport. */
const detail = (extra = "") => [extra, NOTE[mode]].filter(Boolean).join(" · ");

/* ------------------------------------------------------------------
   protocol
------------------------------------------------------------------- */

let idRetries = 0;

/**
 * Our own id is still held — by the connection we just closed.
 *
 * A rejoin, a key rotation or a collision recovery reconnects within
 * milliseconds, and the relay only drops a peer once it *notices* the old
 * transport is gone. Reconnect faster than that and we meet our own ghost: the
 * relay keeps us under a provisional id, while the files layer goes on
 * addressing frames to our originId — so transfers to this device quietly stop
 * resolving. Ask again a moment later, by which time the ghost has been reaped.
 */
function reclaimIdentity() {
  if (idRetries >= 3) return emit(EV.TOAST, proto.ERRORS.PEER_ID_TAKEN);
  const gen = epoch;
  const attempt = ++idRetries;
  setTimeout(() => {
    if (!isOpen() || gen !== epoch) return;
    send(proto.hello("join", state.get().originId, session.name));
  }, 600 * attempt);
}

function handle(msg) {
  switch (msg.t) {
    case proto.T.WELCOME:
      state.setInstance(msg.instance);
      if (msg.you) state.get().peerId = msg.you;
      state.setPeers(msg.peers ?? 1, msg.list ?? []);
      // `existing > 0` on a create means the generated key is taken (OI-2).
      if (session.intent === "create" && msg.existing > 0) {
        emit(EV.KEY_COLLISION, { existing: msg.existing });
        return;
      }
      // A room's last clip is replayed to late joiners, so a device that
      // arrives mid-session is immediately in sync (FR-3.3).
      if (msg.last) onFrame(msg.last);
      break;

    case proto.T.PEERS:
      state.setPeers(msg.count, msg.list ?? []);
      break;

    case proto.T.PONG:
      emit(EV.CONN_STATE, {
        state: "connected",
        detail: detail(`${Math.round(performance.now() - pingSentAt)} ms`),
      });
      break;

    case proto.T.ERROR:
      if (msg.code === "PEER_ID_TAKEN") return reclaimIdentity();
      emit(EV.TOAST, proto.ERRORS[msg.code] || `Relay error: ${msg.code}`);
      break;

    default:
      onFrame(msg);
  }
}
