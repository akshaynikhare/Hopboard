/**
 * A human-readable name for this device, shown in the peer list.
 *
 * Derived from the user agent, which is unreliable by design — this is a label
 * to help someone recognise their own laptop in a list of three, not an
 * identity. It is sent to peers inside the encrypted envelope, never to the
 * relay in the clear.
 */

import { read, write } from "./storage.js";

function detect() {
  const ua = navigator.userAgent;

  const os =
    /Windows/i.test(ua)                    ? "Windows" :
    /Android/i.test(ua)                    ? "Android" :
    /iPhone|iPad|iPod/i.test(ua)           ? "iOS"     :
    /Mac OS X|Macintosh/i.test(ua)         ? "macOS"   :
    /Linux/i.test(ua)                      ? "Linux"   : "Unknown";

  // Order matters: Edge and Opera both contain "Chrome", Chrome contains "Safari".
  const browser =
    /Edg\//i.test(ua)                      ? "Edge"    :
    /OPR\/|Opera/i.test(ua)                ? "Opera"   :
    /Firefox\//i.test(ua)                  ? "Firefox" :
    /Chrome\//i.test(ua)                   ? "Chrome"  :
    /Safari\//i.test(ua)                   ? "Safari"  : "Browser";

  return `${browser} · ${os}`;
}

/** Persisted so a device keeps its name across reloads, and stays renameable. */
export function name() {
  const saved = read("deviceName");
  if (saved) return saved;
  const detected = detect();
  write("deviceName", detected);
  return detected;
}

export function rename(newName) {
  const clean = String(newName || "").trim().slice(0, 40);
  if (clean) write("deviceName", clean);
  return clean || name();
}
