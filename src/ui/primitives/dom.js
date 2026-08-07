/** DOM helpers. Small on purpose — this is not a framework. */

export const $  = sel => document.getElementById(sel) || document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];

/**
 * Escape before interpolating ANY user or peer content into innerHTML.
 * Clip content is attacker-controlled by definition: anyone with the session
 * key can put a <script> tag on your clipboard.
 */
export const esc = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The one place in the app that writes HTML.
 *
 * `esc()` above is a convention, and docs/ARCHITECTURE.md §5 lists "peer content
 * is escaped before entering innerHTML" as a security INVARIANT — which means
 * the whole guarantee rests on nobody ever forgetting one call. There were 25
 * assignment sites across 16 modules. That is 25 chances.
 *
 * Trusted Types turns the convention into a rule the browser enforces. With
 * `require-trusted-types-for 'script'` in the CSP, assigning a plain string to
 * innerHTML THROWS; only a TrustedHTML from a registered policy is accepted. So
 * a new sink added anywhere else fails loudly on the first render instead of
 * quietly working until someone pastes a <script> tag.
 *
 * !! Be clear about what this does not do: `createHTML` is a pass-through. It
 * sanitises nothing. `esc()` is still what makes the string safe, and the
 * static check still verifies that every module writing HTML calls it. The
 * policy's job is to make the sink singular and countable, not to clean it. !!
 *
 * Chromium-only — Firefox and Safari ignore both the directive and this API,
 * so they fall back to a plain assignment and are exactly as safe as before.
 * That matches the support matrix in PRD §5.3 and is the honest position: this
 * is defence in depth on the primary target, not a substitute for escaping.
 */
const policy = (() => {
  try {
    return globalThis.trustedTypes?.createPolicy?.("realtimeclipboard", {
      createHTML: s => s,
      // `require-trusted-types-for 'script'` guards script URLs as well as HTML,
      // and navigator.serviceWorker.register() is one of those sinks. Without
      // this the worker fails to register on Chromium — no offline shell and no
      // install prompt — while every other browser and every Node test is fine,
      // because neither enforces the policy. Found by tools/check/csp-check.mjs.
      createScriptURL: s => s,
    }) ?? null;
  } catch {
    // Already registered — two bundles on one page, or a hot reload. The
    // existing policy is identical, so carrying on unpoliced here would be
    // wrong; falling back to a plain assignment is what an unsupporting
    // browser does anyway.
    return null;
  }
})();

export function setHTML(el, html) {
  const node = typeof el === "string" ? $(el) : el;
  if (!node) return node;
  node.innerHTML = policy ? policy.createHTML(html) : html;
  return node;
}

/**
 * Mint a URL that may be loaded AS CODE — today only the service worker.
 *
 * Passed through unchanged, like createHTML above: the value is ours, built by
 * core/paths.js from document.baseURI, and never contains anything a peer sent.
 * The point is that a script URL now has to come from here, so a future one
 * built out of remote input cannot reach the sink by accident.
 */
export const scriptURL = url => (policy ? policy.createScriptURL(url) : url);

export function on(el, event, handler, opts) {
  (typeof el === "string" ? $(el) : el)?.addEventListener(event, handler, opts);
}

export function text(sel, value) {
  const el = typeof sel === "string" ? $(sel) : sel;
  if (el) el.textContent = value;
}

export function toggle(sel, cls, force) {
  const el = typeof sel === "string" ? $(sel) : sel;
  el?.classList.toggle(cls, force);
}
