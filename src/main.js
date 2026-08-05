/**
 * Composition root. The only file that knows the whole module graph.
 *
 * Everything else talks through core/bus.js. If a UI module needs the network,
 * it emits an event and the wiring happens here — that boundary is what let the
 * transport stay swappable while the rest of the app was being built.
 */

import { TEXT } from "./core/config.js";
import { emit, on, EV } from "./core/bus.js";
import * as state from "./core/state.js";
import * as keys from "./core/keys.js";
import * as storage from "./core/storage.js";
import * as cryptoBox from "./core/crypto.js";
import * as device from "./core/device.js";

import * as relay from "./transport/relay.js";
import * as proto from "./transport/protocol.js";

import * as capture from "./clipboard/capture.js";

// Imported for its side effect as well as init(): install.js restores the room
// key into the fragment at module-evaluation time, which must happen before
// resolveKey() runs — an installed PWA opens with no fragment, because a
// manifest start_url cannot carry one (OI-10).
import * as install from "./ui/install.js";

import * as toast from "./ui/toast.js";
import * as banners from "./ui/banners.js";
import * as editor from "./ui/editor.js";
import * as filesPanel from "./ui/filesPanel.js";
import * as sessionPanel from "./ui/sessionPanel.js";
import * as statusbar from "./ui/statusbar.js";
import * as activitybar from "./ui/activitybar.js";

/* ------------------------------------------------------------------
   session key
------------------------------------------------------------------- */
function resolveKey() {
  // A key from the URL or storage means we are JOINING. A key we generate
  // ourselves means CREATING, which must be collision-checked (OI-2) or we
  // could drop the user straight into a stranger's clipboard.
  const fromUrl = keys.fromUrl();
  if (keys.isValid(fromUrl)) return { key: fromUrl, intent: "join" };

  const remembered = storage.loadLastKey();
  if (remembered && keys.isValid(remembered)) return { key: remembered, intent: "join" };

  return { key: keys.generate(), intent: "create" };
}

async function openSession(key, intent) {
  keys.toUrl(key);
  storage.saveLastKey(key);

  state.setConnection("connecting", "deriving key");

  // PBKDF2 at 250k iterations is hundreds of ms on a low-end phone (OI-8), so
  // this is awaited once per session and the result cached — never per message.
  const [aesKey, roomHash] = await Promise.all([
    cryptoBox.deriveKey(key),
    cryptoBox.roomHash(key),
  ]);

  state.setKey({ key, roomHash, aesKey });
  relay.connect({ roomHash, intent, name: device.name() });
}

/* ------------------------------------------------------------------
   inbound frames
------------------------------------------------------------------- */
async function onFrame(msg) {
  const { aesKey, originId } = state.get();

  switch (msg.t) {
    case proto.T.CLIP: {
      if (msg.originId === originId) return;          // our own echo, ignore
      if (!aesKey) return;
      try {
        const text = await cryptoBox.decrypt(aesKey, msg.payload, msg.iv);
        emit(EV.TEXT_RECEIVED, { text, from: msg.originId });
      } catch {
        // Almost always a key mismatch, which shouldn't be reachable: the room
        // name is a hash of the key, so peers in a room share it by construction.
        emit(EV.TOAST, "Could not decrypt a clip — key mismatch");
      }
      break;
    }

    // Signalling and file frames are handed to the files layer, which is kept
    // ignorant of the transport (see docs/ARCHITECTURE.md).
    case proto.T.RTC_OFFER:
    case proto.T.RTC_ANSWER:
    case proto.T.RTC_ICE:
    case proto.T.FILE_META:
    case proto.T.FILE_REQ:
    case "file-chunk":
      routeToFiles(msg);
      break;
  }
}

let filesSignalHandler = null;
function routeToFiles(msg) {
  if (filesSignalHandler) filesSignalHandler(msg);
}

/* ------------------------------------------------------------------
   outbound
------------------------------------------------------------------- */
async function sendText(text) {
  const { aesKey, originId, settings } = state.get();
  if (settings.direction === "Receive only") return;
  if (!aesKey || !relay.isOpen()) return;
  if (text.length > TEXT.MAX_CHARS) return;

  const { payload, iv } = await cryptoBox.encrypt(aesKey, text);
  relay.send(proto.clip({ payload, iv, originId }));
}

/* ------------------------------------------------------------------
   wiring
------------------------------------------------------------------- */
function wire() {
  relay.setFrameHandler(onFrame);

  // Local capture -> encrypt -> wire.
  on(EV.TEXT_CAPTURED, ({ text }) => {
    editor.setText(text);
    sendText(text);
  });

  // Remote clip -> editor, then the OS clipboard. capture.apply owns the
  // suppression ordering that stops the value bouncing back to the sender.
  on(EV.TEXT_RECEIVED, async ({ text }) => {
    editor.setText(text);
    await capture.apply(text);
  });

  // A generated key turned out to be in use. Regenerate rather than silently
  // join a stranger's session (OI-2).
  on(EV.KEY_COLLISION, async () => {
    relay.close();
    const key = keys.generate();
    emit(EV.TOAST, "That key was taken — generated a new one");
    await openSession(key, "create");
  });

  // Restoring an old clip from history should behave exactly like a local
  // capture: it goes to the editor and out to peers.
  on("history:restore", ({ text }) => {
    editor.setText(text);
    capture.capture(text, "Restored from history");
  });

  on("session:rejoin", async ({ key }) => {
    relay.close();
    await openSession(keys.normalise(key), "join");
  });

  on("session:leave", () => {
    relay.close();
    state.setConnection("idle");
    emit(EV.TOAST, "Left the session");
  });
}

/* ------------------------------------------------------------------
   files layer hookup (populated once the P2P module is present)
------------------------------------------------------------------- */
async function wireFiles() {
  try {
    const transfer = await import("./files/transfer.js");
    if (typeof transfer.setSignalSender === "function") {
      transfer.setSignalSender(frame => relay.send(frame));
      filesSignalHandler = transfer.onSignal ?? null;
    }
  } catch (err) {
    console.warn("[hopboard] files transfer layer unavailable", err);
  }
}

/* ------------------------------------------------------------------
   optional feature modules
   Loaded dynamically so a missing or failing feature degrades to "that panel
   is absent" rather than a blank page — a static import that throws takes the
   whole module graph down with it.
------------------------------------------------------------------- */
async function loadOptional() {
  const features = [
    ["./ui/historyPanel.js", "history"],
    ["./ui/install.js",      "install"],
    ["./ui/qr.js",           "qr"],
  ];
  for (const [path, label] of features) {
    try {
      const mod = await import(path);
      await mod.init?.();
    } catch (err) {
      console.warn(`[hopboard] optional feature "${label}" not loaded:`, err.message);
    }
  }
}

/* ------------------------------------------------------------------
   boot
------------------------------------------------------------------- */
async function boot() {
  toast.init();
  install.init();          // after toast, so the update prompt has a subscriber
  banners.init();
  statusbar.init();
  activitybar.init();
  editor.init();
  filesPanel.init();
  sessionPanel.init();

  wire();
  await wireFiles();
  await loadOptional();

  capture.start();

  const { key, intent } = resolveKey();
  try {
    await openSession(key, intent);
  } catch (err) {
    console.error("[hopboard] session failed to open", err);
    state.setConnection("offline", "could not start session");
    emit(EV.TOAST, "Could not start the session — check the console");
  }

  console.info(
    `[hopboard] booted · key=${key} intent=${intent} device=${device.name()}`
  );
}

document.addEventListener("DOMContentLoaded", boot);
