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
  bind("bAbout", "click", showAbout);

  // Collapsible panes, VS Code sidebar behaviour.
  $$("[data-toggle]").forEach(h =>
    bind(h, "click", () => h.parentElement.classList.toggle("collapsed")));

  restoreSettings();

  $$(".sw").forEach(sw => bind(sw, "click", () => {
    const next = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(next));
    persist(sw.dataset.k, next);
  }));

  bind("poll", "change", e => {
    persist("poll", e.target.value);
    capture.startPolling();
  });
  bind("direction", "change", e => persist("direction", e.target.value));

  on(EV.KEY_CHANGED, ({ key }) => renderKey(key));
  on(EV.PEERS_CHANGED, ({ count, list }) => renderPeers(count, list));
  on(EV.INSTANCE_CHANGED, warnSplitBrain);

  renderPeers(1, []);
}

function persist(name, value) {
  state.setSetting(name, value);
  storage.saveSettings(state.get().settings);
}

function restoreSettings() {
  const saved = storage.loadSettings();
  if (saved) Object.assign(state.get().settings, saved);
  const s = state.get().settings;

  $$(".sw").forEach(sw => sw.setAttribute("aria-checked", String(Boolean(s[sw.dataset.k]))));
  if (POLL_OPTIONS[s.poll] !== undefined) $("poll").value = s.poll;
  $("direction").value = s.direction;
}

function renderKey(key) {
  ["key", "bcKey", "sbKeyText"].forEach(id => { const el = $(id); if (el) el.textContent = key; });
}

/**
 * Rotating the key means leaving the current room entirely, so main.js has to
 * tear down the connection and derive fresh crypto material. This panel only
 * announces the intent — it does not own the transport.
 */
function newKey() {
  emit("session:rejoin", { key: keys.generate() });
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

function showAbout() {
  const s = state.get();
  emit(EV.TOAST,
    `Hopboard · ${s.connection} · ${s.peers} device${s.peers === 1 ? "" : "s"} · `
    + `capture ${s.tier} · relay ${s.instance || "—"}`);
}
