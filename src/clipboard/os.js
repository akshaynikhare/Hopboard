/**
 * The entire OS clipboard boundary — two calls. Everything else in the app
 * goes through this module. See docs/CLIPBOARD-FLOW.md.
 */

import { emit, EV } from "../core/bus.js";

/** Requires document focus. Needs no permission. */
export async function write(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    emit(EV.TOAST, "Window must be focused to write the clipboard");
    return false;
  }
}

/**
 * Requires focus AND the clipboard-read permission AND a secure context.
 * Returns null rather than throwing — callers treat "cannot read right now" as
 * ordinary, because it is: it happens every time the window loses focus.
 */
export async function read() {
  try { return await navigator.clipboard.readText(); }
  catch { return null; }
}

export const canRead  = () => Boolean(navigator.clipboard?.readText);
export const canWrite = () => Boolean(navigator.clipboard?.writeText);

/** 'granted' | 'prompt' | 'denied' | 'unknown' */
export async function permission() {
  try {
    const st = await navigator.permissions.query({ name: "clipboard-read" });
    return st.state;
  } catch { return "unknown"; }
}

export async function onPermissionChange(fn) {
  try {
    const st = await navigator.permissions.query({ name: "clipboard-read" });
    st.onchange = () => fn(st.state);
    return st.state;
  } catch { return "unknown"; }
}
