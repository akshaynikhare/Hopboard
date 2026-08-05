/**
 * Capture tiers — the heart of the sending half. See docs/CLIPBOARD-FLOW.md.
 *
 *   T1  paste event            always works, no permission
 *   T2  read on focus          needs clipboard-read
 *   T3  poll while focused     needs clipboard-read
 *   T4  background capture     IMPOSSIBLE for a web app, permanently
 *
 * There is no clipboard-change event on the web platform, so "capture" means
 * "look at the moments we are allowed to look".
 */

import { POLL_OPTIONS, TEXT } from "../core/config.js";
import { emit, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as os from "./os.js";

let pollTimer = null;
let started = false;

export function start() {
  if (started) return;
  started = true;

  // T1 — paste. The floor the product stands on, not an edge case.
  document.addEventListener("paste", e => {
    const text = (e.clipboardData || window.clipboardData)?.getData("text");
    if (text) capture(text, "Captured by paste");
  });

  // T2 — focus and visibility. visibilitychange is the dominant path on Android,
  // where there is no window focus in the desktop sense.
  window.addEventListener("focus", tryRead);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tryRead();
  });

  detectTier();
}

export async function detectTier() {
  if (!os.canRead()) return state.setTier("T1", "paste only");

  const apply = s => {
    if (s === "granted")      { state.setTier("T3", "auto-capture"); startPolling(); }
    else if (s === "prompt")  { state.setTier("T2", "click paste to allow"); }
    else if (s === "denied")  { state.setTier("T1", "paste only (blocked)"); }
    else                      { state.setTier("T2", "read on focus"); }
  };
  apply(await os.onPermissionChange(apply));
}

/** T3 — only meaningful while the window is focused. */
export function startPolling() {
  clearInterval(pollTimer);
  const ms = POLL_OPTIONS[state.get().settings.poll] ?? 0;
  if (!ms) return;
  pollTimer = setInterval(() => { if (document.hasFocus()) tryRead(); }, ms);
}

export function stopPolling() { clearInterval(pollTimer); }

export async function tryRead() {
  const s = state.get();
  if (!s.settings.autoread) return;
  if (s.settings.direction === "Receive only") return;
  if (state.isSuppressed()) return;          // just applied a remote clip (FR-2.6)

  const text = await os.read();
  if (text) capture(text, "Captured on focus");
}

/** Single funnel for every captured clip, whatever tier found it. */
export function capture(text, how) {
  const s = state.get();
  if (!text || text === s.lastSent) return;   // FR-2.7 dedupe
  if (state.isSuppressed()) return;
  s.lastSent = text;
  emit(EV.TEXT_CAPTURED, { text, how });
}

/**
 * Apply an incoming clip to the OS clipboard.
 *
 * Order matters: lastSent and the suppression window are set BEFORE the write,
 * so our own poller recognises the value it is about to see and does not
 * bounce it straight back to the sender.
 */
export async function apply(text) {
  const s = state.get();
  if (!s.settings.autowrite) return false;
  if (s.settings.direction === "Send only") return false;

  s.lastSent = text;
  state.suppress(TEXT.SUPPRESS_MS);
  return os.write(text);
}
