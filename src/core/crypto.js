/**
 * End-to-end encryption. All of it. No libraries.
 *
 *   OPEN    roomHash = SHA-256("realtimeclipboard:" + KEY)[0..16]  -> sent
 *           aesKey   = PBKDF2(KEY, salt, 250k)                     -> never sent
 *
 *   LOCKED  prk       = PBKDF2(PIN, "realtimeclipboard-lock-v1:" + KEY, 600k)
 *           aesKey    = HKDF(prk, "…/aes")
 *           roomHash  = HKDF(prk, "…/room")   -> sent
 *           authToken = HKDF(prk, "…/auth")   -> sent, proves PIN knowledge
 *
 * The room hash requiring the PIN is the load-bearing part: it turns "you cannot
 * read it" into "you cannot find it". Someone holding the link but not the PIN
 * computes a different room hash and never appears in the real room at all — no
 * peer slot, no roster entry, no traffic metadata. Locked and unlocked rooms of
 * the same key are disjoint for the same reason. See PRD §7.3.
 */

import { CRYPTO } from "./config.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Derivation is expensive (OI-8), so cache per key for the session. */
let cached = { id: null, aesKey: null };

export async function roomHash(key) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode("realtimeclipboard:" + key));
  return hex(new Uint8Array(digest).slice(0, CRYPTO.ROOM_HASH_BYTES));
}

/**
 * Several hundred ms on a low-end Android, so call once per session and show an
 * "unlocking" state — never per message.
 */
export async function deriveKey(key) {
  if (cached.id === `open:${key}` && cached.aesKey) return cached.aesKey;

  const material = await crypto.subtle.importKey(
    "raw", enc.encode(key), "PBKDF2", false, ["deriveKey"]
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(CRYPTO.SALT),
      iterations: CRYPTO.ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  cached = { id: `open:${key}`, aesKey };
  return aesKey;
}

/* ---- locked sessions ---- */

/**
 * The exact opposite of what normalise() does to a key, and getting it backwards
 * is silent.
 *
 *   - NFC is mandatory. "é" as one code point and as "e" + combining accent are
 *     different byte strings deriving different rooms, and nothing reports it —
 *     the second device is simply alone, looking like a wrong PIN.
 *   - Trim the ends: a pasted trailing space is invisible on screen.
 *   - Keep case and the middle. A PIN is never read aloud and retyped, so
 *     uppercasing would throw away a bit per letter to buy nothing.
 */
export function normalisePin(raw) {
  return String(raw ?? "").normalize("NFC").trim();
}

/**
 * One PBKDF2, three outputs. PBKDF2 reruns its full iteration count per 32-byte
 * block, so asking it for 64 bytes would cost double; stretch once and expand
 * with HKDF, which is a couple of HMACs.
 *
 * The share key as salt stops ONE table covering every session — the open path,
 * with its single global salt, has exactly that weakness. It buys nothing
 * against the attacker this feature is for: someone holding the link can compute
 * the salt. Only PIN length and iteration count defend there, which is why the
 * dialog reports entropy in bits rather than calling a short PIN "secure".
 *
 * Returns `prk` as hex so a refresh can skip the 600k iterations.
 */
export async function deriveLocked(key, pin) {
  const prk = await stretch(key, normalisePin(pin));
  return { ...(await expand(prk)), prk: hex(new Uint8Array(prk)) };
}

/** Same outputs, from a remembered prk. No PBKDF2, so this is instant. */
export async function deriveLockedFromPrk(prkHex) {
  return { ...(await expand(unhex(prkHex))), prk: prkHex };
}

async function stretch(key, pin) {
  const material = await crypto.subtle.importKey(
    "raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(CRYPTO.LOCK_SALT + key),
      iterations: CRYPTO.LOCK_ITERATIONS, hash: "SHA-256" },
    material,
    256
  );
}

async function expand(prk) {
  const ikm = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits", "deriveKey"]);
  const info = i => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(i) });

  const [aesKey, room, auth] = await Promise.all([
    crypto.subtle.deriveKey(
      info(CRYPTO.LOCK_INFO.AES), ikm,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    ),
    crypto.subtle.deriveBits(info(CRYPTO.LOCK_INFO.ROOM), ikm, CRYPTO.ROOM_HASH_BYTES * 8),
    crypto.subtle.deriveBits(info(CRYPTO.LOCK_INFO.AUTH), ikm, CRYPTO.ROOM_HASH_BYTES * 8),
  ]);

  return {
    aesKey,
    roomHash:  hex(new Uint8Array(room)),
    authToken: hex(new Uint8Array(auth)),
  };
}

// No locked-session cache on purpose: the path runs once per session, and the
// things that DO call it again — a corrected PIN, a rotated key — are exactly
// where the previous answer must not be reused. The stored prk covers refresh.

/** -> {payload, iv} both base64. A fresh IV per message is mandatory for GCM. */
export async function encrypt(aesKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, aesKey, enc.encode(plaintext)
  );
  return { payload: toB64(buf), iv: toB64(iv) };
}

export async function decrypt(aesKey, payloadB64, ivB64) {
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) }, aesKey, fromB64(payloadB64)
  );
  return dec.decode(buf);
}

// Called on leaving a session and on rotating the key. This had no callers for
// years, so the AES key of a room you walked out of stayed live until you opened
// another one.
export function clearCache() { cached = { id: null, aesKey: null }; }

/* ---- hex helpers ---- */
function hex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
function unhex(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/* ---- base64 helpers (binary-safe) ---- */
function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));   // chunked: avoids arg limit
  }
  return btoa(s);
}
function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
