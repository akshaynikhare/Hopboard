/**
 * The deploy bundle is a second artifact, and nothing else tests it.
 *
 * Every other check in this repo runs against `src/` — the unbundled tree that
 * developers and the .husky hooks see. What ships is what tools/build/build.mjs
 * produces, and the failures that live in the gap between them are all silent:
 * a lazy import quietly inlined, a chunk that 404s, a precache list naming
 * files that no longer exist, a stylesheet cascade reordered. None of them
 * throw. They present as "the app is slower now", "that panel has no styling",
 * or "offline stopped working", weeks later.
 *
 * Usage:  node tests/dom/bundle.mjs
 *         Skips cleanly without jsdom, like tests/live/boot.mjs.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  return ok;
};

console.log("\nBundled build\n");

const OUT = mkdtempSync(join(tmpdir(), "realtimeclipboard-build-"));
try {
  execFileSync(process.execPath, [join(REPO, "tools/build/build.mjs"), OUT], { stdio: "pipe" });
} catch (err) {
  console.log("  FAIL  build succeeds  — " + (err.stdout?.toString() || err.message).slice(-400));
  process.exit(1);
}
check("build succeeds", true);

const read = p => readFileSync(join(OUT, p), "utf8");
const has = p => existsSync(join(OUT, p));

/* ---------- the lazy loads survived ----------
   Without --splitting, esbuild inlines dynamic imports. The globe is 18 KB
   gzip below the fold on the page search engines fetch, and files/transfer.js
   is the largest module in the repo. Inlining either would make the bundle
   bigger while every other check still passed. */
const mainJs = read("src/main.js");
const chunks = name => [...read(name).matchAll(/from\s*"\.\/([\w.-]+\.js)"/g)].map(m => m[1]);

check("the globe is still a separate chunk",
  !mainJs.includes("naturalearthdata")
  && existsSyncGlob("src/landing", /^globe-/),
  "landing.js must import it, not contain it");

check("file transfer is still a separate chunk",
  existsSyncGlob("src", /^transfer-/) && existsSyncGlob("src", /^registry-/));

/* ---------- every chunk the entries name actually exists ----------
   A module specifier that resolves to nothing is a blank page and one console
   line — the exact failure native ES modules fail at silently, which is why
   tests/unit/static-check.mjs guards it for the source tree. */
const dangling = [];
for (const entry of ["src/main.js", "src/landing/landing.js",
                     "src/landing/faq.js", "src/landing/redirect.js"]) {
  if (!has(entry)) { dangling.push(`${entry} (missing entry)`); continue; }
  for (const c of chunks(entry)) {
    if (!has(join(dirname(entry), c))) dangling.push(`${entry} -> ${c}`);
  }
}
check("every chunk resolves", dangling.length === 0, dangling.join("; "));

/* ---------- the precache list matches what was built ----------
   cache.addAll() rejects as a unit: one stale entry kills the install and
   offline support stops working with no visible symptom. */
const sw = read("sw.js");
const shell = [...(sw.match(/const SHELL = \[([\s\S]*?)\n\];/)?.[1] ?? "")
  .matchAll(/"\.\/([^"]*)"/g)].map(m => m[1]).filter(Boolean);
/**
 * A SHELL entry is a URL, and one of them is not a filename.
 *
 * The app is precached as `./app`, which the host serves from `app.html` — the
 * extensionless serving that tools/build/build.mjs's pretty-URL pass is built around.
 * Resolving the literal path first and the `.html` form second is exactly the
 * order the host resolves them in, so this stays true if a future entry is
 * extensionless too, and still catches a genuinely dangling path.
 */
const servedBy = p => has(p) ? p : has(`${p}.html`) ? `${p}.html` : null;

const missing = shell.filter(p => !servedBy(p));
check(`precache list is complete (${shell.length} entries)`, missing.length === 0,
  missing.join(", "));
check("the app is precached at its served URL",
  shell.includes("app") && servedBy("app") === "app.html",
  `./app -> ${servedBy("app")}`);
check("service worker VERSION was stamped",
  !/const VERSION = "";/.test(sw) && /const VERSION = ".+";/.test(sw),
  sw.match(/const VERSION = "(.*?)";/)?.[1]);

