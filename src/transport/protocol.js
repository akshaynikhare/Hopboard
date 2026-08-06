/**
 * Wire protocol — PRD §6. Frame shapes live here and nowhere else.
 *
 * Deliberately transport-agnostic: if the SSE+POST fallback is ever needed
 * (PRD §4.3 R3), these same envelopes travel unchanged.
 */

export const T = {
  HELLO:   "hello",
  CLIP:    "clip",
  PING:    "ping",
  PONG:    "pong",
  WELCOME: "welcome",
  PEERS:   "peers",
  ERROR:   "error",
  // M7 — WebRTC signalling, forwarded blindly by the relay
  RTC_OFFER:  "rtc-offer",
  RTC_ANSWER: "rtc-answer",
  RTC_ICE:    "rtc-ice",
  FILE_META:  "file-meta",
  FILE_REQ:   "file-req",
};

/**
 * `intent` is the collision guard (OI-2). A key we generated connects as
 * "create"; if the welcome reports peers already present, that key is taken and
 * we must regenerate rather than silently join a stranger's clipboard.
 * A key the user typed or followed a link to is always "join".
 */
export const hello = (intent, originId, name) => ({ t: T.HELLO, intent, originId, name });

export const clip = ({ payload, iv, originId }) => ({
  t: T.CLIP, payload, iv, originId, ts: Date.now(),
});

export const ping = () => ({ t: T.PING });

export const fileMeta = ({ id, name, size, type, thumb, originId }) => ({
  t: T.FILE_META, id, name, size, type, thumb, originId,
});

export const fileReq = ({ id, to, originId }) => ({
  t: T.FILE_REQ, id, to, originId,
});

export function parse(raw) {
  try { return JSON.parse(raw); }
  catch { return { t: T.ERROR, code: "BAD_JSON" }; }
}

export const ERRORS = {
  TOO_LARGE:    "That clip is over the 32 KB limit",
  RATE_LIMITED: "Slow down — too many messages",
  ROOM_FULL:    "This session already has the maximum number of devices",
  BAD_JSON:     "The relay sent something unreadable",
  NO_STREAM:    "The connection expired — reconnecting",
  // Only ever shown after the transport has given up retrying: the usual cause
  // is our own just-closed connection still holding the name, which clears on
  // its own. See relay.js reclaimIdentity().
  PEER_ID_TAKEN: "Another device in this session is using the same id — files may not reach this one",
};
