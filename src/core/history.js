/**
 * In-session clip history — PRD FR-2.9 (last 20 clips, one-click copy).
 *
 * ── PRIVACY INVARIANT ──────────────────────────────────────────────────────
 * This module persists to **sessionStorage only. Never localStorage.**
 *
 * Clipboard content is not ordinary application data: in practice it is
 * passwords, API tokens, 2FA codes and private URLs. Those must not survive the
 * browser session, must not be readable by the next person to open the laptop,
 * and must not leak between rooms. sessionStorage is scoped to the tab and dies
 * with it, which is exactly the lifetime we want.
 *
 * core/storage.js is the localStorage wrapper and is explicitly documented as
 * "clipboard *content* never comes near this — only preferences". So the
 * sessionStorage twin lives here rather than being bolted onto that module: the
 * two stores have different lifetimes for a reason, and keeping them in separate
 * files is what stops a future edit from quietly moving clips onto disk.
 *
 * The same reasoning drives the key-change behaviour: a different share key is a
 * different room and a different set of people. History never crosses that line.
 *
 * Node-testable on purpose — this file imports only core/bus.js, and every
 * sessionStorage call is wrapped, so it degrades to memory-only where the API is
 * missing (node, private mode, storage disabled).
 */

import { on, emit, EV } from "./bus.js";

/**
 * PRD FR-2.9 caps history at 20. This belongs in core/config.js with the other
 * limits; it lives here only because config.js is owned elsewhere. Move it when
 * the two land together.
 */
export const MAX_CLIPS = 20;

/** Event names this module owns. Use the constants — a typo'd literal is a silent no-op. */
export const EVENTS = {
  /** {clips, reason} — the list changed (add / clear / hydrate). */
  CHANGED: "history:changed",
  /** {text} — a clip was picked from history and should be loaded into the editor. */
  RESTORE: "history:restore",
};

const STORE_KEY = "hopboard.history";

let clips = [];
let roomKey = null;      // share key the current list belongs to; null until first KEY_CHANGED
let started = false;
let seq = 0;

/* ------------------------------------------------------------------ storage */
/*
 * Mirrors the shape of core/storage.js (read / write / remove, wrapped so a
 * disabled-storage browser degrades instead of throwing) but targets
 * sessionStorage. try/catch also swallows the ReferenceError under node, which
 * is what makes this module testable outside a browser.
 */

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
 * A clip can be 50k characters and we keep 20 of them, so a full list can push
 * a megabyte. If the write is refused we keep going in memory rather than
 * dropping the clip — losing persistence across a reload is a smaller failure
 * than losing the user's clipboard.
 */
function persist() {
  if (!clips.length && roomKey === null) return removeStore();
  writeStore({ key: roomKey, clips });
}

/* ------------------------------------------------------------------- model */

const nextId = () => `h${Date.now().toString(36)}${(++seq).toString(36)}`;

/** Local normalisation — deliberately not importing core/keys.js, which pulls in
 *  config.js and its top-level `location` read (breaks node testability). */
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
 * Record a clip. Returns the new entry, or null if it was ignored.
 *
 * Ignored when: the text is empty/whitespace, or it is identical to the most
 * recent entry. That last one matters more than it looks — capture tiers can
 * fire twice for one copy (paste event + poll), and a peer echoing our own clip
 * back arrives with the same text under a different direction. Consecutive
 * duplicates are noise in every one of those cases.
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

/* -------------------------------------------------------------------- boot */

/**
 * Rehydrate whatever this tab had before a reload. The stored key is not known
 * to be the current room yet — the first KEY_CHANGED decides whether to keep or
 * discard this (see onKeyChanged).
 */
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
 * A new share key is a new room, new peers, and a new privacy context. Clips
 * from the old room must not be sitting in the panel when someone else joins.
 *
 * The first KEY_CHANGED after boot is not a rotation, though — main.js emits one
 * during startup for the key we already had. Comparing against the key stored
 * alongside the clips is what tells the two apart, and is why the key is
 * persisted with the list rather than held only in memory.
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

/**
 * Subscribe to the bus. Idempotent — ui/historyPanel.js calls this so the
 * feature is one init() line in main.js, but calling it from main.js directly is
 * equally fine.
 */
export function init() {
  if (started) return;
  started = true;

  hydrate();

  on(EV.TEXT_CAPTURED, ({ text }) => add({ text, direction: "sent" }));
  on(EV.TEXT_RECEIVED, ({ text }) => add({ text, direction: "received" }));
  on(EV.KEY_CHANGED, onKeyChanged);

  if (clips.length) announce("hydrate");
}
