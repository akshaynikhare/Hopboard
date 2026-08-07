/**
 * The app, greyed out and unusable, while a locked link has no PIN.
 *
 * Cancelling the prompt used to leave a working-looking app in front of somebody
 * in no session at all: the editor accepted text, history marked it SENT, the
 * files pane offered to send — none of it going anywhere. That is the failure
 * this app is least willing to have, so the shell goes inert behind a scrim and
 * the only two things on screen are the two ways out.
 *
 * It does NOT cover a WRONG PIN, which is not detectable: a wrong PIN lands you
 * in a different, empty room, exactly what being first to arrive looks like, and
 * gating on "alone in a locked room" would grey out every session the moment its
 * creator opened it. That case stays a banner — see ui/shell/banners.js.
 *
 * Both buttons are bus events; this module knows nothing about keys or rooms.
 */

import { on, emit, EV } from "../../core/bus.js";
import { esc, setHTML, lazyStyle } from "../primitives/dom.js";
import { shellInert } from "../primitives/modal.js";

let gate = null;
let release = null;

export function init() {
  on(EV.LOCK_REQUIRED, ({ required }) => (required ? raise() : drop()));
}

function raise() {
  if (gate) return;
  lazyStyle("lock.css");

  gate = document.createElement("div");
  gate.className = "lockgate";
  // Not a dialog: a dialog implies something behind it to go back to, and there
  // is nothing behind this. `alert` because it arrives without being asked for
  // and everything it interrupts has already stopped working.
  gate.setAttribute("role", "alert");
  setHTML(gate, `
    <div class="lockgate-card">
      <svg class="lockgate-ico" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="10" width="16" height="10" rx="2"/>
        <path d="M8 10V7a4 4 0 018 0v3"/>
      </svg>
      <h2>${esc("This session is locked")}</h2>
      <p>${esc("It needs its PIN before this device can join. The PIN is not in the "
        + "link — whoever sent it to you has to pass it on separately.")}</p>
      <div class="lockgate-row">
        <button class="btn" type="button" data-pin>Enter PIN</button>
        <button class="btn ghost" type="button" data-new>Start a new session</button>
      </div>
      <p class="lockgate-note">${esc("A new session is a different room with a new key, "
        + "open to anyone you give the link to. It does not get you into this one.")}</p>
    </div>`);

  gate.querySelector("[data-pin]").addEventListener("click", () => emit("session:relock"));
  gate.querySelector("[data-new]").addEventListener("click", () => emit("session:rotate"));

  document.body.appendChild(gate);
  release = shellInert();

  // The action, not the card. Whoever is looking at this either has the PIN and
  // wants the field, or does not and wants the other button — and both are one
  // key away from here.
  gate.querySelector("[data-pin]").focus();
}

function drop() {
  release?.();
  release = null;
  gate?.remove();
  gate = null;
}
