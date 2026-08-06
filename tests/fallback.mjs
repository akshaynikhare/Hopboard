/**
 * The transport fallback, driven through the real client modules.
 *
 * backend/test_sse.py proves the relay serves the SSE+POST path. This proves
 * the half nobody can test from the office: that the *client* notices a
 * WebSocket that is being swallowed by a proxy, gives up on it, moves to the
 * fallback on its own, and carries a clip across to a peer that is still on a
 * WebSocket — with no help from the UI and nothing for the user to configure.
 *
 * The block is simulated exactly as it presents in the wild (PRD §5.4): a
 * socket that is accepted and then never opens, never closes and never errors.
 * That is the failure mode a naive client waits on forever.
 *
 * Usage:  node tests/fallback.mjs [ws_base]      default ws://127.0.0.1:8000
 *         Skips cleanly when no relay is reachable, so it is safe in CI.
 */

import { createServer } from "node:http";

import { NET, TRANSPORT } from "../src/core/config.js";

/**
 * Localhost, and deliberately NOT RELAY_BASE like the other suites.
 *
 * This one measures the client's own timing — the probe window before it gives
 * up on a hung WebSocket, and the race to reclaim a peer id across a fast
 * rejoin. Both are tuned against a relay that answers in microseconds. Pointed
 * at a deployed relay it fails on latency alone and reports a client bug that
 * is not there, which is worse than not running.
 *
 * Skipping is the right answer when there is no local relay: the check below
 * exits 0 rather than failing, so this stays safe in a hook and in CI.
 */
const BASE = process.argv[2] || "ws://127.0.0.1:8000";
const HTTP = BASE.replace(/^ws/i, "http");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  return ok;
};

/* ---------- is there a relay? ---------- */
try {
  const res = await fetch(`${HTTP}/health`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  console.log(`\nSKIP: no relay at ${HTTP}  (${err.message})\n`
    + "      start one with: python -m uvicorn main:app --port 8000  (in backend/)\n");
  process.exit(0);
}

/* ---------- the browser bits the client expects ---------- */

const RealWebSocket = globalThis.WebSocket;

/** localStorage, in memory. storage.js only ever holds preferences. */
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

/**
 * EventSource, where the runtime does not have one.
 *
 * Node exposes it only behind --experimental-eventsource, and requiring a flag
 * to run the suite is a good way to have the suite not run. This covers the
 * slice sse.js actually uses: message events, an error when the stream ends,
 * and close(). Under `node --experimental-eventsource` the real one is used
 * instead and this is never constructed.
 */
if (typeof globalThis.EventSource === "undefined") {
  globalThis.EventSource = class {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.onmessage = null;
      this.onerror = null;
      this.onopen = null;
      this._ctrl = new AbortController();
      this._run();
    }

    async _run() {
      try {
        const res = await fetch(this.url, {
          headers: { Accept: "text/event-stream" },
          signal: this._ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        this.readyState = 1;
        this.onopen?.();

        const reader = res.body.getReader();
        const decode = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decode.decode(value, { stream: true });
          // Events are separated by a blank line; "data:" lines are the payload
          // and ":" lines are keepalive comments.
          let split;
          while ((split = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const data = block
              .split("\n")
              .filter(l => l.startsWith("data:"))
              .map(l => l.slice(5).trimStart())
              .join("\n");
            if (data) this.onmessage?.({ data });
          }
        }
        throw new Error("stream ended");
      } catch (err) {
        if (this.readyState === 2) return;      // closed by us
        this.readyState = 0;
        this.onerror?.({ message: err.message });
      }
    }

    close() {
      this.readyState = 2;
      this._ctrl.abort();
    }
  };
}

/**
 * A WebSocket that behaves like one crossing an intercepting proxy: the
 * constructor succeeds, and then nothing ever happens. No open, no close, no
 * error — which is why a probe timeout, rather than an error handler, is what
 * the client has to rely on.
 */
let blockedSockets = 0;
class SwallowedWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    blockedSockets++;
  }
  send() { throw new Error("not open"); }
  close() { this.readyState = 3; }
}

globalThis.WebSocket = SwallowedWebSocket;

// Failover is a matter of seconds by design — it is a user waiting at a screen.
// Compressed here so the suite runs in one, without changing the logic under
// test: these are the same knobs the app reads at runtime.
NET.PROBE_MS = 250;
NET.BACKOFF_MIN_MS = 40;
NET.BACKOFF_MAX_MS = 120;

/* ---------- the modules under test ---------- */

const { on, EV } = await import("../src/core/bus.js");
const relay = await import("../src/transport/relay.js");
const proto = await import("../src/transport/protocol.js");
const storage = await import("../src/core/storage.js");

const toasts = [];
const states = [];
on(EV.TOAST, t => toasts.push(t));
on(EV.CONN_STATE, ({ state }) => states.push(state));

const inbox = [];
relay.setFrameHandler(msg => inbox.push(msg));

const room = `fallback-${Math.random().toString(36).slice(2, 10)}`;

const until = async (label, predicate, ms = 6000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  console.log(`      (timed out waiting for ${label})`);
  return false;
};

console.log(`\nTransport fallback against ${BASE}\n`);

/* ---------- 1. the switch ---------- */

