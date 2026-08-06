/**
 * Build the changelog from the git history.
 *
 * Two outputs from one pass, because two audiences need the same facts in
 * different shapes:
 *
 *   CHANGELOG.md    for the repository — every release, in full
 *   changelog.json  for the app — the same data, shipped and read by
 *                   ui/whatsNew.js so a returning user is told what changed
 *
 * Generated rather than written by hand for the reason every generated file
 * exists: a hand-written changelog is accurate until the first busy week. The
 * source of truth is the commit history, which nobody can forget to update.
 *
 * Conventional Commits (`feat:`, `fix!:`, `perf(files):`) decide which section a
 * commit lands in — the commit-msg hook enforces the format. Anything that
 * predates the hook, or was committed with --no-verify, is not dropped: it goes
 * into a general "Other changes" bucket, because a changelog that silently omits
 * work is worse than one with an untidy section.
 *
 * Usage:
 *   node tools/changelog.mjs              write both files
 *   node tools/changelog.mjs --check      exit 1 if they are out of date
 *   node tools/changelog.mjs --next v1.2.0  treat unreleased work as that version
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MD = join(REPO, "CHANGELOG.md");
const JSON_OUT = join(REPO, "changelog.json");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const NEXT = valueOf("--next");

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1] ?? null;
}

const git = (...a) =>
  execFileSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

/* ------------------------------------------------------------------ sections

   Ordered by what a reader wants first. "Added" before "Fixed" before the
   housekeeping, and anything breaking is hoisted above all of it regardless of
   which type it came from — a rename that breaks existing links is not a
   footnote in the "Changed" section.

   Types absent from here (chore, style, ci, test) are deliberately not shown:
   they are real work and they are in the git history, but a release note is
   read by someone deciding whether to care about an update. */
const SECTIONS = [
  { key: "feat",     title: "Added" },
  { key: "fix",      title: "Fixed" },
  { key: "perf",     title: "Faster" },
  { key: "refactor", title: "Changed" },
  { key: "docs",     title: "Documentation" },
  { key: "build",    title: "Build & deploy" },
  { key: "other",    title: "Other changes" },
];
const SHOWN = new Set(SECTIONS.map(s => s.key));

/** `feat(files)!: subject` -> its parts, or null if it is not conventional. */
function parseSubject(subject) {
  const m = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
  if (!m) return null;
  return { type: m[1], scope: m[2] || null, bang: !!m[3], subject: m[4].trim() };
}

function commitsBetween(from, to) {
  // %x1f / %x1e: unit and record separators. A commit body can contain anything
  // a person can type, including every character that would otherwise look like
  // a delimiter, so the delimiters are ones a keyboard does not produce.
  const range = from ? `${from}..${to}` : to;
  const raw = git("log", range, "--no-merges", "--format=%H%x1f%s%x1f%b%x1e");
  if (!raw) return [];

  return raw.split("\x1e").map(r => r.trim()).filter(Boolean).map(record => {
    const [hash, subject, body = ""] = record.split("\x1f");
    const parsed = parseSubject(subject);
    // Breaking is either the `!` marker or the footer. Both are in the spec and
    // people reach for whichever they remember.
    const breaking = (parsed?.bang ?? false) || /^BREAKING[ -]CHANGE:/m.test(body);
    return {
      hash: hash.slice(0, 7),
      type: parsed && SHOWN.has(parsed.type) ? parsed.type : (parsed ? null : "other"),
      scope: parsed?.scope ?? null,
      subject: parsed?.subject ?? subject,
      breaking,
    };
  });
}

/**
 * Every release, newest first, plus whatever is not released yet.
 *
 * Tags are ordered by the date of the commit they point at rather than by name.
 * Sorting by name puts v1.10.0 before v1.9.0, and sorting by tag creation date
 * misplaces a tag added late to an old commit.
 */
