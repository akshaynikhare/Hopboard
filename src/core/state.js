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
    direction: "Both",
  },
};

export const get = () => state;

export function setKey({ key, roomHash, aesKey }) {
  state.key = key;
  state.roomHash = roomHash ?? state.roomHash;
  state.aesKey = aesKey ?? state.aesKey;
  emit(EV.KEY_CHANGED, { key });
}

export function setConnection(connection, detail = "") {
  state.connection = connection;
  emit(EV.CONN_STATE, { state: connection, detail });
}

export function setPeers(count, list = []) {
  state.peers = count;
  emit(EV.PEERS_CHANGED, { count, list });
}

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
