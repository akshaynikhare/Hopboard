/**
 * Live / Manual switch, in the app header.
 *
 * This is the most consequential control in the app, which is why it sits in
 * the header rather than buried in settings:
 *
 *   Live   — everything you copy, anywhere, goes to every device in the
 *            session. That is the product.
 *   Manual — nothing leaves this machine until you paste it here or press
 *            Send. Receiving is unchanged either way.
 *
 * The distinction matters because "live" means the passwords and tokens you
 * copy for unrelated reasons travel too. Someone on a work machine, or sharing
 * a key with a colleague for five minutes, should be able to see and change
 * that without hunting for it.
 */

import { SYNC_MODES } from "../../core/config.js";
import { emit, on, EV } from "../../core/bus.js";
import * as state from "../../core/state.js";
import * as storage from "../../core/storage.js";
import * as capture from "../../clipboard/capture.js";
import { $, esc, setHTML } from "../primitives/dom.js";

const OPTIONS = [
  { mode: SYNC_MODES.LIVE, label: "Live",
    hint: "Everything you copy is shared automatically" },
  { mode: SYNC_MODES.MANUAL, label: "Manual",
    hint: "Only what you paste here or Send is shared" },
];

export function init() {
  const host = $("mount-mode");
  if (!host) return;

  // These values are local constants, not user input — but escaping them
  // unconditionally keeps the repo-wide rule true with no exceptions to
  // remember, and costs nothing.
  setHTML(host, `
    <div class="modeswitch" role="radiogroup" aria-label="Clipboard sharing mode">
      ${OPTIONS.map(o => `
        <button class="modebtn" role="radio" data-mode="${esc(o.mode)}"
                aria-checked="false" title="${esc(o.hint)}">${esc(o.label)}</button>`).join("")}
    </div>`);

  host.addEventListener("click", e => {
    const btn = e.target.closest("[data-mode]");
    if (btn) set(btn.dataset.mode, true);
  });

  // Keyboard: a radiogroup that ignores arrows is not a radiogroup.
  host.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const current = state.get().settings.syncMode;
    set(current === SYNC_MODES.LIVE ? SYNC_MODES.MANUAL : SYNC_MODES.LIVE, true);
  });

  on(EV.SYNC_MODE, ({ mode }) => paint(mode));
  paint(state.get().settings.syncMode);
}

/**
 * Change the mode. Exported because the switch is not only a header control:
 * loading a clip out of history flips it to Manual (main.js), and that has to
 * go through the one function that owns persistence and repainting rather than
 * poking state.settings.syncMode behind this module's back.
 *
 * Returns true only when the mode actually changed, so a caller can decide
 * whether the change is worth telling the user about.
 */
export function set(mode, announce) {
  if (!Object.values(SYNC_MODES).includes(mode)) return false;
  if (state.get().settings.syncMode === mode) return false;

  state.setSetting("syncMode", mode);
  storage.saveSettings(state.get().settings);
  capture.applyMode();          // emits SYNC_MODE, which repaints
  paint(mode);

  if (announce) {
    emit(EV.TOAST, mode === SYNC_MODES.LIVE
      ? "Live — everything you copy is shared"
      : "Manual — only what you paste here is shared");
  }
  return true;
}

function paint(mode) {
  document.querySelectorAll(".modebtn").forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("on", active);
    btn.setAttribute("aria-checked", String(active));
    btn.tabIndex = active ? 0 : -1;
  });
  // The status bar says what the app is doing; this says what it is allowed
  // to do. Both are worth having visible at once.
  const dot = $("sbMode");
  if (dot) dot.textContent = mode === SYNC_MODES.LIVE ? "Live sync" : "Manual";
}
