/**
 * Bottom tab bar — the phone layout's view switcher.
 *
 * ── WHY A TAB BAR ──────────────────────────────────────────────────────────
 * The desktop layout is two columns: the editor, and a sidebar holding three
 * stacked panes. Narrow enough and that becomes one column, which is where the
 * old narrow layout stopped — and one column of five scrolling regions on a
 * 640px-tall screen is not a layout, it is a list of things you have to scroll
 * past to reach the thing you wanted. The editor never got more than half the
 * screen; the status bar was below the fold.
 *
 * So on a phone the app shows exactly one of them at a time and gives it the
 * whole shell. This file owns which one.
 *
 * ── HOW ────────────────────────────────────────────────────────────────────
 * A view is a tab plus the elements that make it up. Three of the four include
 * the sidebar itself, because their pane lives inside it — so "show a view" is
 * "hide everything in the union that this view does not claim", not "toggle one
 * element". Hiding is a class (.mv-hide) rather than inline `display`, so the
 * media query in styles/mobile.css is what decides whether it means anything:
 * a stale class left on a widened window cannot blank out the desktop layout.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * Not `role="tablist"`. That pattern requires each view to be a `tabpanel`, and
 * the Text view is the document's `<main>` — trading a landmark screen-reader
 * users navigate by for an ARIA relationship they get anyway from `aria-current`
 * is a bad trade. This is a nav with a current item, which is what it is.
 */

import { $, esc } from "./dom.js";

/** Must match the breakpoint in styles/mobile.css. */
const NARROW = "(max-width:900px)";

/* 24×24, stroked, matching the icons already in app.html. */
const ICON = {
  text: '<path d="M4 6h16M4 11h16M4 16h10"/>',
  files: '<path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>',
  history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
  devices: '<rect x="2" y="4" width="13" height="10" rx="1"/><path d="M6 18h5"/>'
         + '<rect x="17" y="8" width="5" height="12" rx="1"/>',
};

let shell, host, views = [], all = [], current = "text", mq = null;

export function init() {
  shell = $("shell");
  host = $("mount-mobilenav");
  if (!shell || !host) return;

  const side = $("side");

  // Built here rather than at module scope: the history pane is mounted by an
  // optional feature module during boot, and if that module failed to load
  // there is no Clips view to offer. main.js runs this after loadOptional()
  // for exactly that reason.
  views = [
    { id: "text",    label: "Text",    icon: ICON.text,    els: [$("mainPane")] },
    { id: "files",   label: "Files",   icon: ICON.files,   els: [side, $("paneFiles")] },
    // Labelled for the pane it shows, not for the concept: the header inside it
    // says HISTORY, and a tab called "Clips" that opens "History" reads as two
    // different places.
    { id: "history", label: "History", icon: ICON.history, els: [side, $("paneHistory")] },
    { id: "devices", label: "Devices", icon: ICON.devices, els: [side, $("paneSession")] },
  ].filter(v => v.els.every(Boolean));

  if (views.length < 2) return;                 // nothing to switch between
  all = [...new Set(views.flatMap(v => v.els))];

  // Local constants, not user input — escaped anyway, because the repo rule is
  // "everything interpolated into innerHTML goes through esc()" and an
  // exception you have to remember is not a rule.
  host.innerHTML = `
    <nav class="mnav" aria-label="Views">
      ${views.map(v => `
        <button type="button" class="mnavbtn" data-view="${esc(v.id)}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${v.icon}</svg>
          <span>${esc(v.label)}</span>
          <span class="mdot" hidden></span>
          <span class="vh" data-alert hidden>needs attention</span>
        </button>`).join("")}
    </nav>`;

  host.addEventListener("click", e => {
    const btn = e.target.closest("[data-view]");
    if (btn) show(btn.dataset.view);
  });

  mq = window.matchMedia?.(NARROW) ?? null;
  // addListener is the pre-2019 Safari spelling. The app targets phones and
  // some of them are old — but the two must not both fire, or every breakpoint
  // change repaints twice.
  if (mq?.addEventListener) mq.addEventListener("change", onBreakpoint);
  else mq?.addListener?.(onBreakpoint);

  watchSplitBrain();
  paint();
}

/** Switch views. No-op for an unknown id, so a stale class name cannot blank the screen. */
export function show(id) {
  if (!views.some(v => v.id === id)) return;
  current = id;
  paint();
}

function onBreakpoint() {
  paint();
  fitKeyboard();
}

function paint() {
  const narrow = mq ? mq.matches : false;
  const active = views.find(v => v.id === current) ?? views[0];

  for (const el of all) {
    el.classList.toggle("mv-hide", narrow && !active.els.includes(el));
  }

  // Drives the handful of view-specific rules in styles/mobile.css. Removed
  // rather than blanked on the wide layout so those selectors cannot match.
  if (narrow) shell.dataset.mview = active.id;
  else delete shell.dataset.mview;

  for (const btn of host.querySelectorAll(".mnavbtn")) {
    btn.setAttribute("aria-current", String(btn.dataset.view === active.id));
  }

  refreshAlerts();
}

/* ------------------------------------------------------------------
   Split-brain warning

   sessionPanel.js writes it into #splitWarn, inside the sidebar's Devices
   pane. On a phone that pane is one tab out of four, so the one message in the
   app that means "sync has stopped working and nothing else will tell you"
   could sit unread behind the editor. Mark the tab instead.
------------------------------------------------------------------- */
function watchSplitBrain() {
  const warn = $("splitWarn");
  if (!warn || typeof MutationObserver !== "function") return;
  new MutationObserver(refreshAlerts)
    .observe(warn, { attributes: true, attributeFilter: ["class"] });
}

function refreshAlerts() {
  const warn = $("splitWarn");
  // Only while you are somewhere else — on the Devices tab the warning itself
  // is on screen, in full, and a dot beside it says nothing.
  const flag = !!warn?.classList.contains("show") && current !== "devices";
  const btn = host?.querySelector('[data-view="devices"]');
  btn?.querySelector(".mdot")?.toggleAttribute("hidden", !flag);
  btn?.querySelector("[data-alert]")?.toggleAttribute("hidden", !flag);
}

/* ------------------------------------------------------------------
   On-screen keyboard

   The keyboard shrinks the VISUAL viewport and leaves the layout viewport
   alone, so a 100dvh shell keeps its full height and its bottom third — the ad
   slot, the status bar, the tab bar, and often the line being typed — ends up
   behind the keyboard. Pinning the shell to what is actually visible hands
   that space back to the editor.

   The 150px threshold is what separates a keyboard from a collapsing URL bar
   (60–90px), which must NOT trigger this: reacting to it would resize the shell
   on every scroll.
------------------------------------------------------------------- */
const vv = typeof window !== "undefined" ? window.visualViewport : null;

function fitKeyboard() {
  if (!shell || !vv) return;
  const covered = window.innerHeight - vv.height;
  shell.style.height = mq?.matches && covered > 150 ? `${vv.height}px` : "";
}

vv?.addEventListener?.("resize", fitKeyboard);
