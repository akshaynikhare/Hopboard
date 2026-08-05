/**
 * In-memory file list. No IndexedDB, no server, no persistence — closing the
 * tab is the cleanup routine.
 *
 * A local entry holds the actual Blob. A remote entry holds only metadata and a
 * thumbnail until someone requests the bytes.
 */

import { FILES } from "../core/config.js";
import { emit, EV } from "../core/bus.js";
import * as thumbs from "./thumbs.js";

const items = [];

export const all = () => items;
export const get = id => items.find(f => f.id === id);
export const count = () => items.length;

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
    });
    added++;
  }

  if (added) emit(EV.FILES_CHANGED, items);
  return { added, rejected };
}

/** A peer announced a file: metadata and thumbnail only, no bytes. */
export function addRemote({ id, name, size, type, thumb, originId }) {
  if (get(id)) return;
  items.push({ id, name, size, type, thumb, blob: null,
               origin: "remote", owner: originId, progress: 0, path: null });
  emit(EV.FILES_CHANGED, items);
}

export function setProgress(id, percent) {
  const f = get(id);
  if (!f) return;
  f.progress = Math.max(0, Math.min(100, percent));
  emit(EV.FILE_PROGRESS, { id, percent: f.progress });
  emit(EV.FILES_CHANGED, items);
}

/** Attach received bytes. `path` records whether it came direct or via relay. */
export function complete(id, blob, path) {
  const f = get(id);
  if (!f) return;
  f.blob = blob;
  f.progress = 100;
  f.path = path;
  emit(EV.TRANSFER_PATH, { id, path });
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
