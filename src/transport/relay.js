/**
 * WebSocket client for the relay.
 *
 * Isolated behind connect/send/close on purpose: if the deployed relay turns
 * out not to pass WebSocket upgrades (PRD OI-1), the SSE+POST fallback replaces
 * this file and nothing else changes.
 */

import { RELAY_URL, NET } from "../core/config.js";
import { emit, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as proto from "../transport/protocol.js";

let sock = null;
let wantOpen = false;
let backoff = NET.BACKOFF_MIN_MS;
let heartbeat = null;
let pingSentAt = 0;

/** Non-transport frames are handed up; the caller decrypts. */
let onFrame = () => {};
export const setFrameHandler = fn => { onFrame = fn; };

export function connect({ roomHash, intent = "join", url = RELAY_URL, name = "" }) {
  wantOpen = true;
  state.setConnection("connecting");

  sock = new WebSocket(`${url.replace(/\/+$/, "")}/ws/${roomHash}`);

  sock.onopen = () => {
    backoff = NET.BACKOFF_MIN_MS;
    state.setConnection("connected");
    send(proto.hello(intent, state.get().originId, name));
    heartbeat = setInterval(() => {
      pingSentAt = performance.now();
      send(proto.ping());
    }, NET.HEARTBEAT_MS);
  };

  sock.onmessage = e => {
    const msg = proto.parse(e.data);

    switch (msg.t) {
      case proto.T.WELCOME:
        state.setInstance(msg.instance);
        if (msg.you) state.get().peerId = msg.you;
        state.setPeers(msg.peers ?? 1, msg.list ?? []);
        // `existing > 0` on a create means the generated key is taken (OI-2).
        if (intent === "create" && msg.existing > 0) {
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
          detail: `${Math.round(performance.now() - pingSentAt)} ms`,
        });
        break;

      case proto.T.ERROR:
        emit(EV.TOAST, proto.ERRORS[msg.code] || `Relay error: ${msg.code}`);
        break;

      default:
        onFrame(msg);
    }
  };

  sock.onclose = ev => {
    clearInterval(heartbeat);
    if (!wantOpen) return state.setConnection("idle");

    // 1012 = "service restart". Every push to main redeploys the relay and
    // closes every live socket with this code (OI-13) — observed for real
    // during the M0 idle test. It is a planned, short outage rather than a
    // fault, so reset the backoff and come back promptly instead of treating
    // it like a flaky network and waiting out a doubled delay.
    if (ev.code === 1012) backoff = NET.BACKOFF_MIN_MS;

    // Jitter keeps a restart from producing a synchronised reconnect stampede
    // from every client at the same instant.
    const wait = Math.round(backoff * (0.8 + Math.random() * 0.4));
    backoff = Math.min(backoff * 2, NET.BACKOFF_MAX_MS);

    state.setConnection("reconnecting",
      ev.code === 1012 ? "relay restarting" : `${(wait / 1000).toFixed(1)}s`);

    // Always rejoin: a reconnect is never a "create", or a transient drop would
    // look like a key collision and needlessly rotate the user's key.
    setTimeout(() => { if (wantOpen) connect({ roomHash, intent: "join", url, name }); }, wait);
  };

  sock.onerror = () => state.setConnection("offline", "upgrade may be blocked");
}

export function send(obj) {
  if (!isOpen()) return false;
  sock.send(JSON.stringify(obj));
  return true;
}

export function close() {
  wantOpen = false;
  clearInterval(heartbeat);
  sock?.close(1000);
  sock = null;
}

export const isOpen = () => sock?.readyState === WebSocket.OPEN;
