/**
 * WebSocket channel — the default way to reach the relay.
 *
 * A *channel* moves frames and nothing else. It knows how to open a pipe, push
 * a frame down it, hand incoming frames up, and say when it is finished. It
 * knows nothing about hello, heartbeats, backoff, reconnection or which
 * transport should be used next — all of that lives in relay.js, once, for both
 * channels. See transport/sse.js for the other implementation of this contract.
 *
 *   create({ url, roomHash, onOpen, onFrame, onDown }) -> { send, close, isOpen }
 *
 *   onOpen()          the channel is usable; frames may be sent
 *   onFrame(msg)      one parsed inbound frame
 *   onDown({code, reason})
 *                     the channel is finished and will not recover. Fired at
 *                     most once, and never after close() — a deliberate close
 *                     is not an event anyone needs to react to.
 */

import * as proto from "./protocol.js";

export const LABEL = "WebSocket";

export const available = () => typeof WebSocket !== "undefined";

export function create({ url, roomHash, auth = null, onOpen, onFrame, onDown }) {
  let done = false;

  const finish = (code, reason) => {
    if (done) return;
    done = true;
    onDown({ code, reason });
  };

  let sock;
  try {
    // `?a=` is a locked session's admission token. Not a secret in the sense
    // the PIN is — it is HKDF output the relay compares against the room's
    // first arrival — but it is still session material, so it rides in the
    // query rather than the path for the same reason `sid` does on the SSE
    // path: paths are what proxies and access logs like to keep.
    sock = new WebSocket(
      `${url.replace(/\/+$/, "")}/ws/${roomHash}${auth ? `?a=${encodeURIComponent(auth)}` : ""}`);
  } catch (err) {
    // Constructing the socket throws synchronously on a malformed URL, and on
    // a Content-Security-Policy that forbids the scheme — which is one of the
    // ways a managed browser blocks WebSockets outright. Report it as a normal
    // channel failure so the caller can fall back rather than crash on boot.
    Promise.resolve().then(() => finish(0, err.message || "could not open"));
    return { label: LABEL, send: () => false, close: () => { done = true; }, isOpen: () => false };
  }

  sock.onopen = () => onOpen();
  sock.onmessage = e => onFrame(proto.parse(e.data));

  // onerror carries no useful detail in any browser, and a close event always
  // follows it — so the close is the single place failure is reported from.
  sock.onerror = () => {};
  sock.onclose = ev => finish(ev.code, ev.reason);

  return {
    label: LABEL,
    isOpen: () => sock.readyState === WebSocket.OPEN,

    send(obj) {
      if (sock.readyState !== WebSocket.OPEN) return false;
      sock.send(JSON.stringify(obj));
      return true;
    },

    close(code = 1000) {
      done = true;
      try { sock.close(code); } catch { /* already gone */ }
    },
  };
}
