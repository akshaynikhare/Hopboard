/**
 * Slide-up menus for the status bar, where every item that reports something is
 * also the control for it.
 *
 * This module owns their *behaviour*, so five menus cannot drift into five
 * slightly different ones: one open at a time, anchored to the item that opened
 * it, closed by Escape or an outside click, and rendered from a callback so the
 * contents are current rather than a snapshot from boot.
 *
 * It owns none of the *content* — statusbar.js and sessionPanel.js supply that.
 */

import { $, esc, setHTML, clear } from "./dom.js";

const menus = new Map();          // button id -> {label, render, onEvent}
let openId = null;

/** Which menu is open, if any. */
export const current = () => openId;

/**
 * Wire a status-bar item to a menu.
 *
 *   render()          returns the menu's inner HTML. Called on every open and
 *                     on every refresh(), so it reads live state.
 *   onEvent(e, close) clicks and changes inside the menu.
 *
 * Returns false when the item is not in the DOM — the status bar is optional
 * furniture, and a missing item must not take a settings module down with it.
 */
export function attach(buttonId, { label, render, onEvent }) {
  const button = $(buttonId);
  if (!button) return false;

  menus.set(buttonId, { label, render, onEvent });
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", e => {
    e.stopPropagation();          // or the outside-click handler closes it again
    openId === buttonId ? close() : open(buttonId);
  });
  return true;
}

export function open(id) {
  const host = $("mount-menus");
  const config = menus.get(id);
  if (!host || !config) return;

  if (openId && openId !== id) close();
  openId = id;
  draw();

  $(id)?.setAttribute("aria-expanded", "true");
  host.querySelector("button, select, [tabindex]")?.focus?.();

  // Capture phase: a click elsewhere closes this before it does whatever else
  // it was going to do, which is what every menu everywhere already does.
  document.addEventListener("click", onAway, true);
  document.addEventListener("keydown", onKey);
}

export function close() {
  const host = $("mount-menus");
  if (openId) $(openId)?.setAttribute("aria-expanded", "false");
  openId = null;
  if (host) clear(host);
  document.removeEventListener("click", onAway, true);
  document.removeEventListener("keydown", onKey);
}

/**
 * Re-render the open menu in place.
 *
 * Called when the thing a menu is showing changes underneath it — a device
 * joins while the roster is open, the transport fails over while the picker is
 * open. Doing nothing would leave a menu quietly lying about the current state.
 */
export function refresh() {
  if (openId) draw();
}

function draw() {
  const host = $("mount-menus");
  const config = menus.get(openId);
  if (!host || !config) return;

  // Focus is restored after the rebuild: a menu that re-renders because a peer
  // joined must not drop the keyboard user back to the top of the page.
  const focused = document.activeElement?.dataset?.mi;

  // The label is ours, not a peer's. Escaped anyway, because the repo rule is
  // "everything interpolated into innerHTML goes through esc()" and an
  // exception you have to remember is not a rule.
  setHTML(host, `<div class="smenu" role="menu" aria-label="${esc(config.label)}">`
    + config.render() + `</div>`);

  host.onclick = e => route(e, config);
  host.onchange = e => route(e, config);

  if (focused) host.querySelector(`[data-mi="${CSS.escape(focused)}"]`)?.focus?.();
  anchor(host);
}

function route(e, config) {
  try { config.onEvent(e, close); }
  catch (err) { console.error("[statusMenu] handler failed", err); }
}

/**
 * Sit directly above the item that opened it, without falling off the screen.
 *
 * Measured rather than fixed in CSS, in both axes, because both move.
 * Horizontally: items before it change width (the share key) and some are
 * dropped at narrow widths, so an item's left edge is not knowable in advance.
 * Vertically: the status bar is the last row on a desktop but NOT on a phone,
 * where the tab bar sits below it — a menu offset from the bottom of the
 * viewport was right on one layout and covering the tabs on the other.
 *
 * The CSS values remain as the fallback for anything that cannot measure.
 */
function anchor(host) {
  const menu = host.querySelector(".smenu");
  const button = $(openId);
  if (!menu || typeof button?.getBoundingClientRect !== "function") return;

  const bar = button.getBoundingClientRect();
  if (!bar.width && !bar.height) return;                   // not laid out yet

  const width = menu.getBoundingClientRect().width || 300;
  menu.style.left = `${Math.max(8, Math.min(bar.left, window.innerWidth - width - 8))}px`;
  menu.style.bottom = `${Math.max(0, window.innerHeight - bar.top + 6)}px`;
}

function onAway(e) {
  if (!openId) return;
  const host = $("mount-menus");
  if (host?.contains(e.target) || $(openId)?.contains(e.target)) return;
  close();
}

function onKey(e) {
  if (e.key !== "Escape" || !openId) return;
  e.preventDefault();
  const button = $(openId);
  close();
  button?.focus?.();
}
