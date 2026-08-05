/**
 * Collapsible sidebar panes.
 *
 * Delegated from the sidebar rather than bound per-header, because panes are
 * mounted at unpredictable points during boot: feature modules load
 * dynamically and append their own. A `querySelectorAll("[data-toggle]")`
 * snapshot at init time binds whatever happens to exist at that instant — a
 * pane mounted a moment later gets no handler at all, and re-running init
 * binds the early ones twice (a click that toggles and untoggles).
 *
 * One listener on a stable ancestor is immune to both.
 */

import { $ } from "./dom.js";

export function init() {
  const side = $("side");
  if (!side) return;

  side.addEventListener("click", e => {
    const header = e.target.closest("[data-toggle]");
    if (!header || !side.contains(header)) return;
    // Buttons inside a header (add file, new key, copy link) act on their own;
    // they must not also collapse the pane out from under the user.
    if (e.target.closest("button")) return;
    header.parentElement?.classList.toggle("collapsed");
  });
}
