/**
 * The one place that knows there is a native shell underneath.
 *
 * Rank 0 and DOM-free, because the answer also decides the default key length in
 * config.js — and core/ is imported by the node tests and shipped in the npm
 * package cli/ runs on.
 *
 * Three files used to feature-test `globalThis.__TAURI__` independently and all
 * three failed at once: `withGlobalTauri` had never been switched on, so the
 * global did not exist, T0 never started, and the desktop app silently degraded
 * to a browser tab that cannot watch the clipboard.
 */

const g = globalThis;

// `__TAURI_INTERNALS__` is injected into every Tauri webview; `__TAURI__` only
// when `withGlobalTauri` is on. Both are checked so the answer survives that
// flag being turned off again — the failure this module was written after.
const IN_TAURI = typeof g.__TAURI_INTERNALS__ === "object"
              || typeof g.__TAURI__ === "object";

/** `document` first: jsdom has both, and the DOM suites want to be "web". */
const IN_NODE = typeof document === "undefined" && !!g.process?.versions?.node;

export const SURFACE    = IN_TAURI ? "desktop" : IN_NODE ? "cli" : "web";
export const IS_DESKTOP = SURFACE === "desktop";
export const IS_WEB     = SURFACE === "web";
export const IS_CLI     = SURFACE === "cli";

/** Call a command in desktop/src-tauri/src/main.rs. Null anywhere else. */
export async function invoke(command, args) {
  const core = g.__TAURI__?.core;
  if (!core?.invoke) return null;
  try {
    return await core.invoke(command, args);
  } catch (err) {
    console.warn(`[realtimeclipboard] native "${command}" failed:`, err);
    return null;
  }
}

/**
 * Subscribe to an event the shell emits. Resolves to an unsubscribe function, or
 * null off the desktop so callers can treat "no shell" as ordinary.
 */
export async function listen(event, fn) {
  const api = g.__TAURI__?.event;
  if (!api?.listen) return null;
  try {
    return await api.listen(event, ({ payload }) => fn(payload));
  } catch (err) {
    console.warn(`[realtimeclipboard] native listen "${event}" failed:`, err);
    return null;
  }
}
