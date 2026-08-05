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
const html = read(join(ROOT, "index.html"));
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
};

bad = [];
for (const f of jsFiles.filter(f => /[\\/]ui[\\/]/.test(f))) {
  if (ESC_EXEMPT[rel(f)]) continue;
  const src = stripComments(read(f));
  if (/innerHTML\s*=/.test(src) && !/\besc\(/.test(src)) bad.push(rel(f));
}
ok("UI modules writing innerHTML also use esc()", bad.length === 0, bad.join(", "));

/* ---------- 7. only the clipboard module touches the clipboard ---------- */
bad = jsFiles
  .filter(f => !f.includes("clipboard"))
  .filter(f => /navigator\.clipboard/.test(read(f)))
  .map(rel);
ok("navigator.clipboard confined to clipboard/", bad.length === 0, bad.join(", "));

/* ---------- 8. UI modules do not import the transport ----------
   The boundary that let the transport stay swappable while everything else
   was built. See docs/ARCHITECTURE.md §3. */
bad = jsFiles
  .filter(f => /[\\/](ui|files|clipboard)[\\/]/.test(f))
  .filter(f => /from\s+"[^"]*transport\/relay\.js"/.test(read(f)))
  .map(rel);
ok("no UI/files/clipboard module imports transport/relay.js", bad.length === 0, bad.join(", "));

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

const onDisk = new Set(["./", "./index.html", "./manifest.webmanifest"]);
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

console.log("\n" + "=".repeat(56));
console.log(`STATIC: ${pass}/${pass + fail} passed`);
console.log("=".repeat(56));
process.exit(fail ? 1 : 0);
