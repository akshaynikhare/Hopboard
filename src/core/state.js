/**
 * Single source of truth for session state.
 *
 * Deliberately not reactive. Modules mutate through the setters here and the
 * bus announces the change; nothing observes this object directly. That keeps
 * the data flow one-directional and greppable.
 */

import { emit, EV } from "./bus.js";
import { DEFAULT_SYNC_MODE } from "./config.js";

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
  authToken: null,           // proves PIN knowledge to the relay; not a secret
  originId: crypto.randomUUID().slice(0, 8),   // this tab, for loop suppression
  peerId: null,              // assigned by the relay in `welcome.you`
  connection: "idle",        // idle | connecting | connected | reconnecting | offline
  instance: null,            // relay instance id — a change means split-brain (OI-3)
  peers: 1,
  tier: "T1",                // clipboard capture tier, see clipboard/capture.js
  lastSent: "",              // dedupe guard (FR-2.7)
  suppressUntil: 0,          // loop-suppression deadline (FR-2.6)
  settings: {
    syncMode: DEFAULT_SYNC_MODE,   // live | manual — see config.js
    autowrite: true,
    autoread: true,
    autoaccept: false,
    thumbs: true,
    images: true,
    cursors: true,
    poll: "1s",
  },
};

export const get = () => state;

export function setKey({ key, roomHash, aesKey, locked = false, authToken = null }) {
  state.key = key;
  state.roomHash = roomHash ?? state.roomHash;
  state.aesKey = aesKey ?? state.aesKey;
  state.locked = locked;
  state.authToken = authToken;
  // A new key is a new room: whatever we had proved about the old one does not
  // carry over, and claiming otherwise would leave a stale padlock on screen.
  state.verified = false;
  emit(EV.KEY_CHANGED, { key, locked });
  emit(EV.LOCK_STATE, { locked, verified: false });
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
