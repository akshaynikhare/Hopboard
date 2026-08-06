/**
 * Capture tiers — the heart of the sending half. See docs/CLIPBOARD-FLOW.md.
 *
 *   T0  native clipboard watch  desktop app only — the OS tells us
 *   T1  paste event             always works, no permission
 *   T2  read on focus           needs clipboard-read
 *   T3  poll while focused      needs clipboard-read
 *   T4  background capture      IMPOSSIBLE for a web app, permanently
 *
 * There is no clipboard-change event on the web platform, so in a browser
 * "capture" means "look at the moments we are allowed to look".
 *
 * T0 is the exception, and the entire reason the desktop app exists. Inside the
 * Tauri shell a native listener — AddClipboardFormatListener on Windows,
 * NSPasteboard changeCount on macOS, XFixes on X11 — reports every change,
 * whether or not this window is focused. T4 stays impossible; T0 is not T4,
 * because the code doing the watching is not the web page.
 *
 * !! T0 makes the loop-suppression ordering in apply() far more dangerous than
 * it already was. T3 only ever polled while focused, so a mistake there was
 * bounded by the user looking at the window. T0 sees every clipboard change on
 * the machine, forever, so the lastSent-before-write ordering is now the only
 * thing between the user and an endless clipboard storm across every device in
 * the session. See docs/CLIPBOARD-FLOW.md §6. !!
 */

import { POLL_OPTIONS, TEXT, SYNC_MODES, IMAGES } from "../core/config.js";
import { emit, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as os from "./os.js";

let pollTimer = null;
let started = false;

export function start() {
  if (started) return;
  started = true;

  // T1 — paste. The floor the product stands on, not an edge case, and the
  // ONLY path that still runs in manual mode: pasting here is the deliberate
  // act that manual mode is about.
  document.addEventListener("paste", e => {
    const image = os.imageFromPaste(e);
    if (image) {
      e.preventDefault();               // don't also drop a filename into the editor
      captureImage(image, "Image pasted");
      return;
    }
    const text = (e.clipboardData || window.clipboardData)?.getData("text");
    if (text) capture(text, "Captured by paste");
  });

  // T2 — focus and visibility. visibilitychange is the dominant path on Android,
  // where there is no window focus in the desktop sense.
  // Flush before reading: a queued incoming clip must land on the OS clipboard
  // before we look at it, or we would read the stale value and broadcast it back.
  window.addEventListener("focus", async () => { await flushPending(); tryRead(); });
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    await flushPending();
    tryRead();
  });

  startNative();
  detectTier();
}

/**
 * T0 — the desktop shell's clipboard watcher.
 *
 * The native side owns the OS boundary and emits a `clipboard://text` event
 * with what it read. This adds no new path into the app: it lands in the same
 * capture() funnel as every other tier, so `main.js`, the editor, the history
 * and the transport are untouched. That is the boundary in
 * docs/ARCHITECTURE.md §3 doing its job — a whole new capture mechanism, on a
 * platform that did not exist before, and no UI file changes.
 *
 * Absent outside Tauri, so this is a no-op in a browser rather than a branch.
 */
function startNative() {
  const tauri = globalThis.__TAURI__;
  if (!tauri?.event?.listen) return;

  tauri.event.listen("clipboard://text", ({ payload }) => {
    // Mode is checked HERE as well as in the native side, deliberately.
    // Manual mode means nothing leaves this machine unless the user says so,
    // and that promise must not depend on a second process having got the
    // message. The cheap check is the one that is load-bearing.
    if (state.get().settings.syncMode !== SYNC_MODES.LIVE) return;
    if (state.isSuppressed()) return;                // FR-2.6, and see the header
    if (typeof payload === "string" && payload) capture(payload, "Copied anywhere");
  }).catch(() => { /* the shell is older than this event; the other tiers stand */ });

  state.setTier("T0", "watching the system clipboard");
}

export async function detectTier() {
  // The native watcher outranks anything the browser can offer, and unlike the
  // others it does not depend on a permission or on focus. Do not let the
  // browser's own detection downgrade the reported tier underneath it.
  if (globalThis.__TAURI__?.event) return;
  if (!os.canRead()) return state.setTier("T1", "paste only");

  const apply = s => {
    emit(EV.PERMISSION, { state: s });
    if (s === "granted")      { state.setTier("T3", "auto-capture"); startPolling(); }
    else if (s === "prompt")  { state.setTier("T2", "click paste to allow"); }
    else if (s === "denied")  { state.setTier("T1", "paste only (blocked)"); }
    else                      { state.setTier("T2", "read on focus"); }
  };
  apply(await os.onPermissionChange(apply));
}

