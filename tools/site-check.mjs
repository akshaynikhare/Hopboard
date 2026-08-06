/**
 * Assert that an assembled `_site` is fit to publish. Run against the output of
 * tools/build.mjs, immediately after it, as part of the deploy.
 *
 * These checks used to be a `run: |` block in .github/workflows/pages.yml. They
 * moved here when the frontend went to Cloudflare Pages, because the deploy
 * moved with it: Cloudflare builds the site itself from a build command, and a
 * check that lives in a GitHub Actions step does not run there at all. Porting
 * them was not optional — dropping them would have traded a genuine gate for a
 * faster deploy, which is the wrong trade for the two checks below that are
 * about a silent, unrecoverable failure rather than a broken page.
 *
 * A non-zero exit fails the Cloudflare build, and a failed build is not
 * promoted, so production keeps serving the previous deploy.
 *
 * Node-only on purpose: the old block shelled out to `python3` for the JSON and
 * XML parsing, and the build image's Python is not something this repo should
 * depend on for whether a release ships.
 *
 *   node tools/build.mjs _site && node tools/site-check.mjs _site
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const OUT = resolve(ROOT, process.argv[2] || "_site");

/** The one place the canonical origin is written down for the checks below. */
const ORIGIN = "https://realtimeclipboard.com";

/** The host the site was published from until the move, and must never mention again. */
const OLD_HOST = "akshaynikhare.github.io";

let failed = 0;
const fail = msg => { console.error(`  FAIL  ${msg}`); failed++; };
const pass = msg => console.log(`  ok    ${msg}`);

/* ------------------------------------------------------- files exist ---- */

/**
 * src/ui/install.js is deliberately absent from this list: the deploy ships
 * bundles, not the module tree. src/main.js and src/landing/landing.js are the
 * entry points the HTML names, and tests/bundle.mjs is what proves the chunks
 * behind them resolve.
 *
 * `_headers` and `_redirects` are here because they are the whole reason the
 * site is on Cloudflare Pages. A missing `_headers` does not break a single
 * page — it silently drops the CSP frame-ancestors and HSTS and looks exactly
 * like a healthy deploy, which is the failure mode that most needs a check.
 */
const REQUIRED = [
  "index.html", "app.html", "manifest.webmanifest", "sw.js",
  "robots.txt", "sitemap.xml", "changelog.json", "CHANGELOG.md",
  "_headers", "_redirects",
  "src/main.js", "src/styles/main.css",
  "src/landing/landing.js", "src/landing/landing.css",
  "icons/icon-192.png", "icons/icon-512.png",
  "icons/maskable-192.png", "icons/maskable-512.png",
  "social/og-card.png",
  "help/index.html", "blog/index.html",
  "help/clipboard-sync-not-working/index.html", "help/install/index.html",
  "download/index.html", "download/download.css", "src/landing/download.js",
];

console.log("\nSite check\n");

const missing = REQUIRED.filter(f => !existsSync(join(OUT, f)));
missing.length ? missing.forEach(f => fail(`missing ${f}`))
               : pass(`${REQUIRED.length} required files present`);

/* ------------------------------------------------------------ robots ---- */

/**
 * The point of the whole domain move, and worth one line to prove it landed.
 * On github.io this file was served from a subdirectory, where robots.txt is
 * never fetched — it governed nothing and could not be fixed from this repo.
 * At an apex it is finally authoritative, which also means a wrong one is now
 * capable of doing damage.
 */
