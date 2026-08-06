/**
 * SSE + POST channel — the fallback for networks that will not pass WebSockets.
 *
 * This is PRD §4.3 R3, fallback 1, and PRD §5.4: a TLS-inspecting corporate
 * proxy may accept the TCP connection on 443 and then quietly refuse (or worse,
 * silently swallow) the HTTP Upgrade that a WebSocket needs. Server-Sent Events
 * are an ordinary long-lived `GET` returning `text/event-stream`, and sends are
 * an ordinary `POST` — no Upgrade anywhere, so what gets through a proxy is a
 * plain HTTP response body.
 *
 * It implements exactly the contract in transport/ws.js, carries exactly the
 * envelopes in transport/protocol.js, and relay.js cannot tell which of the two
 * it is holding beyond the label it prints.
 *
 * Two things SSE does not give us for free, handled here:
 *
 *   1. It is one-directional. Upstream frames go out as POSTs to /pub, which
 *      costs one extra round trip per send versus a WebSocket. Sends are
 *      coalesced (see flush) so a burst — trickle-ICE candidates, file chunks,
 *      cursor moves — becomes one request rather than thirty.
 *
 *      Worth knowing if you ever self-host behind HTTP/1.1: a browser allows
 *      six connections per host there, and an event stream holds one of them
 *      open for as long as the tab lives — so half a dozen tabs on the same
 *      relay can starve each other. Over HTTP/2, which is what any modern host
 *      (and Cloudflare, which fronts this one) serves, they are multiplexed
 *      onto one connection and the limit does not apply.
 *
 *   2. It has no connection identity. The stream is the session, so the relay
 *      issues a `sid` on the welcome frame and every POST names it. Without
 *      that, a POST has no way to say which of eight peers in the room it came
 *      from — the relay can only trust the connection a frame arrived on
 *      (see main.py `_forward`), and for this transport that connection is the
 *      stream, not the POST.
 */

import { NET } from "../core/config.js";
import * as proto from "./protocol.js";

export const LABEL = "HTTP stream";

/**
 * The relay answered, but not on /sse — it is running a build from before the
 * fallback existed.
 *
 * Worth telling apart from a blocked network, because it looks identical from
 * here and the fix is the opposite one. It is also the likeliest way to meet
 * this path: deploy the frontend ahead of the relay and every client that falls
 * back lands on a route that is not there yet.
 */
export const NO_FALLBACK = "relay has no fallback endpoint";

export const available = () =>
  typeof EventSource !== "undefined" && typeof fetch === "function";

/** How long to wait before retrying a POST that failed to reach the relay. */
const RETRY_MS = 400;

/** A POST that never answers must not wedge the outbox behind it. */
const POST_TIMEOUT_MS = 15_000;

