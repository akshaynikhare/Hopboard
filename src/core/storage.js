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
