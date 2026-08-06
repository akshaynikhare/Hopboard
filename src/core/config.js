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

  /**
   * Locked sessions — see LOCK below and core/crypto.js `deriveLocked`.
   *
   * The salt is a PREFIX, completed with the share key: the key is random per
   * session, which is exactly what a salt is for. The open-session salt above
   * is one global constant, so a single precomputed table covers every user on
   * earth; here an attacker has to build one per key.
   *
   * 600k rather than 250k because the threat is different. An open session's
   * secret is a 29-bit key an attacker has to guess; a locked session's secret
   * is a PIN held by someone who may ALREADY have the link, so the PIN is the
   * whole defence and every doubling of the iteration count is a doubling of
   * their cost. It is paid once per session, behind the "unlocking" state.
   */
  LOCK_SALT: "hopboard-lock-v1:",
  LOCK_ITERATIONS: 600_000,

  /**
   * HKDF info strings: one PBKDF2 run, three independent outputs.
   *
   * Asking PBKDF2 itself for 64 bytes would cost DOUBLE — it reruns the full
   * iteration count per 32-byte output block, and OI-8 already flags PBKDF2
   * cost on a low-end Android. HKDF expansion is a couple of HMACs.
   */
  LOCK_INFO: {
    AES:  "hopboard-lock/aes",
    ROOM: "hopboard-lock/room",
    AUTH: "hopboard-lock/auth",
  },
};

/**
 * Locked sessions: the share key in the link, a PIN that never travels with it.
 *
 * The key is a bearer credential (PRD §7.1) and a link is a leaky thing — it
 * gets forwarded, screenshotted, pasted into a group chat. A locked session
 * adds a second secret that is never in the URL, never on disk, and never sent
 * to the relay, so holding the link is not sufficient to read the clipboard.
 *
 * MIN_PIN is 6 and the PIN is free-form rather than 4-6 digits, because against
 * someone who already has the link the key contributes nothing and the PIN is
 * the entire secret: a 4-digit PIN is ~13 bits, which is minutes of offline
 * guessing. The dialog states the number rather than an adjective.
 */
export const LOCK = {
  MIN_PIN: 6,

  /**
   * Fragment marker: `#!ABCDEF`. That a session is locked is not a secret — the
   * PIN is — and the app has to know before it connects, so the flag rides in
   * the link. Leading rather than trailing: chat clients that trim punctuation
   * off a pasted URL trim the END of it.
   */
  SIGIL: "!",

  /**
   * Sent once on creating a locked room, retained by the relay as the room's
   * last clip and replayed to every joiner — so a joiner can tell "wrong PIN"
   * from "first one here" by whether it decrypts. Receivers drop it instead of
   * rendering it. See core/crypto.js and the beacon note in main.js.
   */
  BEACON: String.fromCharCode(0) + "hopboard-lock-v1",
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

/**
 * The project's own addresses: where the code is, and where it asks for help.
 *
 * Derived from OWNER/NAME rather than written out four times, for the same
 * reason RELAY_HTTP_URL is derived from RELAY_URL — a fork, a rename, or a
 * moved account is then one edit, and the four links cannot drift into pointing
 * at three different projects.
 *
 * COFFEE_HANDLE is separate because it is a different service's account name
 * and only happens to match today.
 *
 * !! UNVERIFIED: OWNER is real (the repo is at github.com/akshaynikhare/
 * Hopboard); the sponsors page and the Buy Me a Coffee handle were guessed from
 * it and have NOT been confirmed to exist. Check both before this ships — a
 * donate link that 404s costs more goodwill than no donate link. !!
 */
export const REPO = {
  OWNER: "akshaynikhare",
  NAME: "Hopboard",
  COFFEE_HANDLE: "akshaynikhare",
};

export const LINKS = {
  REPO:    `https://github.com/${REPO.OWNER}/${REPO.NAME}`,
  ISSUES:  `https://github.com/${REPO.OWNER}/${REPO.NAME}/issues`,
  /**
   * The chooser, not a blank issue: "report" that lands on a list of other
   * people's bugs asks the user to find the button themselves, and a blank box
   * asks them to guess what we need.
   *
   * `/new/choose` picks between the bug and feature forms in
   * .github/ISSUE_TEMPLATE/ — which is also where the "do not paste your share
   * key" warning lives, and that warning is the single most valuable thing on
   * the page for this product.
   */
  NEW_ISSUE: `https://github.com/${REPO.OWNER}/${REPO.NAME}/issues/new/choose`,
  SPONSOR: `https://github.com/sponsors/${REPO.OWNER}`,
  COFFEE:  `https://www.buymeacoffee.com/${REPO.COFFEE_HANDLE}`,
};

export const IMAGES = {
  /** Clipboard image types we will read and share. */
  TYPES: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  /** Named so a received screenshot does not land as "blob" on disk. */
  NAME_PREFIX: "clipboard-image",
};
