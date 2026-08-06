/**
 * Live peer cursors — a small labelled pointer for every OTHER device in the
 * session, so a room with three laptops in it feels inhabited.
 *
 * ============================================================================
 * PRIVACY — read this before changing anything below
 * ============================================================================
 * This broadcasts a continuous signal about what a person is physically doing,
 * which is a different class of data from "a clip arrived". Three properties
 * make it defensible, and all three are load-bearing:
 *
 *   1. It is ENCRYPTED like everything else. A cursor frame's only cleartext
 *      fields are `t` and `originId` — both in main.js's ROUTING_FIELDS, both
 *      needed to deliver the frame. `x`, `y`, `name` and `state` are sealed by
 *      main.js's encryptFrame() with the session key, exactly as a clip is. The
 *      relay forwards a blob; it does not learn where anyone's mouse is, only
 *      that some socket in some room is moving one.
 *
 *   2. It is OFF-SWITCHABLE. `state.settings.cursors` gates both directions.
 *      Undefined means on (this ships enabled); an explicit `false` means we
 *      send nothing and render nothing, and we tell peers we are gone rather
 *      than leaving a frozen pointer on their screens.
 *
 *   3. It STOPS when you are not there. Tab hidden, window blurred, or pointer
 *      outside the viewport and the stream ends immediately. Sharing a pointer
 *      while you are reading email in another tab is surveillance, not presence.
 *
 * We NEVER render our own pointer. A second cursor chasing the real one is
 * disorienting, and the guard is belt-and-braces: the relay excludes the sender
 * from a broadcast, and onSignal() drops anything carrying our originId anyway.
 *
 * ============================================================================
 * CONTRACT WITH main.js  (the transfer.js idiom — see files/transfer.js)
 * ============================================================================
 * A UI module must not import transport/relay.js (docs/ARCHITECTURE.md §3), so
 * main.js injects the send function and pumps inbound frames back in:
 *
 *   1.  cursors.setSignalSender(frame => boolean)
 *       `frame.t` is always FT.CURSOR; `frame.originId` (us) is filled in here.
 *       main.js seals the non-routing fields and puts it on the relay, and
 *       returns false if it could not be sent.
 *
 *   2.  cursors.onSignal(frame)
 *       Every inbound frame whose `.t` is in cursors.FRAMES, already decrypted,
 *       with `.originId` set to the sender (and `.from` stamped by the relay,
 *       which is the one field a peer cannot lie about — preferred when present).
 *
 *   3.  cursors.init()
 *
 * ============================================================================
 * RATE — why the numbers below
 * ============================================================================
 * A pointermove handler fires 60-120 times a second and clipboard sync is the
 * actual product; presence must never compete with it. Two things protect it:
 *
 *   - The relay puts "cursor" in its own rate-limit class (backend/main.py
 *     FRAME_CLASS) at 20/s, separate from the 10/s `interactive` bucket that
 *     clip, ping and hello share. So a moving mouse cannot rate-limit a clip
 *     even in the worst case.
 *   - We still throttle to one frame every SEND_INTERVAL_MS (100 ms = 10/s),
 *     half the cursor budget, leaving room for scheduler jitter without ever
 *     touching the 20/s ceiling. Movement smaller than MIN_MOVE does not send
 *     at all, so a resting hand costs nothing, and updates are coalesced with
 *     requestAnimationFrame so a burst of 8 moves between frames sends once.
 *
 * Smoothing happens on the RECEIVING side, in CSS: a 110 ms linear transform
 * transition turns the 10 fps feed into continuous motion on the compositor,
 * for no JavaScript per frame. `prefers-reduced-motion` drops it and the cursor
 * is simply placed. See styles/cursors.css.
 */

