/**
 * Repo health check — runs without a browser or a relay.
 *
 * Catches the class of bug that native ES modules fail at silently: a typo'd
 * import path or a missing element id produces a blank page and one console
 * line, with no build step to catch it first.
 *
 * Usage: node tests/static-check.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
let pass = 0, fail = 0;

const ok = (name, good, detail = "") => {
  good ? pass++ : fail++;
  console.log(`  ${good ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const jsFiles = walk(join(ROOT, "src")).filter(f => f.endsWith(".js"));
const read = f => readFileSync(f, "utf8");
const rel = f => relative(ROOT, f).replace(/\\/g, "/");

console.log("\nStatic checks\n");

/* ---------- 1. every module parses ---------- */
let bad = [];
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch { bad.push(rel(f)); }
}
ok(`all ${jsFiles.length} modules parse`, bad.length === 0, bad.join(", "));

/* ---------- 2. every relative import resolves ---------- */
bad = [];
for (const f of jsFiles) {
  const src = read(f);
  const specs = [
    ...src.matchAll(/from\s+"([^"]+)"/g),
    ...src.matchAll(/import\("([^"]+)"\)/g),
  ].map(m => m[1]).filter(s => s.startsWith("."));
  for (const spec of specs) {
    if (!existsSync(resolve(dirname(f), spec))) bad.push(`${rel(f)} -> ${spec}`);
  }
}
ok("every relative import resolves", bad.length === 0, bad.join("; "));