const robots = read("robots.txt");
robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`)
  ? pass("robots.txt declares the sitemap on the canonical origin")
  : fail("robots.txt does not declare Sitemap: " + ORIGIN + "/sitemap.xml");

/* ----------------------------------------------------------- sitemap ---- */

const sitemap = read("sitemap.xml");
if (!/^\s*<\?xml/.test(sitemap) || !sitemap.includes("</urlset>")) {
  fail("sitemap.xml is not a well-formed urlset");
} else {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  const foreign = locs.filter(u => !u.startsWith(ORIGIN + "/"));
  if (!locs.length) fail("sitemap.xml contains no <loc> entries");
  else if (foreign.length) foreign.forEach(u => fail(`sitemap.xml <loc> is off-origin: ${u}`));
  else pass(`sitemap.xml: ${locs.length} URLs, all on ${ORIGIN}`);
}

/* ---------------------------------------------------------- manifest ---- */

/**
 * Valid JSON, and no SVG in icons[].
 *
 * The SVG is not a harmless extra entry. An icon declaring sizes:"any"
 * satisfies Chrome's "at least one icon >= 144px" test on paper, so it wins the
 * selection — and then Chrome cannot rasterise it for an app icon, reports
 * `no-acceptable-icon`, and does NOT fall back to the PNGs sitting right above
 * it. One SVG line silently removed the install button from the omnibox while
 * every other criterion passed. Verified with Page.getInstallabilityErrors:
 * dropping it is the whole fix. icon.svg is still the favicon in index.html —
 * that is fine, a <link rel="icon"> and manifest icons[] are unrelated paths.
 */
try {
  const icons = JSON.parse(read("manifest.webmanifest")).icons || [];
  const svg = icons.filter(i => i.type === "image/svg+xml" || i.src.endsWith(".svg"));
  svg.length && fail(`manifest icons[] contains SVG ${svg.map(i => i.src).join(", ")} `
    + `- this breaks PWA installability in Chrome. Use PNG only.`);
  icons.some(i => i.sizes === "512x512" && i.purpose === "any")
    ? !svg.length && pass("manifest icons[] is PNG-only and has a 512x512 purpose=any")
    : fail("manifest has no 512x512 purpose=any PNG icon");
} catch (e) {
  fail(`manifest.webmanifest is not valid JSON: ${e.message}`);
}

/* --------------------------------------------------------- /app URLs ---- */

/**
 * Every reference to the app points at /app, and /app resolves to something.
 *
 * tools/build.mjs rewrites `app.html` to `app` in the deploy only — the source
 * tree keeps the `.html` because the Tauri desktop app ships it directly over
 * a protocol that does no extension stripping. That split is exactly the kind
 * of arrangement that works until someone adds a link in a form the rewrite's
 * pattern does not match, and then ships a 404 that no test on disk can see.
 *
 * Checked as a pair on purpose. A surviving `app.html` link is a needless
 * redirect hop at best; a missing `_redirects` rule is a site that does not
 * load at all, and the two failures have the same cause — the rewrite silently
 * not happening.
 */
const appLinks = htmlPages()
  .concat(["manifest.webmanifest", "src/landing/landing.js", "src/landing/redirect.js"])
  .filter(f => existsSync(join(OUT, f)))
  .filter(f => /(["'])((?:\.{1,2}\/)*|https:\/\/realtimeclipboard\.com\/)app\.html(?=[#"'])/.test(read(f)));

appLinks.length
  ? appLinks.forEach(f => fail(`${f} still links to app.html — the /app rewrite missed it`))
  : pass("every reference to the app uses /app");

/^\/app\s+\/app\.html\s+200\s*$/m.test(read("_redirects"))
  ? pass("_redirects maps /app onto app.html")
  : fail("_redirects has no `/app  /app.html  200` rule — /app would not resolve");

// The slash is not cosmetic: src/core/paths.js resolves APP_ROOT with
// `new URL(".", document.baseURI)`, so /app/ would move sw.js, the manifest
// and every lazy stylesheet a directory down. PRD OI-9, again.
/^\/app\/\s/m.test(read("_redirects"))
  ? fail("_redirects maps /app/ with a trailing slash — that moves APP_ROOT to /app/")
  : pass("/app is mapped without a trailing slash");

const swShell = read("sw.js").match(/const SHELL = \[(.*?)\n\];/s)?.[1] ?? "";
swShell.includes('"./app"')
  ? pass("the service worker precaches ./app")
  : fail("sw.js SHELL does not precache ./app — the app would not work offline");

/* ------------------------------------------------------------ noindex --- */

/**
 * The app must never be indexable. If this tag is ever dropped, every rendered
 * session — key, clipboard contents, history — becomes crawlable. Fail the
 * deploy rather than find out from a search result.
 */
/name="robots" content="noindex/.test(read("app.html"))
  ? pass("app.html carries its noindex meta tag")
  : fail("app.html is missing its noindex meta tag");

/* ---------------------------------------------------------------- CSP --- */

const pages = htmlPages();

const noCsp = pages.filter(f => !read(f).includes('http-equiv="Content-Security-Policy"'));
noCsp.length ? noCsp.forEach(f => fail(`${f} is missing its Content-Security-Policy meta tag`))
             : pass(`${pages.length} pages carry a CSP meta tag`);

/**
 * The meta policy and the `_headers` policy must agree.
 *
 * Browsers INTERSECT multiple policies rather than letting one win, so a
 * directive that is stricter in only one of the two produces an effective
 * policy that neither file describes. The symptom is a resource blocked in
 * production and nowhere else, with a console message naming a policy string
 * that does not appear anywhere in the repository. `frame-ancestors` is the
 * one sanctioned difference: it is ignored in a meta tag by specification, so
 * the header is the only place it can exist.
 */
const metaCsp = read("app.html").match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
const headerCsp = read("_headers").match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1];

if (!metaCsp) fail("could not read the CSP out of app.html");
else if (!headerCsp) fail("_headers declares no Content-Security-Policy");
else {
  const norm = p => p.split(";").map(d => d.trim()).filter(d => d && !d.startsWith("frame-ancestors")).sort();
  const [a, b] = [norm(metaCsp), norm(headerCsp)];
  const diff = [...a.filter(d => !b.includes(d)).map(d => `meta only: ${d}`),
                ...b.filter(d => !a.includes(d)).map(d => `header only: ${d}`)];
  if (diff.length) {
    fail("the _headers CSP and the meta CSP disagree — they intersect, so this "
       + "produces a policy no file describes:");
    diff.forEach(d => console.error(`          ${d}`));
  } else {
    headerCsp.includes("frame-ancestors")
      ? pass("CSP: header and meta agree, and the header adds frame-ancestors")
      : fail("_headers CSP has no frame-ancestors — the only directive it exists to add");
  }
}

/* ------------------------------------------------------- old host ------- */

/**
 * The migration guard. Every canonical, og:url and JSON-LD @id in this site
 * used to name the old host, and a single survivor points search engines and
 * social cards back at a tombstone. There are too many of them across too many
 * files to re-check by eye on each release.
 *
 * Scoped to the files a crawler reads. docs/ is copied into the deploy and
 * legitimately discusses the old host in prose — docs/SEO.md §7 is the write-up
 * of this very move — so excluding it is the point, not an oversight.
 */
const crawlable = walk(OUT)
  .map(f => relative(OUT, f).replace(/\\/g, "/"))
  .filter(f => /\.(html|xml|txt|webmanifest)$/.test(f) && !f.startsWith("docs/"));

/**
 * Comments do not count, and robots.txt is the reason.
 *
 * Its header explains that this file was inert for the whole life of the
 * project because the site lived on a subpath — which it can only explain by
 * naming the old host. That is the one place the old name is load-bearing
 * rather than left over, and a check that cannot tell the difference pushes you
 * to delete the explanation to make it green.
 *
 * Only `#` comments are stripped, and only from the plain-text formats where
 * `#` means a comment. In HTML and XML the old host would sit in an href, a
 * canonical or a <loc>, all of which are real references a crawler follows.
 */
const withoutComments = (name, body) =>
  /\.(txt)$/.test(name) ? body.replace(/^\s*#.*$/gm, "") : body;

const stale = crawlable.filter(f => withoutComments(f, read(f)).includes(OLD_HOST));
stale.length ? stale.forEach(f => fail(`${f} still references ${OLD_HOST}`))
             : pass(`${crawlable.length} crawlable files, none referencing ${OLD_HOST}`);

/* ---------------------------------------------------------------------- */

console.log(`\n  files to publish ${walk(OUT).length}\n`);

if (failed) {
  console.error(`::error::site check failed (${failed} problem${failed > 1 ? "s" : ""})\n`);
  process.exit(1);
}
console.log("  site check passed\n");

function read(f) {
  try { return readFileSync(join(OUT, f), "utf8"); } catch { return ""; }
}

function htmlPages() {
  return walk(OUT)
    .filter(f => f.endsWith(".html"))
    .map(f => relative(OUT, f).replace(/\\/g, "/"));
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
