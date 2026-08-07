/**
 * localStorage, wrapped so a disabled-storage browser degrades instead of
 * throwing. Clipboard *content* never comes near this — only preferences.
 */

import { NET, STORAGE_PREFIX, normaliseRelay } from "./config.js";

const PREFIX = STORAGE_PREFIX;

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
 * The relay this device talks to, when it is not the one the build ships with.
 * config.js reads this key directly at module evaluation, because the URL has to
 * resolve before anything imports it; this pair is for changing it afterwards.
 *
 * Normalised on the way in as well as out — a malformed stored value would
 * otherwise be re-read as malformed on every launch, and the symptom (every
 * connection refused) looks nothing like its cause.
 */
export const loadRelayUrl = () => normaliseRelay(read("relayUrl", null));

export function saveRelayUrl(url) {
  const clean = normaliseRelay(url);
  if (!clean) { remove("relayUrl"); return null; }
  write("relayUrl", clean);
  return clean;
}

/**
 * The last room, so a relaunch can offer it back (FR-1.7, OI-10). Stores
 * `{key, locked}` and still reads the bare string it used to be, because an
 * upgrade must not strand somebody in "no room at all".
 *
 * The lock FLAG is remembered here. The PIN is not — see saveLock.
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
 * Which transport last worked (transport/relay.js). Remembered because probing
 * costs real seconds of "Connecting…" behind a proxy that blocks WebSockets.
 * Expired rather than permanent because it is a fact about the *network*: a
 * laptop leaving the office should return to the faster transport on its own.
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
 * A transport the user picked by hand, which outranks anything measured. Kept
 * apart from the remembered-working one because they answer different questions:
 * "what worked last time" is an observation and expires, "use HTTP" is an
 * instruction and does not. Merged, a successful auto-connect would quietly
 * overwrite a deliberate choice.
 */
export const loadTransportChoice = () => read("transportChoice", null);

export function saveTransportChoice(mode) {
  if (!mode) return remove("transportChoice");
  write("transportChoice", mode);
}

/**
 * Session-scoped file allowances.
 *
 * sessionStorage is the whole point: "allow everything from this device" is a
 * decision about the session you are in and has to die with the tab, or it is a
 * standing grant to whoever holds the share key. Scoped to a room as well —
 * rotating the key is how someone throws a device out, and it would be worth
 * nothing if the allowance came along.
 */
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

/**
 * The locked-session unlock, scoped to this tab.
 *
 * WHAT is the PBKDF2 output, never the PIN. It unlocks the same room, so this is
 * not a security win in itself — the point is that PINs are human-chosen and
 * reused, and the typed string should not sit in a browser store. Reading it
 * back skips 600k iterations, so a refresh is instant.
 *
 * WHERE is sessionStorage: a refresh is the same session and must not re-prompt,
 * but the tab closing ends it. localStorage would put the unlock on disk beside
 * the plaintext key, at which point the second secret has bought nothing.
 *
 * Matched on the KEY, not the room, and those are not interchangeable: a locked
 * room hash derives from the stretched PIN alone, so a record left by a previous
 * key would look self-consistent and silently reconnect this tab to a room the
 * current link does not name.
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
