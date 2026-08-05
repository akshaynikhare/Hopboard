/**
 * Every tunable constant. Nothing else in the app hard-codes a limit —
 * if you find a magic number elsewhere, it belongs here.
 */

/**
 * Relay endpoint.
 *
 * Must be wss:// in production: the site is served over HTTPS from GitHub
 * Pages, and a browser refuses a ws:// connection from an https:// page as
 * mixed content. Localhost is exempt from that rule, which is why the dev
 * branch can stay ws://.
 */
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

export const RELAY_URL = IS_LOCAL
  ? "ws://127.0.0.1:8000"
  : "wss://hopboard.fastapicloud.dev";

export const TEXT = {
  MAX_CHARS: 50_000,          // PRD FR-2.8
  SUPPRESS_MS: 1500,          // loop-suppression window after applying a remote clip (FR-2.6)
};

export const FILES = {
  MAX_BYTES: 5 * 1024 * 1024, // 5 MB per file (FR-7.1)
  MAX_COUNT: 20,              // per session, memory only (FR-7.7)
  THUMB_PX: 160,              // longest edge (FR-7.2)
  THUMB_QUALITY: 0.7,
  CHUNK_BYTES: 32 * 1024,     // relay-fallback chunk, matches the relay frame cap (FR-7.6)
};

export const KEY = {
  // Crockford-ish: no 0/O, no 1/I/L. Ambiguity here becomes a support ticket.
  ALPHABET: "23456789ABCDEFGHJKMNPQRSTVWXYZ",
  LENGTH: 6,                  // PRD D3
  LONG_LENGTH: 10,            // "high security" option
};

export const CRYPTO = {
  SALT: "hopboard-v1",
  ITERATIONS: 250_000,        // PBKDF2; derive once per session and cache (OI-8)
  ROOM_HASH_BYTES: 16,
};

export const NET = {
  HEARTBEAT_MS: 30_000,       // must beat proxy idle reaping (PRD 5.4, FR-3.6)
  BACKOFF_MIN_MS: 1_000,
  BACKOFF_MAX_MS: 30_000,
  ICE_TIMEOUT_MS: 5_000,      // then fall back to relay chunks (FR-7.6)
};

export const POLL_OPTIONS = { "Off": 0, "500ms": 500, "1s": 1000, "2s": 2000 };
