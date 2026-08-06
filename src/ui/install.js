/**
 * PWA installability and service-worker lifecycle (PRD §3.4, FR-4.1 – FR-4.6).
 *
 * Self-contained by design. It creates its own DOM under #mount-banners, links
 * its own stylesheet and manifest, and reaches the rest of the app only through
 * the bus — nothing else in the repo has to change to switch it on, which is
 * the boundary test in docs/ARCHITECTURE.md §4.
 *
 * Everything here is path-relative. The site lives on a GitHub Pages subpath
 * (https://<user>.github.io/Hopboard/), so a single leading "/" anywhere below
 * would point at the user's Pages root and silently break both the service
 * worker scope and the install criteria — PRD OI-9.
 */

import { emit, EV } from "../core/bus.js";
import { $, esc } from "./dom.js";
import { fromUrl, isValid, fragment } from "../core/keys.js";
import { loadLastKey, read, write } from "../core/storage.js";

/* URLs are resolved against this module's own location rather than the
   document's, so they survive being loaded from any page in the app. */
const APP_ROOT = new URL("../../", import.meta.url);   // .../Hopboard/
const SW_URL = new URL("sw.js", APP_ROOT);
const MANIFEST_URL = new URL("manifest.webmanifest", APP_ROOT);
const CSS_URL = new URL("../styles/install.css", import.meta.url);

const DISMISSED = "installDismissed";

let deferredPrompt = null;    // the stashed beforeinstallprompt event
let wantsReload = false;      // the user asked for the update, so reload on swap
let hadController = false;    // was a worker already driving this page at boot?
let started = false;          // init() is idempotent — listeners must not stack

/* ---------------- OI-10: the fragment the install drops ---------------- */

/**
 * `start_url` cannot carry "#D75LV" — a manifest has no way to express a
 * fragment, so an installed app always launches at the bare scope with no room.
 * FR-4.5: fall back to the last key we stored.
 *
 * Runs at module evaluation, not from init(), because main.js resolves the key
 * inside its own boot() and this has to be true before that runs. Calling it
 * twice is a no-op, so init() calls it again for anyone importing lazily.
 *
 * With no stored key we do nothing at all: main.js generates a fresh one, which
 * is the correct behaviour for a first launch.
 */
function restoreRoom() {
  if (isValid(fromUrl().key)) return null;        // the URL already names a room

  const last = loadLastKey();
  if (!last || !isValid(last.key)) return null;   // let main.js generate one

  // The lock marker is restored with the key. Dropping it would rebuild the
  // fragment as an UNLOCKED room of the same name — a real room that anyone
  // holding the link can read — so an installed app relaunching would silently
  // move the user out of their private session and into a public one.
  const hash = fragment(last.key, last.locked);
  try {
    // replaceState, not location.hash: no history entry to trap the back
    // button, and no hashchange event fired at a half-booted app.
    history.replaceState(null, "", `#${hash}`);
  } catch {
    location.hash = hash;                         // sandboxed contexts
  }
  return hash;
}

restoreRoom();

/* ---------------- head plumbing ---------------- */

function linkStylesheet() {
  // install.css sets --pwa-css:1, so if styles/main.css already @imports it
  // there is nothing to inject.
  if (document.querySelector("link[data-pwa-css]")) return;
  const marker = getComputedStyle(document.documentElement)
    .getPropertyValue("--pwa-css").trim();
  if (marker === "1") return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL.href;
  link.dataset.pwaCss = "";
  document.head.appendChild(link);
}

function linkManifest() {
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = MANIFEST_URL.href;
  document.head.appendChild(link);
}

/* ---------------- banners ---------------- */

const ICON = {
  install: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  update: '<path d="M21 12a9 9 0 11-2.6-6.4M21 3v6h-6"/>',
};

function mount() {
  return $("mount-banners") || document.body;
}

/**
 * Build a banner. `message` and `action` are the only interpolated values and
 * both go through esc() — this module never has attacker-controlled text today,
 * but the rule in docs/ARCHITECTURE.md §5 is unconditional.
 */
