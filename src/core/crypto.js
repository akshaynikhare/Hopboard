/**
 * End-to-end encryption. All of it. No libraries.
 *
 * OPEN SESSION — the key the user types serves two purposes without the server
 * learning it:
 *
 *   roomHash = SHA-256("realtimeclipboard:" + KEY)[0..16]   -> sent, routes the room
 *   aesKey   = PBKDF2(KEY, salt, 250k)             -> never leaves this browser
 *
 * LOCKED SESSION — a PIN that is never in the link, never on disk and never
 * sent anywhere. It is folded into ONE PBKDF2 run whose output is expanded by
 * HKDF into three independent values:
 *
 *   prk       = PBKDF2(PIN, salt = "realtimeclipboard-lock-v1:" + KEY, 600k)
 *   aesKey    = HKDF(prk, "…/aes")    -> AES-GCM-256
 *   roomHash  = HKDF(prk, "…/room")   -> sent, routes the room
 *   authToken = HKDF(prk, "…/auth")   -> sent, proves PIN knowledge to the relay
 *
 * The room hash requiring the PIN is the load-bearing part: it is what turns
 * "you cannot read it" into "you cannot find it". Someone holding the link but
 * not the PIN computes a different room hash, lands in a different room, and
 * never appears in the real one at all — no peer slot, no roster entry, no
 * traffic metadata. Locked and unlocked rooms with the same key are likewise
 * disjoint, so the two kinds of client can never meet and fail to decrypt each
 * other.
 *
 * The relay cannot derive the key from the hash, so it cannot decrypt. It sees
 * a room name and ciphertext, and nothing else. See PRD §7.3.
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
 * Derive the AES key. Several hundred ms on a low-end Android, so call once
 * per session and show an "unlocking" state — never per message.
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

/* ------------------------------------------------------------------
   Locked sessions
------------------------------------------------------------------- */

/**
 * Normalise a PIN — the exact OPPOSITE of what normalise() does to a key, and
 * the reasoning is worth keeping because getting it backwards is silent.
 *
 * A key is uppercased and stripped to [A-Z0-9] so that two people typing "the
 * same key" land in the same room. A PIN is user-chosen prose, so:
 *
 *   - NFC, mandatory. "é" can be typed as one code point or as "e" plus a
 *     combining accent. They are different byte strings, they derive different
 *     rooms, and NOTHING would report it — the second device would simply be
 *     alone in a room of its own, looking like a wrong PIN.
 *   - Trim the ends. A trailing space from a paste is invisible on screen and
 *     the user has no way to see why their correct PIN is rejected.
 *   - Keep case and everything in the middle. Uppercasing would throw away
 *     about a bit per letter to buy nothing: unlike a key, a PIN is never read
 *     aloud off a screen and retyped from memory.
 */
export function normalisePin(raw) {
  return String(raw ?? "").normalize("NFC").trim();
}

/**
 * The whole locked-session derivation: one PBKDF2, three outputs.
 *
 * PBKDF2 reruns its full iteration count for every 32-byte block of output, so
 * asking it for the 64 bytes we need would cost twice what it should — and OI-8
 * already flags this as hundreds of milliseconds on a low-end Android. Instead
 * we stretch once and expand with HKDF, which is a couple of HMACs.
 *
 * The share key is the salt, and it is worth being precise about what that does
 * and does not buy. It stops ONE table from covering every session — the
 * open-session path, with its single global CRYPTO.SALT, has exactly that
 * weakness today. It buys nothing at all against the attacker this feature is
 * actually for: someone holding the link holds the key, so they can compute the
 * salt themselves. Against them the only defence is the length of the PIN and
 * the iteration count, which is why the dialog reports entropy in bits instead
 * of calling a short PIN "secure".
 *
 * Returns `prk` as hex alongside the derived values so a page refresh can skip
 * the 600k iterations. See storage.saveLock for why the PIN itself is never
 * what gets stored.
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

/**
 * No cache entry for locked sessions, deliberately.
 *
 * The open-session cache exists because deriveKey() is called with the same key
 * repeatedly. The locked path is not: it runs once per session, a reconnect
 * reuses the room hash without re-deriving, and the only things that DO call it
 * again — a corrected PIN, a rotated key — are the cases where the previous
 * answer is exactly the one you must not reuse. The refresh path is covered by
 * the stored prk instead, which is cheaper than a cache and survives the tab
 * being reloaded.
 */

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

/**
 * Forget the derived key.
 *
 * Called on leaving a session and on rotating the key. For years this had no
 * callers at all, which meant the AES key of a room you had deliberately walked
 * out of stayed live in this module until you happened to open another one.
 */
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
