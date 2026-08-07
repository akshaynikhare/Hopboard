/**
 * The desktop shell's half of the conversation.
 *
 * Everything that crosses between the webview and main.rs is here, so that
 * main.js — and every other UI module — stays ignorant of Tauri. What crosses
 * is deliberately small and deliberately dull:
 *
 *   out   two booleans about the window, and whether sync is Live
 *   in    the tray asking for something, and the window asking to close
 *
 * The tray asks rather than being told. "Copy share link" arrives here as a
 * request with no payload and is answered by the modules that already hold the
 * session, because the link is derived from the key and the key does not cross
 * into the native process (desktop/CLAUDE.md).
 */

import { emit, on, EV } from "../../core/bus.js";
import * as state from "../../core/state.js";
import * as storage from "../../core/storage.js";
import * as native from "../../core/native.js";
import { SYNC_MODES } from "../../core/config.js";
import { esc, lazyStyle } from "../primitives/dom.js";
import * as modal from "../primitives/modal.js";

/** Set once the user has been told where the window goes. */
const EXPLAINED = "closeExplained";

export async function init() {
  if (!native.IS_DESKTOP) return;

  pushWindowPrefs();
  pushSyncIndicator();

  on(EV.SETTINGS_CHANGED, ({ name }) => {
    if (name === "closeToTray") pushWindowPrefs();
  });
  on(EV.SYNC_MODE, pushSyncIndicator);

  await native.listen("window://close-requested", askAboutClose);
  await native.listen("ui://copy-link",  () => emit("ui:copy-link"));
  await native.listen("ui://toggle-sync", () => emit("ui:sync-toggle"));
  await native.listen("ui://guide",       () => emit("ui:guide"));
  await native.listen("shortcut://unavailable", combo =>
    emit(EV.TOAST, `${combo} is taken by another app — use the tray icon instead`));
}

/**
 * The native side keeps its own copy because only it sees a close, and it has
 * to behave correctly for a close that arrives before this page finished
 * booting. Its defaults match the shipped ones; this only ever corrects them.
 */
function pushWindowPrefs() {
  native.invoke("set_window_prefs", {
    closeToTray: state.get().settings.closeToTray !== false,
    askOnClose: !storage.read(EXPLAINED, false),
  });
}

function pushSyncIndicator() {
  native.invoke("set_sync_indicator", {
    live: state.get().settings.syncMode === SYNC_MODES.LIVE,
  });
}

/**
 * Where the window went, asked once.
 *
 * The window is still on screen at this point — main.rs called
 * prevent_close() before emitting — so this can be an ordinary dialog rather
 * than a native notification, and it can offer the choice instead of merely
 * announcing the behaviour. Being unable to make X mean X is what turns a
 * sensible default into the thing people file bugs about.
 */
function askAboutClose() {
  const answer = quit => {
    storage.write(EXPLAINED, true);
    pushWindowPrefs();
    native.invoke("resolve_close", { quit });
  };

  lazyStyle("desktop.css");

  const { el } = modal.show({
    className: "deskmodal",
    labelledBy: "closeTitle",
    html: `
      <h2 class="deskh" id="closeTitle">RealtimeClipboard keeps running</h2>
      <p class="deskp">Closing this window leaves it in your ${esc(trayName())} so
         it can carry on watching your clipboard. Open it again from there —
         <b>Quit</b> is in the same menu.</p>
      <label class="deskcheck">
        <input type="checkbox" id="closeAlwaysQuit">
        <span>Always quit instead, when I close the window</span>
      </label>
      <div class="deskrow">
        <button class="btn ghost" type="button" id="closeQuit">Quit now</button>
        <button class="btn" type="button" id="closeHide">Keep it running</button>
      </div>`,
    // Escape or the backdrop is not an answer to "what should X do", so treat
    // it as the default rather than leaving the shell waiting out its grace.
    onClose: result => { if (result === null) answer(false); },
  });

  el.querySelector("#closeHide")?.focus();

  el.querySelector("#closeQuit")?.addEventListener("click", () => {
    // Ticked alongside Quit, "always" is the same instruction said twice.
    if (el.querySelector("#closeAlwaysQuit")?.checked) {
      state.saveSetting("closeToTray", false);
    }
    modal.close("quit");
    answer(true);
  });

  el.querySelector("#closeHide")?.addEventListener("click", () => {
    if (el.querySelector("#closeAlwaysQuit")?.checked) {
      state.saveSetting("closeToTray", false);
    }
    modal.close("hide");
    answer(false);
  });
}

/** macOS puts it in the menu bar and calls it that; everyone else says tray. */
const trayName = () =>
  /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") ? "menu bar" : "system tray";
