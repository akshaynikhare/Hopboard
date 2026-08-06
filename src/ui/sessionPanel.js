/** Panel 3 — share key, devices, settings. */

import { POLL_OPTIONS } from "../core/config.js";
import { emit, on, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as keys from "../core/keys.js";
import * as storage from "../core/storage.js";
import * as os from "../clipboard/os.js";
import * as capture from "../clipboard/capture.js";
import { $, $$, esc, on as bind } from "./dom.js";

export function init() {
  bind("bNew",  "click", e => { e.stopPropagation(); newKey(); });
  bind("bLink", "click", e => { e.stopPropagation(); copyLink(); });
  bind("sbKey", "click", copyLink);
  bind("bQr",   "click", () => emit("ui:qr", { text: keys.shareLink(state.get().key) }));
  bind("bLeave", "click", () => emit("session:leave"));

  // Collapsible panes are handled by ui/panes.js, delegated from the sidebar.
  // They used to be bound here with a querySelectorAll snapshot, which only
  // reached panes that already existed when this ran.

  restoreSettings();

  $$(".sw").forEach(sw => bind(sw, "click", () => {
    const next = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(next));
    persist(sw.dataset.k, next);
    if (sw.dataset.k === "longKeys") renderKeyStrength();
  }));

  renderKeyStrength();

  bind("poll", "change", e => {
    persist("poll", e.target.value);
    capture.startPolling();
  });

  on(EV.KEY_CHANGED, ({ key }) => renderKey(key));
  on(EV.PEERS_CHANGED, ({ count, list }) => renderPeers(count, list));
  on(EV.INSTANCE_CHANGED, warnSplitBrain);

  renderPeers(1, []);
}

function persist(name, value) {
  state.setSetting(name, value);
  storage.saveSettings(state.get().settings);
  emit(EV.SETTINGS_CHANGED, { name, value });
}

function restoreSettings() {
  const saved = storage.loadSettings();
  if (saved) Object.assign(state.get().settings, saved);
  const s = state.get().settings;

  // `?? true` matters: settings added after a user's preferences were saved
  // read back as undefined, and Boolean(undefined) would silently turn a
  // default-on feature off for everyone who used an earlier build.
  const DEFAULT_ON = new Set(["autowrite", "thumbs", "images", "cursors"]);
  $$(".sw").forEach(sw => {
    const key = sw.dataset.k;
    const value = s[key] ?? DEFAULT_ON.has(key);
    s[key] = value;
    sw.setAttribute("aria-checked", String(Boolean(value)));
  });

  const poll = $("poll");
  if (poll && POLL_OPTIONS[s.poll] !== undefined) poll.value = s.poll;
}

function renderKey(key) {
  // Two places since the breadcrumb went: the key in the app header and the
  // status bar's copy-the-link affordance.
  ["key", "sbKeyText"].forEach(id => { const el = $(id); if (el) el.textContent = key; });
}

/**
 * Rotating the key means leaving the current room entirely, so main.js has to
 * tear down the connection and derive fresh crypto material. This panel only
 * announces the intent — it does not own the transport.
 */
function newKey() {
  emit("session:rejoin", { key: keys.generate(keyLength()) });
}

const keyLength = () =>
  state.get().settings.longKeys ? keys.LENGTHS.LONG : keys.LENGTHS.NORMAL;

/**
 * Say what the setting buys in numbers, not adjectives. "More secure" is
 * unfalsifiable; "~29 bits" versus "~49 bits" lets someone decide.
 */
function renderKeyStrength() {
  const el = $("keyBits");
  if (!el) return;
  const n = keyLength();
  // "applies to the next key" matters: flipping this does not re-key the
  // session you are already in, and silently implying otherwise would be a
  // security claim the app is not honouring.
  el.textContent = `${n} characters · ~${Math.round(keys.entropyBits(n))} bits · applies to the next key`;
}

async function copyLink() {
  const link = keys.shareLink(state.get().key);
  if (await os.write(link)) emit(EV.TOAST, "Link copied — it contains the key");
}

function renderPeers(count, list) {
  $("peerN").textContent = count;
  $("sbPeers").textContent = `${count} device${count === 1 ? "" : "s"}`;

  const rows = list.length ? list : [{ name: "This device (you)", mode: "" }];
  $("peers").innerHTML = rows.map(p => `
    <div class="row">
      <span class="dot on"></span>
      <div class="l">${esc(p.name)}</div>
      ${p.mode === "p2p"   ? '<span class="pill p2p">P2P</span>'
      : p.mode === "relay" ? '<span class="pill relay">RELAY</span>' : ""}
    </div>`).join("");
}

/**
 * The relay keeps rooms in process memory. A changed instance id means we may
 * be on a different replica from our peers, which presents as "sync silently
 * stopped working". Say so loudly rather than letting it look like lag.
 */
function warnSplitBrain({ from, to }) {
  const el = $("splitWarn");
  if (!el) return;
  el.textContent = `Relay instance changed (${from} → ${to}). Rooms are per-process, `
    + `so devices on different replicas cannot see each other. Pin replicas to 1.`;
  el.classList.add("show");
}