import { on, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as device from "../core/device.js";
import { $, esc, setHTML } from "./dom.js";
import { styleHref } from "../core/paths.js";

/** Frame types. "cursor" is ROOM_WIDE in the relay — broadcast, never targeted. */
export const FT = { CURSOR: "cursor" };

/** Exactly the frames main.js should route into onSignal(). */
export const FRAMES = Object.freeze(Object.values(FT));

/**
 * Pointer states carried in a frame.
 *
 * Deliberately two, not three. An "idle" state was considered and dropped:
 * silence already means idle, the fade renders it, and a frame whose only job
 * is to say "nothing happened" is a frame spent for no pixels.
 */
export const CURSOR_STATE = {
  MOVE: "move",   // {x, y, name} — here, and this is where
  GONE: "gone",   // no coordinates — stop drawing me, now
};

/* ------------------------------------------------------------------ *
 * Tunables
 *
 * These live here rather than in core/config.js because every one of them is
 * a property of this feature's feel, not a product limit. If a second module
 * ever needs one, that is the signal to promote it.
 * ------------------------------------------------------------------ */

/** 10 sends/sec — half the relay's 20/s cursor budget. See the header. */
const SEND_INTERVAL_MS = 100;

/**
 * Smallest movement worth a frame, in normalised units: 0.002 is ~4 px across
 * a 1920 px window, ~2 px on a phone. Below it the send is skipped entirely,
 * so hand tremor and a mouse resting against a wheel cost nothing.
 */
const MIN_MOVE = 0.002;

/**
 * Three decimals is ~2 px of precision on a 1920 px window — past the point
 * anyone can see, and rounding is free privacy: we transmit less about where
 * exactly someone is pointing than we could.
 */
const COORD_DP = 3;

/** Silence handling. Fade first so a peer's disappearance is not a jump cut. */
let fadeAfterMs = 10_000;   // 10 s quiet -> fade out
let dropAfterMs = 12_000;   // then remove the element entirely
let sweepMs = 1_000;        // how often the two above are checked

/** Peer-chosen, so bounded before it reaches the DOM. Matches device.rename(). */
const NAME_CHARS = 40;

/** Token colours used as peer identities. See styles/cursors.css .c0-.c4. */
const PALETTE_SIZE = 5;

/* ------------------------------------------------------------------ *
 * Injected collaborator
 * ------------------------------------------------------------------ */

let sendSignal = null;
let warnedNoSender = false;

export function setSignalSender(fn) { sendSignal = typeof fn === "function" ? fn : null; }

function signal(frame) {
  if (!sendSignal) {
    // Once, not ten times a second: a mis-wire should be visible, not a flood.
    if (!warnedNoSender) {
      warnedNoSender = true;
      console.warn("[cursors] no signal sender wired — main.js must call setSignalSender()");
    }
    return false;
  }
  frame.originId = state.get().originId;
  try { return sendSignal(frame) !== false; }
  catch (err) {
    console.error("[cursors] signal send threw", err);
    return false;
  }
}

/**
 * Seam for tests: shorten the silence windows so "a peer went quiet" is
 * exercisable without a twelve-second wait. Pass nothing to restore.
 */
export function setSilenceMs({ fade, drop, sweep } = {}) {
  fadeAfterMs = Number.isFinite(fade) && fade > 0 ? fade : 10_000;
  dropAfterMs = Number.isFinite(drop) && drop > 0 ? drop : 12_000;
  sweepMs = Number.isFinite(sweep) && sweep > 0 ? sweep : 1_000;
  if (sweepTimer) { stopSweep(); ensureSweep(); }
}

/* ------------------------------------------------------------------ *
 * Gates
 * ------------------------------------------------------------------ */

/**
 * The setting. Undefined is ON — the feature ships enabled and sessionPanel
 * writes the flag only once someone touches the toggle, so treating a missing
 * value as "off" would silently disable it for every existing install.
 */
const allowed = () => state.get().settings.cursors !== false;

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

let focused = true;
let pointerInside = false;

/** Everything that must be true before this device's pointer goes on the wire. */
const canSend = () => allowed() && !hidden() && focused && pointerInside;

/* ------------------------------------------------------------------ *
 * SEND SIDE
 * ------------------------------------------------------------------ */

let pending = null;        // newest normalised position, not yet sent
let lastSent = null;       // what peers last heard, for the MIN_MOVE test
let lastSentAt = 0;
let rafPending = false;
let flushTimer = 0;
let broadcasting = false;  // peers currently believe we have a live pointer

const nowMs = () =>
  (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

/** rAF where it exists; a timer otherwise, so this module works headless. */
function raf(fn) {
  return typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(fn)
    : setTimeout(fn, 16);
}

const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : n);
const round = n => Number(n.toFixed(COORD_DP));
const isCoord = n => typeof n === "number" && Number.isFinite(n);

function onPointerMove(ev) {
  // A finger is not a hovering pointer: a touch drag would render as a cursor
  // that teleports and then vanishes, which reads as a glitch rather than a
  // person. Mouse, trackpad and pen only.
  if (ev.pointerType === "touch") return;

  pointerInside = true;
  if (!canSend()) return;

  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  pending = { x: clamp01(ev.clientX / w), y: clamp01(ev.clientY / h) };
  schedule();
}

/**
 * The throttle. Never more than one pending flush: either a rAF (we are due
 * now) or a timer for the remainder of the interval (we are not). The timer
 * matters — without it, a pointer that stops moving the instant after a send
 * would leave its final position undelivered and the cursor stranded a few
 * pixels from where it actually is.
 */
function schedule() {
  if (rafPending || flushTimer) return;

  const wait = SEND_INTERVAL_MS - (nowMs() - lastSentAt);
  if (wait > 0) {
    flushTimer = setTimeout(() => { flushTimer = 0; schedule(); }, wait);
    return;
  }

  rafPending = true;
  raf(() => { rafPending = false; flush(); });
}

function flush() {
  const p = pending;
  pending = null;
  if (!p || !canSend()) return;

  const x = round(p.x);
  const y = round(p.y);
  // Only on actual movement. This is the difference between a still mouse
  // costing 10 frames a second and costing nothing.
  if (lastSent && Math.abs(x - lastSent.x) < MIN_MOVE && Math.abs(y - lastSent.y) < MIN_MOVE) return;

  lastSent = { x, y };
  lastSentAt = nowMs();
  broadcasting = true;
  ensureSweep();                       // so a setting flipped off is noticed
  signal({ t: FT.CURSOR, x, y, name: label(), state: CURSOR_STATE.MOVE });
}

/**
 * Stop broadcasting and say so.
 *
 * The explicit "gone" frame is what keeps a blurred window from leaving a
 * frozen pointer sitting on everyone else's screen for ten seconds. It is at
 * most one frame per blur/leave, so it deliberately ignores the throttle.
 */
function stopBroadcast() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  pending = null;
  lastSent = null;
  if (!broadcasting) return;
  broadcasting = false;
  signal({ t: FT.CURSOR, state: CURSOR_STATE.GONE });
}