/* ---------- the cascade still ends where it has to ----------
   src/styles/main.css imports mobile.css LAST on purpose: "nearly every rule in
   it overrides an earlier sheet's at the same specificity, and source order is
   what settles that." esbuild preserves @import order, so this should hold —
   but a future switch to a naive `cat styles/*.css` would sort alphabetically
   and break the whole mobile layout with a green build. */
const bundledCss = read("src/styles/main.css");
const probe = src => (readFileSync(join(REPO, "src/styles", src), "utf8")
  .match(/(?<=^|\})\s*(\.[a-zA-Z][\w-]*)\s*[,{]/m) || [])[1];
const mobileSel = probe("mobile.css");
const others = ["layout.css", "editor.css", "statusbar.css", "banners.css", "ads.css"]
  .map(probe).filter(Boolean);
const mobileAt = mobileSel ? bundledCss.lastIndexOf(mobileSel) : -1;
check("mobile.css is still last in the cascade",
  mobileAt > 0 && others.every(sel => bundledCss.indexOf(sel) < mobileAt),
  `${mobileSel} at ${((100 * mobileAt) / bundledCss.length).toFixed(0)}%`);
check("all 17 @imports were inlined", !bundledCss.includes("@import"));

/* ---------- and it still boots ----------
   The point of 1c-0: six modules resolved asset paths from `import.meta.url`,
   which encodes how deep a file sits in the tree. Bundling moves all of them at
   once. install.js resolved the app root one level too high and broke the
   service-worker scope and PWA install criteria in a way nothing threw on. */
let JSDOM;
try { ({ JSDOM } = await import("jsdom")); }
catch {
  console.log("\n  SKIP: boot half needs jsdom  (npm i -D jsdom)\n");
  done();
}

/**
 * Booted at `/app`, which is the URL the deploy actually serves — not at the
 * `app.html` the file is still called.
 *
 * The distinction is the whole of PRD OI-9 restated. core/paths.js derives
 * APP_ROOT from `new URL(".", document.baseURI)`, so the address the page was
 * fetched from — not where the file sits — decides where the app looks for
 * sw.js, the manifest and every lazily-loaded stylesheet. `/app` resolves it to
 * `/`, which is right. `/app/` would resolve it to `/app/` and move all of them
 * a directory down, and nothing would throw: the app would boot, register no
 * service worker, fail the PWA install criteria, and render a QR panel with no
 * styles. Testing against `app.html` would never see it, because that resolves
 * to `/` too.
 */
const dom = new JSDOM(read("app.html"), {
  url: "https://realtimeclipboard.com/app#BUNDLE",
  pretendToBeVisual: true,
});
const { window } = dom;
const put = (n, v) => Object.defineProperty(globalThis, n, { value: v, configurable: true, writable: true });
global.window = window;
global.document = window.document;
global.location = window.location;
put("navigator", window.navigator);
global.localStorage = window.localStorage;
global.sessionStorage = window.sessionStorage;
// Node's own `performance`, NOT jsdom's. undici — the fetch built into Node —
// calls performance.markResourceTiming() when a request finishes, and jsdom's
// implementation has no such method, so replacing the global kills the process
// with "markResourceTiming is not a function" the moment the app fetches
// anything. It surfaced when the bundled app started loading changelog.json.
// The app itself only ever calls performance.now(), which Node has.
Object.defineProperty(window, "performance",
  { value: globalThis.performance, configurable: true });
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.CustomEvent = window.CustomEvent;
put("crypto", globalThis.crypto);
if (!window.crypto?.subtle) {
  Object.defineProperty(window, "crypto", { value: globalThis.crypto, configurable: true });
}
Object.defineProperty(window.navigator, "clipboard", { value: undefined, configurable: true });

/**
 * Same-origin requests are served out of the build under test — for the reason
 * stated four lines below, which this file was not honouring.
 *
 * jsdom is told the page's URL is the production origin, so the app's relative
 * fetch for changelog.json resolved to a PUBLIC address. "Waiting on a live
 * socket here would make a build check need the network" was already the stated
 * rule, and a live HTTP request breaks it in exactly the same way — it was just
 * quieter, because the request 404'd fast and whatsNew.js swallowed it.
 *
 * It stopped being quiet when the site moved to realtimeclipboard.com and DNS
 * had not propagated: undici reports timings before rejecting and killed the
 * process from inside Node's internals. See the `performance` note above — same
 * seam, and this is the half that was left.
 *
 * Serving from OUT rather than from REPO is the point. This test exists to
 * check what tools/build/build.mjs produced; reading the source tree instead would
 * reintroduce the exact gap between `src/` and the deploy that the header of
 * this file is about.
 */