export function create({ url, roomHash, onOpen, onFrame, onDown }) {
  const base = url.replace(/^ws/i, "http").replace(/\/+$/, "");

  let sid = null;          // issued by the relay on `welcome`; null until then
  let done = false;
  let outbox = [];         // serialised frames queued but not yet in flight
  let inflight = false;
  let retried = false;
  let retryTimer = null;

  const finish = (code, reason) => {
    if (done) return;
    done = true;
    clearTimeout(retryTimer);
    try { es.close(); } catch { /* already gone */ }
    onDown({ code, reason });
  };

  const es = new EventSource(`${base}/sse/${roomHash}`);

  es.onmessage = e => {
    const msg = proto.parse(e.data);

    // The welcome frame doubles as the handshake for this transport. Note that
    // "open" here means *the welcome arrived*, not "the GET was accepted": a
    // proxy that buffers the response body accepts the request happily and then
    // delivers nothing, which is indistinguishable from a working stream until
    // you insist on seeing a frame come out of it. relay.js gives every channel
    // NET.PROBE_MS to reach this line, so that proxy is caught and fallen back
    // from like any other block.
    if (msg.t === proto.T.WELCOME && msg.sid && !sid) {
      sid = msg.sid;
      delete msg.sid;      // transport plumbing; the protocol layer never sees it
      onOpen();
    }

    onFrame(msg);
  };

  es.onerror = () => {
    // EventSource reconnects on its own, and that is precisely what must not
    // happen: the relay would accept the new stream as a brand-new peer with a
    // new sid, while we carry on POSTing under the old one — a ghost in the
    // roster and every send rejected. Reconnection is relay.js's job, with its
    // backoff and its rejoin, so end the stream here and report it.
    if (sid) return finish(4001, "stream dropped");

    // Nothing has come back at all, and EventSource will not say why — no
    // status, no body, and a 404 with no CORS header on it reads in the console
    // as a cross-origin block. So ask the relay something simpler: if /health
    // answers, the host is reachable and it is the route that is missing.
    classify().then(reason => finish(4000, reason));
  };

  async function classify() {
    try {
      const res = await fetch(`${base}/health`, { signal: timeout(5000) });
      return res.ok ? NO_FALLBACK : `relay error ${res.status}`;
    } catch {
      return "stream refused";
    }
  }

  /**
   * Take the next POST's worth of frames.
   *
   * Bounded on both count and bytes so one flush cannot exceed what the relay
   * accepts in a body — a file transfer on the relay-chunk path (FR-7.6) can
   * queue hundreds of 32 KB frames in a moment.
   */
  function take() {
    const batch = [];
    let bytes = 0;
    while (outbox.length && batch.length < NET.POST_MAX_FRAMES) {
      const next = outbox[0];
      if (batch.length && bytes + next.length > NET.POST_MAX_BYTES) break;
      bytes += next.length;
      batch.push(outbox.shift());
    }
    return batch;
  }

  async function flush() {
    if (inflight || done || !sid || !outbox.length) return;
    inflight = true;
    const batch = take();

    let res = null;
    try {
      res = await fetch(`${base}/pub/${roomHash}?sid=${encodeURIComponent(sid)}`, {
        method: "POST",
        // text/plain keeps this a CORS "simple request". application/json would
        // make every single send a preflighted pair — an extra OPTIONS round
        // trip per clip, on the transport already chosen for being the slower
        // one. The relay parses the body by shape, not by this header.
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        // One frame per line. JSON.stringify escapes every literal newline, so
        // a frame can never contain one and the split is unambiguous.
        body: batch.join("\n"),
        signal: timeout(),
      });
    } catch {
      // Did not reach the relay at all. Retry once — a clip the user copied is
      // worth a second attempt — then drop it rather than build an unbounded
      // queue of stale frames behind a network that is gone. The stream is what
      // reports the session dead; a failed POST on its own does not.
      if (!retried) {
        retried = true;
        outbox = batch.concat(outbox);
        retryTimer = setTimeout(() => { inflight = false; flush(); }, RETRY_MS);
        return;
      }
      retried = false;
      inflight = false;
      console.warn(`[hopboard] dropped ${batch.length} frame(s): relay unreachable`);
      return flush();
    }

    retried = false;
    inflight = false;

    // The stream backing this sid is gone, so there is nowhere for the relay to
    // answer even if it accepted the frame. Reopening is the only fix.
    if (res.status === 404 || res.status === 410) {
      return finish(4404, "session expired");
    }
    // Anything else the relay dislikes (too large, rate limited) it also says
    // on the stream as a normal error frame, which the UI already surfaces.
    if (!res.ok) console.warn(`[hopboard] relay rejected a send: HTTP ${res.status}`);

    if (outbox.length) flush();
  }

  return {
    label: LABEL,

    // Usable means "the relay has answered and we know who we are". Before the
    // welcome there is no sid, so there is nowhere to send.
    isOpen: () => !done && sid !== null,

    send(obj) {
      if (done || !sid) return false;
      outbox.push(JSON.stringify(obj));
      flush();
      return true;
    },

    close() {
      done = true;
      clearTimeout(retryTimer);
      outbox = [];
      // Ending the stream is what tells the relay we left: it notices the
      // response body being cancelled and drops us from the roster.
      try { es.close(); } catch { /* already gone */ }
    },
  };
}

/** AbortSignal.timeout where it exists, hand-rolled where it does not. */
function timeout(ms = POST_TIMEOUT_MS) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  if (typeof AbortController === "undefined") return undefined;
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}