/**
 * The name rides in every frame rather than being looked up in the roster.
 *
 * It costs ~20 bytes inside an already-encrypted envelope and it makes each
 * frame self-describing: nothing replays cursor frames, so a device that joins
 * mid-stream would otherwise draw an unlabelled pointer until the next `peers`
 * frame happened to arrive. Renaming a device also takes effect on the next
 * movement instead of the next roster change.
 */
function label() {
  try { return device.name(); }
  catch { return ""; }
}

/* ------------------------------------------------------------------ *
 * RECEIVE SIDE — the single entry point main.js calls
 * ------------------------------------------------------------------ */

export function onSignal(frame) {
  if (!frame || typeof frame !== "object") return;
  if (frame.t !== FT.CURSOR) return;
  if (!allowed()) return;                       // switched off: render nothing

  const me = state.get().originId;
  // `from` is stamped by the relay and cannot be forged; `originId` is what the
  // sender claims. Either one matching us means this is our own pointer coming
  // back, and our own pointer is the one thing we must never draw.
  if (frame.originId === me || frame.from === me) return;

  const id = frame.from || frame.originId;
  if (!id) return;

  if (frame.state === CURSOR_STATE.GONE) { removePeer(id); return; }

  // Strict, not coerced. `Number(null)` is 0 and `Number("")` is 0, so a
  // half-built frame would silently render a pointer pinned to the top-left
  // corner — which looks like a bug in this module rather than a bad frame.
  // These arrive as JSON from whoever holds the session key: a coordinate is
  // a number or the frame is not a coordinate.
  if (!isCoord(frame.x) || !isCoord(frame.y)) return;

  upsert(id, clamp01(frame.x), clamp01(frame.y), frame.name);
}

/* ------------------------------------------------------------------ *
 * RENDER
 * ------------------------------------------------------------------ */

/** id -> { el, name, x, y, seenAt }. Every entry owns exactly one element. */
const peers = new Map();

