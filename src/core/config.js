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
// Guarded: this module is imported by node-based tests where `location` does
// not exist, and a bare reference would throw at import time and take the whole
// graph down.
const IS_LOCAL = typeof location !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

export const RELAY_URL = IS_LOCAL
  ? "ws://127.0.0.1:8000"
  : "wss://hopboard.fastapicloud.dev";

/**
 * The same relay over plain HTTP, for the SSE+POST fallback and /stats.
 *
 * One hostname, two ways in — which is what makes the fallback worth having:
 * IT allowlists a single domain (PRD §5.4) and both transports are covered by
 * it. Derived rather than written twice so the two can never drift.
 */
export const RELAY_HTTP_URL = RELAY_URL.replace(/^ws/i, "http");

/**
 * How we talk to the relay.
 *
 *   ws   — WebSocket. Lower latency, one connection, the default.
 *   sse  — Server-Sent Events downstream + fetch POST upstream (PRD §4.3 R3).
 *          Plain HTTP with no Upgrade, so it survives the TLS-inspecting
 *          proxies that eat WebSockets on corporate networks (§5.4).
 *
 * Both carry the identical envelopes from §6 — see transport/protocol.js.
 */
export const TRANSPORT = { WS: "ws", SSE: "sse" };

export const TEXT = {
  MAX_CHARS: 50_000,          // PRD FR-2.8
  SUPPRESS_MS: 1500,          // loop-suppression window after applying a remote clip (FR-2.6)
};

export const FILES = {
  MAX_BYTES: 5 * 1024 * 1024, // 5 MB per file (FR-7.1)
  MAX_COUNT: 20,              // per session, memory only (FR-7.7)
  THUMB_PX: 160,              // longest edge (FR-7.2)
  THUMB_QUALITY: 0.7,
  /**
   * Chunk size for the P2P data channel, which carries raw binary.
   *
   * The relay fallback CANNOT use this value directly: a chunk there is
   * base64'd inside a JSON frame, and base64 (plus the AES-GCM tag and the
   * envelope fields) inflates it by roughly a third — a 32 KB chunk becomes a
   * ~44 KB frame and is rejected by the relay's own 32 KB cap. The relay chunk
   * size is therefore DERIVED from this, in files/chunker.js as
   * RELAY_CHUNK_BYTES, rather than being a second hand-tuned number that could
   * drift out of sync with it.
   */
  CHUNK_BYTES: 32 * 1024,

  /**
   * How long a file request lives before both ends give up on it.
   *
   * Both ends, deliberately: the holder's prompt counts down to a denial and
   * the requester stops waiting, on the same number, so neither is left
   * believing in a transfer the other has already abandoned. Approving into a
   * peer that gave up thirty seconds ago sends 5 MB nowhere.
   *
   * Its own constant rather than a multiple of the ICE timeout, which is what
   * it used to be. That coupling meant shortening the ICE race in a test also
   * shortened how long a human had to answer a dialog, and tuning the network
   * silently retuned the UI.
   */
  REQUEST_TIMEOUT_MS: 15_000,
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

  /**
   * How long a transport gets to become usable before we give up on it.
   *
   * A blocked WebSocket frequently does NOT fail: an intercepting proxy accepts
   * the TCP connection, swallows the Upgrade, and leaves the socket hanging
   * with no open, no close and no error — forever. Without this timer the app
   * sits on "Connecting…" indefinitely and never tries the fallback, which is
   * the exact failure this whole path exists for.
   *
   * Generous enough to survive a scale-to-zero cold start (PRD R2), which is
   * seconds rather than milliseconds.
   */
  PROBE_MS: 8_000,

  /**
   * Consecutive attempts that never became usable before switching transport.
   *
   * Two, not one: a single failure is far more often a cold start or a flaky
   * moment than a policy, and switching on it would put users on the slower
   * path for no reason. Two failures in a row is a proxy.
   */
  SWITCH_AFTER: 2,

  /** Frames per upstream POST, and the byte budget for one (SSE path). */
  POST_MAX_FRAMES: 16,
  POST_MAX_BYTES: 256 * 1024,

  /** How long the remembered transport choice is trusted. */
  TRANSPORT_MEMORY_MS: 12 * 60 * 60 * 1000,
};

export const POLL_OPTIONS = { "Off": 0, "500ms": 500, "1s": 1000, "2s": 2000 };

/**
 * How much of the OS clipboard the app takes on itself.
 *
 *   live   — anything you copy anywhere is picked up when this window has
 *            focus, and sent. The default, and what "shared clipboard" means.
 *   manual — nothing leaves this machine until you paste it in here or press
 *            Send. Receiving is unaffected.
 *
 * Manual exists because "live" means every password, token and private
 * message you copy for any reason goes to every device in the session. That is
 * the point of the product, and it is also a lot of trust to extend
 * permanently — someone on a shared or work machine may want the sharing to be
 * a deliberate act.
 */
export const SYNC_MODES = {
  LIVE: "live",
  MANUAL: "manual",
};
export const DEFAULT_SYNC_MODE = SYNC_MODES.LIVE;

export const IMAGES = {
  /** Clipboard image types we will read and share. */
  TYPES: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  /** Named so a received screenshot does not land as "blob" on disk. */
  NAME_PREFIX: "clipboard-image",
};