const ORIGIN = window.location.origin;
const netFetch = globalThis.fetch;
put("fetch", (input, init) => {
  const url = new URL(String(input?.url ?? input), ORIGIN);
  if (url.origin !== ORIGIN) return netFetch(input, init);
  const file = join(OUT, decodeURIComponent(url.pathname));
  return Promise.resolve(existsSync(file)
    ? new Response(readFileSync(file), { status: 200 })
    : new Response("not found", { status: 404 }));
});
window.fetch = globalThis.fetch;

// No relay, on purpose: this asks whether the bundle EVALUATES and reaches the
// end of boot(). Whether the transport works is tests/live/e2e.mjs's job, and
// waiting on a live socket here would make a build check need the network.
global.WebSocket = class { constructor() { setTimeout(() => this.onerror?.({}), 0); } send() {} close() {} };

const log = [];
for (const level of ["warn", "error", "info"]) {
  const original = console[level];
  console[level] = (...a) => { log.push([level, a.join(" ")]); original(...a); };
}

let threw = null;
try {
  await import(pathToFileURL(join(OUT, "src/main.js")).href);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await new Promise(r => setTimeout(r, 1500));
} catch (err) { threw = err; }

check("the bundle evaluates without throwing", !threw, threw?.message ?? "");
check("boot() reaches the end",
  log.some(([lvl, m]) => lvl === "info" && m.includes("booted")));

const errors = log.filter(([lvl]) => lvl === "error");
check("no errors during boot", errors.length === 0,
  errors.map(([, m]) => m.slice(0, 120)).join(" | "));

/* main.js loads the optional panels through a thunk so their specifiers stay
   literal and analysable. When they were path STRINGS the bundler could not
   see them, left them pointing at ./ui/features/qr.js, and both panels failed to load
   in the deploy — caught, warned and degraded exactly as designed, which is
   why it would have shipped. The degradation is correct; reaching it from a
   build mistake is not, so it fails here. */
const notLoaded = log.filter(([, m]) => m.includes("not loaded"));
check("no optional feature failed to load", notLoaded.length === 0,
  notLoaded.map(([, m]) => m.slice(0, 160)).join(" | "));

/* Served from /app, the app root is still the site root — asserted against the
   module the whole codebase resolves its assets through, rather than inferred
   from the URL above. This is the one assertion that would fail if /app ever
   gained a trailing slash. */
const paths = await import(pathToFileURL(join(REPO, "src/core/paths.js")).href);
check("APP_ROOT resolves to the site root when served at /app",
  paths.APP_ROOT.href === "https://realtimeclipboard.com/",
  paths.APP_ROOT.href);
/* lock.css and not qr.css: this asserts a resolved href, so it passes for a
   sheet that is not there — and qr.css moved back to the eager half when it
   turned out mobile.css restyles it. Naming a sheet that really is in lazy/
   keeps the assertion about something true. */
check("assets beside the app resolve to the root, not under /app",
  paths.atRoot("sw.js") === "https://realtimeclipboard.com/sw.js"
    && paths.lazyStyleHref("lock.css") === "https://realtimeclipboard.com/src/styles/lazy/lock.css",
  `${paths.atRoot("sw.js")} | ${paths.lazyStyleHref("lock.css")}`);

done();

/** Chunk filenames carry a content hash, so they can only be matched by shape. */
function existsSyncGlob(dir, re) {
  try { return readdirSync(join(OUT, dir)).some(f => re.test(f)); }
  catch { return false; }
}

function done() {
  rmSync(OUT, { recursive: true, force: true });
  console.log("\n" + "=".repeat(56));
  console.log(`BUNDLE: ${pass}/${pass + fail} passed`);
  console.log("=".repeat(56));
  process.exit(fail ? 1 : 0);
}
