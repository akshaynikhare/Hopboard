/**
 * Session and settings, in the status bar.
 *
 * This was Panel 3: a sidebar pane holding the device roster and six groups of
 * switches. It is now four slide-up menus hanging off the status-bar items that
 * already reported the same things:
 *
 *   #sbPeers  "2 devices"  roster, split-brain warning, new key, leave
 *   #sbMode   "Live sync"  Live/Manual, clipboard polling, receiving, images
 *   #sbP2P    "P2P idle"   the file settings
 *   #sbGear   (gear)       key strength and pointer sharing
 *
 * Why move at all: on a phone the pane was one tab out of four, so every
 * setting — and the roster, and the split-brain warning that means sync has
 * silently stopped — sat behind the editor until someone went looking. The
 * status bar is on screen in every view on every layout.
 *
 * The menus render from state on every open (see ui/statusMenu.js), which is
 * what lets this file drop the DOM-seeding that used to run at boot: there are
 * no switch elements to initialise, because they do not exist until the moment
 * they are shown.
 */

import { POLL_OPTIONS, SYNC_MODES } from "../core/config.js";
import { emit, on, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as keys from "../core/keys.js";
import * as storage from "../core/storage.js";
import * as os from "../clipboard/os.js";
import * as capture from "../clipboard/capture.js";
import * as menu from "./statusMenu.js";
// The header switch and this menu are two controls for one setting, so they go
// through the one module that owns persistence and repainting rather than each
// poking state.settings.syncMode behind the other's back.
import * as syncMode from "./syncMode.js";
import { $, esc, on as bind } from "./dom.js";

/** Switches that are ON for anyone who has never touched them. */
const DEFAULT_ON = new Set(["autowrite", "thumbs", "images", "cursors"]);
const SWITCHES = ["autowrite", "images", "autoaccept", "thumbs", "longKeys", "cursors"];

/** Set by the relay when the room may have moved replica; shown in the roster. */
let splitBrain = null;

export function init() {
  bind("bNew",  "click", e => { e.stopPropagation(); newKey(); });
  bind("bLink", "click", e => { e.stopPropagation(); copyLink(); });
  bind("sbKey", "click", copyLink);
  bind("bQr",   "click", () => showQr());

  restoreSettings();

  menu.attach("sbPeers", { label: "Devices", render: devicesMenu, onEvent: onMenuEvent });
  menu.attach("sbMode",  { label: "Sync",    render: syncMenu,    onEvent: onMenuEvent });
  menu.attach("sbP2P",   { label: "Files",   render: filesMenu,   onEvent: onMenuEvent });
  menu.attach("sbGear",  { label: "Settings", render: gearMenu,   onEvent: onMenuEvent });

  on(EV.KEY_CHANGED, ({ key }) => renderKey(key));
  // The padlock and the Security group both read `locked`/`verified`, and the
  // second of those can flip at any moment — the first frame that decrypts.
  on(EV.LOCK_STATE, () => { renderLock(); menu.refresh(); });
  on(EV.PEERS_CHANGED, ({ count, list }) => renderPeers(count, list));
  on(EV.SYNC_MODE, () => menu.refresh());
  on(EV.INSTANCE_CHANGED, ({ from, to }) => { splitBrain = { from, to }; menu.refresh(); });

  renderPeers(1, []);
}

/* ------------------------------------------------------------------
   settings
------------------------------------------------------------------- */

function persist(name, value) {
  state.setSetting(name, value);
  storage.saveSettings(state.get().settings);
  emit(EV.SETTINGS_CHANGED, { name, value });
}

/**
 * Seed the settings object from storage.
 *
 * `?? DEFAULT_ON` matters: a setting added after a user's preferences were
 * saved reads back undefined, and Boolean(undefined) would silently turn a
 * default-on feature off for everyone who used an earlier build.
 *
 * Purely state now — it used to read and write the switch elements, which only
 * worked because they existed at boot. They are rendered on demand.
 */
function restoreSettings() {
  const saved = storage.loadSettings();
  if (saved) Object.assign(state.get().settings, saved);

  const s = state.get().settings;
  for (const k of SWITCHES) s[k] = s[k] ?? DEFAULT_ON.has(k);
}

/** One handler for all four menus: they are made of the same three controls. */
function onMenuEvent(e, close) {
  const s = state.get().settings;

  const sw = e.target.closest?.(".sw");
  if (sw && e.type === "click") {
    const next = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(next));
    persist(sw.dataset.k, next);
    return menu.refresh();               // key strength and labels follow it
  }

  if (e.target.id === "poll" && e.type === "change") {
    persist("poll", e.target.value);
    capture.startPolling();
    return;
  }

  if (e.type !== "click") return;
  const action = e.target.closest?.("[data-act]")?.dataset.act;
  if (!action) return;

  if (action === "mode") {
    syncMode.set(e.target.closest("[data-mode]").dataset.mode, true);
    return menu.refresh();
  }
  if (action === "new")    { close(); return newKey(); }
  if (action === "leave")  { close(); return emit("session:leave"); }
  if (action === "link")   { close(); return copyLink(); }
  if (action === "lock")   { close(); return emit("session:lock"); }
  if (action === "unlock") { close(); return emit("session:unlock"); }
  if (action === "repin")  { close(); return emit("session:repin"); }
  if (action === "qr")     { close(); return showQr(); }
}

