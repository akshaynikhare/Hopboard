/**
 * Panel 1 — the main editor. Line-number gutter, Ln/Col, char counter.
 *
 * Line numbers matter more than they look: what people paste in here is stack
 * traces and JSON, and line numbers are what make a shared error discussable.
 */

import { TEXT } from "../core/config.js";
import { emit, on, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as os from "../clipboard/os.js";
import * as capture from "../clipboard/capture.js";
import { $, on as bind } from "./dom.js";

let ta, gutter;

export function init() {
  ta = $("editor");
  gutter = $("gutter");

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
  refresh();
}

export const getText = () => ta.value;

function send() {
  const value = ta.value.trim();
  if (!value) return emit(EV.TOAST, "Nothing to send");
  if (value.length > TEXT.MAX_CHARS) {
    return emit(EV.TOAST, `Over the ${TEXT.MAX_CHARS.toLocaleString()} character limit`);
  }
  state.get().lastSent = value;
  emit(EV.TEXT_CAPTURED, { text: value, how: "Sent" });
}

function refresh() {
  renderGutter();
  renderCounts();
}

function renderGutter() {
  const lines = Math.max(ta.value.split("\n").length, 1);
  if (gutter.childElementCount !== lines) {
    gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join("");
  }
  const current = ta.value.slice(0, ta.selectionStart).split("\n").length;
  [...gutter.children].forEach((el, i) => el.classList.toggle("cur", i === current - 1));
  gutter.scrollTop = ta.scrollTop;
}

function renderCounts() {
  const n = ta.value.length;
  const chars = $("sbChars");
  chars.textContent = `${n.toLocaleString()} / ${TEXT.MAX_CHARS.toLocaleString()}`;
  chars.classList.toggle("over", n > TEXT.MAX_CHARS);

  const upto = ta.value.slice(0, ta.selectionStart).split("\n");
  $("sbLnCol").textContent = `Ln ${upto.length}, Col ${upto.at(-1).length + 1}`;
}
