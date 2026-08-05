/** DOM helpers. Small on purpose — this is not a framework. */

export const $  = sel => document.getElementById(sel) || document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];

/**
 * Escape before interpolating ANY user or peer content into innerHTML.
 * Clip content is attacker-controlled by definition: anyone with the session
 * key can put a <script> tag on your clipboard.
 */
export const esc = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function on(el, event, handler, opts) {
  (typeof el === "string" ? $(el) : el)?.addEventListener(event, handler, opts);
}

export function text(sel, value) {
  const el = typeof sel === "string" ? $(sel) : sel;
  if (el) el.textContent = value;
}

export function toggle(sel, cls, force) {
  const el = typeof sel === "string" ? $(sel) : sel;
  el?.classList.toggle(cls, force);
}
