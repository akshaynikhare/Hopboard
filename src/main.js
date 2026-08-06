/**
 * Composition root. The only file that knows the whole module graph.
 *
 * Everything else talks through core/bus.js. If a UI module needs the network,
 * it emits an event and the wiring happens here — that boundary is what let the
 * transport stay swappable while the rest of the app was being built.
 */

import {
  TEXT, SYNC_MODES, LOCK, textBytes, RELAY_URL, RELAY_IS_CUSTOM,
} from "./core/config.js";
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
import * as lockDialog from "./ui/lockDialog.js";
import * as whatsNew from "./ui/whatsNew.js";
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
  const url = keys.fromUrl();
  if (keys.isValid(url.key)) return { ...url, intent: "join" };

  const remembered = storage.loadLastKey();
  if (remembered && keys.isValid(remembered.key)) return { ...remembered, intent: "join" };

  return { key: keys.generate(), locked: false, intent: "create" };
}

/**
 * The current session's stretched PIN, so a rotate or a collision can re-derive
 * without asking the user to prove themselves again for something they did not
 * do. Module scope rather than state.js on purpose: `state.get()` hands out the
 * whole mutable object and anything could log it wholesale, and this is the one
 * value in the app that must never appear in a console.
 *
 * It is the PBKDF2 output, not the PIN. The string the user typed exists only
 * as an argument to openSession() and is not retained anywhere.
 */
let lockPrk = null;

/**
 * Open a session, locked or not.
 *
 * `pin` is the string the user typed and is used exactly once, here, to derive.
 * It is never stored, never emitted on the bus, and never reaches another
 * module — what travels onwards is the derived material. If a caller has been
 * through this before in the same tab it can pass `prk` instead and skip the
 * 600k iterations entirely.
 */
async function openSession(key, intent, { locked = false, pin = null, prk = null } = {}) {
  keys.toUrl(key, locked);
  storage.saveLastKey(key, locked);

  // Two different waits, so say which one this is. Locked sessions are four
  // times the PBKDF2 work of an open one (OI-8) and the user is looking at a
  // dialog they just dismissed, wondering whether it took.
  state.setConnection("connecting", locked ? "unlocking" : "deriving key");

  if (locked) {
    const derived = prk
      ? await cryptoBox.deriveLockedFromPrk(prk)
      : await cryptoBox.deriveLocked(key, pin);

    // Remembered against the room it unlocks, so a rotate invalidates it and a
    // refresh does not re-prompt. sessionStorage — it dies with the tab.
    lockPrk = derived.prk;
    storage.saveLock(key, derived.prk);

    state.setKey({
      key,
      roomHash: derived.roomHash,
      aesKey: derived.aesKey,
      locked: true,
      authToken: derived.authToken,
    });
    announce(derived.roomHash, true);
    relay.connect({
      roomHash: derived.roomHash, intent, name: device.name(), auth: derived.authToken,
    });
    return;
  }

  // PBKDF2 at 250k iterations is hundreds of ms on a low-end phone (OI-8), so
  // this is awaited once per session and the result cached — never per message.
  const [aesKey, roomHash] = await Promise.all([
    cryptoBox.deriveKey(key),
    cryptoBox.roomHash(key),
  ]);

  lockPrk = null;
  storage.clearLock();
  state.setKey({ key, roomHash, aesKey });
  announce(roomHash, false);
  relay.connect({ roomHash, intent, name: device.name() });
}

/**
 * The one line about the session that reaches the console.
 *
 * The room hash, never the key. The relay is told the hash anyway, so printing
 * it discloses nothing new — whereas the key is the credential that opens the
 * session, and it used to be logged on every boot, into every screen recording
 * and every support-ticket screenshot the app has ever appeared in. The PIN,
 * needless to say, appears nowhere at all.
 */
function announce(roomHash, locked) {
  console.info(`[hopboard] session · room=${roomHash} locked=${locked}`);
}

/**
 * Boot into a session, asking for the PIN first if the link says it is locked.
 *
 * The order matters and is the whole point: nothing connects until the PIN is
 * in hand. A locked link whose prompt is cancelled leaves the app idle with a
 * way back in — it must NOT quietly fall through to the unlocked room of the
 * same name, which is a real room, joinable by anyone holding the link, and
 * would hand the user a session that looks private and is not.
 *
 * A refresh skips the prompt: this tab's stretched PIN is in sessionStorage,
 * filed under the share key, so a reload is silent while a new tab is not.
 */
async function startSession(key, intent, locked) {
  if (!locked) return openSession(key, intent);

  const known = storage.loadLock(key);
  if (known) return openSession(key, intent, { locked: true, prk: known });

  const pin = await lockDialog.ask({ mode: intent === "create" ? "create" : "join", key });
  if (!pin) {
    // Backing out is allowed, but it must not be a dead end. Nothing is
    // connected and state.key was never set, so the key is parked here for the
    // "Enter PIN" action to pick up — see retryLock().
    pendingLock = { key, intent };
    // No LOCK_STATE here on purpose: `state.locked` is still false because no
    // session was ever opened, and announcing a lock state the state object
    // does not hold would put a padlock on a session that does not exist.
    state.setConnection("idle", "locked — PIN required");
    return;
  }
  return openSession(key, intent, { locked: true, pin });
}

