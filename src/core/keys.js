/** Share-key generation and normalisation. */

import { KEY, LOCK } from "./config.js";

/**
 * Cryptographically random key from the unambiguous alphabet.
 *
 * Note the modulo bias: 256 does not divide 30, so the first 16 letters of the
 * alphabet are very slightly likelier than the last 14. The effect is about
 * 0.03 bits over a 6-character key — irrelevant next to the 30-bit total, and
 * called out here so nobody has to rediscover it.
 */
export function generate(length = KEY.LENGTH) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => KEY.ALPHABET[b % KEY.ALPHABET.length]).join("");
}

/**
 * Bits of entropy in a key of this length, given the 30-letter alphabet.
 *
 *   6 chars  ≈ 29.4 bits   — the default. Convenient, and brute-forceable
 *                            offline by anyone who captured ciphertext.
 *  10 chars  ≈ 49.1 bits   — ~1.6 million times harder, still typeable.
 *
 * PBKDF2 at 250k iterations multiplies the cost of each guess, but it does not
 * change the shape of the problem: short keys are a convenience decision, and
 * this function exists so the UI can say so in numbers rather than adjectives.
 */
export function entropyBits(length) {
  return Math.log2(KEY.ALPHABET.length) * length;
}

export const LENGTHS = { NORMAL: KEY.LENGTH, LONG: KEY.LONG_LENGTH };

/**
 * Normalise before ANY use — hashing, comparison, display.
 *
 * This matters more than it looks: the room name is a hash of the key, and
 * "D75LV" and "d75lv" hash differently. Skipping this silently drops two users
 * into different rooms while both believe they typed the same key.
 * Verified in docs/M0-RESULTS.md §6.
 */
export function normalise(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Deliberately more permissive than the generation alphabet.
 *
 * KEY.ALPHABET exists so generated keys are unambiguous when read aloud or
 * retyped — it is a constraint on what we PRODUCE. Validation must accept
 * anything a peer might legitimately hand us, because:
 *
 *   - a key shared from another build (or a future alphabet) is still valid;
 *     the room name is a hash, and a hash accepts any input
 *   - rejecting an in-use key strands the user with no way to join
 *
 * "D75LV" is the worked example throughout the docs and contains an L, which
 * the generator will never emit. It still has to work.
 */
export function isValid(raw) {
  const k = normalise(raw);
  return k.length >= 4 && k.length <= 32;
}

/**
 * Bits of entropy in a PIN, estimated from the character classes it actually
 * uses rather than from its length alone.
 *
 * Deliberately pessimistic — it assumes an attacker who knows the alphabet you
 * drew from, which is the only assumption worth making about someone running an
 * offline attack. "123456" is counted as six digits, not six printable ASCII
 * characters, so the dialog reports ~20 bits and not a flattering ~39.
 *
 * The number matters more here than it does for a key. A key is guessed from
 * nothing; a PIN is guessed by someone who may already hold the link, and at
 * that point it is the entire remaining secret.
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

/* ------------------------------------------------------------------
   The fragment

   A locked session's link carries a marker but never the PIN: `#!ABCDEF`.
   That a session is locked is not a secret — the PIN is — and the app has to
   know before it derives anything, because the marker is what decides which of
   two completely different derivations to run.

   Parsing happens BEFORE normalise(), and that ordering is load-bearing:
   normalise() strips everything outside [A-Z0-9], so running it first turns
   "#!ABCDEF" into the perfectly valid, completely different key "ABCDEF".

   An older build has no idea about any of this. It normalises the fragment,
   drops the "!", and joins the UNLOCKED room named ABCDEF — a different room
   from the locked one, which it cannot address. It finds an empty room and
   learns nothing, which is the correct way for this to fail.
------------------------------------------------------------------- */

export const LOCK_SIGIL = LOCK.SIGIL;

/** Split a raw fragment into its key and its lock flag. */
export function parseFragment(raw) {
  const s = String(raw ?? "").trim();
  const locked = s.startsWith(LOCK.SIGIL);
  return { key: normalise(locked ? s.slice(LOCK.SIGIL.length) : s), locked };
}

/** Build one. The inverse of parseFragment, and tested as such. */
export function fragment(key, locked = false) {
  return (locked ? LOCK.SIGIL : "") + normalise(key);
}

/** Read the key from the URL fragment. The fragment is never sent to a server. */
export function fromUrl() {
  return parseFragment(location.hash.slice(1));
}

export function toUrl(key, locked = false) {
  location.hash = fragment(key, locked);
}

export function shareLink(key, locked = false) {
  return `${location.origin}${location.pathname}#${fragment(key, locked)}`;
}