/**
 * Trigger Chrome's clipboard-read permission prompt. There is no API to request
 * it directly — the prompt only appears as a side effect of an actual read, so
 * this attempts one and lets detectTier() observe the result.
 */
export async function requestPermission() {
  await os.read();
  await detectTier();
}

/** T3 — only meaningful while the window is focused, and only in live mode. */
export function startPolling() {
  clearInterval(pollTimer);
  if (state.get().settings.syncMode !== SYNC_MODES.LIVE) return;
  const ms = POLL_OPTIONS[state.get().settings.poll] ?? 0;
  if (!ms) return;
  pollTimer = setInterval(() => { if (document.hasFocus()) tryRead(); }, ms);
}

/**
 * Called when the mode changes so polling starts or stops immediately.
 *
 * `autoread` is derived from the mode rather than set independently. It used
 * to have its own toggle, which meant two controls governed one behaviour and
 * could disagree — the kind of thing that produces a bug report saying the app
 * ignores its own setting. Live mode IS auto-read.
 */
export function applyMode() {
  const live = state.get().settings.syncMode === SYNC_MODES.LIVE;
  state.setSetting("autoread", live);
  if (live) startPolling();
  else stopPolling();
  emit(EV.SYNC_MODE, { mode: state.get().settings.syncMode });
}

export function stopPolling() { clearInterval(pollTimer); }

export async function tryRead() {
  const s = state.get();
  // Manual mode: the OS clipboard is not watched at all. Nothing leaves this
  // machine unless the user pastes it here or presses Send.
  if (s.settings.syncMode !== SYNC_MODES.LIVE) return;
  if (!s.settings.autoread) return;
  if (state.isSuppressed()) return;          // just applied a remote clip (FR-2.6)

  const text = await os.read();
  if (text) capture(text, "Captured on focus");

  // Images are checked on focus only, never on the poll tick: clipboard.read()
  // is markedly more expensive than readText() and would burn battery at 1 Hz
  // for a case that is rare per second and common per minute.
  if (s.settings.images) await tryReadImage();
}

let lastImageKey = "";

export async function tryReadImage() {
  const blob = await os.readImage();
  if (!blob) return;
  // Size+type is a cheap stand-in for identity; hashing every screenshot on
  // every focus would cost more than it saves.
  const key = `${blob.type}:${blob.size}`;
  if (key === lastImageKey) return;
  lastImageKey = key;
  captureImage(blob, "Image captured");
}

/**
 * Images do not go through the text path. They are handed to the files layer
 * as a normal 5 MB-capped item, so a screenshot shares its thumbnail
 * immediately and the full image only moves when someone asks — see
 * docs/P2P-FILES.md. capture.js stays ignorant of files/: it announces.
 */
function captureImage(blob, how) {
  const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  emit(EV.IMAGE_CAPTURED, {
    blob,
    name: `${IMAGES.NAME_PREFIX}-${stamp}.${ext}`,
    how,
  });
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
 * so our own poller recognises the value it is about to see and does not bounce
 * it straight back to the sender.
 *
 * writeText() also requires focus, so a clip arriving while the window is in the
 * background cannot be written immediately. It is queued rather than dropped and
 * flushed on the next focus — same gesture the user already needs for sending,
 * so there is one rule to learn instead of two.
 */
export async function apply(text) {
  const s = state.get();
  if (!s.settings.autowrite) return false;

  s.lastSent = text;
  state.suppress(TEXT.SUPPRESS_MS);

  if (!document.hasFocus()) {
    pending = text;
    emit(EV.PENDING_CLIP, { pending: true, text });
    return false;
  }
  return os.write(text);
}

let pending = null;

/** Flush a clip that arrived while we were in the background. */
export async function flushPending() {
  if (pending === null) return;
  const text = pending;
  pending = null;
  const ok = await os.write(text);
  emit(EV.PENDING_CLIP, { pending: false });
  if (ok) emit(EV.TOAST, "Pending clip written to your clipboard");
}

export const hasPending = () => pending !== null;
