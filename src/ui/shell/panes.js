/**
 * Collapsible sidebar panes.
 *
 * Delegated from the sidebar rather than bound per-header, because feature
 * modules load dynamically and append their own panes: a querySelectorAll
 * snapshot at init binds only what exists at that instant, and re-running init
 * binds the early ones twice. One listener on a stable ancestor is immune.
 *
 * The disclosure control is a genuine <button> wrapping only the chevron and the
 * label, inserted by upgrade(). A `.paneh` is a clickable <div> — unreachable by
 * keyboard, announces as nothing (WCAG 2.1.1, 4.1.2) — and role="button" on the
 * header is wrong because it also carries action buttons, and a button inside a
 * button is invalid. Enter and Space then come free: there is no key handling in
 * this file, which is the point. The row stays clickable for the mouse.
 */

import { $ } from "../primitives/dom.js";

/** Only used to mint an id for aria-controls when a .paneb has none. */
let paneSeq = 0;

/** A header's leading content ends at the first of these. */
const isBoundary = node =>
  node.nodeType === 1 &&
  (node.tagName === "BUTTON" ||
   node.classList.contains("spacer") ||
   node.classList.contains("soft"));

/**
 * Turn a `.paneh` into a real disclosure control. Idempotent — safe to call on
 * every mutation, which is exactly what init() does.
 *
 * Exported so a pane that owns its own toggle handler (ui/historyPanel.js) gets
 * identical semantics without having to restate them.
 *
 * @returns {HTMLButtonElement|null} the disclosure button
 */
export function upgrade(header) {
  if (!header || header.nodeType !== 1) return null;

  const existing = header.querySelector(".panebtn");
  if (existing) return existing;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "panebtn";

  // Move the chevron and the label into the button; stop before the spacer,
  // the count and the action buttons so they stay outside it.
  while (header.firstChild && !isBoundary(header.firstChild)) {
    btn.appendChild(header.firstChild);
  }
  if (!btn.childNodes.length) return null;      // nothing to label it with

  header.insertBefore(btn, header.firstChild);

  // Decoration, and it duplicates what aria-expanded already says.
  btn.querySelector(".chev")?.setAttribute("aria-hidden", "true");

  const body = header.parentElement?.querySelector(".paneb");
  if (body) {
    if (!body.id) body.id = `paneb${++paneSeq}`;
    btn.setAttribute("aria-controls", body.id);
  }

  sync(header);
  return btn;
}

/** Reflect the pane's collapsed state onto its disclosure button. */
export function sync(header) {
  const btn = header?.querySelector?.(".panebtn");
  if (!btn) return;
  const collapsed = header.parentElement?.classList.contains("collapsed") === true;
  btn.setAttribute("aria-expanded", String(!collapsed));
}

function toggle(header) {
  const pane = header.parentElement;
  if (!pane) return;
  pane.classList.toggle("collapsed");
  sync(header);
}

export function init() {
  const side = $("side");
  if (!side) return;

  side.querySelectorAll("[data-toggle]").forEach(upgrade);

  // The same reason the click handler is delegated: panes arrive late. Scoped
  // to added nodes so the sidebar's frequent re-renders (the file grid repaints
  // on every progress tick) cost a type check and nothing else.
  if (typeof MutationObserver === "function") {
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.("[data-toggle]")) upgrade(node);
          node.querySelectorAll?.("[data-toggle]").forEach(upgrade);
        }
      }
    }).observe(side, { childList: true, subtree: true });
  }

  side.addEventListener("click", e => {
    const header = e.target.closest("[data-toggle]");
    if (!header || !side.contains(header)) return;
    // Buttons inside a header (add file, new key, copy link) act on their own;
    // they must not also collapse the pane out from under the user. The
    // disclosure button is the exception — collapsing IS its job, and letting
    // its click fall through to here keeps exactly one toggle per activation
    // for mouse, Enter and Space alike.
    const btn = e.target.closest("button");
    if (btn && !btn.classList.contains("panebtn")) return;
    toggle(header);
  });
}
