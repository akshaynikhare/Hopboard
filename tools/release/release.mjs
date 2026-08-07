/**
 * Cut a release: verify, write the changelog, tag, push.
 *
 * Two things ship, from one command, on two different triggers: pushing main
 * deploys the site (Cloudflare Pages), and pushing the tag builds the CLI, the
 * desktop installers and the relay image (.github/workflows/release.yml). The
 * site therefore goes live in about a minute and the binaries take half an
 * hour — see docs/RELEASING.md for what /download/ does in between.
 *
 * It is a script rather
 * than a list of steps in a README because the steps have an order — the
 * changelog has to be written and committed BEFORE the tag, or the tag points
 * at a commit whose changelog does not mention the release the tag is for.
 *
 * Usage:
 *   npm run release -- patch          0.1.0 -> 0.1.1
 *   npm run release -- minor          0.1.0 -> 0.2.0
 *   npm run release -- major          0.1.0 -> 1.0.0
 *   npm run release -- v1.4.2         exactly that
 *   npm run release -- minor --dry    say what would happen, change nothing
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PKG = join(REPO, "package.json");
const CARGO_TOML = join(REPO, "desktop/src-tauri/Cargo.toml");
const CARGO_LOCK = join(REPO, "desktop/src-tauri/Cargo.lock");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const target = args.find(a => !a.startsWith("--"));

const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).trim();
const run = (cmd, ...a) =>
  execFileSync(cmd, a, { cwd: REPO, stdio: "inherit", shell: process.platform === "win32" });

const die = msg => { console.error(`\n  ${msg}\n`); process.exit(1); };

/**
 * Rewrite one match in a file, and die if there is not exactly one.
 *
 * The loud part is the point. A version bump that silently matches nothing
 * ships a build labelled with the previous release, which nobody notices until
 * a user reports a bug against a version that never existed.
 */
function replaceOnce(file, pattern, replacement) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(pattern, replacement);
  if (after === before) die(`${file} — nothing matched ${pattern}. Refusing to tag a half-bumped tree.`);
  writeFileSync(file, after);
}

if (!target) {
  die("Say what to release:  npm run release -- patch | minor | major | v1.2.3");
}

/* ------------------------------------------------------- refuse to start badly

   Each of these has cost somebody an afternoon somewhere. A release from a
   dirty tree ships something that is in no commit; a release from a feature
   branch tags work that was never merged; a release over an existing tag is
   either a no-op or a rewrite of history other people have already fetched. */

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") {
  die(`Releases are cut from main; you are on "${branch}".\n  Merge your branch first.`);
}

if (git("status", "--porcelain")) {
  die("Working tree is not clean. Commit or stash first — a release must be\n"
    + "  reproducible from the tag, and an uncommitted file is not in the tag.");
}

// Someone else may have pushed since this checkout. Tagging a stale main means
// the release is missing work that is already on the branch.
try {
  git("fetch", "--tags", "--quiet");
  const behind = git("rev-list", "--count", "HEAD..@{upstream}");
  if (behind !== "0") die(`main is ${behind} commit(s) behind the remote. Pull first.`);
} catch {
  console.log("  (no upstream to compare against — continuing)");
}

/* ------------------------------------------------------------- work out the version */

const pkg = JSON.parse(readFileSync(PKG, "utf8"));
const current = pkg.version ?? "0.0.0";

function bump(from, kind) {
  const [maj, min, pat] = from.split(".").map(n => parseInt(n, 10) || 0);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

let version;
if (/^(patch|minor|major)$/.test(target)) {
  version = bump(current, target);
} else if (/^v?\d+\.\d+\.\d+$/.test(target)) {
  version = target.replace(/^v/, "");
} else {
  die(`"${target}" is not patch, minor, major, or a version like v1.2.3`);
}

const tag = `v${version}`;
const tags = git("tag", "--list").split("\n").filter(Boolean);
if (tags.includes(tag)) die(`${tag} already exists. Pick another version.`);

console.log(`\n  ${current} -> ${version}   (tag ${tag})\n`);

/* --------------------------------------------------------------------- verify

   The same checks the hooks run. Repeated here rather than trusted from the
   last commit, because "it passed when I committed it" and "it passes now" are
   different claims once a merge has happened in between. */

if (!DRY) {
  console.log("  Verifying …\n");
  run("npm", "run", "verify");
}

/* ------------------------------------------------------- changelog, then tag */

const commits = git("log", tags.length ? `${git("describe", "--tags", "--abbrev=0")}..HEAD` : "HEAD",
                    "--no-merges", "--oneline").split("\n").filter(Boolean);

if (!commits.length) die("Nothing to release — no commits since the last tag.");

console.log(`\n  ${commits.length} commit(s) in this release:`);
commits.slice(0, 10).forEach(c => console.log(`    ${c}`));
if (commits.length > 10) console.log(`    … and ${commits.length - 10} more`);

if (DRY) {
  console.log(`\n  --dry: stopping here. Would tag ${tag} and push.\n`);
  process.exit(0);
}

console.log("\n  Writing the changelog …");
run("node", "tools/release/changelog.mjs", "--next", tag);

pkg.version = version;
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");

/* The desktop crate carries the version twice more, and `cargo build --locked`
   fails outright when the manifest and the lock disagree — so a bump that
   misses either one turns the next tag red on all three platforms rather than
   producing a mislabelled binary. tauri.conf.json is NOT here: it reads
   "../../package.json" and derives its version from the write above.

   Anchored to the first `version =` after the [package] header. A bare
   /^version = / would match `rust-version` on some formatter's output, and a
   global replace would rewrite all 600-odd dependency pins in the lock file. */
replaceOnce(CARGO_TOML, /(\[package\][\s\S]*?\r?\nversion = )"[^"]+"/, `$1"${version}"`);
replaceOnce(CARGO_LOCK, /(name = "realtimeclipboard"\r?\nversion = )"[^"]+"/, `$1"${version}"`);

// --no-verify, and it is not a shortcut: the pre-commit hook refuses commits on
// main, which is exactly right for hand-written changes and exactly wrong for
// the one commit that is only ever made on main by this script. The checks it
// would have run were run above.
git("add", "CHANGELOG.md", "changelog.json", "package.json",
    "desktop/src-tauri/Cargo.toml", "desktop/src-tauri/Cargo.lock");
execFileSync("git", ["commit", "--no-verify", "-m", `chore(release): ${tag}`],
             { cwd: REPO, stdio: "inherit" });

// Annotated, not lightweight: an annotated tag carries a date, an author and a
// message, and `git describe` prefers it. The message is the release's own
// changelog section, so `git show v1.2.0` tells you what shipped.
const section = readFileSync(join(REPO, "CHANGELOG.md"), "utf8")
  .split(/^## /m)
  .find(s => s.startsWith(tag)) ?? tag;

execFileSync("git", ["tag", "-a", tag, "-m", `## ${section}`.trim()],
             { cwd: REPO, stdio: "inherit" });

console.log(`\n  Tagged ${tag}. Pushing …\n`);
run("git", "push", "origin", "main");
run("git", "push", "origin", tag);

console.log(`\n  ${tag} pushed. The site is deploying from main now; the tag builds`);
console.log("  the installers, the CLI and the relay image — watch:");
console.log("    https://github.com/akshaynikhare/RealtimeClipboard/actions\n");
console.log("  The GitHub release stays a DRAFT until all three desktop builds pass.");
console.log("  Until it is published, /download/ keeps offering /releases/latest.\n");
