/**
 * In-memory file list. No IndexedDB, no server, no persistence — closing the
 * tab is the cleanup routine.
 *
 * A local entry holds the actual Blob. A remote entry holds only metadata and a
 * thumbnail until someone requests the bytes.
 *
 * Every entry also carries the two facts the UI is required to show and never
 * hide (docs/ARCHITECTURE.md §5):
 *
 *   state  — where this file is in its lifecycle, including why it failed.
 *            A transfer that dies must leave a visible reason behind, not an
 *            abandoned progress bar.
 *   path   — "p2p" or "relay", set the moment it is decided rather than at
 *            completion, so a relay transfer is labelled while it is still
 *            running. A relay transfer is a different privacy story.
 */

import { FILES } from "../core/config.js";
import { emit, EV } from "../core/bus.js";
import * as thumbs from "./thumbs.js";

const items = [];

/** Lifecycle. `idle` covers both "just sitting here" and "sent successfully". */
export const STATE = {
  IDLE:       "idle",
  REQUESTING: "requesting",   // we asked; nothing has come back yet
  WAITING:    "waiting",      // a peer asked us; a human has to approve
  CONNECTING: "connecting",   // negotiating, ICE race in progress
  SENDING:    "sending",
  RECEIVING:  "receiving",
  DONE:       "done",
  ERROR:      "error",
  CANCELLED:  "cancelled",
};

const BUSY = new Set([STATE.REQUESTING, STATE.WAITING, STATE.CONNECTING, STATE.SENDING, STATE.RECEIVING]);

export const all = () => items;
export const get = id => items.find(f => f.id === id);
export const count = () => items.length;

/** Is a transfer under way for this file? The UI offers cancel when true. */
export const isBusy = id => BUSY.has(get(id)?.state);

/** Returns {added, rejected:[{name, reason}]} — the caller reports rejections. */
export async function add(fileList, { makeThumbs = true } = {}) {
  const rejected = [];
  let added = 0;

  for (const file of fileList) {
    if (items.length >= FILES.MAX_COUNT) {
      rejected.push({ name: file.name, reason: `session limit of ${FILES.MAX_COUNT} files reached` });
      continue;
    }
    if (file.size > FILES.MAX_BYTES) {
      rejected.push({ name: file.name, reason: `${thumbs.formatSize(file.size)} — over the 5 MB limit` });
      continue;
    }

    items.push({
      id: crypto.randomUUID().slice(0, 8),
      name: file.name,
      size: file.size,
      type: file.type,
      blob: file,                                   // stays on this machine
      thumb: makeThumbs ? await thumbs.make(file) : null,
      origin: "local",
      progress: 0,
      path: null,                                   // "p2p" | "relay" once transferred
      state: STATE.IDLE,
      error: null,
    });
    added++;
    // Announced individually rather than via FILES_CHANGED: that event carries
    // the whole list and fires for progress ticks too, so a listener could not
    // tell "this one is new and needs sending" from "something moved".
    emit(EV.FILE_ADDED, { file: items[items.length - 1] });
  }

  if (added) emit(EV.FILES_CHANGED, items);
  return { added, rejected };
}

/** A peer announced a file: metadata and thumbnail only, no bytes. */
export function addRemote({ id, name, size, type, thumb, originId }) {
  if (get(id)) return;
  items.push({ id, name, size, type, thumb, blob: null,
               origin: "remote", owner: originId, progress: 0, path: null,
               state: STATE.IDLE, error: null });
  emit(EV.FILES_CHANGED, items);
}

/**
 * `path` rides along in the payload so a listener can label the progress it is
 * showing. ui/statusbar.js currently hard-codes "P2P %" for every tick, which
 * mislabels a relay transfer while it runs; this makes that a one-line fix in
 * a file this change does not own.
 */
export function setProgress(id, percent) {
  const f = get(id);
  if (!f) return;
  f.progress = Math.max(0, Math.min(100, percent));
  emit(EV.FILE_PROGRESS, { id, percent: f.progress, path: f.path });
  emit(EV.FILES_CHANGED, items);
}

/**
 * Where this file is in its lifecycle. Moving out of ERROR clears the old
 * message so a retry does not show the previous failure under a live bar.
 */
export function setState(id, state, error = null) {
  const f = get(id);
  if (!f) return;
  f.state = state;
  f.error = state === STATE.ERROR ? error : null;
  emit(EV.FILES_CHANGED, items);
}

/**
 * Record the transport path as soon as it is known — not at completion.
 * A user watching a slow relay transfer should see RELAY the whole way through,
 * not a P2P badge that turns yellow at the end.
 */
export function setPath(id, path) {
  const f = get(id);
  if (!f || f.path === path) return;
  f.path = path;
  emit(EV.TRANSFER_PATH, { id, path });
  emit(EV.FILES_CHANGED, items);
}

/** Attach received bytes. `path` records whether it came direct or via relay. */
export function complete(id, blob, path) {
  const f = get(id);
  if (!f) return;
  f.blob = blob;
  f.progress = 100;
  f.path = path;
  f.state = STATE.DONE;
  f.error = null;
  emit(EV.TRANSFER_PATH, { id, path });
  emit(EV.FILES_CHANGED, items);
}

/**
 * A transfer failed. Loud by design: a file that silently stops arriving is
 * indistinguishable from a slow network, and the user can do nothing about
 * either unless we say which it was.
 */
export function fail(id, reason = "transfer failed") {
  const f = get(id);
  if (!f) return;
  f.state = STATE.ERROR;
  f.error = String(reason);
  f.progress = 0;
  emit(EV.FILE_PROGRESS, { id, percent: 0 });
  emit(EV.FILES_CHANGED, items);
  emit(EV.TOAST, `${f.name}: ${f.error}`);
}

/**
 * Abort bookkeeping. Does not itself stop a transfer — files/transfer.js owns
 * the sockets; this records the outcome. The UI calls transfer.cancel(), which
 * calls back in here.
 */
export function cancel(id) {
  const f = get(id);
  if (!f) return;
  f.error = null;

  if (f.blob) {
    // We still hold the bytes — a cancelled *send* damages nothing, so the tile
    // goes back to rest rather than wearing a failure it did not suffer.
    f.state = f.origin === "local" ? STATE.IDLE : STATE.DONE;
    f.progress = f.origin === "local" ? 0 : 100;
  } else {
    // A cancelled *download* must stay visibly incomplete, and must not claim
    // a transport path for a transfer that never landed.
    f.state = STATE.CANCELLED;
    f.progress = 0;
    f.path = null;
  }

  emit(EV.FILE_PROGRESS, { id, percent: f.progress, path: f.path });
  emit(EV.FILES_CHANGED, items);
}

/** Put a failed or cancelled entry back to a state a retry can start from. */
export function reset(id) {
  const f = get(id);
  if (!f) return;
  f.state = f.blob ? STATE.DONE : STATE.IDLE;
  f.error = null;
  f.progress = f.blob ? 100 : 0;
  emit(EV.FILES_CHANGED, items);
}

export function remove(id) {
  const i = items.findIndex(f => f.id === id);
  if (i < 0) return;
  items.splice(i, 1);
  emit(EV.FILES_CHANGED, items);
}

export function clear() {
  items.length = 0;
  emit(EV.FILES_CHANGED, items);
}

/** Trigger a browser download of a file we already hold. */
export function save(id) {
  const f = get(id);
  if (!f?.blob) return false;
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
