/**
 * File transfer — WebRTC first, relay chunks when WebRTC cannot connect.
 *
 * ============================================================================
 * CONTRACT WITH main.js  (read this before wiring anything)
 * ============================================================================
 *
 * This module must never import transport/relay.js: the whole point of the
 * boundary in docs/ARCHITECTURE.md §3 is that the transport can be swapped for
 * SSE+POST without touching anything above it. So main.js injects the send
 * function and pumps inbound frames back in. Two calls, both from main.js:
 *
 *   1.  transfer.setSignalSender(frame => boolean)
 *
 *       Called once at boot. `frame` is a plain JSON-serialisable object whose
 *       `.t` is one of transfer.FRAMES and whose `.to` is the originId of the
 *       peer it is meant for. `.originId` (us) is filled in here.
 *
 *       main.js is responsible for:
 *         - encrypting the payload-bearing fields exactly as it encrypts clips
 *           (`sdp`, `candidate`, `b64`, `name` — everything except `t`, `to`,
 *           `originId`, `id`, `seq`, `total`, `crc`, which are routing);
 *         - putting the frame on the relay;
 *         - returning `false` if it could not be sent. Any other return value
 *           (including undefined) is treated as sent.
 *
 *   2.  transfer.onSignal(frame)
 *
 *       Called for every inbound frame whose `.t` appears in transfer.FRAMES,
 *       already decrypted, with `.originId` set to the sending peer. Frames
 *       addressed to somebody else are ignored here too, so a relay that
 *       broadcasts rather than unicasts is safe.
 *
 * Optional, both with safe defaults:
 *
 *   3.  transfer.setApprover(async ({id,name,size,type,from}) => boolean)
 *       Called when a peer asks for one of our files and
 *       state.settings.autoaccept is false. ui/filesPanel.js installs this.
 *       With no approver installed the request is DENIED, not silently allowed.
 *
 *   4.  transfer.setPeerFactory(config => RTCPeerConnection)
 *       Seam for tests: inject a fake that never opens its data channel and the
 *       ICE-timeout fallback fires deterministically, with no browser and no
 *       five-second wait. Pass nothing to restore the real one.
 *
 * Frame types this module emits and consumes are in FRAMES below. rtc-offer,
 * rtc-answer, rtc-ice and file-req already exist in transport/protocol.js; the
 * five that do not (file-accept, file-deny, file-chunk, file-done, file-cancel,
 * file-error) are declared here because transport/ is not ours to edit. They
 * belong in protocol.js — see the report.
 *
 * ============================================================================
 * WHY THERE IS NO TURN SERVER
 * ============================================================================
 * TURN would fix corporate connectivity by relaying the bytes — which discards
 * the exact property that motivated P2P, and costs bandwidth. Instead we fall
 * back to the relay we already pay nothing for. That is viable only because the
 * cap is 5 MB (docs/P2P-FILES.md §4, PRD OI-14). The fallback is not an edge
 * case: on the target network it is the expected path.
 *
 * Whichever path is used is recorded on the file and shown in the UI. A relay
 * transfer is a different privacy story from a direct one, and the user is
 * entitled to know which one they got.
 */

