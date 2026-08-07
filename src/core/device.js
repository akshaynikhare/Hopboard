/**
 * A human-readable name for this device, shown in the peer list. Derived from
 * the user agent, which is unreliable by design — a label to help someone
 * recognise their own laptop in a list of three, not an identity.
 *
 * IT IS SENT IN THE CLEAR: `protocol.hello()` puts `name` in a plaintext field,
 * and the relay stores and rebroadcasts it in every roster. So keep it a label —
 * "Chrome · Windows" is fine, and a name is not the place for anything you would
 * mind the relay operator reading. One of the things a locked session does NOT
 * hide, see PRD §7.5 and OI-20.
 */

import { read, write } from "./storage.js";

/**
 * Windows | Android | iOS | macOS | Linux | Unknown. Exported because the
 * desktop guide describes the tray, which behaves differently enough per
 * platform that one paragraph covering all three would be wrong on two.
 */
export function os() {
  const ua = globalThis.navigator?.userAgent ?? "";
  return /Windows/i.test(ua)            ? "Windows" :
         /Android/i.test(ua)            ? "Android" :
         /iPhone|iPad|iPod/i.test(ua)   ? "iOS"     :
         /Mac OS X|Macintosh/i.test(ua) ? "macOS"   :
         /Linux/i.test(ua)              ? "Linux"   : "Unknown";
}

function detect() {
  const ua = navigator.userAgent;

  // Order matters: Edge and Opera both contain "Chrome", Chrome contains "Safari".
  const browser =
    /Edg\//i.test(ua)                      ? "Edge"    :
    /OPR\/|Opera/i.test(ua)                ? "Opera"   :
    /Firefox\//i.test(ua)                  ? "Firefox" :
    /Chrome\//i.test(ua)                   ? "Chrome"  :
    /Safari\//i.test(ua)                   ? "Safari"  : "Browser";

  return `${browser} · ${os()}`;
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
