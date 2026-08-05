/** Share-key generation and normalisation. */

import { KEY } from "./config.js";

/** Cryptographically random key from the unambiguous alphabet. */
export function generate(length = KEY.LENGTH) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => KEY.ALPHABET[b % KEY.ALPHABET.length]).join("");
}

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
