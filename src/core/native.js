/**
 * The one place that knows there is a native shell underneath.
 *
 * Rank 0 and DOM-free, because the answer also decides the default key length
 * in config.js — and core/ is imported by the node tests and shipped in the npm
 * package that cli/ runs on.
 *
 * Before this module existed, three files feature-tested `globalThis.__TAURI__`
 * independently and all three failed the same way at once: `withGlobalTauri`
 * had never been switched on in tauri.conf.json, so the global did not exist,
 * T0 never started, and the desktop app silently degraded to a browser tab that
 * cannot watch the clipboard. One owner, one feature test, one place to look.
 */

const g = globalThis;

/**
 * `__TAURI_INTERNALS__` is injected into every Tauri webview; `__TAURI__` only
 * when `withGlobalTauri` is on. Both are checked so the SURFACE answer stays
 * correct even if that flag is ever turned off again — which is exactly the
 * failure this module was written after.
 */
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
 * Subscribe to an event the shell emits. Resolves to an unsubscribe function,
 * or null off the desktop so callers can treat "no shell" as ordinary.
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