/* ------------------------------------------------------------------ *
 * Motion
 *
 * styles/cursors.css already drops the 110 ms transform transition inside a
 * `@media (prefers-reduced-motion: reduce)` block, and that remains the primary
 * mechanism. This is the JavaScript half of the same decision, and it does two
 * things the stylesheet cannot:
 *
 *   1. It skips the one-frame deferral of `.live`. That deferral exists only to
 *      stop a new cursor sliding in from the corner of the window on its first
 *      update — with no transform transition there is nothing to slide, so the
 *      cursor is simply placed, which is what the setting asks for.
 *
 *   2. It sets transition-property on the element itself. The sheet is injected
 *      as a <link> at init(), so there is a window in which it has not applied
 *      yet — and if it fails to load at all, the CSS guard never runs. Only the
 *      PROPERTY is set here: duration and easing stay in CSS, so the opacity
 *      fade that cursors.css deliberately keeps (a state change, not motion —
 *      without it a peer's departure is a jump cut) survives untouched.
 *
 * The query is live, so someone turning the OS setting on mid-session gets it
 * applied to the cursors already on screen.
 * ------------------------------------------------------------------ */

const motionQuery = typeof matchMedia === "function"
  ? matchMedia("(prefers-reduced-motion: reduce)")
  : null;

export const reducedMotion = () => motionQuery?.matches === true;

function applyMotion(el) {
  el.style.transitionProperty = reducedMotion() ? "opacity" : "";
}

function onMotionChange() {
  for (const c of peers.values()) applyMotion(c.el);
}

/**
 * The pointer glyph. Static markup with nothing interpolated into it — the one
 * peer-supplied value, the device name, goes through setName() and esc().
 * The tip sits at (1,1) in the viewBox and the element is nudged by -1px in
 * CSS, so the visible point lands exactly on the reported coordinate.
 */
const ARROW =
  '<svg class="hb-cursor-arrow" viewBox="0 0 14 22" aria-hidden="true">' +
  '<path d="M1 1L1 17L4.5 13.5L7 19L9.2 18L6.8 12.6L11.5 12.6Z"/></svg>';

/**
 * Stable colour per peer: FNV-1a over the id, into a small palette of token
 * colours. Stable matters more than unique — a cursor that changes colour when
 * a peer reconnects reads as a different person. With five colours and the
 * relay's eight-peer cap, two peers can collide; the label is the identity and
 * the colour is only a hint, so that is a cost worth paying for staying inside
 * tokens.css instead of inventing hues.
 */
function paletteIndex(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % PALETTE_SIZE;
}

/**
 * Created on first use, not at init(): a solo session should not carry an
 * empty overlay div around. aria-hidden because a screen reader announcing
 * where somebody else's mouse is would be pure noise.
 */
function layer() {
  const found = $("cursorLayer");
  if (found) return found;
  const el = document.createElement("div");
  el.id = "cursorLayer";
  el.className = "hb-cursors";
  el.setAttribute("aria-hidden", "true");
  (document.body || document.documentElement).appendChild(el);
  return el;
}

function upsert(id, x, y, name) {
  let c = peers.get(id);

  if (!c) {
    const el = document.createElement("div");
    el.className = `hb-cursor c${paletteIndex(id)}`;
    setHTML(el, `${ARROW}<span class="hb-cursor-name"></span>`);
    c = { el, name: null, x, y, seenAt: 0 };
    peers.set(id, c);
    place(c, x, y);                       // position BEFORE the transition exists
    applyMotion(el);
    layer().appendChild(el);
    // The transition and the fade-in are enabled a frame later. Enabled from
    // the start, a new cursor would slide in from the top-left corner of the
    // window on its first update instead of simply being where it is.
    // Under reduced motion there is no transform transition to defer past, so
    // the wait would only delay the cursor appearing.
    if (reducedMotion()) el.classList.add("live");
    else raf(() => el.classList.add("live"));
    ensureSweep();
  }

  setName(c, name);
  place(c, x, y);
  c.seenAt = nowMs();
  c.el.classList.remove("quiet");
}

function place(c, x, y) {
  c.x = x;
  c.y = y;
  const px = Math.round(x * (window.innerWidth || 0));
  const py = Math.round(y * (window.innerHeight || 0));
  // translate3d, not left/top: transform-only movement stays on the compositor,
  // so seven cursors gliding at once never trigger layout.
  c.el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
}

/**
 * The device name is chosen by the peer and is attacker-controlled: anyone
 * holding the session key can name their device `<img src=x onerror=…>`, and
 * this is the only peer-supplied value in the module that reaches innerHTML.
 * esc() is the invariant (docs/ARCHITECTURE.md §5); the length cap is on top
 * of it, so a 10 KB "name" cannot stripe a label across the whole viewport.
 */
