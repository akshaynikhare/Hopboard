/**
 * The PIN prompt for locked sessions.
 *
 * One export, `ask()`, which resolves to the PIN the user typed or to null if
 * they backed out. Everything the caller does with that answer — deriving,
 * connecting, giving up — happens in main.js; this module knows nothing about
 * rooms, keys or the relay, and imports nothing that does.
 *
 * WHY THIS IS A MODAL, when the file-request prompt next door deliberately is
 * not (ui/filesPanel.js). That one is docked because an unanswered request from
 * another device must never stop this one being used. This one is different in
 * kind: nothing is connected yet and there is nothing behind it to use. Until it
 * is answered the app has no session at all, so a focus trap is describing the
 * truth rather than imposing it.
 *
 * The pattern — inert shell, tab ring, Escape, focus restore — is ui/qr.js's,
 * duplicated rather than shared. A third one of these should become
 * ui/modal.js; two is not yet enough to know what the shared shape is, and the
 * duplication is visible from here.
 *
 * THE PIN NEVER TOUCHES MARKUP. It is read from `input.value` at submit and the
 * field is cleared on close. It is never interpolated into innerHTML, never put
 * in an attribute, never emitted on the bus, and never logged — a dialog that
 * leaked the secret it collects would be a strange thing to have built.
 */

import { LOCK } from "../core/config.js";
import { pinEntropyBits } from "../core/keys.js";
import { esc } from "./dom.js";

const SHELL = ".vs";

/* Loaded on first use rather than from main.css: the dialog is rare and its
   stylesheet is dead weight on every session that never locks. Same mechanism
   as ui/qr.js — resolved against this module so it survives being served from
   a subpath. */
const STYLE_HREF = new URL("../styles/lock.css", import.meta.url).href;

