/**
 * Inline banners above the editor: clipboard permission, pending clips, and the
 * split-brain warning.
 *
 * Self-contained — builds its own DOM under #mount-banners so no markup lives
 * in index.html for it. Each banner is keyed, so showing the same key twice
 * updates rather than stacks.
 */

import { on, emit, EV } from "../core/bus.js";
import { TRANSPORT } from "../core/config.js";
import * as capture from "../clipboard/capture.js";
import { $, esc } from "./dom.js";

const banners = new Map();
/** key -> a function that cancels that banner's auto-dismiss timer. */
const timers = new Map();
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

  // A clip arrived while there was unsent work in the editor. It is already on
  // the clipboard; this only offers to put it in view, so nothing is lost
  // either way.
  on(EV.CLIP_OFFERED, ({ text }) => {
    show("offered", {
      tone: "info",
      title: "New clip received",
      body: `It is on your clipboard. Applying it here replaces what you have typed. `
          + `“${text.slice(0, 70)}${text.length > 70 ? "…" : ""}”`,
      action: {
        label: "Show it",
        onClick: () => { emit("clip:accept", { text }); dismiss("offered"); },
      },
    });
  });

  // The key is a bearer credential: whoever holds it is in. Silently adding a
  // device to a list nobody re-reads is not enough — if a stranger guesses or
  // is handed the key, the moment they arrive is the only moment it is
  // noticeable.
  on(EV.PEER_JOINED, ({ name }) => {
    show("joined", {
      tone: "warn",
      title: "A device joined this session",
      body: `${name || "An unnamed device"} can now read what you copy and `
          + `request your files. If that was not you, generate a new key.`,
      action: { label: "New key", onClick: () => emit("session:rotate") },
      // Auto-dismissed, but only while nobody is reading it — see show().
      dismissAfter: 15000,
    });
  });

  // Which pipe the session is running down. Silence here would be the same
  // mistake FR-7.6 forbids for file transfers: a fallback nobody is told about
  // reads as "the app is just slow today".
  on(EV.TRANSPORT, ({ mode, blocked }) => {
    if (blocked) {
      // Not "reconnecting". Neither a WebSocket nor a plain HTTP stream is
      // getting through, which no amount of waiting fixes — this is the banner
      // that gives someone something concrete to take to their IT desk.
      show("transport", {
        tone: "bad",
        title: "Cannot reach the relay",
        body: "Neither WebSockets nor HTTP streaming is getting through. If you are on "
            + "a managed network, ask for hopboard.fastapicloud.dev to be allowed on 443.",
      });
      return;
    }

    if (mode !== TRANSPORT.SSE) return dismiss("transport");

    show("transport", {
      tone: "info",
      title: "Using the HTTP fallback",
      body: "WebSockets are blocked on this network, so Hopboard switched to HTTP "
          + "streaming. Everything works and is still end-to-end encrypted; sending is "
          + "a little slower.",
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

/** rAF where it exists; a timer otherwise, so this module works headless. */
const soon = fn =>
  (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 0));

/**
 * A banner appears without anyone asking for it, so it has to announce itself
 * or a screen-reader user simply never learns that a clip is waiting or that
 * clipboard access was refused.
 *
 * Two roles, not one. "Relay instance changed" means sync has silently stopped
 * working and reads as lag until someone is told, so it interrupts (alert).
 * The rest are things you can act on when you get to them, and interrupting
 * whatever is being read for a permission prompt is the behaviour that trains
 * people to turn the screen reader's verbosity down.
 */
const ROLE = { bad: "alert" };

function show(key, { tone, title, body, action, dismissAfter }) {
  dismiss(key);

  const el = document.createElement("div");
  el.className = `banner banner-${tone}`;
  el.setAttribute("role", ROLE[tone] ?? "status");

  const txt = document.createElement("div");
  txt.className = "banner-txt";
  el.appendChild(txt);

  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn sm";
    btn.textContent = action.label;
    btn.onclick = () => action.onClick();
    el.appendChild(btn);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "banner-x";
  // Three banners can be on screen at once, and three buttons all called
  // "Dismiss" are indistinguishable in a screen reader's element list.
  close.setAttribute("aria-label", `Dismiss: ${title}`);
  close.textContent = "×";
  close.onclick = () => dismiss(key);
  el.appendChild(close);

  mount.appendChild(el);
  banners.set(key, el);

  // Filled a frame AFTER the live region is in the tree. A region that arrives
  // with its text already inside it is announced inconsistently across screen
  // readers — some treat the whole subtree as one insertion and say nothing.
  // Populating it once it is being watched is the behaviour they all agree on.
  soon(() => {
    if (banners.get(key) !== el) return;              // dismissed within the frame
    txt.innerHTML = `<b>${esc(title)}</b><span>${esc(body)}</span>`;
  });

  if (dismissAfter > 0) autoDismiss(key, el, dismissAfter);
}

/**
 * A banner that vanishes on a timer takes its action button with it.
 *
 * Fifteen seconds is comfortable if you saw it arrive, and nowhere near enough
 * if a screen reader is still reading the sentence before it, or if you are
 * partway through tabbing to "New key" (WCAG 2.2.1). So the clock stops
 * whenever the banner has focus in it or the pointer over it, and restarts
 * from the top when attention moves away. Nothing auto-dismisses out from
 * under someone who is looking at it.
 */
function autoDismiss(key, el, ms) {
  let timer = 0;
  let hovering = false;

  const held = () => hovering || el.contains(document.activeElement);
  const stop = () => { clearTimeout(timer); timer = 0; };
  const start = () => { if (!timer && !held()) timer = setTimeout(() => dismiss(key), ms); };

  el.addEventListener("pointerenter", () => { hovering = true; stop(); });
  el.addEventListener("pointerleave", () => { hovering = false; start(); });
  el.addEventListener("focusin", stop);
  el.addEventListener("focusout", () => soon(start));   // focus lands next tick
  timers.set(key, stop);
  start();
}

function dismiss(key) {
  timers.get(key)?.();
  timers.delete(key);
  banners.get(key)?.remove();
  banners.delete(key);
}
