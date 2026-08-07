/**
 * In-session clip history — PRD FR-2.9 (last 20 clips, one-click copy).
 *
 * PRIVACY INVARIANT: persists to **sessionStorage only, never localStorage**.
 * Clipboard content is passwords, tokens, 2FA codes and private URLs; it must
 * not survive the browser session, be readable by the next person to open the
 * laptop, or leak between rooms. The sessionStorage twin lives here rather than
 * in core/storage.js precisely so a future edit cannot quietly move clips onto
 * disk — that module is the localStorage one, for preferences.
 *
 * Node-testable on purpose: imports only core/bus.js, and every sessionStorage
 * call is wrapped, so it degrades to memory-only where the API is missing.
 */

import { on, emit, EV } from "./bus.js";

/**
 * PRD FR-2.9 caps history at 20. Belongs in core/config.js with the other
 * limits; it is here because importing config.js would cost node testability.
 */
export const MAX_CLIPS = 20;

/** Event names this module owns. Use the constants — a typo'd literal is a silent no-op. */
export const EVENTS = {
  /** {clips, reason} — the list changed (add / clear / hydrate). */
  CHANGED: "history:changed",
  /** {text} — a clip was picked from history and should be loaded into the editor. */
  RESTORE: "history:restore",
};

const STORE_KEY = "realtimeclipboard.history";

let clips = [];
let roomKey = null;      // share key the current list belongs to; null until first KEY_CHANGED
let started = false;
let seq = 0;

// Mirrors core/storage.js against sessionStorage. try/catch also swallows the
// ReferenceError under node, which is what makes this module testable.
function readStore() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch { return null; }
}

function writeStore(value) {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(value)); return true; }
  catch { return false; }   // quota, private mode, or no sessionStorage at all
}

function removeStore() {
  try { sessionStorage.removeItem(STORE_KEY); } catch { /* nothing to do */ }
}

/**
 * A refused write keeps going in memory rather than dropping the clip: 20 clips
 * of 50k characters can push a megabyte, and losing persistence across a reload
 * is a smaller failure than losing the user's clipboard.
 */
function persist() {
  if (!clips.length && roomKey === null) return removeStore();
  writeStore({ key: roomKey, clips });
}

const nextId = () => `h${Date.now().toString(36)}${(++seq).toString(36)}`;

// Local, deliberately not core/keys.js — that pulls in config.js and its
// top-level `location` read, which breaks node testability.
const normKey = k => String(k ?? "").trim().toUpperCase();

function announce(reason) {
  emit(EVENTS.CHANGED, { clips: all(), reason });
}

/** Newest first. Returns a shallow copy — callers must not mutate the list. */
export function all() {
  return clips.slice();
}

export function get(id) {
  return clips.find(c => c.id === id) ?? null;
}

export const size = () => clips.length;

/**
 * Record a clip. Returns the new entry, or null if it was ignored — empty text,
 * or identical to the most recent entry. Consecutive dedupe matters more than it
 * looks: capture tiers can fire twice for one copy (paste event + poll), and a
 * peer echoing our own clip back arrives with the same text.
 */
export function add({ text, direction }) {
  const value = String(text ?? "");
  if (!value.trim()) return null;

  const dir = direction === "sent" ? "sent" : "received";
  if (clips.length && clips[0].text === value) return null;   // consecutive dedupe

  const entry = { id: nextId(), text: value, direction: dir, at: new Date(), chars: value.length };
  clips.unshift(entry);
  if (clips.length > MAX_CLIPS) clips.length = MAX_CLIPS;     // FR-2.9: last 20

  persist();
  announce("add");
  return entry;
}

/** Drop everything, in memory and in sessionStorage. */
export function clear(reason = "clear") {
  const had = clips.length;
  clips = [];
  removeStore();
  if (roomKey !== null) persist();
  if (had) announce(reason);
  return had;
}

// The stored key is not known to be the current room yet — the first
// KEY_CHANGED decides whether to keep or discard this.
function hydrate() {
  const saved = readStore();
  if (!saved || !Array.isArray(saved.clips)) return;

  roomKey = saved.key ?? null;
  clips = saved.clips
    .filter(c => c && typeof c.text === "string")
    .slice(0, MAX_CLIPS)
    .map(c => ({
      id: typeof c.id === "string" ? c.id : nextId(),
      text: c.text,
      direction: c.direction === "sent" ? "sent" : "received",
      at: new Date(c.at ?? Date.now()),          // JSON round-trips Date to a string
      chars: typeof c.chars === "number" ? c.chars : c.text.length,
    }));
}

/**
 * A new share key is a new room, new peers, and a new privacy context. The first
 * KEY_CHANGED after boot is not a rotation, though — main.js emits one for the
 * key we already had, and comparing against the key stored alongside the clips
 * is what tells the two apart.
 */
function onKeyChanged({ key }) {
  const next = normKey(key);
  if (!next) return;

  if (roomKey !== null && normKey(roomKey) !== next) {
    roomKey = next;
    clear("key-changed");
    persist();
    return;
  }

  roomKey = next;
  persist();
}

/** Subscribe to the bus. Idempotent. */
export function init() {
  if (started) return;
  started = true;

  hydrate();

  on(EV.TEXT_CAPTURED, ({ text }) => add({ text, direction: "sent" }));
  on(EV.TEXT_RECEIVED, ({ text }) => add({ text, direction: "received" }));
  on(EV.KEY_CHANGED, onKeyChanged);

  if (clips.length) announce("hydrate");
}