/**
 * The note travels with the payload so qr.js needs no opinion about sessions —
 * and so the caption cannot claim the code carries the PIN when it does not,
 * nor stay silent about it when that is the whole point.
 */
function showQr() {
  const { key, locked } = state.get();
  emit("ui:qr", {
    text: keys.shareLink(key, locked),
    note: locked
      ? "The code carries the key, not the PIN. Whoever scans it still has to be told that separately."
      : "The link contains the key. Anyone who scans it can read what you copy.",
  });
}

/* ------------------------------------------------------------------
   menu contents
------------------------------------------------------------------- */

/** A switch row. `data-mi` is the focus anchor across a re-render. */
const swRow = (k, title, note) => `
  <div class="srow">
    <div class="l"><b>${esc(title)}</b><span>${esc(note)}</span></div>
    <button class="sw" role="switch" data-mi="${esc(k)}" data-k="${esc(k)}"
            aria-checked="${state.get().settings[k] ? "true" : "false"}"
            aria-label="${esc(title)}"></button>
  </div>`;

const group = title => `<div class="sgrp">${esc(title)}</div>`;

function devicesMenu() {
  const { peers, settings } = state.get();
  const list = rosterRows();

  return group(`In this session · ${peers}`)
    + list
    + (splitBrain ? `
      <div class="swarn" role="alert">
        Relay instance changed (${esc(splitBrain.from)} → ${esc(splitBrain.to)}).
        Rooms are per-process, so devices on different replicas cannot see each
        other. Pin replicas to 1.
      </div>` : "")
    + group("This session")
    + `<div class="sacts">
         <button class="btn ghost" type="button" data-act="link" data-mi="link">Copy link</button>
         <button class="btn ghost" type="button" data-act="qr" data-mi="qr">Show QR</button>
       </div>
       <div class="sacts">
         <button class="btn ghost" type="button" data-act="new" data-mi="new">New key</button>
         <button class="btn ghost" type="button" data-act="leave" data-mi="leave">Leave session</button>
       </div>`
    + (settings.cursors ? "" : `<div class="snote">Pointer sharing is off.</div>`);
}

let roster = [{ name: "This device (you)", mode: "" }];

function rosterRows() {
  return roster.map(p => `
    <div class="srow plain">
      <span class="dot on"></span>
      <div class="l"><b>${esc(p.name || "An unnamed device")}</b></div>
      ${p.mode === "p2p"   ? '<span class="pill p2p">P2P</span>'
      : p.mode === "relay" ? '<span class="pill relay">RELAY</span>' : ""}
    </div>`).join("");
}

function syncMenu() {
  const live = state.get().settings.syncMode !== SYNC_MODES.MANUAL;
  const poll = state.get().settings.poll;

  return group("Clipboard")
    + `<div class="sacts seg">
         <button class="btn ghost${live ? " on" : ""}" type="button"
                 data-act="mode" data-mode="${SYNC_MODES.LIVE}" data-mi="live"
                 aria-pressed="${live}">Live</button>
         <button class="btn ghost${live ? "" : " on"}" type="button"
                 data-act="mode" data-mode="${SYNC_MODES.MANUAL}" data-mi="manual"
                 aria-pressed="${!live}">Manual</button>
       </div>
       <div class="snote">${live
         ? "Anything you copy while this window has focus is shared."
         : "Nothing leaves this machine until you press Send."}</div>`
    + group("Live mode")
    + `<div class="srow">
         <div class="l"><b>Check clipboard every</b><span>Only while Live and focused</span></div>
         <select id="poll" data-mi="poll" aria-label="Clipboard poll interval">
           ${Object.keys(POLL_OPTIONS).map(o =>
             `<option${o === poll ? " selected" : ""}>${esc(o)}</option>`).join("")}
         </select>
       </div>`
    + swRow("images", "Share copied images", "Screenshots appear as previews on your other devices")
    + group("Receiving")
    + swRow("autowrite", "Auto-write incoming", "Put received text straight on this machine's clipboard");
}

function filesMenu() {
  return group("Files")
    + swRow("autoaccept", "Let peers fetch without asking", "Otherwise you approve each request")
    + swRow("thumbs", "Send previews", "Thumbnails travel automatically, before anyone asks")
    + `<div class="snote">Files move device to device. If that is blocked they go
        through the relay, encrypted, and the transfer says so.</div>`;
}

