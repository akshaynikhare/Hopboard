/**
 * Single source of truth for session state.
 *
 * Deliberately not reactive. Modules mutate through the setters here and the
 * bus announces the change; nothing observes this object directly. That keeps
 * the data flow one-directional and greppable.
 */

import { emit, EV } from "./bus.js";
import { DEFAULT_SYNC_MODE, SYNC_MODES, KEY, TEXT } from "./config.js";
import * as storage from "./storage.js";

const state = {
  key: null,
  roomHash: null,
  aesKey: null,
  /**
   * Locked session — a PIN outside the link (core/crypto.js).
   *
   * `verified` is a separate fact from `locked` and the difference is the whole
   * honesty of the feature. A wrong PIN does not fail loudly: it derives a
   * different, empty room, which looks exactly like being the first one to
   * arrive. `verified` means something in this room actually decrypted, so we
   * KNOW the PIN is right rather than assuming it.
   */
  locked: false,
  verified: false,
  /**
   * Were we the first device into this room?
   *
   * `null` until the relay's `welcome` answers it — "not yet known" is a third
   * state and must not be spelled `false`, or the lock button would be refused
   * for the fraction of a second before the room reports itself and refused
   * again for the whole of an offline session.
   *
   * Only locking reads it (see canLock). The relay's `existing` count is the
   * source: it is the peers already present at the moment we joined.
   */
  founder: null,
  authToken: null,           // proves PIN knowledge to the relay; not a secret
  originId: crypto.randomUUID().slice(0, 8),   // this tab, for loop suppression
  peerId: null,              // assigned by the relay in `welcome.you`
  connection: "idle",        // idle | connecting | connected | reconnecting | offline
  instance: null,            // relay instance id — a change means split-brain (OI-3)
  peers: 1,
  tier: "T1",                // clipboard capture tier, see clipboard/capture.js
  lastSent: "",              // dedupe guard (FR-2.7)
  suppressUntil: 0,          // loop-suppression deadline (FR-2.6)
  lastLocalCopyAt: 0,        // a local copy outranks an arriving clip — see recentLocalCopy()
  settings: {
    // off | manual | live — one ladder, see config.js SYNC_MODES. Reading and
    // writing the OS clipboard are both derived from this and neither has a
    // switch of its own: two controls over one behaviour eventually disagree,
    // and then the app looks like it is ignoring its own setting.
    syncMode: DEFAULT_SYNC_MODE,
    autoaccept: false,
    thumbs: true,
    images: true,
    cursors: true,
    longKeys: KEY.DEFAULT_LONG,    // installed builds default to 10 chars
    closeToTray: true,             // desktop only; the X button hides, Quit is in the tray
    poll: "1s",
  },
};

export const get = () => state;

/**
 * Seed settings from storage.
 *
 * Runs first in boot(), and the ordering is the point: resolveKey() asks how
 * long the next key should be, and used to be answered from the defaults
 * because the panel that restored preferences had not initialised yet.
 *
 * A key absent from the saved object keeps its default above. That is what
 * lets a setting be ADDED without silently turning it off for everyone who
 * saved their preferences under an earlier build.
 */
export function restore() {
  const saved = storage.loadSettings();
  if (saved) Object.assign(state.settings, saved);

  migrateReceiving(saved);

  /**
   * One-time move to the long key on installed builds.
   *
   * Anyone who toggled any switch before this shipped has an explicit
   * `longKeys: false` they never chose — persist() writes the whole settings
   * object, so the old default was recorded as a decision. Gated on a marker so
   * it happens once and a later deliberate "off" stands.
   *
   * Nothing existing is invalidated: this only changes the NEXT key generated.
   */
  if (KEY.DEFAULT_LONG && !storage.read("longKeyDefault")) {
    state.settings.longKeys = true;
    storage.write("longKeyDefault", KEY.LONG_LENGTH);
    storage.saveSettings(state.settings);
  }
}

/**
 * Receiving used to be its own switch, defaulting on and independent of the
 * mode, so Manual stopped this machine SENDING while incoming clips still
 * landed on its system clipboard. Both directions are the mode's now.
 *
 * Anyone who turned that switch off asked for exactly one thing: nothing
 * arriving should touch their clipboard. On the new ladder only Manual honours
 * that, so they are moved there rather than silently promoted to a Live rung
 * that does the thing they opted out of. The dead keys go with them, which is
 * also what makes this run once — after the next save they are not on disk.
 */
function migrateReceiving(saved) {
  if (!saved) return;
  if (!("autowrite" in saved) && !("autoread" in saved)) return;

  if (saved.autowrite === false && state.settings.syncMode === SYNC_MODES.LIVE) {
    state.settings.syncMode = SYNC_MODES.MANUAL;
  }
  delete state.settings.autowrite;
  delete state.settings.autoread;
  storage.saveSettings(state.settings);
}

/** Change a setting and remember it. The only path that persists one. */
export function saveSetting(name, value) {
  state.settings[name] = value;
  storage.saveSettings(state.settings);
  emit(EV.SETTINGS_CHANGED, { name, value });
}

