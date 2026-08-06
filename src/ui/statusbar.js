/** VS Code style status bar. Reflects state; owns none of it. */

import { on, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import { $ } from "./dom.js";

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
