/**
 * localStorage, wrapped so a disabled-storage browser degrades instead of
 * throwing. Clipboard *content* never comes near this — only preferences.
 */

import { NET } from "./config.js";

const PREFIX = "hopboard.";

export function read(name, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function write(name, value) {
  try { localStorage.setItem(PREFIX + name, JSON.stringify(value)); return true; }
  catch { return false; }        // private mode, quota, or storage disabled
}

export function remove(name) {
  try { localStorage.removeItem(PREFIX + name); } catch { /* nothing to do */ }
}

export const loadSettings = () => read("settings", null);
export const saveSettings = s => write("settings", s);
export const loadLastKey  = () => read("lastKey", null);
export const saveLastKey  = k => write("lastKey", k);

/**
 * Which transport last worked (see transport/relay.js).
 *
 * Remembered because probing costs the user real seconds of "Connecting…" on
 * every load behind a proxy that blocks WebSockets, and the answer there is the
 * same every time. Expired rather than permanent because it is a fact about the
 * *network*, not the device: a laptop that leaves the office should go back to
 * the faster transport on its own, without anyone knowing there was a setting.
 */
export function loadTransport() {
  const saved = read("transport", null);
  if (!saved?.mode || !saved.at) return null;
  return Date.now() - saved.at < NET.TRANSPORT_MEMORY_MS ? saved.mode : null;
}

export function saveTransport(mode) {
  if (!mode) return remove("transport");
  write("transport", { mode, at: Date.now() });
}

/**
 * A transport the user picked by hand, which outranks anything measured.
 *
 * Kept apart from the remembered-working one above because they answer
 * different questions — "what worked last time" is an observation and expires;
 * "use HTTP" is an instruction and does not. Merging them would let a
 * successful automatic connection quietly overwrite a deliberate choice.
 */
export const loadTransportChoice = () => read("transportChoice", null);

export function saveTransportChoice(mode) {
  if (!mode) return remove("transportChoice");
  write("transportChoice", mode);
}

/* ------------------------------------------------------------------
   Session-scoped file allowances

   sessionStorage, not localStorage, and this is the whole point of them: "allow
   everything from this device" is a decision about the session you are in, and
   it has to die with the tab. A permanent version of this setting is a standing
   grant to whoever holds the share key, made once and then forgotten about.

   Scoped to a room as well as a tab. The key is a bearer credential and rooms
   are named after it, so an allowance granted in one session must not survive
   into another — rotating the key is how someone throws a device out, and it
   would be worth nothing if the allowance came along.
------------------------------------------------------------------- */

export function loadAllowances(room) {
  if (!room) return [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(PREFIX + "allow") || "null");
    return saved && saved.room === room && Array.isArray(saved.peers) ? saved.peers : [];
  } catch { return []; }
}

export function saveAllowances(room, peers) {
  try {
    if (!room || !peers?.length) sessionStorage.removeItem(PREFIX + "allow");
    else sessionStorage.setItem(PREFIX + "allow", JSON.stringify({ room, peers }));
    return true;
  } catch { return false; }
}
