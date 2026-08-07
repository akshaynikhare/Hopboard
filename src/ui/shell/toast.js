/**
 * Transient status messages, bottom-right, VS Code notification style.
 *
 * ── WHY THIS IS NOT A ONE-LINER ────────────────────────────────────────────
 * #toast in app.html carries role="status" aria-live="polite", which makes this
 * module the app's only real announcement channel: nothing else tells a screen
 * reader that a link was copied, a file was rejected, or the session was left.
 * That puts two obligations on it that a "set textContent, hide later" version
 * did not meet.
 *
 *   1. IT MUST ACTUALLY ANNOUNCE. A polite live region is announced when its
 *      contents CHANGE. Writing the same string twice is not a change, so a
 *      repeated message ("Copied 412 characters", twice) was silently
 *      unannounced the second time. Clearing the node on hide makes every
 *      appearance a real mutation.
 *
 *      It also means the text has to be removed when the toast fades out.
 *      opacity:0 hides it from the eye but leaves it in the accessibility
 *      tree, so a screen reader browsing the page an hour later still found a
 *      stale status sitting there.
 *
 *   2. IT MUST NOT BE A FIREHOSE. Toasts arrive in bursts — dropping ten files
 *      over the 5 MB cap emits ten in one tick (ui/filesPanel.js intake()).
 *      The old version overwrote the node ten times in a few milliseconds: the
 *      eye saw only the last one, and the screen reader got a stream of
 *      half-read fragments. Messages are now queued and each gets a minimum
 *      time on screen, consecutive duplicates collapse instead of repeating,
 *      and a burst longer than QUEUE_MAX keeps the NEWEST — in a burst the
 *      latest message is the one still relevant.
 *
 * Motion (prefers-reduced-motion) is handled in styles/components.css: the
 * toast fades but no longer slides.
 */

import { $ } from "../primitives/dom.js";
import { on, EV } from "../../core/bus.js";

/** No message is replaced faster than this, however fast they arrive. */
const MIN_VISIBLE_MS = 1100;

/** A beat of empty between two messages, so they do not read as one. */
const GAP_MS = 160;

/** Long enough for the fade in styles/components.css to finish. */
const CLEAR_MS = 260;

/**
 * Depth of the backlog. Three is a judgement, not a constant to tune: it is
 * about as many as anyone will read, and a burst is nearly always the same
 * failure repeated.
 */
const QUEUE_MAX = 3;

const queue = [];
let current = null;         // the message on screen, or null
let shownAt = 0;
let hideTimer = 0;
let pumpTimer = 0;
let clearTimer = 0;

const nowMs = () => (typeof performance !== "undefined" && performance.now
  ? performance.now() : Date.now());

export function init() {
  on(EV.TOAST, message => show(message));
}

/**
 * Queue a message. Returns nothing — a toast is best-effort by definition, and
 * a caller that cared whether it was seen would need a banner, not this.
 */
export function show(message, ms = 2400) {
  const text = String(message ?? "").trim();
  if (!text) return;

  // Collapse consecutive duplicates rather than re-announcing them. The clip
  // path can emit the same string twice in a row (two peers, one clip), and
  // hearing it twice tells you nothing the first one did not.
  if (text === current) {
    keepVisible(ms);
    return;
  }
  if (queue.length && queue[queue.length - 1].text === text) return;

  queue.push({ text, ms });
  while (queue.length > QUEUE_MAX) queue.shift();   // drop the stalest
  pump();
}

/** Extend the current message's dwell without restarting the announcement. */
function keepVisible(ms) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, Math.max(ms, MIN_VISIBLE_MS));
}

function pump() {
  if (pumpTimer || !queue.length) return;

  if (current !== null) {
    // Something is on screen. Let it finish its minimum, then come back.
    const left = MIN_VISIBLE_MS - (nowMs() - shownAt);
    if (left > 0) {
      pumpTimer = setTimeout(() => { pumpTimer = 0; pump(); }, left);
      return;
    }
    hide();
    return;                                   // hide() schedules the next pump
  }

  paint(queue.shift());
}

function paint({ text, ms }) {
  const el = $("toast");
  if (!el) { current = null; return; }

  clearTimeout(clearTimer);
  el.textContent = text;
  el.classList.add("show");
  current = text;
  shownAt = nowMs();
  keepVisible(ms);
}

function hide() {
  clearTimeout(hideTimer);
  hideTimer = 0;
  current = null;

  const el = $("toast");
  el?.classList.remove("show");

  // Empty the live region once the fade is done, so nothing stale is left in
  // the accessibility tree — and so an identical message later still reads as
  // a change. Skipped if the next message has already been painted.
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    if (current === null && el) el.textContent = "";
  }, CLEAR_MS);

  if (!queue.length) return;
  clearTimeout(pumpTimer);
  pumpTimer = setTimeout(() => { pumpTimer = 0; pump(); }, GAP_MS);
}