function releases() {
  const tags = git("tag", "--list", "v*", "--sort=-creatordate").split("\n").filter(Boolean);

  const out = [];
  const head = tags.length ? tags[0] : null;

  // Unreleased work sits on top, named for the tag it is about to become if
  // --next said so.
  const pending = commitsBetween(head, "HEAD");
  if (pending.length) {
    out.push({
      version: NEXT || "Unreleased",
      date: NEXT ? today() : null,
      commits: pending,
    });
  }

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const previous = tags[i + 1] ?? null;
    out.push({
      version: tag,
      date: git("log", "-1", "--format=%ad", "--date=short", tag),
      commits: commitsBetween(previous, tag),
    });
  }
  return out;
}

const today = () => git("log", "-1", "--format=%ad", "--date=short", "HEAD");

/** Group a release's commits into the display sections, dropping empty ones. */
function group(commits) {
  const breaking = commits.filter(c => c.breaking);
  const groups = [];

  if (breaking.length) {
    groups.push({ title: "Breaking", items: breaking.map(describe) });
  }
  for (const { key, title } of SECTIONS) {
    const items = commits.filter(c => c.type === key && !c.breaking);
    if (items.length) groups.push({ title, items: items.map(describe) });
  }
  return groups;
}

const describe = c => (c.scope ? `${c.scope}: ${c.subject}` : c.subject);

/* -------------------------------------------------------------------- render */

function markdown(list) {
  const lines = [
    "# Changelog",
    "",
    "Generated from the commit history by `tools/changelog.mjs` — do not edit by",
    "hand, the next release will overwrite it. To change an entry, reword the",
    "commit.",
    "",
    "Format follows [Keep a Changelog](https://keepachangelog.com); versions follow",
    "[Semantic Versioning](https://semver.org).",
    "",
  ];

  for (const rel of list) {
    const groups = group(rel.commits);
    if (!groups.length) continue;

    lines.push(`## ${rel.version}${rel.date ? ` — ${rel.date}` : ""}`, "");
    for (const g of groups) {
      lines.push(`### ${g.title}`, "");
      for (const item of g.items) lines.push(`- ${item}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/**
 * The app's copy. Deliberately smaller than the markdown one.
 *
 * It is fetched by a running client, so it is capped: the last few releases,
 * and a bounded number of lines in each. Someone reading "what's new" wants the
 * last release or two — shipping four years of history to every visitor would
 * be paying bandwidth for a scroll nobody reaches the bottom of. The full
 * record is in CHANGELOG.md, which is linked from the dialog.
 */
function appJson(list) {
  const MAX_RELEASES = 8;
  const MAX_ITEMS = 12;

  const releasesOut = list
    .filter(r => r.version !== "Unreleased")     // never advertise unshipped work
    .slice(0, MAX_RELEASES)
    .map(r => {
      const groups = group(r.commits)
        .map(g => ({
          title: g.title,
          items: g.items.slice(0, MAX_ITEMS),
          more: Math.max(0, g.items.length - MAX_ITEMS),
        }));
      return {
        version: r.version,
        date: r.date,
        breaking: r.commits.some(c => c.breaking),
        groups,
      };
    })
    .filter(r => r.groups.length);

  return JSON.stringify({
    generated: today(),
    current: releasesOut[0]?.version ?? null,
    releases: releasesOut,
  }, null, 2) + "\n";
}

/* ---------------------------------------------------------------------- main */

const list = releases();
const md = markdown(list);
const json = appJson(list);

if (CHECK) {
  const stale = [];
  if (!existsSync(MD) || readFileSync(MD, "utf8") !== md) stale.push("CHANGELOG.md");
  if (!existsSync(JSON_OUT) || readFileSync(JSON_OUT, "utf8") !== json) stale.push("changelog.json");

  if (stale.length) {
    console.error(`Out of date: ${stale.join(", ")}  —  run 'npm run changelog'`);
    process.exit(1);
  }
  console.log("changelog is up to date");
  process.exit(0);
}

writeFileSync(MD, md);
writeFileSync(JSON_OUT, json);

const shipped = list.filter(r => r.version !== "Unreleased").length;
const pending = list.find(r => r.version === "Unreleased")?.commits.length ?? 0;
console.log(`CHANGELOG.md + changelog.json written — ${shipped} release(s)`
  + (pending ? `, ${pending} commit(s) unreleased` : ""));
