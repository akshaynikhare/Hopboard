/**
 * Tiny pub/sub. The only way modules talk to each other.
 *
 * The rule that keeps this codebase modular: UI modules never import transport
 * or clipboard modules, and vice versa. They publish and subscribe to events
 * here. main.js is the only file that knows the full graph.
 */

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);        // call the return value to unsubscribe
}

export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  // Copy first: a handler may unsubscribe itself mid-dispatch.
  for (const fn of [...set]) {
    try { fn(payload); }
    catch (err) { console.error(`[bus] handler failed for "${event}"`, err); }
  }
}

/** Canonical event names. Typos here are silent bugs, so use the constants. */
export const EV = {
  // clipboard
  TEXT_CAPTURED:   "text:captured",    // {text, how} — a clip settled here, needs sending
  TEXT_RECEIVED:   "text:received",    // {text, from} — a clip arrived from a peer
  /**
   * Typing, not clips. {text, caret} out, {text, caret, name, from} in.
   *
   * The pair above is the COMMIT channel: a clip that settled, bound for
   * history, the OS clipboard and the size cap. This pair is the VIEW channel —
   * what the text looks like mid-keystroke. Keeping them apart is what stops a
   * streamed sentence becoming six history entries and six clipboard writes.
   */
  TEXT_TYPED:      "text:typed",
  TEXT_STREAMED:   "text:streamed",
  TIER_CHANGED:    "clipboard:tier",   // {tier, note}
  PENDING_CLIP:    "clipboard:pending",// {pending, text} — arrived while unfocused
  CLIP_OFFERED:    "clipboard:offered",// {text} — arrived, but the editor has unsent work
  PEER_JOINED:     "peers:joined",     // {name} — a device entered the session
  PEER_LEFT:       "peers:left",       // {name}
  PERMISSION:      "clipboard:permission", // {state} granted|prompt|denied
  IMAGE_CAPTURED:  "clipboard:image",  // {blob, name} — an image was copied or pasted
  SYNC_MODE:       "clipboard:mode",   // {mode} live|manual

  // transport
  CONN_STATE:      "conn:state",       // {state, detail}
  TRANSPORT:       "conn:transport",   // {mode, label, blocked, forced} — ws | sse, or nothing works
  TRANSPORT_SELECT:"conn:transport:set",// {mode} — the user picked one; null = automatic
  PEERS_CHANGED:   "peers:changed",    // {count, list}
  INSTANCE_CHANGED:"conn:instance",    // {from, to} — split-brain warning (OI-3)
  KEY_COLLISION:   "session:collision",// generated key was taken (OI-2)
  ROOM_STATE:      "conn:room",        // {existing, hasLast} — what `welcome` said

  // session
  KEY_CHANGED:     "session:key",      // {key, locked}
  /**
   * {locked, verified} — see core/crypto.js.
   *
   * "lockstate", not "lock", and the extra syllable is load-bearing. The name
   * used to be "session:lock", which is ALSO the imperative the UI emits to
   * mean "lock this session" (main.js). One name, two opposite meanings: a
   * report and an order. So every state.setKey() — one per session, on every
   * single boot — delivered a report to the handler that acts on the order,
   * and the app opened the "Lock this session" PIN dialog by itself the moment
   * it started. Nothing failed, nothing was logged, and the dialog looked
   * exactly like a feature.
   *
   * Announcements are past tense here (`session:key`, `peers:changed`) and
   * commands are bare verbs (`session:lock`, `session:leave`). Keep it that
   * way; the bus does no namespacing of its own and a collision is silent.
   */
  LOCK_STATE:      "session:lockstate",
  /**
   * {required} — a locked link is open and its PIN has not been given, so there
   * is no session and nothing behind the UI is connected to anything. Reported
   * separately from LOCK_STATE because `state.locked` is still false at that
   * point: no session was ever opened to be locked.
   */
  LOCK_REQUIRED:   "session:lockrequired",
  FOUNDER:         "session:founder",  // {founder} — first into this room? null = not yet known

  // files
  FILES_CHANGED:   "files:changed",    // full list
  FILE_ADDED:      "files:added",      // {file} — added locally, needs announcing
  FILE_PROGRESS:   "files:progress",   // {id, percent}
  TRANSFER_PATH:   "files:path",       // {id, path: "p2p" | "relay"}

  // ui
  TOAST:           "ui:toast",         // string
  SETTINGS_CHANGED:"ui:settings",      // {name, value} — a preference was toggled
};
