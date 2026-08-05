/** Transient status messages, bottom-right, VS Code notification style. */

import { $ } from "./dom.js";
import { on, EV } from "../core/bus.js";

let timer = null;

export function init() {
  on(EV.TOAST, show);
}

export function show(message, ms = 2400) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove("show"), ms);
}
