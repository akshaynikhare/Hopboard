/** VS Code style status bar. Reflects state; owns none of it. */

import { on, EV } from "../core/bus.js";
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

  on(EV.TRANSFER_PATH, ({ path }) => {
    $("sbP2P").textContent = path === "relay" ? "Relay fallback" : "P2P connected";
  });

  on(EV.FILE_PROGRESS, ({ percent }) => {
    $("sbP2P").textContent = percent >= 100 ? "P2P connected" : `P2P ${percent}%`;
  });
}