relay.connect({ roomHash: room, intent: "join", url: BASE, name: "blocked-device" });

const switched = await until("the fallback to engage",
  () => relay.transport() === TRANSPORT.SSE && relay.isOpen());

check("a swallowed WebSocket does not hang the session forever", switched,
      `transport=${relay.transport()} sockets tried=${blockedSockets}`);
check("it tried the WebSocket first, more than once",
      blockedSockets >= NET.SWITCH_AFTER, `${blockedSockets} attempts`);
check("the session reaches connected on the fallback",
      states.includes("connected"), states.join(" -> "));
check("the user is told, not silently downgraded",
      toasts.some(t => /websocket/i.test(t)), toasts.join(" | ") || "no toast");
check("the working transport is remembered for next time",
      storage.loadTransport() === TRANSPORT.SSE, String(storage.loadTransport()));

/* ---------- 2. a clip actually crosses ---------- */

const peer = new RealWebSocket(`${BASE}/ws/${room}`);
const peerInbox = [];
await new Promise((resolve, reject) => {
  peer.onopen = resolve;
  peer.onerror = e => reject(new Error(e.message || "peer failed"));
  peer.onmessage = e => peerInbox.push(JSON.parse(e.data));
  setTimeout(() => reject(new Error("peer connect timeout")), 5000);
});
peer.send(JSON.stringify(proto.hello("join", "peerWS", "ws-device")));

await until("the roster to settle", () => peerInbox.some(m => m.t === "welcome"));

relay.send(proto.clip({ payload: "Zm9vYmFy", iv: "aXY=", originId: "sseClient" }));
const delivered = await until("the clip to reach the WebSocket peer",
  () => peerInbox.some(m => m.t === "clip" && m.payload === "Zm9vYmFy"));
check("a clip sent over the fallback reaches a WebSocket peer", delivered,
      `${peerInbox.filter(m => m.t === "clip").length} clip(s) seen`);

peer.send(JSON.stringify({ t: "clip", payload: "YmFja3dhcmRz", iv: "aXY=", originId: "peerWS" }));
const received = await until("the reply to reach the fallback client",
  () => inbox.some(m => m.t === "clip" && m.payload === "YmFja3dhcmRz"));
check("a clip sent from a WebSocket peer reaches the fallback client", received,
      `${inbox.filter(m => m.t === "clip").length} clip(s) seen`);

/* ---------- 3. rejoining does not stack connections ---------- */

// Rejoin, rotate-key and collision-recovery all close and reopen — while a
// reconnect timer from the previous attempt may still be pending. If that timer
// is allowed to fire, the room ends up holding two of us.
relay.close();
relay.connect({ roomHash: room, intent: "join", url: BASE, name: "blocked-device" });
await until("the rejoin to connect", () => relay.isOpen());
await new Promise(r => setTimeout(r, 600));   // let any stale timer misbehave

const roster = peerInbox.filter(m => m.t === "peers").at(-1);
check("rejoining replaces the connection instead of stacking one",
      roster?.count === 2, JSON.stringify(roster ?? null));

// Reconnecting this fast means the relay is still holding our id for the
// connection we just dropped. The client has to get its own name back, or the
// files layer addresses frames to a device the relay no longer knows.
const { originId } = (await import("../src/core/state.js")).get();
const reclaimed = await until("our peer id to come back",
  () => peerInbox.filter(m => m.t === "peers").at(-1)
        ?.list.some(p => p.peerId === originId), 4000);
check("the client reclaims its own peer id after a fast rejoin", reclaimed,
      JSON.stringify(peerInbox.filter(m => m.t === "peers").at(-1)?.list ?? null));

/* ---------- 4. leaving ---------- */

relay.close();
const left = await until("the roster to lose us",
  () => peerInbox.filter(m => m.t === "peers").at(-1)?.count === 1);
check("closing the fallback leaves the room", left,
      JSON.stringify(peerInbox.filter(m => m.t === "peers").at(-1) ?? null));

peer.close();

/* ---------- 5. a relay that predates the fallback ---------- */

// Deploy the frontend ahead of the relay and this is what every client that
// falls back meets: /health answers, /sse is a bare 404 — and a 404 with no
// CORS header on it reads in the browser console as a cross-origin block. The
// client has to name the real cause, or the next person debugs the network.
const stale = createServer((req, res) => {
  if (req.url.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true,"instance":"old"}');
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not Found");
});
await new Promise(r => stale.listen(0, "127.0.0.1", r));
const stalePort = stale.address().port;

let verdict = null;
on(EV.TRANSPORT, payload => { if (payload.blocked) verdict = payload; });

relay.connect({ roomHash: room, intent: "join", url: `ws://127.0.0.1:${stalePort}`,
                name: "blocked-device" });
const diagnosed = await until("the client to work out why", () => verdict !== null, 8000);
relay.close();
stale.close();

check("an out-of-date relay is diagnosed, not blamed on the network",
      diagnosed && verdict.unsupported === true, JSON.stringify(verdict));

console.log("\n" + "=".repeat(56));
console.log(`FALLBACK: ${pass}/${pass + fail} passed`);
console.log("=".repeat(56) + "\n");
process.exit(fail ? 1 : 0);
