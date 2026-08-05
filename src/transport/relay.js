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

export function connect({ roomHash, intent = "join", url = RELAY_URL }) {
  wantOpen = true;
  state.setConnection("connecting");

  sock = new WebSocket(`${url.replace(/\/+$/, "")}/ws/${roomHash}`);

  sock.onopen = () => {
    backoff = NET.BACKOFF_MIN_MS;
    state.setConnection("connected");
    send(proto.hello(intent, state.get().originId));
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
        state.setPeers(msg.peers ?? 1);
        // `existing > 0` on a create means the generated key is taken (OI-2).
        if (intent === "create" && msg.existing > 0) {
          emit(EV.KEY_COLLISION, { existing: msg.existing });
          return;
        }
        if (msg.last) onFrame(msg.last);
        break;

      case proto.T.PEERS:
        state.setPeers(msg.count);
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

  sock.onclose = () => {
    clearInterval(heartbeat);
    if (!wantOpen) return state.setConnection("idle");
    // Exponential backoff with jitter, so a relay restart does not produce a
    // synchronised stampede from every client at once (OI-13).
    const wait = Math.round(backoff * (0.8 + Math.random() * 0.4));
    backoff = Math.min(backoff * 2, NET.BACKOFF_MAX_MS);
    state.setConnection("reconnecting", `${(wait / 1000).toFixed(1)}s`);
    setTimeout(() => { if (wantOpen) connect({ roomHash, intent: "join", url }); }, wait);
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
