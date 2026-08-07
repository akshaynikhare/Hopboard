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
 * !! The app root is the ORIGIN root — `new URL("/", …)`, not `new URL(".", …)`.
 * That is a deliberate narrowing: this used to resolve the directory the current
 * page sits in, so the app could be served from a subpath like
 * `user.github.io/RealtimeClipboard/`. Subpath hosting is no longer supported, because
 * src/pages/ publishes its pages one level up from where they sit on disk and
 * therefore links to them root-absolutely — and a root-absolute link is wrong
 * under a subpath by construction. Supporting both would mean two link styles
 * in one site, which is how the depth bugs above happened in the first place.
 *
 * What that buys: the app's HTML no longer has to live at the app root for this
 * to be correct, so a page's depth stops being load-bearing anywhere. What it
 * costs: hosting under a path prefix. docs/SELF-HOSTING.md says so. !!
 */

/**
 * Guarded the same way `config.js` guards `location`: `core/` is imported by
 * the node-based tests, where there is no document, and a bare reference would
 * throw at import time and take the whole module graph down with it.
 */
const BASE = typeof document !== "undefined" && document.baseURI
  ? document.baseURI
  : "http://localhost/";

/** The origin root, with trailing slash — `https://realtimeclipboard.com/`. */
export const APP_ROOT = new URL("/", BASE);

/** A file sitting beside `app.html`: `sw.js`, `manifest.webmanifest`, `changelog.json`. */
export const atRoot = name => new URL(name, APP_ROOT).href;

/**
 * A stylesheet under `src/styles/lazy/`, fetched on first open.
 *
 * Lazy sheets stay OUT of the bundle on purpose — a QR modal's stylesheet has
 * no business in the critical path of an app most people never open it in.
 *
 * !! The directory is the whole contract. `styles/` is bundled into main.css
 * and `styles/lazy/` is copied verbatim, so which loader a sheet belongs to is
 * a fact about where it sits rather than about who happens to reference it.
 * tools/build/build.mjs used to recover that by grepping every module for calls to
 * this function; it copies the directory now. Pointing this at `styles/` would
 * make an eager sheet loadable twice, once bundled and once over the wire. !!
 *
 * A sheet cannot be moved into `lazy/` on payload grounds alone. An injected
 * <link> lands AFTER main.css, and main.css ends with mobile.css, which
 * overrides earlier sheets at equal specificity and relies on source order to
 * win. So anything mobile.css restyles has to stay eager whatever it costs —
 * qr.css and history.css share ten classes with it and are the standing
 * example.
 */
export const lazyStyleHref = name => new URL(`src/styles/lazy/${name}`, APP_ROOT).href;
