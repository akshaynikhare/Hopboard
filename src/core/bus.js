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
  TEXT_CAPTURED:   "text:captured",    // {text, how} — local capture, needs sending
  TEXT_RECEIVED:   "text:received",    // {text, from} — arrived from a peer
  TIER_CHANGED:    "clipboard:tier",   // {tier, note}

  // transport
  CONN_STATE:      "conn:state",       // {state, detail}
  PEERS_CHANGED:   "peers:changed",    // {count, list}
  INSTANCE_CHANGED:"conn:instance",    // {from, to} — split-brain warning (OI-3)
  KEY_COLLISION:   "session:collision",// generated key was taken (OI-2)

  // session
  KEY_CHANGED:     "session:key",      // {key}

  // files
  FILES_CHANGED:   "files:changed",    // full list
  FILE_PROGRESS:   "files:progress",   // {id, percent}
  TRANSFER_PATH:   "files:path",       // {id, path: "p2p" | "relay"}

  // ui
  TOAST:           "ui:toast",         // string
};
