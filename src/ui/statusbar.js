/** VS Code style status bar. Reflects state; owns none of it. */

import { on, emit, EV } from "../core/bus.js";
import { TRANSPORT } from "../core/config.js";
import * as state from "../core/state.js";
import { $, esc } from "./dom.js";

const LABEL = {
  idle:         "Not connected",
  connecting:   "Connecting…",
  connected:    "Connected",
  reconnecting: "Reconnecting",
  offline:      "Offline",
};
const DOT = {
  idle: "", connecting: "wait", connected: "on", reconnecting: "wait", offline: "off",
};

export function init() {
  on(EV.CONN_STATE, ({ state, detail }) => {
    $("sbConnText").textContent = detail ? `${LABEL[state]} · ${detail}` : LABEL[state];
    $("sbConn").querySelector(".dot").className = `dot ${DOT[state] || ""}`;
  });

  initTransportPicker();

  on(EV.TIER_CHANGED, ({ tier, note }) => {
    $("sbTier").textContent = note ? `${tier} · ${note}` : tier;
  });

  // You can see everyone else's pointer; nothing was telling you they can see
  // yours. A presence feature that only shows you what you gain, and never
  // what you give up, is the asymmetry worth fixing before the toggle is.
  const showBroadcast = () => {
    const el = $("sbCursor");
    if (!el) return;
    const s = state.get();
    const others = Math.max(0, (s.peers ?? 1) - 1);
    const sharing = s.settings.cursors !== false && others > 0;
    el.hidden = !sharing;
    el.textContent = sharing
      ? `Pointer visible to ${others} device${others === 1 ? "" : "s"}`
      : "";
  };
  on(EV.PEERS_CHANGED, showBroadcast);
  on(EV.SETTINGS_CHANGED, showBroadcast);
  showBroadcast();

  on(EV.TRANSFER_PATH, ({ path }) => {
    $("sbP2P").textContent = path === "relay" ? "Relay fallback" : "P2P connected";
  });

  // The label must follow the actual path. Printing "P2P n%" for every tick
  // overwrote the RELAY label mid-transfer, which is exactly the silent
  // fallback FR-7.6 forbids — the user would have watched a relay transfer
  // labelled as direct.
  on(EV.FILE_PROGRESS, ({ percent, path }) => {
    const label = path === "relay" ? "Relay" : "P2P";
    $("sbP2P").textContent = percent >= 100 ? `${label} connected` : `${label} ${percent}%`;
  });
}

/* ------------------------------------------------------------------
   Transport picker

   The status bar already said which transport was carrying the session. This
   makes that label the control for it, which is the obvious place to look and
   costs no new screen furniture.

   Two audiences, both real:
     - someone on a network that only half-works, who needs to pin HTTP rather
       than watch the client rediscover that every reconnect;
     - anyone testing the fallback, which otherwise requires access to a
       network that actually blocks WebSockets.

   The UI never touches the transport itself (docs/ARCHITECTURE.md §3) — it
   emits, and main.js is what calls relay.setTransport().
------------------------------------------------------------------- */

const OPTIONS = [
  { value: "",              name: "Automatic",     hint: "WebSocket, with HTTP as the fallback" },
  { value: TRANSPORT.WS,    name: "WebSocket",     hint: "Fastest. Blocked on some corporate networks" },
  { value: TRANSPORT.SSE,   name: "HTTP fallback", hint: "Server-sent events plus POST. Slower, gets through more" },
];

let picked = "";          // what the user chose; "" is automatic
let live = null;          // what is actually carrying frames right now

function initTransportPicker() {
  const button = $("sbConn");
  const host = $("mount-transport");
  if (!button || !host) return;                  // status bar is optional furniture

  on(EV.TRANSPORT, ({ mode, forced }) => {
    picked = forced ?? "";
    live = mode;
    if (host.firstChild) drawMenu(host);         // only if it is open
  });

  button.addEventListener("click", e => {
    e.stopPropagation();
    host.firstChild ? closeMenu(host) : openMenu(host);
  });

  host.addEventListener("click", e => {
    const option = e.target.closest("[data-transport]");
    if (!option) return;
    // The empty string means automatic, so read the attribute rather than
    // trusting dataset to round-trip "" as anything but "".
    emit(EV.TRANSPORT_SELECT, { mode: option.getAttribute("data-transport") || null });
    closeMenu(host);
    $("sbConn")?.focus();
  });
}

function openMenu(host) {
  drawMenu(host);
  $("sbConn")?.setAttribute("aria-expanded", "true");
  host.querySelector("[data-transport]")?.focus();
  // Capture phase: a click anywhere else closes it before that click does
  // whatever else it was going to do, which is what every menu in every app
  // does and what people expect without thinking about it.
  document.addEventListener("click", onAway, true);
  document.addEventListener("keydown", onMenuKey);
}

function closeMenu(host) {
  host.innerHTML = "";
  $("sbConn")?.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", onAway, true);
  document.removeEventListener("keydown", onMenuKey);
}

function onAway(e) {
  const host = $("mount-transport");
  if (!host?.firstChild) return;
  if (host.contains(e.target) || $("sbConn")?.contains(e.target)) return;
  closeMenu(host);
}

function onMenuKey(e) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  closeMenu($("mount-transport"));
  $("sbConn")?.focus();
}

function drawMenu(host) {
  host.innerHTML = `<div class="tmenu" role="menu" aria-label="Connection transport">
    ${OPTIONS.map(o => {
      const chosen = o.value === picked;
      // "in use" is a different fact from "chosen": on Automatic the app picks,
      // and the user is entitled to see which one it landed on.
      const inUse = !chosen && !picked && o.value && o.value === live;
      return `<button class="tmenuitem" type="button" role="menuitemradio"
                 aria-checked="${chosen}" data-transport="${esc(o.value)}">
        <span class="tick">${chosen ? "✓" : ""}</span>
        <span class="tx"><b>${esc(o.name)}</b><span>${esc(o.hint)}</span></span>
        ${inUse ? `<span class="tnow">in use</span>` : ""}
      </button>`;
    }).join("")}
  </div>`;
}
