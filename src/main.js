/**
 * Composition root. The only file that knows the whole module graph.
 *
 * Everything else talks through core/bus.js. If you find yourself importing a
 * transport module from a UI module, wire it here instead — that boundary is
 * what keeps the pieces independently testable and replaceable.
 */

import { TEXT } from "./core/config.js";
import { emit, on, EV } from "./core/bus.js";
import * as state from "./core/state.js";
import * as keys from "./core/keys.js";
import * as storage from "./core/storage.js";

import * as capture from "./clipboard/capture.js";

import * as toast from "./ui/toast.js";
import * as editor from "./ui/editor.js";
import * as filesPanel from "./ui/filesPanel.js";
import * as sessionPanel from "./ui/sessionPanel.js";
import * as statusbar from "./ui/statusbar.js";
import * as activitybar from "./ui/activitybar.js";

/* ---------------- session key ---------------- */
function resolveKey() {
  // A key from the URL or storage means we are JOINING. A key we generate
  // ourselves means CREATING, which must be collision-checked (OI-2).
  const fromUrl = keys.fromUrl();
  if (keys.isValid(fromUrl)) return { key: fromUrl, intent: "join" };

  const remembered = storage.loadLastKey();
  if (remembered && keys.isValid(remembered)) return { key: remembered, intent: "join" };

  return { key: keys.generate(), intent: "create" };
}

/* ---------------- wiring ---------------- */
function wire() {
  // Local capture -> the wire. M1 replaces the toast with an encrypted send.
  on(EV.TEXT_CAPTURED, ({ text, how }) => {
    editor.setText(text);
    emit(EV.TOAST, `${how} · M1 puts this on the wire`);
  });

  // Remote clip -> OS clipboard. capture.apply owns the suppression ordering
  // that stops the value bouncing straight back to the sender.
  on(EV.TEXT_RECEIVED, async ({ text }) => {
    await capture.apply(text);
  });

  // A generated key turned out to be in use: regenerate rather than drop the
  // user into a stranger's clipboard.
  on(EV.KEY_COLLISION, () => {
    const key = keys.generate();
    keys.toUrl(key);
    storage.saveLastKey(key);
    state.setKey({ key });
    emit(EV.TOAST, "That key was taken — generated a new one");
  });
}

/* ---------------- boot ---------------- */
function boot() {
  const { key, intent } = resolveKey();
  keys.toUrl(key);
  storage.saveLastKey(key);

  toast.init();
  statusbar.init();
  activitybar.init();
  editor.init();
  filesPanel.init();
  sessionPanel.init();

  wire();

  state.setKey({ key });
  state.setConnection("idle");
  capture.start();

  // M1: derive the AES key, hash the room, and connect.
  //   const aesKey   = await crypto.deriveKey(key);
  //   const roomHash = await crypto.roomHash(key);
  //   relay.setFrameHandler(onFrame);
  //   relay.connect({ roomHash, intent });
  emit(EV.TOAST, `Session ${key} · preview, no transport yet`);

  console.info(
    `[hopboard] booted · key=${key} intent=${intent} origin=${state.get().originId}\n` +
    `Text cap ${TEXT.MAX_CHARS}. Network stubbed — see docs/ARCHITECTURE.md.`
  );
}

document.addEventListener("DOMContentLoaded", boot);