function gearMenu() {
  return group("Security")
    + swRow("longKeys", "Longer keys", keyStrength())
    + lockRows()
    + group("Presence")
    + swRow("cursors", "Show other cursors", "See where the other devices are pointing");
}

/**
 * Locking, as buttons rather than a switch.
 *
 * A switch says "an instant, local, reversible preference". This is none of
 * those: the lock is part of the room's name, so turning it on moves you to a
 * different session and leaves every device that was in the old one behind.
 * Presenting that as a toggle would be a small lie with a large consequence,
 * and the button label gets to say what actually happens.
 */
function lockRows() {
  const { locked, verified } = state.get();

  if (!locked) {
    return `<div class="srow plain">
        <div class="l"><b>Lock this session</b><span>Adds a PIN that is not in the
        link. Starts a new session — your other devices need the new link and the
        PIN.</span></div>
      </div>
      <div class="sacts">
        <button class="btn ghost" type="button" data-act="lock" data-mi="lock">Lock session</button>
      </div>`;
  }

  return `<div class="srow plain">
      <div class="l"><b>Locked${verified ? "" : " · not yet confirmed"}</b><span>${
        verified
          ? "Another device in this session has proved it has the same PIN."
          : "Nothing has been decrypted here yet, so the PIN is unconfirmed."
      }</span></div>
    </div>
    <div class="sacts">
      <button class="btn ghost" type="button" data-act="repin" data-mi="repin">Change PIN</button>
      <button class="btn ghost" type="button" data-act="unlock" data-mi="unlock">Remove lock</button>
    </div>
    <div class="snote">A locked session hides what you copy, not that you are
    here — the relay still sees a room with devices in it.</div>`;
}

/* ------------------------------------------------------------------
   the bits the status bar itself shows
------------------------------------------------------------------- */

function renderKey(key) {
  // Two places since the breadcrumb went: the key in the app header and the
  // status bar's copy-the-link affordance.
  ["key", "sbKeyText"].forEach(id => { const el = $(id); if (el) el.textContent = key; });
  renderLock();
}

/**
 * The padlock, in three states rather than two.
 *
 * "Private" and "Private · unconfirmed" are genuinely different claims and the
 * bar must not merge them. A locked session where nothing has decrypted yet
 * might be a session whose other devices simply have not arrived — or it might
 * be a mistyped PIN, which puts this device alone in a room of its own. Showing
 * a confident padlock in the second case would be the app asserting something
 * it has no evidence for, about the one property the feature exists to provide.
 */
function renderLock() {
  const el = $("sbLock");
  if (!el) return;

  const { locked, verified } = state.get();
  el.hidden = !locked;
  if (!locked) return;

  el.classList.toggle("unconfirmed", !verified);
  el.textContent = verified ? "Private" : "Private · unconfirmed";
  el.title = verified
    ? "Locked with a PIN, and another device here has proved it has the same one"
    : "Locked with a PIN. Nothing has decrypted yet, so no other device has been confirmed";
}

function renderPeers(count, list) {
  roster = list.length ? list : [{ name: "This device (you)", mode: "" }];
  const el = $("sbPeers");
  if (el) el.textContent = `${count} device${count === 1 ? "" : "s"}`;
  menu.refresh();                        // a device joining while the roster is open
}

/**
 * Rotating the key means leaving the current room entirely, so main.js has to
 * tear down the connection and derive fresh crypto material. This module only
 * announces the intent — it does not own the transport.
 */
function newKey() {
  // Stays locked if it was locked. "New key" answers "someone has my link", and
  // whoever had only the link never had the PIN — so dropping the lock here
  // would quietly downgrade a private session while the user was busy securing
  // it. main.js reuses the existing PIN rather than asking again.
  emit("session:rotate");
}

const keyLength = () =>
  state.get().settings.longKeys ? keys.LENGTHS.LONG : keys.LENGTHS.NORMAL;

/**
 * Say what the setting buys in numbers, not adjectives. "More secure" is
 * unfalsifiable; "~29 bits" versus "~49 bits" lets someone decide.
 *
 * "applies to the next key" matters: flipping this does not re-key the session
 * you are already in, and silently implying otherwise would be a security claim
 * the app is not honouring.
 */
function keyStrength() {
  const n = keyLength();
  return `${n} characters · ~${Math.round(keys.entropyBits(n))} bits · applies to the next key`;
}

async function copyLink() {
  const { key, locked } = state.get();
  const link = keys.shareLink(key, locked);
  if (!await os.write(link)) return;
  // The toast is the only moment the app can tell someone what they have just
  // put on their clipboard. For a locked session the important half is what is
  // NOT in it, and that the other half still has to be sent some other way.
  emit(EV.TOAST, locked
    ? "Link copied — the PIN is not in it. Send that separately"
    : "Link copied — it contains the key");
}
