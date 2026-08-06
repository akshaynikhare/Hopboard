/** Share-key generation and normalisation. */

import { KEY } from "./config.js";

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

/** Read the key from the URL fragment. The fragment is never sent to a server. */
export function fromUrl() {
  return normalise(location.hash.slice(1));
}

export function toUrl(key) {
  location.hash = normalise(key);
}

export function shareLink(key) {
  return `${location.origin}${location.pathname}#${normalise(key)}`;
}
