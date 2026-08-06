/**
 * Composition root. The only file that knows the whole module graph.
 *
 * Everything else talks through core/bus.js. If a UI module needs the network,
 * it emits an event and the wiring happens here — that boundary is what let the
 * transport stay swappable while the rest of the app was being built.
 */

import { TEXT, SYNC_MODES } from "./core/config.js";
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
import * as panes from "./ui/panes.js";
import * as editor from "./ui/editor.js";
import * as filesPanel from "./ui/filesPanel.js";
import * as sessionPanel from "./ui/sessionPanel.js";
import * as statusbar from "./ui/statusbar.js";
import * as resizer from "./ui/resizer.js";
import * as syncMode from "./ui/syncMode.js";
import * as appLinks from "./ui/appLinks.js";
import * as hints from "./ui/hints.js";
import * as cursors from "./ui/cursors.js";
import * as ads from "./ui/ads.js";
import * as mobileNav from "./ui/mobileNav.js";

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

    default:
      // Live pointers. x/y/name are sealed by encryptFrame(), so the relay
      // only ever sees `t` and `originId` — it never learns where a mouse is.
      if (cursors.FRAMES.includes(msg.t)) return cursors.onSignal(await decryptFrame(msg));

      // Signalling and file frames go to the files layer, which is kept
      // ignorant of the transport (docs/ARCHITECTURE.md §3).
      //
      // Driven off transfer.FRAMES rather than a hand-written case list: an
      // earlier version enumerated six of the eleven types and silently
      // dropped file-accept, which carries the chunk plan — every transfer
      // would have stalled with no error anywhere.
      if (filesFrames.has(msg.t)) routeToFiles(await decryptFrame(msg));
  }
}

let filesSignalHandler = null;
let filesFrames = new Set();

function routeToFiles(msg) {
  if (msg && filesSignalHandler) filesSignalHandler(msg);
}

/* ------------------------------------------------------------------
   signalling encryption

   The relay is supposed to be a blind pipe (docs/P2P-FILES.md §4). Sending
   signalling in the clear would have handed it every SDP, every ICE candidate
   — including the peers' IP addresses — and, on the relay-fallback path, every
   byte of every file. That is precisely the property the design claims to have
   and would not have had.

   Routing fields stay in the clear because the relay must read them to deliver
   the frame; everything else is sealed with the same session key as clips.
------------------------------------------------------------------- */
const ROUTING_FIELDS = new Set(["t", "to", "from", "originId", "id", "seq", "total", "crc"]);

async function encryptFrame(frame) {
  const { aesKey } = state.get();
  if (!aesKey) return frame;

  const routing = {}, secret = {};
  for (const [k, v] of Object.entries(frame)) {
    (ROUTING_FIELDS.has(k) ? routing : secret)[k] = v;
  }
  if (!Object.keys(secret).length) return frame;

  const { payload, iv } = await cryptoBox.encrypt(aesKey, JSON.stringify(secret));
  return { ...routing, payload, iv };
}

async function decryptFrame(frame) {
  const { aesKey } = state.get();
  if (!aesKey || !frame.payload || !frame.iv) return frame;
  try {
    const secret = JSON.parse(await cryptoBox.decrypt(aesKey, frame.payload, frame.iv));
    const { payload, iv, ...routing } = frame;
    return { ...routing, ...secret };
  } catch {
    // A peer in this room shares the key by construction, so this should be
    // unreachable — drop rather than hand the files layer a half-frame.
    console.warn("[hopboard] undecryptable signalling frame", frame.t);
    return null;
  }
}

