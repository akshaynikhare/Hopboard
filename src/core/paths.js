/**
 * Where the app is served from, resolved once for the whole codebase.
 *
 * Six modules used to compute this themselves with `new URL("../…",
 * import.meta.url)` — each one hard-coding how deep its own file sits in the
 * tree. That works exactly as long as every module keeps its own file, and
 * stops the moment the deploy bundles `src/ui/*.js` into `src/main.js`: every
 * one of those paths shifts by a directory level, all at once, and nothing
 * throws. `install.js` in particular resolved the app root to the GitHub Pages
 * ROOT rather than to `/RealtimeClipboard/`, which silently breaks the service-worker
 * scope and the PWA install criteria — PRD OI-9, the failure its own comment
 * warned about.
 *
 * A module's depth in the tree is not information any module should depend on.
 * `document.baseURI` is: it is what the browser already resolved every relative
 * href on the page against, so it is right whether the code arrives as forty
 * modules or as one bundle.
 *
 * !! The invariant this rests on: the app's HTML lives AT the app root.
 * `app.html` does, and so does `index.html`. The `help/` and `blog/` pages do
 * not — they sit a directory down — and they must never import an app module
 * that resolves an asset through here. Today they load no JS at all, and the
 * static check enforces that they keep to `landing.css`. If that ever changes,
 * this is the one file to fix rather than six. !!
 */

/**
 * Guarded the same way `config.js` guards `location`: `core/` is imported by
 * the node-based tests, where there is no document, and a bare reference would
 * throw at import time and take the whole module graph down with it.
 */
const BASE = typeof document !== "undefined" && document.baseURI
  ? document.baseURI
  : "http://localhost/";

/** `.../RealtimeClipboard/` — the directory the app is served from, with trailing slash. */
export const APP_ROOT = new URL(".", BASE);

/** A file sitting beside `app.html`: `sw.js`, `manifest.webmanifest`, `changelog.json`. */
export const atRoot = name => new URL(name, APP_ROOT).href;

/**
 * A stylesheet under `src/styles/`.
 *
 * The panels that call this load their CSS lazily, on first open, so those
 * files stay OUT of the bundle on purpose — a QR modal's stylesheet has no
 * business in the critical path of an app most people never open it in. They
 * are still copied to the deploy by `cp -r src`, so only the href needs to
 * survive bundling, not the file.
 */
export const styleHref = name => new URL(`src/styles/${name}`, APP_ROOT).href;
