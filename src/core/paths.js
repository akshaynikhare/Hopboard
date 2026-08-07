/**
 * Where the app is served from, resolved once for the whole codebase.
 *
 * From `document.baseURI`, never `import.meta.url` — see core/CLAUDE.md. A
 * module's depth in the tree is not information it may depend on, and bundling
 * shifts every such path at once without throwing.
 *
 * APP_ROOT is the ORIGIN root, which is what retired subpath hosting: pages in
 * `src/pages/` link root-absolutely, and a root-absolute link cannot be correct
 * under a path prefix.
 */

// core/ is imported by the node tests, where there is no document.
const BASE = typeof document !== "undefined" && document.baseURI
  ? document.baseURI
  : "http://localhost/";

export const APP_ROOT = new URL("/", BASE);

/** A file sitting beside `app.html`: `sw.js`, `manifest.webmanifest`, `changelog.json`. */
export const atRoot = name => new URL(name, APP_ROOT).href;

/**
 * A stylesheet under `src/styles/lazy/`, fetched on first open.
 *
 * A sheet cannot move into `lazy/` on payload grounds alone: an injected <link>
 * lands after main.css, which ends with mobile.css and relies on source order to
 * win at equal specificity. Anything mobile.css restyles stays eager — qr.css
 * and history.css are the standing example.
 */
export const lazyStyleHref = name => new URL(`src/styles/lazy/${name}`, APP_ROOT).href;
