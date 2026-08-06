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

/**
 * The last room, so a relaunch can offer it back (FR-1.7, OI-10).
 *
 * Stores `{key, locked}` since locked sessions exist; it used to be a bare
 * string and still reads one, because an upgrade must not strand somebody in
 * "no room at all" on their first load of the new build.
 *
 * The lock FLAG is remembered here, in localStorage. The PIN is not, and never
 * will be — see saveLock below.
 */
export function loadLastKey() {
  const saved = read("lastKey", null);
  if (!saved) return null;
  return typeof saved === "string"
    ? { key: saved, locked: false }
    : { key: saved.key ?? null, locked: !!saved.locked };
}

export const saveLastKey = (key, locked = false) => write("lastKey", { key, locked });

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

/* ------------------------------------------------------------------
   The locked-session unlock, scoped to this tab

   Two decisions here, both deliberate.

   WHAT is stored is the PBKDF2 output, never the PIN. It unlocks exactly the
   same room, so this is not a security improvement in itself — the point is
   that a PIN is a human-chosen secret and humans reuse them. The string the
   user typed should not be sitting in a browser store waiting to be read by
   the next thing that gets to run in this origin. The derived value is useless
   anywhere else, and reading it back skips 600k PBKDF2 iterations, so a refresh
   is instant instead of a second of "Unlocking…".

   WHERE is sessionStorage, for the same reason the file allowances above use
   it: a refresh is the same session and must not re-prompt, but the tab closing
   is the end of it. localStorage would put the unlock on disk next to the
   plaintext key — at which point the link and the PIN are stored together and
   the second secret has bought nothing.

   Scoped to the share key, so rotating the key invalidates it automatically.
------------------------------------------------------------------- */

/**
 * The remembered unlock for a share key, or null.
 *
 * Matched on the KEY rather than on the room, and that is not interchangeable.
 * The room hash of a locked session is derived from the stretched PIN alone, so
 * a record left behind by a previous key would still look perfectly
 * self-consistent and would silently reconnect this tab to a room the current
 * link does not name. The key is the thing that has to agree.
 */
export function loadLock(key) {
  if (!key) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(PREFIX + "lock") || "null");
    return saved && saved.key === key && saved.prk ? saved.prk : null;
  } catch { return null; }
}

export function saveLock(key, prk) {
  try {
    if (!key || !prk) sessionStorage.removeItem(PREFIX + "lock");
    else sessionStorage.setItem(PREFIX + "lock", JSON.stringify({ key, prk }));
    return true;
  } catch { return false; }
}

export const clearLock = () => saveLock(null, null);
