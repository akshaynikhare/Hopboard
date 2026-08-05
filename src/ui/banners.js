/**
 * Inline banners above the editor: clipboard permission, pending clips, and the
 * split-brain warning.
 *
 * Self-contained — builds its own DOM under #mount-banners so no markup lives
 * in index.html for it. Each banner is keyed, so showing the same key twice
 * updates rather than stacks.
 */

import { on, emit, EV } from "../core/bus.js";
import * as capture from "../clipboard/capture.js";
import { $, esc } from "./dom.js";

const banners = new Map();
let mount;

export function init() {
  mount = $("mount-banners");
  if (!mount) return;

  on(EV.PERMISSION, ({ state }) => {
    if (state === "granted") return dismiss("perm");

    if (state === "denied") {
      // Not a dead end — the paste tier always works and needs no permission.
      show("perm", {
        tone: "info",
        title: "Clipboard reading is blocked",
        body: "Paste into the editor with Ctrl/Cmd+V — that always works, no permission needed.",
      });
      return;
    }

    if (state === "prompt") {
      show("perm", {
        tone: "info",
        title: "Allow clipboard access",
        body: "Lets Hopboard pick up what you copied when you switch back to this window.",
        action: { label: "Allow", onClick: () => capture.requestPermission() },
      });
    }
  });

  on(EV.PENDING_CLIP, ({ pending, text }) => {
    if (!pending) return dismiss("pending");
    // writeText() needs focus, so a clip that arrives in the background is held
    // rather than dropped. Say so, and offer the manual route.
    show("pending", {
      tone: "warn",
      title: "1 clip waiting",
      body: `Focus this window and it lands on your clipboard automatically.${
        text ? ` (${text.slice(0, 60)}${text.length > 60 ? "…" : ""})` : ""}`,
      action: { label: "Apply now", onClick: () => capture.flushPending() },
    });
  });

  on(EV.INSTANCE_CHANGED, ({ from, to }) => {
    show("split", {
      tone: "bad",
      title: "Relay instance changed",
      body: `${from} → ${to}. Rooms live in process memory, so devices on `
          + `different replicas cannot see each other. Pin max replicas to 1.`,
    });
  });
}

function show(key, { tone, title, body, action }) {
  dismiss(key);

  const el = document.createElement("div");
  el.className = `banner banner-${tone}`;
  el.innerHTML = `
    <div class="banner-txt">
      <b>${esc(title)}</b>
      <span>${esc(body)}</span>
    </div>`;

  if (action) {
    const btn = document.createElement("button");
    btn.className = "btn sm";
    btn.textContent = action.label;
    btn.onclick = () => action.onClick();
    el.appendChild(btn);
  }

  const close = document.createElement("button");
  close.className = "banner-x";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.onclick = () => dismiss(key);
  el.appendChild(close);

  mount.appendChild(el);
  banners.set(key, el);
}

function dismiss(key) {
  banners.get(key)?.remove();
  banners.delete(key);
}