/* ------------------------------------------------------------------
   outbound
------------------------------------------------------------------- */
async function sendText(text) {
  const { aesKey, originId } = state.get();
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

  cursors.setSignalSender(frame => {
    if (!relay.isOpen()) return false;
    encryptFrame(frame)
      .then(sealed => relay.send(sealed))
      .catch(err => console.error("[hopboard] could not send cursor frame", err));
    return true;
  });

  // Local capture -> encrypt -> wire.
  on(EV.TEXT_CAPTURED, ({ text }) => {
    editor.setText(text);
    sendText(text);
  });

  // Remote clip -> OS clipboard, and the editor only if it is safe to.
  //
  // The clipboard write always happens: that is the product, it is what the
  // user asked for by enabling the session, and it costs them nothing.
  //
  // The EDITOR is different. Overwriting it discards whatever the user was
  // typing, with no undo. So when there is unsent work in there, the clip is
  // offered rather than applied — the text is already on their clipboard, and
  // one click puts it in the editor if they want it.
  on(EV.TEXT_RECEIVED, async ({ text }) => {
    await capture.apply(text);

    if (!editor.isDirty()) {
      editor.setText(text);
      // The core event of the product announced nothing at all: a screen-reader
      // user had no way to know a clip had arrived. Routed through the toast
      // queue, which collapses duplicates and paces bursts, so Live mode does
      // not turn this into a firehose.
      emit(EV.TOAST, `Clip received · ${text.length.toLocaleString()} characters`);
      return;
    }
    emit(EV.CLIP_OFFERED, { text });
  });

  on("clip:accept", ({ text }) => editor.setText(text));

  // A generated key turned out to be in use. Regenerate rather than silently
  // join a stranger's session (OI-2).
  on(EV.KEY_COLLISION, async () => {
    relay.close();
    const key = keys.generate();
    emit(EV.TOAST, "That key was taken — generated a new one");
    await openSession(key, "create");
  });

  // A copied or pasted image becomes a normal file: its thumbnail is shared
  // immediately so peers see the preview, and the full image only moves when
  // someone asks for it (docs/P2P-FILES.md). clipboard/ announces, files/
  // stores, and neither knows about the other.
  on(EV.IMAGE_CAPTURED, async ({ blob, name, how }) => {
    try {
      const registry = await import("./files/registry.js");
      const file = new File([blob], name, { type: blob.type });
      const { added, rejected } = await registry.add([file], {
        makeThumbs: state.get().settings.thumbs,
      });
      if (added) emit(EV.TOAST, `${how} · ${name}`);
      rejected.forEach(r => emit(EV.TOAST, `${r.name}: ${r.reason}`));
    } catch (err) {
      console.warn("[hopboard] could not add clipboard image", err);
      emit(EV.TOAST, "Could not read that image");
    }
  });

  // Restoring an old clip from history should behave exactly like a local
  // capture: it goes to the editor and out to peers.
  //
  // It also drops the session into Manual. Reaching back for an old clip is a
  // deliberate, one-off act, and in Live mode it does not survive: the T3 poll
  // tick reads the OS clipboard a second later, sees whatever is actually
  // there — not the clip just restored — and broadcasts that instead, so the
  // click appears to do nothing. Manual stops the poller, which is exactly the
  // state someone picking a specific clip out of a list is asking for. The
  // toast says so, because a mode change nobody asked for out loud is a bug
  // report waiting to happen; the header and status bar then show it.
  on("history:restore", ({ text }) => {
    const switched = syncMode.set(SYNC_MODES.MANUAL);
    editor.setText(text);
    capture.capture(text, "Restored from history");
    emit(EV.TOAST, switched
      ? "Loaded into the editor — switched to Manual"
      : "Loaded into the editor");
  });

  on("session:rejoin", async ({ key }) => {
    relay.close();
    state.resetRoster();
    await openSession(keys.normalise(key), "join");
  });

  // "Someone joined and it wasn't me" — get out of the room and take a new key.
  on("session:rotate", async () => {
    relay.close();
    state.resetRoster();
    const key = keys.generate(
      state.get().settings.longKeys ? keys.LENGTHS.LONG : keys.LENGTHS.NORMAL);
    emit(EV.TOAST, "New key — the old session is abandoned");
    await openSession(key, "create");
  });

  // A relay restart drops every socket (OI-13) and its rooms with them. On
  // reconnect the roster is rebuilt from scratch, so the peers we already knew
  // about would each be reported as a fresh arrival and fire the "a device
  // joined" warning — crying wolf on a deploy.
  on(EV.CONN_STATE, ({ state: connState }) => {
    if (connState === "reconnecting" || connState === "offline") state.resetRoster();
  });

  // The status bar offers a transport; only this file is allowed to hand it to
  // the transport layer (docs/ARCHITECTURE.md §3).
  on(EV.TRANSPORT_SELECT, ({ mode }) => relay.setTransport(mode));

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
    const registry = await import("./files/registry.js");
    filesFrames = new Set(transfer.FRAMES ?? []);
    filesSignalHandler = transfer.onSignal ?? null;

    // registry needs the wire too, to retract a file it has removed. It sits
    // under transfer.js and may not import it, so it takes the same injected
    // sender. (Arguably the retraction belongs in transfer.js next to
    // announce() — noted in ARCHITECTURE.md; the seam works and is tested.)
    registry.setSignalSender?.(frame => {
      if (!relay.isOpen()) return false;
      encryptFrame(frame)
        .then(sealed => relay.send(sealed))
        .catch(err => console.error("[hopboard] could not retract a file", err));
      return true;
    });

    // Announcing local files and re-announcing to new peers is transfer.js's
    // own business — it subscribes to the bus directly. Doing it from here is
    // how the outbound half went missing in the first place.

    // The contract is synchronous — `false` means "not sent". Encryption is
    // async, so the check that actually matters (are we connected at all?) is
    // done up front; a failure after that point is reported by the relay's own
    // error frame rather than this return value.
    transfer.setSignalSender(frame => {
      if (!relay.isOpen()) return false;
      encryptFrame(frame)
        .then(sealed => relay.send(sealed))
        .catch(err => console.error("[hopboard] could not send signalling frame", err));
      return true;
    });
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
  // install.js is initialised directly in boot(); listing it here too would
  // register the service worker twice.
  const features = [
    ["./ui/historyPanel.js", "history"],
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
/**
 * Run a module's init() without letting it take the app down with it.
 *
 * This is not defensive padding. An unguarded `install.init()` threw here and
 * the exception escaped boot() itself, so openSession() never ran and the app
 * silently never connected — a broken service-worker helper presenting as
 * "the clipboard doesn't sync". Syncing is the product; nothing decorative
 * around it gets to prevent it.
 */
function safeInit(label, fn) {
  try { fn(); }
  catch (err) { console.warn(`[hopboard] "${label}" failed to init:`, err.message); }
}

async function boot() {
  // Core UI first: these own the surfaces that report connection state, so a
  // failure here is worth knowing about loudly rather than swallowing.
  toast.init();
  banners.init();
  statusbar.init();
  editor.init();

  wire();
  await wireFiles().catch(err =>
    console.warn("[hopboard] files layer unavailable:", err.message));

  // ---- connect NOW ----------------------------------------------------
  // Deliberately not awaited: the session is the product, and it must not
  // queue behind panel rendering, a service-worker registration, or a QR
  // encoder. Errors are reported through the status bar.
  const { key, intent } = resolveKey();
  openSession(key, intent).catch(err => {
    console.error("[hopboard] session failed to open", err);
    state.setConnection("offline", "could not start session");
    emit(EV.TOAST, "Could not start the session — check the console");
  });

  // ---- everything below is decoration ---------------------------------
  safeInit("clipboard capture", () => capture.start());
  safeInit("files panel", filesPanel.init);
  safeInit("session panel", sessionPanel.init);
  safeInit("resizers", resizer.init);
  safeInit("sync mode", syncMode.init);
  safeInit("project links", appLinks.init);
  safeInit("hints", hints.init);
  safeInit("ad slot", ads.init);
  safeInit("peer cursors", cursors.init);
  safeInit("install prompt", install.init);

  await loadOptional();
  safeInit("panes", panes.init);

  // After loadOptional(), because the phone tab bar offers a Clips tab only if
  // the history pane actually mounted.
  safeInit("mobile nav", mobileNav.init);

  console.info(
    `[hopboard] booted · key=${key} intent=${intent} device=${device.name()}`
  );
}

document.addEventListener("DOMContentLoaded", boot);