/**
 * The session we are standing outside of, if the prompt was cancelled.
 *
 * Only meaningful before a first successful open: after that the key lives in
 * state like any other session's.
 */
let pendingLock = null;

/** Ask for the PIN again, whether we are in the wrong room or in none at all. */
async function retryLock() {
  const key = state.get().key ?? pendingLock?.key;
  const intent = state.get().key ? "join" : (pendingLock?.intent ?? "join");
  if (!key) return;

  const pin = await lockDialog.ask({ mode: "retry", key });
  if (!pin) return;

  relay.close();
  cryptoBox.clearCache();
  state.resetRoster();
  pendingLock = null;
  await openSession(key, intent, { locked: true, pin });
}

/* ------------------------------------------------------------------
   The lock beacon

   A wrong PIN does not announce itself. It derives a different room hash, so
   the device lands in a different — and therefore empty — room, which is
   indistinguishable from being the first one to arrive. Secure, and silent,
   and this codebase treats silent wrong behaviour as the expensive kind.

   So a locked room says one thing about itself. On creating one we send a
   single clip whose plaintext is a sentinel. The relay retains the last clip of
   a room and replays it to everyone who joins (backend/main.py `room.last`), so
   a joiner that can decrypt it has PROVED it is in the right room, before any
   peer has to be awake to answer. Any real clip serves just as well, since it
   overwrites the beacon.

   What this cannot cover: a room whose last clip has expired with the room
   itself (10 minutes after the last device leaves). Then there is nothing to
   check against and the session stays "unverified" rather than guessing — see
   the banner in ui/banners.js.
------------------------------------------------------------------- */
async function sendBeacon() {
  const { aesKey } = state.get();
  if (!aesKey || !relay.isOpen()) return;
  const { payload, iv } = await cryptoBox.encrypt(aesKey, LOCK.BEACON);
  relay.send(proto.clip({ payload, iv, originId: state.get().originId }));
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

        // Anything that decrypts proves this device holds the right PIN — the
        // beacon replayed on arrival, or any real clip since. Latched before
        // the sentinel check, because the beacon's whole job is this line.
        state.setVerified();

        // The beacon is not a clip anybody typed. Swallowed here rather than
        // downstream because TEXT_RECEIVED goes on to the editor, the history
        // pane and — with auto-write on — the machine's actual clipboard.
        if (text === LOCK.BEACON) return;

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
    state.setVerified();          // a sealed frame opened: the PIN is right
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

  // Bytes, not characters. The relay counts the encoded frame, so multibyte
  // text can sit well inside MAX_CHARS and still be too large to send.
  //
  // This is also the last gate before the wire, and it must be loud. The
  // editor's own check only covers text a human typed; this path is where an
  // auto-captured clipboard arrives, and a silent `return` here was a clip
  // that appeared to sync and never did.
  const bytes = textBytes(text);
  if (bytes > TEXT.MAX_BYTES) {
    return emit(EV.TOAST, `Too big to send — ${Math.ceil(bytes / 1024)} KB, `
      + `limit ${Math.floor(TEXT.MAX_BYTES / 1024)} KB`);
  }

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
    cryptoBox.clearCache();
    const key = keys.generate();
    emit(EV.TOAST, "That key was taken — generated a new one");
    // A locked session keeps its PIN across the regenerated key: the collision
    // is with the key, and re-asking for the PIN would look like the one the
    // user just typed had been rejected.
    const { locked } = state.get();
    await openSession(key, "create", { locked, prk: locked ? lockPrk : null });
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

  on("session:rejoin", async ({ key, locked = false }) => {
    relay.close();
    cryptoBox.clearCache();
    state.resetRoster();

    // A different room, so nothing about the old one carries over. A locked
    // target needs its PIN asked for; cancelling leaves the app where it was
    // rather than dropping the user into some other room.
    if (locked) {
      const pin = await lockDialog.ask({ mode: "join", key });
      if (!pin) return;
      return openSession(keys.normalise(key), "join", { locked: true, pin });
    }
    await openSession(keys.normalise(key), "join");
  });

  // "Someone joined and it wasn't me" — get out of the room and take a new key.
  //
  // A locked session keeps its PIN. Rotation answers "somebody has my link",
  // and somebody who only had the link never had the PIN; making the user
  // invent and redistribute a second secret to solve the first one is a cost
  // with no threat behind it. Changing the PIN is its own action.
  on("session:rotate", async () => {
    relay.close();
    cryptoBox.clearCache();
    state.resetRoster();
    const { locked } = state.get();
    const key = keys.generate(
      state.get().settings.longKeys ? keys.LENGTHS.LONG : keys.LENGTHS.NORMAL);
    emit(EV.TOAST, locked
      ? "New key — the PIN is unchanged"
      : "New key — the old session is abandoned");
    await openSession(key, "create", { locked, prk: locked ? lockPrk : null });
  });

  /* ---- locking and unlocking ------------------------------------------
     Both are room changes, not preferences.

     The lock flag is part of the room hash, so turning it on or off cannot
     happen underneath a live session — there is no such thing as "this room,
     but locked". What actually happens is that we leave and open a different
     one, which is also the honest behaviour: the clips already sitting in the
     old room stay exactly as readable as they were, and pretending a switch
     retroactively protected them would be a lie the UI told.
  --------------------------------------------------------------------- */

  on("session:lock", async () => {
    const pin = await lockDialog.ask({ mode: "create" });
    if (!pin) return;
    relay.close();
    cryptoBox.clearCache();
    state.resetRoster();
    const key = keys.generate(
      state.get().settings.longKeys ? keys.LENGTHS.LONG : keys.LENGTHS.NORMAL);
    emit(EV.TOAST, "Locked — your other devices need the new link and the PIN");
    await openSession(key, "create", { locked: true, pin });
  });

  on("session:unlock", async () => {
    if (!state.get().locked) return;
    relay.close();
    cryptoBox.clearCache();
    state.resetRoster();
    const key = keys.generate(
      state.get().settings.longKeys ? keys.LENGTHS.LONG : keys.LENGTHS.NORMAL);
    emit(EV.TOAST, "Unlocked — anyone with the new link can read this");
    await openSession(key, "create");
  });

  on("session:repin", async () => {
    if (!state.get().locked) return;
    const pin = await lockDialog.ask({ mode: "create" });
    if (!pin) return;
    relay.close();
    cryptoBox.clearCache();
    state.resetRoster();
    // Same key, new PIN — and therefore a different room, because the PIN is
    // part of its name. The link does not change, which is the point: this is
    // the action for "the PIN got out", not "the link got out".
    emit(EV.TOAST, "New PIN — devices using the old one are left behind");
    await openSession(state.get().key, "create", { locked: true, pin });
  });

  /* ---- the lock beacon ------------------------------------------------
     Planted only into a room that is empty AND has no retained clip.

     That condition is not caution, it is correctness: the beacon IS a clip,
     and the relay keeps exactly one per room to replay to late joiners
     (FR-3.3). Sending it into a room that already has one would overwrite
     somebody's actual last clip with a sentinel, so a security feature would
     have quietly broken the product's core behaviour.

     It re-arms itself for free — after a relay redeploy or a 10-minute
     eviction, whoever arrives first into the empty room plants it again.
  --------------------------------------------------------------------- */
  on(EV.ROOM_STATE, ({ existing, hasLast }) => {
    if (!state.get().locked || existing > 0 || hasLast) return;
    sendBeacon();
  });

  on("session:relock", () => retryLock());

  on("ui:whatsnew", () => whatsNew.open());

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
    // Leaving has to actually leave. The derived key used to outlive the room
    // it belonged to — clearCache() had no callers at all — and a locked
    // session's unlock would have sat in sessionStorage for the next person to
    // sit down at this tab.
    cryptoBox.clearCache();
    lockPrk = null;
    storage.clearLock();
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
  // Thunks, not path strings. `import(variable)` is opaque to a bundler: it
  // cannot know what to emit, so it leaves the specifier alone and the deploy
  // asks for ./ui/qr.js, which the bundle does not contain. Both panels then
  // fail to load — caught, warned, and degraded exactly as designed, which is
  // precisely why nobody would notice. A literal specifier inside a thunk keeps
  // the laziness AND lets tools/build.mjs split each one into its own chunk.
  const features = [
    [() => import("./ui/historyPanel.js"), "history"],
    [() => import("./ui/qr.js"),           "qr"],
  ];
  for (const [load, label] of features) {
    try {
      const mod = await load();
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
  // A relay handed to us in `?relay=` has already been resolved by config.js;
  // this is what makes it stick. Persisting here rather than there keeps
  // core/config.js free of writes — it reads settings, it does not own them —
  // and this is the composition root, which is where "apply the deployment's
  // configuration" belongs (docs/ARCHITECTURE.md §3).
  if (RELAY_IS_CUSTOM && storage.loadRelayUrl() !== RELAY_URL) {
    storage.saveRelayUrl(RELAY_URL);
    console.info("[hopboard] relay set from the address bar:", RELAY_URL);
  }

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
  const { key, intent, locked } = resolveKey();
  startSession(key, intent, locked).catch(err => {
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
  // Not awaited: it fetches a JSON file and, if that is slow or missing, the
  // consequence is one banner that does not appear.
  safeInit("what's new", () => { whatsNew.init(); });
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
    `[hopboard] booted · intent=${intent} locked=${!!locked} device=${device.name()}`
  );
}

document.addEventListener("DOMContentLoaded", boot);