/* ---------- 3. every @import resolves ---------- */
const cssEntry = join(ROOT, "src/styles/main.css");
bad = [...read(cssEntry).matchAll(/@import url\("([^"]+)"\)/g)]
  .map(m => m[1])
  .filter(s => !existsSync(resolve(dirname(cssEntry), s)));
ok("every CSS @import resolves", bad.length === 0, bad.join(", "));

/* ---------- 4. every $("id") exists somewhere ----------
   Elements come from two places: index.html, and modules that build their own
   DOM (banners, history pane, QR modal, PWA prompts). Both count. */
const html = read(join(ROOT, "app.html"));
const known = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
for (const f of jsFiles) {
  const src = read(f);
  for (const m of src.matchAll(/id="([\w-]+)"/g)) known.add(m[1]);        // template literals
  for (const m of src.matchAll(/\.id\s*=\s*"([\w-]+)"/g)) known.add(m[1]); // el.id = "x"
  for (const m of src.matchAll(/\bid:\s*"([\w-]+)"/g)) known.add(m[1]);    // {id: "x"} helpers
}
const referenced = new Set();
for (const f of jsFiles) {
  const src = read(f);
  for (const m of src.matchAll(/\$\("([\w-]+)"\)/g)) referenced.add(m[1]);
  for (const m of src.matchAll(/bind\("([\w-]+)"/g)) referenced.add(m[1]);
}
const dangling = [...referenced].filter(id => !known.has(id)).sort();
ok(`all ${referenced.size} referenced element ids exist`, dangling.length === 0, dangling.join(", "));

/* ---------- 5. colours come from tokens ----------
   A hex literal in a component sheet means the theme cannot be changed in one
   place. A few are legitimate and are listed with their reason. */
const ALLOWED_HEX = {
  "tokens.css": "defines them",
  "components.css": "#fff on the accent button, which is not themed",
  "qr.css": "QR must stay black-on-white or scanners fail — see the file",
  "files.css": "badge foregrounds on fixed accent backgrounds",
};
bad = [];
for (const f of walk(join(ROOT, "src/styles"))) {
  const name = f.split(/[\\/]/).pop();
  if (ALLOWED_HEX[name]) continue;
  const hits = [...read(f).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
  if (hits.length) bad.push(`${name}: ${hits.join(" ")}`);
}
ok("no stray hex outside tokens", bad.length === 0, bad.join("; "));

/* ---------- 6. clip content is escaped ----------
   Anyone with the session key can put markup on your clipboard, so every
   innerHTML assignment carrying peer content has to go through esc().

   Comments are stripped first — an earlier version flagged dom.js purely for
   the word "innerHTML" appearing in the doc comment above esc() itself. */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// Files whose innerHTML provably carries no peer content, with the reason.
const ESC_EXEMPT = {
  "src/ui/editor.js": "gutter interpolates a loop index integer, nothing else",
  "src/ui/lockButton.js": "the template is a constant; every dynamic string it "
    + "later carries goes in through textContent or setAttribute",
};

/* setHTML() as well as innerHTML: the Trusted Types work moved every write
   through ui/dom.js, and a check that still only looked for `innerHTML =` would
   have gone quietly vacuous — passing because the modules no longer contain the
   pattern, not because they escape anything. */
bad = [];
for (const f of jsFiles.filter(f => /[\\/]ui[\\/]/.test(f))) {
  // dom.js DEFINES esc() and owns the one sink, so it never calls either.
  if (ESC_EXEMPT[rel(f)] || rel(f) === "src/ui/dom.js") continue;
  const src = stripComments(read(f));
  if (/innerHTML\s*=|setHTML\(/.test(src) && !/\besc\(/.test(src)) bad.push(rel(f));
}
ok("UI modules writing HTML also use esc()", bad.length === 0, bad.join(", "));

/* ---------- HTML is written in exactly one place ----------
   docs/ARCHITECTURE.md §5 makes "peer content is escaped before entering
   innerHTML" a security invariant, and an invariant enforced by 25 call sites
   remembering to call esc() is a convention wearing an invariant's clothes.
   ui/dom.js setHTML() is now the only sink, which is what lets the CSP's
   Trusted Types directive make it a rule the browser enforces rather than one
   a reviewer has to.

   `= ""` stays legal: Trusted Types exempts the empty string, and "clear this
   node" is not an injection risk. */
/* Capture the assigned value and test it, rather than putting a lookahead after
   `\s*` — `\s*` backtracks to zero width, which lets the lookahead pass and
   reports every `= ""` as a violation. */
bad = jsFiles
  .filter(f => rel(f) !== "src/ui/dom.js")
  .filter(f => [...stripComments(read(f)).matchAll(/\.innerHTML\s*=\s*([^;\n]*)/g)]
    .some(m => m[1].trim() !== '""'))
  .map(rel);
ok("innerHTML is written only in ui/dom.js", bad.length === 0,
   bad.length ? `${bad.join(", ")} — use setHTML()` : "");

/* ---------- 7. only the clipboard module touches the clipboard ---------- */
bad = jsFiles
  .filter(f => !f.includes("clipboard"))
  .filter(f => /navigator\.clipboard/.test(read(f)))
  .map(rel);
ok("navigator.clipboard confined to clipboard/", bad.length === 0, bad.join(", "));

/* ---------- 8. UI modules do not import the transport ----------
   The boundary that let the transport stay swappable while everything else
   was built — and that later carried the whole SSE fallback in without one UI
   file changing. See docs/ARCHITECTURE.md §3.

   The channels count too, not just relay.js: the day someone reaches past the
   facade for ws.js or sse.js, the app starts knowing which pipe it is on and
   the swap stops being free.

   protocol.js is deliberately exempt. It is frame *shapes* — transport-agnostic
   by design and identical on both channels — and files/transfer.js reads its
   type constants rather than hand-copying eleven string literals. */
bad = jsFiles
  .filter(f => /[\\/](ui|files|clipboard)[\\/]/.test(f))
  .filter(f => /from\s+"[^"]*transport\/(relay|ws|sse)\.js"/.test(read(f)))
  .map(rel);
ok("no UI/files/clipboard module imports a transport channel", bad.length === 0, bad.join(", "));

/* ---------- 9. PWA assets present ---------- */
bad = ["manifest.webmanifest", "sw.js", "icons/icon-192.png", "icons/icon-512.png",
       "icons/maskable-192.png", "icons/maskable-512.png"]
  .filter(f => !existsSync(join(ROOT, f)));
ok("PWA assets present", bad.length === 0, bad.join(", "));

/* ---------- 10. service worker does not cache the relay ---------- */
const sw = read(join(ROOT, "sw.js"));
ok("service worker excludes the relay host",
   /fastapicloud|RELAY|ws:|wss:/.test(sw),
   "must skip relay traffic rather than cache it");

/* ---------- 11. the precache list matches what is on disk ----------
   cache.addAll() rejects as a unit, so ONE stale entry pointing at a deleted
   file kills the whole install and offline support stops working with no
   visible symptom. A hand-maintained list of 52 paths will rot; this makes
   the rot fail a test instead of shipping. */
const shellBlock = sw.match(/const SHELL = \[(.*?)\n\];/s)?.[1] ?? "";
const listed = new Set([...shellBlock.matchAll(/"(\.\/[^"]*)"/g)].map(m => m[1]));

const onDisk = new Set(["./", "./index.html", "./app.html", "./manifest.webmanifest"]);
for (const dir of ["src", "icons"]) {
  for (const f of walk(join(ROOT, dir))) {
    if (/\.(js|css)$/.test(f) || dir === "icons") {
      onDisk.add("./" + rel(f));
    }
  }
}
const stale = [...listed].filter(p => !onDisk.has(p));
const unlisted = [...onDisk].filter(p => !listed.has(p));
ok(`precache list matches disk (${listed.size} entries)`,
   stale.length === 0 && unlisted.length === 0,
   [stale.length ? `stale: ${stale.join(" ")}` : "",
    unlisted.length ? `missing: ${unlisted.join(" ")}` : ""].filter(Boolean).join(" | "));

/* ---------- 12. nobody resolves a path from import.meta.url ----------
   `new URL("../../x", import.meta.url)` encodes how deep a module sits in the
   tree. Six of them did, and the deploy bundle collapses src/ui/*.js into
   src/main.js — which moves every one of those paths up a level at once, with
   no error. install.js resolved the app root to the Pages root and silently
   broke the service-worker scope and PWA installability (PRD OI-9).

   core/paths.js resolves it from document.baseURI instead, which is the same
   answer bundled or not. This keeps it that way. */
bad = jsFiles
  .filter(f => rel(f) !== "src/core/paths.js")
  .filter(f => /new URL\([^)]*import\.meta\.url/.test(read(f)))
  .map(rel);
ok("no module resolves a path from import.meta.url", bad.length === 0,
   bad.length ? `${bad.join(", ")} — use core/paths.js` : "");

/* ---------- 13-15. the CSP holds ----------
   Discovered the same way .github/workflows/pages.yml collects content pages —
   any directory holding an index.html — so a page added later is covered here
   without anyone remembering to add it. docs/SEO.md §2 plans a dozen more. */
const IGNORED = new Set(["node_modules", ".git", ".github", ".shots", "_site", "backend"]);
const pages = ["index.html", "app.html"].map(p => join(ROOT, p));
for (const dir of readdirSync(ROOT)) {
  if (IGNORED.has(dir) || !statSync(join(ROOT, dir)).isDirectory()) continue;
  for (const f of walk(join(ROOT, dir))) if (f.endsWith("index.html")) pages.push(f);
}

bad = pages.filter(f => !/http-equiv="Content-Security-Policy"/.test(read(f))).map(rel);
ok(`every page carries a CSP (${pages.length} pages)`, bad.length === 0, bad.join(", "));

/* An inline <script> is what forces 'unsafe-inline' or a hash, and the whole
   point of moving the landing page's fragment redirect into
   src/landing/redirect.js was that there were then none left. JSON-LD is not
   executable and script-src does not apply to it. */
bad = pages.filter(f => [...read(f).matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)]
  .some(m => !/type="application\/ld\+json"/.test(m[1]))).map(rel);
ok("no executable inline <script>", bad.length === 0,
   bad.length ? `${bad.join(", ")} — would need 'unsafe-inline' or a hash` : "");

/* The relay origin now lives in two places: RELAY_URL in core/config.js, and
   connect-src in every page's CSP. Deriving one from the other is impossible
   across a <meta> tag, so this asserts they agree instead — the same trade the
   precache list above makes. Getting it wrong presents as "the app loads and
   every connection is refused", which looks like an outage, not a typo. */
const relayHost = read(join(ROOT, "src/core/config.js"))
  .match(/DEFAULT_RELAY_URL\s*=\s*"wss:\/\/([^"]+)"/)?.[1];
/* Read the meta tag's content attribute, not the first "connect-src" in the
   file — the prose above the tag in app.html explains each directive by name,
   and matching that instead reported a mismatch on a page that was correct. */
bad = pages.filter(f => {
  const csp = read(f)
    .match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? "";
  const connect = csp.match(/connect-src ([^;]+)/)?.[1] ?? "";
  return !connect.includes(`wss://${relayHost}`)
      || !connect.includes(`https://${relayHost}`);
}).map(rel);
ok(`CSP connect-src matches config.js relay (${relayHost})`,
   Boolean(relayHost) && bad.length === 0,
   !relayHost ? "could not read RELAY_URL from config.js" : bad.join(", "));

/* ---------- 16. every module a page loads is a build entry point ----------
   The deploy ships bundles, not the source tree. A module reachable only from
   markup — named in a <script src> and imported by nothing — is invisible to
   the bundler, so it never lands in _site and 404s on the single page that
   needs it. Nothing else catches this: the file exists on disk, the import
   graph is intact, and the page works perfectly in development. */
const buildSrc = read(join(ROOT, "tools/build.mjs"));
const entryNames = new Set([
  ...[...buildSrc.matchAll(/entryPoints:\s*\[([^\]]*)\]/gs)]
    .flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1])),
]);

bad = [];
for (const f of pages) {
  for (const m of read(f).matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) {
    const spec = m[1].replace(/^[./]*/, "");                    // src/landing/x.js
    const base = spec.split("/").pop().replace(/\.js$/, "");     // x
    const covered = [...entryNames].some(e => e === base || e.endsWith(spec) || e.includes(spec));
    if (!covered) bad.push(`${rel(f)} -> ${spec}`);
  }
}
ok("every module a page loads is a build entry point", bad.length === 0,
   bad.length ? `${bad.join("; ")} — add it to tools/build.mjs` : "");

console.log("\n" + "=".repeat(56));
console.log(`STATIC: ${pass}/${pass + fail} passed`);
console.log("=".repeat(56));
process.exit(fail ? 1 : 0);
