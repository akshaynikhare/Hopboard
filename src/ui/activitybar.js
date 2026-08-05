/** Left activity bar. Toggles the sidebar and focuses a pane. */

import { $, $$, on as bind } from "./dom.js";

const TARGETS = {
  abEditor:   null,          // toggles the sidebar entirely
  abFiles:    "paneFiles",
  abPeers:    "paneSession",
  abSettings: "paneSession",
};

export function init() {
  Object.entries(TARGETS).forEach(([id, paneId]) => {
    bind(id, "click", () => {
      $$(".abtn").forEach(b => b.classList.remove("on"));
      $(id).classList.add("on");

      const side = $("side");
      if (!paneId) return side.classList.toggle("hidden");

      side.classList.remove("hidden");
      const pane = $(paneId);
      pane.classList.remove("collapsed");
      pane.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}