function banner({ id, kind, icon, message, action, onAction, onClose }) {
  const existing = $(id);
  if (existing) return existing;

  const el = document.createElement("div");
  el.id = id;
  el.className = `pwa ${kind}`;
  el.setAttribute("role", "status");
  el.innerHTML =
    `<svg class="pwa-ico" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` +
    `<span class="pwa-msg">${esc(message)}</span>` +
    `<button class="btn" type="button" data-act>${esc(action)}</button>` +
    `<button class="ibtn pwa-x" type="button" aria-label="Dismiss">` +
    `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;

  el.querySelector("[data-act]").addEventListener("click", onAction);
  el.querySelector(".pwa-x").addEventListener("click", () => {
    el.remove();
    onClose?.();
  });

  mount().appendChild(el);
  return el;
}

const drop = id => $(id)?.remove();

/* ---------------- install prompt (FR-4.4) ---------------- */

/** Already running as an installed app? Then there is nothing to offer. */
function installed() {
  return ["standalone", "window-controls-overlay", "fullscreen", "minimal-ui"]
    .some(mode => window.matchMedia?.(`(display-mode: ${mode})`).matches)
    || navigator.standalone === true;      // iOS Safari's non-standard flag
}

function showInstall() {
  if (installed() || read(DISMISSED, false)) return;
  banner({
    id: "pwaInstall",
    kind: "info",
    icon: ICON.install,
    message: "Install Hopboard for its own window, icon and offline shell.",
    action: "Install app",
    onAction: promptInstall,
    // Remember the dismissal: Chrome re-fires beforeinstallprompt on later
    // visits and re-offering every time is nagware.
    onClose: () => write(DISMISSED, true),
  });
}

async function promptInstall() {
  const evt = deferredPrompt;
  if (!evt) { drop("pwaInstall"); return; }

  deferredPrompt = null;                   // a prompt event is single-use
  drop("pwaInstall");
  try {
    evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome !== "accepted") emit(EV.TOAST, "Install dismissed");
  } catch (err) {
    console.warn("[pwa] install prompt failed", err);
    emit(EV.TOAST, "Install is not available here");
  }
}

/* ---------------- service worker (FR-4.2, FR-4.6) ---------------- */

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;

  hadController = !!navigator.serviceWorker.controller;

  let reg;
  try {
    // Relative script URL and relative scope: on Pages this registers
    // /Hopboard/sw.js scoped to /Hopboard/, and an absolute "/sw.js" would 404.
    reg = await navigator.serviceWorker.register(SW_URL, { scope: APP_ROOT.href });
  } catch (err) {
    // No offline shell, but the app still works. Not worth a toast.
    console.warn("[pwa] service worker registration failed", err);
    return;
  }

  // A worker parked in `waiting` from a previous visit is an update we never
  // finished applying.
  if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg);

  reg.addEventListener("updatefound", () => {
    const incoming = reg.installing;
    if (!incoming) return;
    incoming.addEventListener("statechange", () => {
      // "installed" with a controller already present means this is a second
      // worker, i.e. an update. Without a controller it is the first install
      // and there is nothing to reload for.
      if (incoming.state === "installed" && navigator.serviceWorker.controller) {
        showUpdate(reg);
      }
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (wantsReload) { wantsReload = false; location.reload(); return; }
    // A worker took over without us asking. Harmless on the first visit
    // (clients.claim), an update at any other time.
    if (hadController) showUpdate(reg);
  });
}

function showUpdate(reg) {
  if ($("pwaUpdate")) return;
  emit(EV.TOAST, "Update available · Reload");
  banner({
    id: "pwaUpdate",
    kind: "warn",
    icon: ICON.update,
    message: "A new version of Hopboard is ready.",
    action: "Reload",
    onAction: () => applyUpdate(reg),
  });
}

/**
 * Non-blocking by contract (FR-4.6): nothing reloads until this is clicked, so
 * an update can never eat what someone is typing into the editor.
 */
function applyUpdate(reg) {
  drop("pwaUpdate");
  wantsReload = true;
  const waiting = reg?.waiting;
  if (waiting) {
    waiting.postMessage({ type: "SKIP_WAITING" });
    // If the swap never lands (worker already active, or the message is lost)
    // reload anyway rather than leaving a dead button.
    setTimeout(() => { if (wantsReload) location.reload(); }, 1500);
  } else {
    location.reload();
  }
}

/* ---------------- init ---------------- */

export function init() {
  restoreRoom();
  linkStylesheet();
  linkManifest();

  if (started) return;        // a second call must not double-register listeners
  started = true;

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();          // suppress Chrome's own mini-infobar
    deferredPrompt = event;
    showInstall();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    drop("pwaInstall");
    write(DISMISSED, false);         // a later uninstall should offer it again
    emit(EV.TOAST, "Hopboard installed");
  });

  // Installing from Chrome's own address-bar affordance never fires our click
  // handler, so watch the display mode too.
  window.matchMedia?.("(display-mode: standalone)")
    .addEventListener?.("change", event => { if (event.matches) drop("pwaInstall"); });

  registerSW();
}