function ensureStyles() {
  if (document.querySelector('link[data-hb-style="lock"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  link.dataset.hbStyle = "lock";
  document.head.appendChild(link);
}

const COPY = {
  create: {
    title: "Lock this session",
    intro: "Pick a PIN. It is never in the link and never leaves this device — "
         + "you have to pass it to your other devices yourself.",
    submit: "Lock session",
    confirm: true,
  },
  join: {
    title: "This session is locked",
    intro: "Enter the PIN for this session. The link alone will not open it.",
    submit: "Unlock",
    confirm: false,
  },
  retry: {
    title: "Enter the PIN again",
    intro: "Nobody else is in this session yet. If someone should be, the PIN "
         + "may not match theirs — a different PIN is a different session.",
    submit: "Unlock",
    confirm: false,
  },
};

let open = null;

/**
 * Ask for a PIN. Resolves to the string, or to null on cancel/Escape.
 *
 * `mode` is create | join | retry. `key` is shown so someone answering a prompt
 * on a second device can see which session it is for — it is already in their
 * address bar, so this discloses nothing they do not have.
 */
export function ask({ mode = "join", key = "" } = {}) {
  const copy = COPY[mode] ?? COPY.join;
  ensureStyles();
  close();                    // never stack two; the old promise resolves null

  return new Promise(resolve => {
    const el = document.createElement("div");
    el.className = "lockmodal";
    el.innerHTML = `
      <div class="lockback" data-cancel></div>
      <div class="lockdlg" role="dialog" aria-modal="true" tabindex="-1"
           aria-labelledby="lockTitle" aria-describedby="lockIntro">
        <h2 id="lockTitle">${esc(copy.title)}</h2>
        <p id="lockIntro">${esc(copy.intro)}</p>
        ${key ? `<p class="lockkey">Session <b>${esc(key)}</b></p>` : ""}

        <label class="locklbl" for="lockPin">PIN</label>
        <input id="lockPin" class="lockinput" type="password" name="hopboard-pin"
               autocomplete="off" autocapitalize="none" autocorrect="off"
               spellcheck="false" enterkeyhint="go"
               aria-describedby="lockStrength">
        ${copy.confirm ? `
        <label class="locklbl" for="lockPin2">Repeat it</label>
        <input id="lockPin2" class="lockinput" type="password" name="hopboard-pin2"
               autocomplete="off" autocapitalize="none" autocorrect="off"
               spellcheck="false" enterkeyhint="go">` : ""}

        <div class="lockstrength" id="lockStrength" aria-live="polite"></div>
        <div class="lockerr" role="alert"></div>

        <div class="lockrow">
          <button class="btn ghost" type="button" data-cancel>Cancel</button>
          <button class="btn" type="button" data-ok>${esc(copy.submit)}</button>
        </div>

        <p class="locknote">Anyone with the link and the PIN can read this
        session. The PIN is not stored on this device beyond this browser tab.</p>
      </div>`;

    document.body.appendChild(el);

    const dlg      = el.querySelector(".lockdlg");
    const pin      = el.querySelector("#lockPin");
    const pin2     = el.querySelector("#lockPin2");
    const strength = el.querySelector(".lockstrength");
    const error    = el.querySelector(".lockerr");

    const say = msg => { error.textContent = msg; };

    /**
     * The number, not an adjective.
     *
     * Mirrors how the key's own strength is stated in ui/sessionPanel.js. It
     * matters more here: against someone who already has the link, the key
     * contributes nothing and this is the whole secret, so "6 characters · ~20
     * bits" is the honest thing to show while a four-digit habit is being typed.
     */
    const rate = () => {
      const v = pin.value;
      if (!v) { strength.textContent = ""; return; }
      const bits = Math.round(pinEntropyBits(v));
      const weak = bits < 40;
      strength.classList.toggle("weak", weak);
      strength.textContent = `${v.length} character${v.length === 1 ? "" : "s"} · ~${bits} bits`
        + (weak ? " · short enough to guess offline if your link gets out" : "");
    };

    const submit = () => {
      const value = pin.value;
      if (value.trim().length < LOCK.MIN_PIN) {
        return say(`At least ${LOCK.MIN_PIN} characters.`);
      }
      if (copy.confirm && value !== pin2.value) {
        return say("The two PINs do not match.");
      }
      close(value);
    };

    const finish = answer => close(answer);

    el.addEventListener("input", rate);
    el.addEventListener("click", e => {
      if (e.target.closest("[data-ok]")) return submit();
      if (e.target.closest("[data-cancel]")) return finish(null);
    });
    // Enter submits from either field: this is a form in everything but the
    // element, and a <form> here would try to navigate.
    el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });

    const onKey = e => {
      if (e.key === "Escape") { e.preventDefault(); finish(null); return; }
      if (e.key === "Tab") trapTab(e, el);
    };
    document.addEventListener("keydown", onKey, true);

    open = {
      el, onKey, resolve,
      restoreFocus: document.activeElement,
      inerted: setShellInert(true),
    };
    (pin ?? dlg)?.focus?.();
  });
}

/**
 * Tear down and settle the promise. Always settles — a caller awaiting a PIN
 * that got replaced by a second prompt would otherwise wait forever.
 *
 * The inputs are blanked before the node is dropped. Removing an element does
 * not scrub the string it held, but it costs nothing to avoid leaving the PIN
 * in a detached DOM node waiting on the garbage collector.
 */
function close(answer = null) {
  if (!open) return;
  const { el, onKey, restoreFocus, inerted, resolve } = open;
  open = null;
  el.querySelectorAll("input").forEach(i => { i.value = ""; });
  document.removeEventListener("keydown", onKey, true);
  if (inerted) setShellInert(false);
  el.remove();
  if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus?.();
  resolve(answer);
}

/** Is a prompt on screen? main.js uses this to avoid stacking two. */
export const isOpen = () => open !== null;

/* ---- focus plumbing, mirroring ui/qr.js ---- */

function setShellInert(on) {
  const shell = document.querySelector(SHELL);
  if (!shell) return false;
  const supported = "inert" in shell;
  if (on) {
    shell.inert = true;
    if (!supported) shell.setAttribute("aria-hidden", "true");
  } else {
    shell.inert = false;
    shell.removeAttribute("aria-hidden");
  }
  return true;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function trapTab(e, el) {
  const items = [...el.querySelectorAll(FOCUSABLE)]
    .filter(n => !n.hasAttribute("disabled") && !n.hidden && n.tabIndex !== -1);
  if (!items.length) { e.preventDefault(); return; }

  const first = items[0];
  const last = items[items.length - 1];
  const at = items.indexOf(document.activeElement);
  if (at === -1) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
