/**
 * Chunking and reassembly. Pure data, no DOM, no network — which is exactly why
 * it lives on its own: this is the part that must be provably byte-exact, and it
 * is the only part of the transfer stack that can be tested without a browser.
 *
 * Both transfer paths share it:
 *
 *   P2P   — chunks go out as ArrayBuffers on an RTCDataChannel, in order,
 *           P2P_CHUNK_BYTES at a time.
 *   relay — the same chunks, base64'd into JSON frames, RELAY_CHUNK_BYTES at a
 *           time (smaller — see the note on the wire budget below).
 *
 * The receiver does not care which one it is on. It is handed {seq, bytes} in
 * any order and writes each slice into a preallocated buffer at seq*chunkBytes,
 * so out-of-order and duplicate arrival are both non-events.
 *
 * Integrity is checked twice, at two different granularities:
 *   - CRC-32 per chunk, so a corrupt frame is caught where it happened rather
 *     than as a mysterious whole-file mismatch 5 MB later;
 *   - SHA-256 over the whole file, computed by the sender and re-computed after
 *     reassembly, which is the actual guarantee that the Blob we hand the
 *     registry is identical to the one that left the other machine.
 */

import { FILES } from "../core/config.js";

/* ------------------------------------------------------------------ *
 * Chunk sizes
 *
 * FILES.CHUNK_BYTES (32 KB) is the tunable. The P2P path uses it as-is:
 * a data channel carries binary, so 32 KB of file is 32 KB on the wire.
 *
 * The relay path CANNOT use it as-is, and docs/P2P-FILES.md §5 is wrong to say
 * that 32 KB "matches the existing relay frame cap — no protocol change".
 * The relay's cap is 32 KB per *JSON message* (PRD §6), and bytes do not
 * survive JSON: base64 inflates by 4/3, and the payload is encrypted before it
 * is encoded, which inflates it again. A 32 KB slice arrives at the relay as
 * ~58 KB and comes back as TOO_LARGE. So the relay path sends the largest raw
 * slice whose fully-encoded frame still fits inside one relay message.
 *
 * These two numbers are protocol arithmetic derived from the one limit in
 * config.js, not new limits — but RELAY_CHUNK_BYTES arguably belongs in
 * config.js next to CHUNK_BYTES. Left here because config.js is not ours.
 * ------------------------------------------------------------------ */

export const P2P_CHUNK_BYTES = FILES.CHUNK_BYTES;

/** Worst case: bytes -> base64 -> AES-GCM -> base64 again. */
const WIRE_EXPANSION = (4 / 3) * (4 / 3);

/** JSON scaffold: {t,id,to,originId,seq,total,crc,iv,b64:"…"} with 8-char ids. */
const FRAME_OVERHEAD_BYTES = 512;

export const RELAY_CHUNK_BYTES = Math.max(
  3,
  Math.floor((FILES.CHUNK_BYTES - FRAME_OVERHEAD_BYTES) / WIRE_EXPANSION / 3) * 3,
);

/* ------------------------------------------------------------------ *
 * Plan
 * ------------------------------------------------------------------ */

/** Number of chunks a file of `size` needs. Zero-byte files need zero chunks. */
export function chunkCount(size, chunkBytes = P2P_CHUNK_BYTES) {
  if (!(size > 0)) return 0;
  return Math.ceil(size / chunkBytes);
}

/** Byte length of chunk `seq` — the last one is usually short. */
export function chunkLength(size, chunkBytes, seq) {
  const offset = seq * chunkBytes;
  if (offset >= size) return 0;
  return Math.min(chunkBytes, size - offset);
}

/** The header a receiver needs before it can accept anything. */
export function plan(blob, chunkBytes = P2P_CHUNK_BYTES) {
  const size = blob?.size ?? 0;
  return { size, chunkBytes, total: chunkCount(size, chunkBytes) };
}

/**
 * Yield the file one chunk at a time. Async and lazy on purpose: it reads each
 * slice only when the consumer is ready for it, so a paused (backpressured)
 * data channel does not pull 5 MB into memory ahead of itself.
 */
export async function* chunks(blob, chunkBytes = P2P_CHUNK_BYTES) {
  const { size, total } = plan(blob, chunkBytes);
  for (let seq = 0; seq < total; seq++) {
    const offset = seq * chunkBytes;
    const bytes = await sliceBytes(blob, offset, Math.min(offset + chunkBytes, size));
    yield { seq, total, offset, bytes, crc: crc32(bytes) };
  }
}

/** One chunk by index — used for retries without restarting the generator. */
export async function chunkAt(blob, seq, chunkBytes = P2P_CHUNK_BYTES) {
  const size = blob?.size ?? 0;
  const offset = seq * chunkBytes;
  if (offset >= size) return null;
  const bytes = await sliceBytes(blob, offset, Math.min(offset + chunkBytes, size));
  return { seq, offset, bytes, crc: crc32(bytes) };
}

async function sliceBytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/* ------------------------------------------------------------------ *
 * Reassembly
 * ------------------------------------------------------------------ */