export function setKey({ key, roomHash, aesKey, locked = false, authToken = null }) {
  state.key = key;
  state.roomHash = roomHash ?? state.roomHash;
  state.aesKey = aesKey ?? state.aesKey;
  state.locked = locked;
  state.authToken = authToken;
  // A new key is a new room: whatever we had proved about the old one does not
  // carry over, and claiming otherwise would leave a stale padlock on screen.
  state.verified = false;
  // Likewise "we were first" — asked and answered per room. Left standing, the
  // founder of one session would carry the right to lock into the next one it
  // walked into, which is precisely the device that must not have it.
  state.founder = null;
  emit(EV.KEY_CHANGED, { key, locked });
  emit(EV.LOCK_STATE, { locked, verified: false });
  emit(EV.FOUNDER, { founder: null });
}

/**
 * Record whether this device was the first one into the room.
 *
 * Fed from `welcome.existing` in main.js. Re-answered on every welcome, so a
 * relay restart — which empties every room (OI-13) — hands the title to
 * whoever reconnects into the empty room first, rather than to whoever held it
 * before the room stopped existing.
 */
export function setFounder(first) {
  const next = first === null ? null : !!first;
  if (state.founder === next) return;
  state.founder = next;
  emit(EV.FOUNDER, { founder: next });
}

/**
 * May THIS device lock the session?
 *
 * Alone, anyone may: there is nobody to be thrown out. With company, only the
 * device that opened the room, because locking is not a setting — it moves the
 * session to a different room and removes everybody else from it (see
 * LOCK.EVICT). A control that lets any arrival do that to the rest is a control
 * for taking a session over, and the person who started it is the one who
 * chose to share the key in the first place.
 *
 * A rule the UI keeps, not one the relay enforces: every device in the room
 * already holds the key, so a modified client could send the goodbye itself.
 * That is not a new power — it could equally read every clip — and the honest
 * description of this is "the app will not help you do it", not "you cannot".
 */
export function canLock() {
  if (state.locked) return false;
  if (state.peers <= 1) return true;
  return state.founder === true;
}

/**
 * Record that this device can actually read this room.
 *
 * Set from the first thing that decrypts — the beacon replayed in `welcome`, or
 * any real frame. Only ever moves false -> true within a session; setKey resets
 * it, because a different room is a different question.
 */
export function setVerified() {
  if (!state.locked || state.verified) return;
  state.verified = true;
  emit(EV.LOCK_STATE, { locked: true, verified: true });
}

export function setConnection(connection, detail = "") {
  state.connection = connection;
  emit(EV.CONN_STATE, { state: connection, detail });
}

/**
 * Peer roster.
 *
 * Diffed rather than just counted, so arrivals can be announced. The key is a
 * bearer credential — a device appearing is the one observable moment that
 * tells you someone else has it, and a count quietly going 2 → 3 is not
 * something anyone notices.
 *
 * The first roster after connecting is not announced: those devices were
 * already there, and greeting them as arrivals would cry wolf on every reload.
 */
let roster = null;

export function setPeers(count, list = []) {
  state.peers = count;

  if (roster === null) {
    roster = new Map(list.map(p => [p.peerId, p.name]));
  } else {
    const now = new Map(list.map(p => [p.peerId, p.name]));
    for (const [id, name] of now) {
      if (!roster.has(id) && id !== state.peerId) emit(EV.PEER_JOINED, { name, id });
    }
    for (const [id, name] of roster) {
      if (!now.has(id)) emit(EV.PEER_LEFT, { name, id });
    }
    roster = now;
  }

  emit(EV.PEERS_CHANGED, { count, list });
}

/** Forget the roster so a reconnect does not report everyone as newly arrived. */
export function resetRoster() { roster = null; }

/**
 * The relay keeps rooms in process memory, so a changed instance id means we
 * may have landed on a different replica where our peers do not exist. Loud,
 * not silent — a quiet failure here looks exactly like "the network is slow".
 */
export function setInstance(instance) {
  const previous = state.instance;
  state.instance = instance;
  if (previous && previous !== instance) {
    emit(EV.INSTANCE_CHANGED, { from: previous, to: instance });
  }
}

export function setTier(tier, note = "") {
  state.tier = tier;
  emit(EV.TIER_CHANGED, { tier, note });
}

export function setSetting(name, value) {
  state.settings[name] = value;
}

/** Mute local capture briefly after applying a remote clip (FR-2.6). */
export function suppress(ms) { state.suppressUntil = Date.now() + ms; }
export function isSuppressed() { return Date.now() < state.suppressUntil; }

/**
 * When this machine last put something on its own clipboard.
 *
 * Distinct from `suppressUntil`, which is about not echoing our own writes back
 * to the room. This is about precedence: for a few seconds after you copy
 * something here, what you copied is what you are about to paste, and a clip
 * arriving from another device does not get to take it away.
 */
export function markLocalCopy() { state.lastLocalCopyAt = Date.now(); }
export function recentLocalCopy() {
  return Date.now() - state.lastLocalCopyAt < TEXT.LOCAL_COPY_GRACE_MS;
}
