/**
 * End-to-end encryption. All of it. No libraries.
 *
 * The key the user types serves two purposes without the server learning it:
 *
 *   roomHash = SHA-256("hopboard:" + KEY)[0..16]   -> sent, routes the room
 *   aesKey   = PBKDF2(KEY, salt, 250k)             -> never leaves this browser
 *
 * The relay cannot derive the key from the hash, so it cannot decrypt. It sees
 * a room name and ciphertext, and nothing else. See PRD §7.3.
 */

import { CRYPTO } from "./config.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Derivation is expensive (OI-8), so cache per key for the session. */
let cached = { key: null, aesKey: null };

export async function roomHash(key) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode("hopboard:" + key));
  return [...new Uint8Array(digest).slice(0, CRYPTO.ROOM_HASH_BYTES)]
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Derive the AES key. Several hundred ms on a low-end Android, so call once
 * per session and show an "unlocking" state — never per message.
 */
export async function deriveKey(key) {
  if (cached.key === key && cached.aesKey) return cached.aesKey;

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
  cached = { key, aesKey };
  return aesKey;
}

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

export function clearCache() { cached = { key: null, aesKey: null }; }

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