export class Reassembler {
  /**
   * @param {object} header {id, size, chunkBytes, total, type, digest}
   *   `digest` is the sender's SHA-256 hex. Omitting it is allowed but then
   *   finish() can only prove the length, not the content.
   */
  constructor({ id = "", size = 0, chunkBytes = P2P_CHUNK_BYTES, total, type = "", digest = null } = {}) {
    this.id = id;
    this.size = size;
    this.chunkBytes = chunkBytes;
    this.total = Number.isInteger(total) ? total : chunkCount(size, chunkBytes);
    this.type = type;
    this.digest = digest;

    this.buffer = new Uint8Array(size);
    this.have = new Uint8Array(this.total);   // 1 byte per chunk; 5 MB => 160 bytes
    this.received = 0;
    this.bytesReceived = 0;
    this.aborted = false;
  }

  get complete() { return !this.aborted && this.received >= this.total; }

  /** 0-100. A zero-byte file is complete the moment it starts. */
  get percent() {
    if (this.total === 0) return 100;
    return Math.floor((this.received / this.total) * 100);
  }

  /**
   * Take one chunk. Order is irrelevant; duplicates are ignored rather than
   * treated as an error, because a retry after a flaky relay is normal.
   *
   * @returns {{stored:boolean, duplicate:boolean, percent:number, complete:boolean}}
   * @throws  on a seq outside the plan, a wrong length, or a CRC mismatch —
   *          all three mean the sender and receiver disagree about the file,
   *          and continuing would produce a silently corrupt Blob.
   */
  accept({ seq, bytes, crc }) {
    if (this.aborted) return this.#status(false, false);
    if (!Number.isInteger(seq) || seq < 0 || seq >= this.total) {
      throw new RangeError(`chunk ${seq} is outside the plan (0..${this.total - 1})`);
    }

    const view = asBytes(bytes);
    const expected = chunkLength(this.size, this.chunkBytes, seq);
    if (view.length !== expected) {
      throw new RangeError(`chunk ${seq} is ${view.length} bytes, expected ${expected}`);
    }
    if (crc != null && crc32(view) !== (crc >>> 0)) {
      throw new Error(`chunk ${seq} failed its checksum`);
    }

    if (this.have[seq]) return this.#status(false, true);

    this.buffer.set(view, seq * this.chunkBytes);
    this.have[seq] = 1;
    this.received++;
    this.bytesReceived += view.length;
    return this.#status(true, false);
  }

  #status(stored, duplicate) {
    return { stored, duplicate, percent: this.percent, complete: this.complete };
  }

  /** Which chunks are still outstanding — the basis of any retry logic. */
  missing() {
    const gaps = [];
    for (let seq = 0; seq < this.total; seq++) if (!this.have[seq]) gaps.push(seq);
    return gaps;
  }

  /** Raw bytes, for tests and for callers that do not want a Blob. */
  bytes() {
    if (!this.complete) throw new Error(`incomplete: ${this.missing().length} chunks missing`);
    return this.buffer;
  }

  /**
   * The finished file. Verifies the whole-file digest before handing anything
   * back, so a caller can treat a returned Blob as byte-identical to the
   * source and a throw as "do not save this".
   */
  async finish() {
    if (this.aborted) throw new Error("transfer was cancelled");
    if (!this.complete) throw new Error(`incomplete: ${this.missing().length} chunks missing`);
    if (this.bytesReceived !== this.size) {
      throw new Error(`size mismatch: ${this.bytesReceived} of ${this.size} bytes`);
    }
    if (this.digest) {
      const got = await digest(this.buffer);
      if (got !== this.digest) throw new Error("checksum mismatch — the file arrived corrupt");
    }
    return new Blob([this.buffer], this.type ? { type: this.type } : undefined);
  }

  /** Drop the buffer. Called on cancel so a 5 MB abort does not linger. */
  abort() {
    this.aborted = true;
    this.buffer = new Uint8Array(0);
    this.have = new Uint8Array(0);
  }
}

/* ------------------------------------------------------------------ *
 * Integrity
 * ------------------------------------------------------------------ */

let CRC_TABLE = null;

export function crc32(input) {
  const bytes = asBytes(input);
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** SHA-256 hex of a Blob or byte buffer. crypto.subtle, no library. */
export async function digest(source) {
  const bytes = typeof Blob !== "undefined" && source instanceof Blob
    ? new Uint8Array(await source.arrayBuffer())
    : asBytes(source);
  // A Uint8Array view may not start at 0, and subtle hashes the whole buffer.
  const exact = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  const hash = await crypto.subtle.digest("SHA-256", exact);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ *
 * Wire encoding (relay path only — the data channel carries binary)
 * ------------------------------------------------------------------ */

export function toB64(input) {
  const bytes = asBytes(input);
  let s = "";
  // Chunked: String.fromCharCode(...bytes) blows the argument limit past ~64 K.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === "string") return fromB64(input);
  throw new TypeError("expected bytes, an ArrayBuffer, or base64");
}