function setName(c, raw) {
  const clean = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_CHARS);
  const name = clean || "Another device";
  if (name === c.name) return;
  c.name = name;
  const slot = c.el.querySelector(".hb-cursor-name");
  if (slot) setHTML(slot, esc(name));
}

function removePeer(id) {
  const c = peers.get(id);
  if (!c) return;
  peers.delete(id);
  c.el.remove();
}

function clearPeers() {
  for (const id of [...peers.keys()]) removePeer(id);
}

/* ------------------------------------------------------------------ *
 * Sweep — fade the quiet, drop the gone
 * ------------------------------------------------------------------ */

let sweepTimer = 0;

/** Runs only while there is something to watch, and stops itself when not. */
function ensureSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, sweepMs);
}

function stopSweep() {
  clearInterval(sweepTimer);
  sweepTimer = 0;
}

function sweep() {
  // state.js is not reactive, so a toggle flipped in the settings panel is
  // noticed here. Sending is already gated by canSend(); this is what tells
  // peers to stop drawing us and clears what we are drawing of them.
  if (!allowed()) {
    stopBroadcast();
    clearPeers();
    stopSweep();
    return;
  }

  const now = nowMs();
  for (const [id, c] of peers) {
    const quiet = now - c.seenAt;
    if (quiet > dropAfterMs) removePeer(id);
    else if (quiet > fadeAfterMs) c.el.classList.add("quiet");
  }

  if (!peers.size && !broadcasting) stopSweep();
}

/* ------------------------------------------------------------------ *
 * init
 * ------------------------------------------------------------------ */

let started = false;

export function init() {
  if (started) return;
  started = true;

  ensureStyles();

  focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;

  // Someone can turn "reduce motion" on while the app is open; the cursors
  // already on screen follow it rather than waiting for a reload.
  motionQuery?.addEventListener?.("change", onMotionChange);

  window.addEventListener("pointermove", onPointerMove, { passive: true });

  // Every way of ceasing to be present ends in the same place. The pointer
  // leaving the document is the common one; blur covers alt-tab, and
  // visibilitychange covers a backgrounded tab or a locked phone.
  const leave = () => { pointerInside = false; stopBroadcast(); };
  document.documentElement.addEventListener("pointerleave", leave);
  window.addEventListener("blur", () => { focused = false; leave(); });
  window.addEventListener("focus", () => { focused = true; });
  document.addEventListener("visibilitychange", () => { if (hidden()) leave(); });
  window.addEventListener("pagehide", leave);

  // Positions are normalised to the viewport, so a resize moves every peer.
  // Without this they sit at their old pixel offsets until the next frame.
  window.addEventListener("resize", () => {
    for (const c of peers.values()) place(c, c.x, c.y);
  });

  // A peer that left the room should not linger for the full fade. The roster
  // is authoritative; anyone not on it is gone.
  on(EV.PEERS_CHANGED, ({ count, list }) => {
    if (!Array.isArray(list) || !list.length) {
      if (count <= 1) clearPeers();       // alone in the room
      return;
    }
    const present = new Set(list.map(p => p?.peerId).filter(Boolean));
    for (const id of [...peers.keys()]) if (!present.has(id)) removePeer(id);
  });

  // Losing the relay means we simply stop hearing from anyone. Ghost pointers
  // frozen mid-glide would read as "they are still there", which is the one
  // thing a presence feature must not get wrong.
  on(EV.CONN_STATE, ({ state: conn }) => {
    if (conn === "offline" || conn === "reconnecting" || conn === "idle") {
      clearPeers();
      broadcasting = false;               // nothing to tell: the socket is gone
      lastSent = null;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Stylesheet
 * ------------------------------------------------------------------ */

const STYLE_HREF = styleHref("cursors.css");

/**
 * This module owns its own CSS, so styles/main.css needs no edit and a double
 * init() cannot produce a duplicate <link> (the ui/install.js and
 * ui/historyPanel.js idiom). Two checks, because either could be true first:
 * the <link> we injected, or the --cursors-css marker that cursors.css sets if
 * main.css ever @imports it directly.
 */
function ensureStyles() {
  if (document.querySelector('link[data-hb-style="cursors"]')) return;
  try {
    const marker = getComputedStyle(document.documentElement)
      .getPropertyValue("--cursors-css").trim();
    if (marker === "1") return;
  } catch { /* no computed style here — inject and move on */ }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  link.dataset.hbStyle = "cursors";
  document.head.appendChild(link);
}
