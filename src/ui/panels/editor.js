/**
 * Panel 1 — the main editor. Line-number gutter, Ln/Col, char counter.
 *
 * Line numbers matter more than they look: what people paste in here is stack
 * traces and JSON, and line numbers are what make a shared error discussable.
 */

import { TEXT, textBytes } from "../../core/config.js";
import { emit, on, EV } from "../../core/bus.js";
import * as state from "../../core/state.js";
import * as os from "../../clipboard/os.js";
import * as capture from "../../clipboard/capture.js";
import { $, on as bind, setHTML } from "../primitives/dom.js";

let ta, gutter;

/**
 * The gutter is `display:none` below this width (styles/mobile.css): 56px of
 * line numbers is a sixth of a 360px screen. Rendering it anyway would build a
 * <div> per line — 1,200 of them for a 50,000-character paste — for something
 * nobody can see, on the device least able to afford it.
 *
 * Must match the breakpoint in styles/mobile.css.
 */
const narrow = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(max-width:900px)")
  : { matches: false };

export function init() {
  ta = $("editor");
  gutter = $("gutter");

  // Widening the window past the breakpoint has to refill a gutter that was
  // left empty, and there is no input event coming to do it.
  if (narrow.addEventListener) narrow.addEventListener("change", () => refresh());
  else narrow.addListener?.(() => refresh());

  ["input", "click", "keyup", "select"].forEach(e => bind(ta, e, refresh));
  bind(ta, "scroll", () => { gutter.scrollTop = ta.scrollTop; });

  bind("aSelect", "click", () => { ta.focus(); ta.select(); refresh(); });
  bind("aCopy",   "click", async () => {
    if (await os.write(ta.value)) emit(EV.TOAST, "Copied to clipboard");
  });
  bind("aPaste",  "click", async () => {
    const text = await os.read();
    if (text) { setText(text); capture.capture(text, "Pasted from clipboard"); }
    else emit(EV.TOAST, "Clipboard unreadable — use Ctrl/Cmd+V instead");
  });
  bind("aSend",   "click", send);
  bind("tabX",    "click", () => { setText(""); emit(EV.TOAST, "Cleared"); });

  // A clip arriving from a peer fills the editor; the OS write is handled by
  // clipboard/capture.apply, which owns the loop-suppression ordering.
  on(EV.TEXT_RECEIVED, ({ text }) => setText(text));

  refresh();
}

export function setText(value) {
  ta.value = value;
  lastAppliedText = value;
  refresh();
}

export const getText = () => ta.value;

/**
 * Has the user typed something we have not sent or received?
 *
 * The editor used to be overwritten unconditionally by every incoming clip, so
 * if the other machine copied something while you were mid-sentence here, your
 * text simply vanished — no undo, no warning. With Live mode and a 1s poll on
 * the far side, that is not a rare race; it is a matter of time.
 */
let lastAppliedText = "";
export const isDirty = () => ta.value.trim() !== "" && ta.value !== lastAppliedText;

function send() {
  const value = ta.value.trim();
  if (!value) return emit(EV.TOAST, "Nothing to send");
  // Characters for the message, bytes for the decision — see config.js TEXT.
  // A CJK or emoji-heavy clip is inside the character count and still over the
  // wire limit, and saying "over the 24,000 character limit" to someone who
  // typed 9,000 characters is worse than not checking at all.
  if (textBytes(value) > TEXT.MAX_BYTES) {
    return emit(EV.TOAST, value.length > TEXT.MAX_CHARS
      ? `Over the ${TEXT.MAX_CHARS.toLocaleString()} character limit`
      : `Over the ${Math.floor(TEXT.MAX_BYTES / 1024)} KB limit — `
        + `${value.length.toLocaleString()} characters, but non-Latin text is several bytes each`);
  }
  state.get().lastSent = value;
  emit(EV.TEXT_CAPTURED, { text: value, how: "Sent" });
}

function refresh() {
  renderGutter();
  renderCounts();
}

function renderGutter() {
  if (narrow.matches) {
    if (gutter.firstChild) gutter.replaceChildren();
    return;
  }
  const lines = Math.max(ta.value.split("\n").length, 1);
  if (gutter.childElementCount !== lines) {
    setHTML(gutter, Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join(""));
  }
  const current = ta.value.slice(0, ta.selectionStart).split("\n").length;
  [...gutter.children].forEach((el, i) => el.classList.toggle("cur", i === current - 1));
  gutter.scrollTop = ta.scrollTop;
}

function renderCounts() {
  const n = ta.value.length;
  const chars = $("sbChars");
  chars.textContent = `${n.toLocaleString()} / ${TEXT.MAX_CHARS.toLocaleString()}`;
  // The counter reads in characters, but "over" has to mean "will not send",
  // so it is decided on bytes. Encoding runs per keystroke and is measured in
  // microseconds even at the cap; the cheap `n` test short-circuits the
  // all-ASCII case, which is nearly all of them.
  chars.classList.toggle("over", n > TEXT.MAX_CHARS || textBytes(ta.value) > TEXT.MAX_BYTES);

  const upto = ta.value.slice(0, ta.selectionStart).split("\n");
  $("sbLnCol").textContent = `Ln ${upto.length}, Col ${upto.at(-1).length + 1}`;
}