import { FILES, NET } from "../core/config.js";
import { emit, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as registry from "./registry.js";
import * as chunker from "./chunker.js";
import { T } from "../transport/protocol.js";

export const PATH = { P2P: "p2p", RELAY: "relay" };

/** Frame types. The first four already exist in transport/protocol.js. */
export const FT = {
  RTC_OFFER:   T.RTC_OFFER,      // {id, to, sdp}
  RTC_ANSWER:  T.RTC_ANSWER,     // {id, to, sdp}
  RTC_ICE:     T.RTC_ICE,        // {id, to, candidate}
  FILE_REQ:    T.FILE_REQ,       // {id, to}                 receiver -> holder
  FILE_ACCEPT: "file-accept",    // {id, to, name, size, type, digest, chunkBytes, total}
  FILE_DENY:   "file-deny",      // {id, to, reason}
  FILE_CHUNK:  "file-chunk",     // {id, to, seq, total, crc, b64}   relay fallback
  FILE_DONE:   "file-done",      // {id, to, digest}                 relay fallback
  FILE_CANCEL: "file-cancel",    // {id, to, reason}         either direction
  FILE_ERROR:  "file-error",     // {id, to, reason}
};

/** Exactly the frames main.js should route into onSignal(). */
export const FRAMES = Object.freeze(Object.values(FT));

/**
 * ICE servers. STUN only — a public one, no account, no cost, and it sees only
 * that some IP asked for its own reflexive address. No TURN, deliberately.
 * (This is an endpoint rather than a limit, which is why it is not in
 * config.js; it arguably should be, alongside RELAY_URL.)
 */
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/** 4-byte seq + 4-byte CRC in front of every binary data-channel chunk. */
const CHUNK_HEADER_BYTES = 8;

/**
 * Backpressure. We allow this many chunks to sit in the SCTP send queue before
 * pausing; bufferedAmountLowThreshold is one chunk, so the drain event fires
 * while there is still something to send and the pipe never goes idle.
 * A queue depth, not a product limit.
 */
const SEND_QUEUE_CHUNKS = 8;
const SEND_HIGH_WATER = FILES.CHUNK_BYTES * SEND_QUEUE_CHUNKS;

/**
 * Relay-fallback pacing. PRD §6 caps a connection at 10 messages/sec; we use
 * eight so heartbeats and clips still get through, and so one person's 5 MB
 * file cannot monopolise a shared free-tier relay.
 */
const RELAY_FRAMES_PER_SEC = 8;
const RELAY_FRAME_GAP_MS = Math.ceil(1000 / RELAY_FRAMES_PER_SEC);

/**
 * How long the receiver waits, in ICE timeouts. The holder may spend a whole
 * ICE_TIMEOUT_MS racing before it even starts the relay fallback, so waiting
 * one timeout would abort a transfer that was about to succeed.
 */
const RESPONSE_GRACE = 3;   // nothing at all has arrived
const IDLE_GRACE = 4;       // arrived, then went quiet mid-transfer

/* ------------------------------------------------------------------ *
 * Injected collaborators
 * ------------------------------------------------------------------ */

let sendSignal = null;
let approver = null;
let peerFactory = null;                  // null => the platform's RTCPeerConnection
let iceTimeout = NET.ICE_TIMEOUT_MS;

export function setSignalSender(fn) { sendSignal = typeof fn === "function" ? fn : null; }
export function setApprover(fn) { approver = typeof fn === "function" ? fn : null; }
export function setPeerFactory(fn) { peerFactory = typeof fn === "function" ? fn : null; }

/**
 * The only place an RTCPeerConnection is constructed. Throws rather than
 * returning null when WebRTC is missing, so every caller falls into the same
 * try/catch that leads to the relay — no separate "is WebRTC supported" branch
 * to get out of sync.
 */
function newPeerConnection(config) {
  if (peerFactory) return peerFactory(config);
  if (typeof RTCPeerConnection === "undefined") throw new Error("this browser has no WebRTC");
  return new RTCPeerConnection(config);
}

/** Exposed so the UI can show the ICE deadline honestly rather than a spinner. */
export const iceTimeoutMs = NET.ICE_TIMEOUT_MS;
export const currentIceTimeoutMs = () => iceTimeout;

/**
 * How long the requester will wait before giving up. The approval prompt must
 * not outlive it, or a user could approve a transfer whose other end has
 * already gone home.
 */
export const requestTimeoutMs = () => iceTimeout * RESPONSE_GRACE;

/** Shorten the ICE race. Tests use it; a "slow network" setting could too. */
export function setIceTimeoutMs(ms) {
  iceTimeout = Number.isFinite(ms) && ms > 0 ? ms : NET.ICE_TIMEOUT_MS;
}

/* ------------------------------------------------------------------ *
 * Live transfers
 * ------------------------------------------------------------------ */

/** id -> transfer. Every entry owns timers and possibly an RTCPeerConnection,
 *  so every exit route goes through finish(), which deletes from here. */
const live = new Map();

export const active = () => [...live.values()].map(t => ({
  id: t.id, role: t.role, peer: t.peer, path: t.path, percent: t.percent,
}));

export const isActive = id => live.has(id);

function makeTransfer(id, role, peer) {
  const t = {
    id, role, peer,
    path: null, percent: 0, done: false,
    pc: null, dc: null, rx: null, meta: null,
    pendingIce: [], remoteReady: false,
    iceTimer: null, deadline: null, idleTimer: null,
  };
  live.set(id, t);
  return t;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Ask a peer for a file we only have a thumbnail of. Clicking the tile is the
 * consent, so this side never prompts; the holder prompts before its bytes
 * leave the machine.
 */
export async function request(id) {
  const file = registry.get(id);
  if (!file || file.origin !== "remote") return false;
  if (file.blob) return false;                     // already have the bytes
  if (live.has(id)) return false;                  // already in flight
  if (!file.owner) return fail(id, "we do not know which device holds this file");
  if (!sendSignal) return fail(id, "not connected to the relay");

  const t = makeTransfer(id, "recv", file.owner);
  registry.setState(id, registry.STATE.REQUESTING);
  registry.setProgress(id, 0);
  emit(EV.TOAST, `Requesting ${file.name}…`);

  if (!signal({ t: FT.FILE_REQ, id, to: t.peer })) {
    finish(t);
    return fail(id, "could not reach the relay");
  }

  // The holder may burn a whole ICE timeout before it starts the fallback, so
  // give it several before declaring the request unanswered.
  t.deadline = setTimeout(() => {
    finish(t);
    fail(id, "no response — the other device may be offline");
  }, iceTimeout * RESPONSE_GRACE);

  return true;
}

/** Abort in either direction, tell the peer, and leave nothing behind. */
export function cancel(id, reason = "cancelled") {
  const t = live.get(id);
  if (!t) return false;
  const name = registry.get(id)?.name ?? "transfer";
  signal({ t: FT.FILE_CANCEL, id, to: t.peer, reason });
  finish(t);
  registry.cancel(id);
  emit(EV.TOAST, `Cancelled ${name}`);
  return true;
}

/** Cancel everything — for "leave session". */
export function cancelAll(reason = "session ended") {
  for (const id of [...live.keys()]) cancel(id, reason);
}

/* ------------------------------------------------------------------ *
 * Inbound signalling — the single entry point main.js calls
 * ------------------------------------------------------------------ */

export function onSignal(frame) {
  if (!frame || typeof frame !== "object") return;
  const me = state.get().originId;
  if (frame.originId === me) return;                     // our own echo
  if (frame.to && frame.to !== me) return;               // somebody else's

  const handler = INBOUND[frame.t];
  if (!handler) return;

  // Handlers are async; onSignal is not. A rejection here must surface as a
  // failed transfer, never as an unhandled rejection in the console.
  Promise.resolve()
    .then(() => handler(frame))
    .catch(err => {
      console.error(`[transfer] ${frame.t} failed`, err);
      const t = live.get(frame.id);
      if (t) finish(t);
      fail(frame.id, describe(err));
    });
}

const INBOUND = {
  [FT.FILE_REQ]:    onFileReq,
  [FT.FILE_ACCEPT]: onFileAccept,
  [FT.FILE_DENY]:   f => { closeAndFail(f.id, f.reason || "the other device declined"); },
  [FT.FILE_ERROR]:  f => { closeAndFail(f.id, f.reason || "the transfer failed"); },
  [FT.FILE_CANCEL]: onFileCancel,
  [FT.RTC_OFFER]:   onRtcOffer,
  [FT.RTC_ANSWER]:  onRtcAnswer,
  [FT.RTC_ICE]:     onRtcIce,
  [FT.FILE_CHUNK]:  onFileChunk,
  [FT.FILE_DONE]:   onFileDone,
};

/* ------------------------------------------------------------------ *
 * SEND SIDE — a peer wants a file we hold
 * ------------------------------------------------------------------ */

async function onFileReq(frame) {
  const { id, originId: peer } = frame;
  const file = registry.get(id);

  if (!file?.blob) {
    return signal({ t: FT.FILE_ERROR, id, to: peer, reason: "that file is no longer available" });
  }
  if (live.has(id)) {
    return signal({ t: FT.FILE_ERROR, id, to: peer, reason: "that file is already being sent" });
  }

  const t = makeTransfer(id, "send", peer);
  registry.setState(id, registry.STATE.WAITING);

  if (!(await allowed(file, peer))) {
    finish(t);
    registry.setState(id, registry.STATE.IDLE);
    signal({ t: FT.FILE_DENY, id, to: peer, reason: "the other device declined the request" });
    emit(EV.TOAST, `Declined the request for ${file.name}`);
    return;
  }
  if (t.done) return;                              // cancelled while we prompted

  registry.setState(id, registry.STATE.CONNECTING);
  t.file = file;
  t.digest = await chunker.digest(file.blob);
  if (t.done) return;

  // The relay plan travels now so the fallback needs no second negotiation.
  // The P2P plan rides the data channel itself, because its chunk size is only
  // known once the SCTP association reports its maximum message size.
  const relayPlan = chunker.plan(file.blob, chunker.RELAY_CHUNK_BYTES);
  signal({
    t: FT.FILE_ACCEPT, id, to: peer,
    name: file.name, size: file.size, type: file.type || "",
    digest: t.digest, chunkBytes: relayPlan.chunkBytes, total: relayPlan.total,
  });

  startIceRace(t);
}

/**
 * FR-7.6, the part that matters. Open a peer connection and start a timer
 * against it. Whichever fires first wins: dc.onopen -> direct, or the timer ->
 * tear the whole thing down and push the bytes through the relay.
 *
 * If the browser has no WebRTC at all, or constructing the connection throws,
 * the fallback runs immediately rather than waiting out a pointless five
 * seconds.
 */
function startIceRace(t) {
  let pc;
  try {
    pc = newPeerConnection({ iceServers: ICE_SERVERS });
  } catch (err) {
    // No WebRTC in this environment at all — do not burn five seconds on a
    // race that cannot be won.
    return toRelay(t, describe(err));
  }
  t.pc = pc;

  pc.onicecandidate = ev => {
    if (ev.candidate) signal({ t: FT.RTC_ICE, id: t.id, to: t.peer, candidate: ev.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (t.path) return;
    if (pc.connectionState === "failed") toRelay(t, "the direct connection failed");
  };
  pc.oniceconnectionstatechange = () => {
    if (!t.path && pc.iceConnectionState === "failed") toRelay(t, "ICE failed");
  };

  let dc;
  try {
    dc = pc.createDataChannel(`hopfile-${t.id}`, { ordered: true });
  } catch (err) {
    return toRelay(t, describe(err));
  }
  t.dc = dc;
  dc.binaryType = "arraybuffer";
  dc.bufferedAmountLowThreshold = FILES.CHUNK_BYTES;

  dc.onopen = () => {
    if (t.path) return;                            // the timer already won
    clearTimeout(t.iceTimer);
    t.iceTimer = null;
    setPath(t, PATH.P2P);
    streamOverDataChannel(t).catch(err => abort(t, describe(err)));
  };
  dc.onerror = () => { if (!t.path) toRelay(t, "the data channel errored"); };
  dc.onclose = () => {
    // Closing after we finished is normal; closing mid-transfer is not.
    if (t.path === PATH.P2P && !t.done) abort(t, "the direct connection dropped");
  };

  // THE RACE. Corporate networks block the UDP this needs, so assume it loses.
  t.iceTimer = setTimeout(() => {
    t.iceTimer = null;
    if (t.path) return;
    toRelay(t, `no direct connection after ${iceTimeout >= 1000 ? `${Math.round(iceTimeout / 1000)}s` : `${iceTimeout}ms`}`);
  }, iceTimeout);

  (async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal({ t: FT.RTC_OFFER, id: t.id, to: t.peer, sdp: pc.localDescription });
    } catch (err) {
      if (!t.path) toRelay(t, describe(err));
    }
  })();
}

/** WebRTC lost. Drop it completely — no half-open connection left behind. */
function toRelay(t, why) {
  if (t.done || t.path) return;
  closeRtc(t);
  setPath(t, PATH.RELAY);
  console.info(`[transfer] ${t.id}: falling back to the relay — ${why}`);
  emit(EV.TOAST, `Direct connection unavailable — sending ${t.file?.name ?? "file"} via the relay`);
  streamOverRelay(t).catch(err => abort(t, describe(err)));
}

/* ---- streaming: direct ---- */

async function streamOverDataChannel(t) {
  const { dc, file } = t;
  const chunkBytes = dataChannelChunkBytes(t.pc);
  const p = chunker.plan(file.blob, chunkBytes);

  registry.setState(t.id, registry.STATE.SENDING);
  dc.send(JSON.stringify({
    hdr: 1, id: t.id, name: file.name, type: file.type || "",
    size: p.size, chunkBytes: p.chunkBytes, total: p.total, digest: t.digest,
  }));

  const header = new DataView(new ArrayBuffer(CHUNK_HEADER_BYTES));
  for await (const c of chunker.chunks(file.blob, chunkBytes)) {
    if (t.done || !registry.get(t.id)) return abort(t, "the file went away mid-transfer");
    if (dc.readyState !== "open") return abort(t, "the direct connection closed");

    await drain(t);
    if (t.done) return;

    header.setUint32(0, c.seq);
    header.setUint32(4, c.crc);
    const framed = new Uint8Array(CHUNK_HEADER_BYTES + c.bytes.length);
    framed.set(new Uint8Array(header.buffer), 0);
    framed.set(c.bytes, CHUNK_HEADER_BYTES);
    dc.send(framed.buffer);

    progress(t, ((c.seq + 1) / p.total) * 100);
  }

  if (dc.readyState === "open") dc.send(JSON.stringify({ fin: 1, id: t.id, digest: t.digest }));
  sent(t);
}

/**
 * Pause while the send queue is deep. Without this a 5 MB file is handed to
 * SCTP as fast as the loop can read it and the buffer either balloons or the
 * channel is torn down by the browser.
 */
function drain(t) {
  const dc = t.dc;
  if (!dc || dc.readyState !== "open" || dc.bufferedAmount <= SEND_HIGH_WATER) return Promise.resolve();
  return new Promise(resolve => {
    const release = () => {
      dc.removeEventListener("bufferedamountlow", release);
      dc.removeEventListener("close", release);
      dc.removeEventListener("error", release);
      resolve();
    };
    dc.addEventListener("bufferedamountlow", release);
    dc.addEventListener("close", release);        // never wait on a dead channel
    dc.addEventListener("error", release);
  });
}

/** 32 KB unless the SCTP association says it will not carry that much. */
function dataChannelChunkBytes(pc) {
  const max = pc?.sctp?.maxMessageSize;
  if (!Number.isFinite(max) || max <= 0) return chunker.P2P_CHUNK_BYTES;
  const room = max - CHUNK_HEADER_BYTES;
  return room > 0 ? Math.min(chunker.P2P_CHUNK_BYTES, room) : chunker.P2P_CHUNK_BYTES;
}

/* ---- streaming: relay fallback ---- */

async function streamOverRelay(t) {
  const { file } = t;
  const chunkBytes = chunker.RELAY_CHUNK_BYTES;
  const p = chunker.plan(file.blob, chunkBytes);

  registry.setState(t.id, registry.STATE.SENDING);

  for await (const c of chunker.chunks(file.blob, chunkBytes)) {
    if (t.done || !registry.get(t.id)) return abort(t, "the file went away mid-transfer");

    const put = signal({
      t: FT.FILE_CHUNK, id: t.id, to: t.peer,
      seq: c.seq, total: p.total, crc: c.crc, b64: chunker.toB64(c.bytes),
    });
    if (!put) return abort(t, "lost the relay connection");

    progress(t, ((c.seq + 1) / p.total) * 100);
    if (c.seq + 1 < p.total) await sleep(RELAY_FRAME_GAP_MS);
  }

  signal({ t: FT.FILE_DONE, id: t.id, to: t.peer, digest: t.digest, total: p.total });
  sent(t);
}

/** Our side of a successful send. The file stays local; the bar goes away. */
function sent(t) {
  const name = registry.get(t.id)?.name ?? "file";
  const via = t.path === PATH.RELAY ? "the relay" : "a direct connection";
  finish(t);
  registry.setState(t.id, registry.STATE.IDLE);
  registry.setProgress(t.id, 0);
  emit(EV.TOAST, `Sent ${name} over ${via}`);
}

/* ------------------------------------------------------------------ *
 * RECEIVE SIDE
 * ------------------------------------------------------------------ */

function onFileAccept(frame) {
  const t = live.get(frame.id);
  if (!t || t.role !== "recv") return;
  clearTimeout(t.deadline);
  t.deadline = null;
  // The relay plan. If WebRTC wins, the data channel header replaces it.
  t.meta = {
    id: frame.id, size: frame.size, type: frame.type || "",
    chunkBytes: frame.chunkBytes, total: frame.total, digest: frame.digest,
  };
  registry.setState(frame.id, registry.STATE.CONNECTING);
  armIdle(t);
}

async function onRtcOffer(frame) {
  const t = live.get(frame.id);
  if (!t || t.role !== "recv") return;
  if (t.pc || t.path === PATH.RELAY) return;       // already connected or past it

  let pc;
  try {
    pc = newPeerConnection({ iceServers: ICE_SERVERS });
  } catch (err) {
    // No WebRTC on this side — stay silent and wait. The holder's own ICE race
    // will time out and its relay chunks will arrive on the channel we already
    // have open.
    console.info(`[transfer] ${t.id}: no WebRTC here (${describe(err)}), waiting for relay chunks`);
    return;
  }
  t.pc = pc;

  pc.onicecandidate = ev => {
    if (ev.candidate) signal({ t: FT.RTC_ICE, id: t.id, to: t.peer, candidate: ev.candidate });
  };
  pc.ondatachannel = ev => {
    const dc = ev.channel;
    t.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      if (t.path === PATH.RELAY) return;
      clearTimeout(t.iceTimer);
      t.iceTimer = null;
      setPath(t, PATH.P2P);
      registry.setState(t.id, registry.STATE.RECEIVING);
    };
    dc.onmessage = msg => {
      try { onChannelMessage(t, msg.data); }
      catch (err) { abort(t, describe(err)); }
    };
    dc.onclose = () => { if (t.path === PATH.P2P && !t.done) abort(t, "the direct connection dropped"); };
    dc.onerror = () => { if (t.path === PATH.P2P && !t.done) abort(t, "the direct connection errored"); };
  };

  await pc.setRemoteDescription(frame.sdp);
  t.remoteReady = true;
  await flushIce(t);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  signal({ t: FT.RTC_ANSWER, id: t.id, to: t.peer, sdp: pc.localDescription });

  // Our own copy of the race: if nothing opens we drop the peer connection so
  // it cannot leak, but we do NOT fail — the holder is about to start sending
  // relay chunks and those arrive on a channel that is already open.
  clearTimeout(t.iceTimer);
  t.iceTimer = setTimeout(() => {
    t.iceTimer = null;
    if (t.path) return;
    console.info(`[transfer] ${t.id}: no direct connection, expecting relay chunks`);
    closeRtc(t);
  }, iceTimeout);
}

async function onRtcAnswer(frame) {
  const t = live.get(frame.id);
  if (!t || t.role !== "send" || !t.pc) return;
  await t.pc.setRemoteDescription(frame.sdp);
  t.remoteReady = true;
  await flushIce(t);
}

async function onRtcIce(frame) {
  const t = live.get(frame.id);
  if (!t || !frame.candidate) return;
  // Candidates routinely beat the description they belong to.
  if (!t.pc || !t.remoteReady) { t.pendingIce.push(frame.candidate); return; }
  try { await t.pc.addIceCandidate(frame.candidate); }
  catch (err) { console.warn(`[transfer] ${t.id}: rejected ICE candidate`, err); }
}

async function flushIce(t) {
  const queued = t.pendingIce.splice(0);
  for (const candidate of queued) {
    try { await t.pc?.addIceCandidate(candidate); }
    catch (err) { console.warn(`[transfer] ${t.id}: rejected queued ICE candidate`, err); }
  }
}

/** Data-channel traffic: a JSON header, binary chunks, a JSON terminator. */
function onChannelMessage(t, data) {
  if (typeof data === "string") {
    const msg = JSON.parse(data);
    if (msg.hdr) {
      t.meta = {
        id: t.id, size: msg.size, type: msg.type || "",
        chunkBytes: msg.chunkBytes, total: msg.total, digest: msg.digest,
      };
      t.rx = new chunker.Reassembler(t.meta);
      registry.setState(t.id, registry.STATE.RECEIVING);
      armIdle(t);
      if (t.rx.complete) complete(t);            // zero-byte file: nothing follows
      return;
    }
    if (msg.fin) { if (!t.done) complete(t); }
    return;
  }

  const bytes = chunker.asBytes(data);
  if (bytes.length < CHUNK_HEADER_BYTES) throw new Error("truncated chunk");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seq = view.getUint32(0);
  const crc = view.getUint32(4);
  takeChunk(t, seq, bytes.subarray(CHUNK_HEADER_BYTES), crc);
}

/** Relay fallback data. Its arrival IS the announcement that P2P lost. */
function onFileChunk(frame) {
  const t = live.get(frame.id);
  if (!t || t.role !== "recv") return;
  if (t.path !== PATH.RELAY) {
    closeRtc(t);                                   // the holder gave up; so do we
    setPath(t, PATH.RELAY);
    registry.setState(t.id, registry.STATE.RECEIVING);
  }
  takeChunk(t, frame.seq, chunker.fromB64(frame.b64), frame.crc);
}

function onFileDone(frame) {
  const t = live.get(frame.id);
  if (!t || t.role !== "recv" || t.done) return;
  // A zero-byte file produces no chunks at all, so nothing has built the
  // reassembler yet. Build it now: with total === 0 it is already complete.
  if (!t.rx && t.meta) t.rx = new chunker.Reassembler(t.meta);
  if (t.rx?.complete) complete(t);
  else if (t.rx) abort(t, `transfer ended with ${t.rx.missing().length} chunks missing`);
  else abort(t, "transfer ended before any data arrived");
}

function takeChunk(t, seq, bytes, crc) {
  if (t.done) return;
  if (!t.rx) {
    if (!t.meta) throw new Error("data arrived before the file header");
    t.rx = new chunker.Reassembler(t.meta);
  }
  const r = t.rx.accept({ seq, bytes, crc });
  progress(t, r.percent);
  armIdle(t);
  if (r.complete) complete(t);
}

async function complete(t) {
  if (t.done) return;
  const rx = t.rx;
  const path = t.path ?? PATH.RELAY;
  const name = registry.get(t.id)?.name ?? "file";

  t.done = true;                                   // stop further chunks racing in
  let blob;
  try {
    blob = await rx.finish();                      // verifies the whole-file digest
  } catch (err) {
    finish(t);
    return fail(t.id, describe(err));
  }

  finish(t);
  registry.complete(t.id, blob, path);
  emit(EV.TOAST, path === PATH.RELAY
    ? `${name} received via the relay — not a direct transfer`
    : `${name} received over a direct connection`);
}

/* ------------------------------------------------------------------ *
 * Cancel, failure, cleanup
 * ------------------------------------------------------------------ */

function onFileCancel(frame) {
  const t = live.get(frame.id);
  if (!t) return;
  finish(t);
  registry.cancel(frame.id);
  emit(EV.TOAST, `The other device cancelled ${registry.get(frame.id)?.name ?? "the transfer"}`);
}

/** Our end broke. Tell the peer, tell the user, leave nothing running. */
function abort(t, reason) {
  if (t.done) return;
  signal({ t: FT.FILE_ERROR, id: t.id, to: t.peer, reason });
  finish(t);
  fail(t.id, reason);
}

function closeAndFail(id, reason) {
  const t = live.get(id);
  if (t) finish(t);
  fail(id, reason);
}

function fail(id, reason) {
  registry.fail(id, reason);
  return false;
}

/** Close the peer connection but keep the transfer alive for the fallback. */
function closeRtc(t) {
  clearTimeout(t.iceTimer);
  t.iceTimer = null;
  if (t.dc) {
    t.dc.onopen = t.dc.onmessage = t.dc.onclose = t.dc.onerror = null;
    try { t.dc.close(); } catch { /* already gone */ }
    t.dc = null;
  }
  if (t.pc) {
    t.pc.onicecandidate = t.pc.ondatachannel = null;
    t.pc.onconnectionstatechange = t.pc.oniceconnectionstatechange = null;
    try { t.pc.close(); } catch { /* already gone */ }
    t.pc = null;
  }
  t.pendingIce.length = 0;
  t.remoteReady = false;
}

/** The one exit route. Every path out of a transfer ends here. */
function finish(t) {
  t.done = true;
  clearTimeout(t.deadline); t.deadline = null;
  clearTimeout(t.idleTimer); t.idleTimer = null;
  closeRtc(t);
  if (t.rx && !t.rx.complete) t.rx.abort();        // release up to 5 MB
  t.rx = null;
  t.file = null;
  live.delete(t.id);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function signal(frame) {
  if (!sendSignal) {
    console.warn("[transfer] no signal sender wired — main.js must call setSignalSender()");
    return false;
  }
  frame.originId = state.get().originId;
  try { return sendSignal(frame) !== false; }
  catch (err) {
    console.error("[transfer] signal send threw", err);
    return false;
  }
}

/**
 * Approval. autoaccept short-circuits it; otherwise the UI decides. With no
 * approver installed we deny, because failing open here means anyone holding
 * the session key silently pulls any file (docs/P2P-FILES.md §6).
 */
async function allowed(file, peer) {
  if (state.get().settings.autoaccept) return true;
  if (!approver) {
    console.warn("[transfer] no approver wired — denying. ui/filesPanel.js should call setApprover()");
    return false;
  }
  try {
    return !!(await approver({
      id: file.id, name: file.name, size: file.size, type: file.type, from: peer,
    }));
  } catch (err) {
    console.error("[transfer] approver threw — denying", err);
    return false;
  }
}

function setPath(t, path) {
  t.path = path;
  registry.setPath(t.id, path);                    // emits EV.TRANSFER_PATH
}

function progress(t, percent) {
  const next = Math.max(0, Math.min(100, Math.round(percent)));
  if (next === t.percent) return;
  t.percent = next;
  registry.setProgress(t.id, next);
}

/** Nothing at all for a while means the peer vanished mid-transfer. */
function armIdle(t) {
  clearTimeout(t.idleTimer);
  t.idleTimer = setTimeout(() => {
    if (t.done) return;
    abort(t, "the transfer stalled — the other device stopped responding");
  }, iceTimeout * IDLE_GRACE);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const describe = err => (err?.message || String(err || "unknown error"));
