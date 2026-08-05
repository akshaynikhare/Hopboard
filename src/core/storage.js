/**
 * localStorage, wrapped so a disabled-storage browser degrades instead of
 * throwing. Clipboard *content* never comes near this — only preferences.
 */

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
