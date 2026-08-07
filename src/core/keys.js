/** Share-key generation and normalisation. */

import { KEY, LOCK } from "./config.js";
import * as state from "./state.js";

// Modulo bias: 256 does not divide 30, costing ~0.03 bits over a 6-char key.
export function generate(length = KEY.LENGTH) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => KEY.ALPHABET[b % KEY.ALPHABET.length]).join("");
}

/**
 * Bits of entropy in a key of this length: 6 chars ≈ 29.4, 10 chars ≈ 49.1.
 *
 * PBKDF2 multiplies the cost of each guess but does not change the shape of the
 * problem. This exists so the UI can state the trade-off in numbers.
 */
export function entropyBits(length) {
  return Math.log2(KEY.ALPHABET.length) * length;
}

export const LENGTHS = { NORMAL: KEY.LENGTH, LONG: KEY.LONG_LENGTH };

// One implementation: the first-run key and the collision retry both used to
// emit six characters however the app was configured.
export const nextLength = () =>
  state.get().settings.longKeys ? LENGTHS.LONG : LENGTHS.NORMAL;

/**
 * Normalise before ANY use — hashing, comparison, display.
 *
 * The room name is a hash of the key, so "D75LV" and "d75lv" would drop two
 * users into different rooms while both believe they typed the same thing.
 */
export function normalise(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Deliberately more permissive than the generation alphabet.
 *
 * KEY.ALPHABET constrains what we PRODUCE. Validation must accept anything a
 * peer might legitimately hand us: a key from another build is still a valid
 * hash input, and rejecting an in-use key strands the user with no way to join.
 * "D75LV" contains an L, which the generator never emits, and still has to work.
 */
export function isValid(raw) {
  const k = normalise(raw);
  return k.length >= 4 && k.length <= 32;
}

/**
 * Bits of entropy in a PIN, from the character classes it actually uses.
 *
 * Deliberately pessimistic — it assumes an attacker who knows the alphabet you
 * drew from, so "123456" reports ~20 bits rather than a flattering ~39. A PIN is
 * guessed by someone who may already hold the link, where it is the entire
 * remaining secret.
 */
export function pinEntropyBits(pin) {
  const p = String(pin ?? "");
  if (!p) return 0;
  let alphabet = 0;
  if (/[a-z]/.test(p)) alphabet += 26;
  if (/[A-Z]/.test(p)) alphabet += 26;
  if (/[0-9]/.test(p)) alphabet += 10;
  if (/[^a-zA-Z0-9]/.test(p)) alphabet += 33;      // printable ASCII punctuation
  return Math.log2(alphabet) * p.length;
}

/**
 * A locked session's link carries a marker but never the PIN: `#!ABCDEF`.
 *
 * Parsing happens BEFORE normalise(), and that order is load-bearing:
 * normalise() strips everything outside [A-Z0-9], so running it first turns
 * "#!ABCDEF" into the valid, completely different key "ABCDEF". That is also how
 * an older build fails safely — it joins the empty unlocked room and learns
 * nothing.
 */
export const LOCK_SIGIL = LOCK.SIGIL;

export function parseFragment(raw) {
  const s = String(raw ?? "").trim();
  const locked = s.startsWith(LOCK.SIGIL);
  return { key: normalise(locked ? s.slice(LOCK.SIGIL.length) : s), locked };
}

/** The inverse of parseFragment, and tested as such. */
export function fragment(key, locked = false) {
  return (locked ? LOCK.SIGIL : "") + normalise(key);
}

/** The fragment is never sent to a server. */
export function fromUrl() {
  return parseFragment(location.hash.slice(1));
}

export function toUrl(key, locked = false) {
  location.hash = fragment(key, locked);
}

/**
 * Drop the key out of the address bar without navigating, for the one case where
 * the session is not merely over but closed to this device (main.js onEvicted).
 * The fragment is what boot() reads first, so leaving it in place makes every
 * reload rejoin a room we have been ejected from.
 *
 * replaceState, not `location.hash = ""` — that leaves a bare "#" and pushes a
 * history entry, so Back would restore the dead key.
 */
export function clearUrl() {
  history.replaceState(null, "", location.pathname + location.search);
}

export function shareLink(key, locked = false) {
  return `${location.origin}${location.pathname}#${fragment(key, locked)}`;
}
