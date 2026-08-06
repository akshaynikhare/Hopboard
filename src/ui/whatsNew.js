/**
 * "What's new" — the changelog, in the app.
 *
 * The app updates itself. A service worker swaps the shell under you and, apart
 * from a reload prompt, nothing ever says what changed — so from the user's side
 * features appear and behaviour shifts for no visible reason. This is the answer
 * to that: the release notes, generated from the commit history by
 * tools/changelog.mjs, shipped as ./changelog.json and shown once per release.
 *
 * Two rules about when it appears, both learned from products that get this
 * wrong:
 *
 *   - It never interrupts. A release is not urgent and a modal that steals focus
 *     while someone is pasting a password is a worse bug than the one it is
 *     announcing. Arrival is a dismissible banner; the dialog only opens if the
 *     user asks for it.
 *   - It never shows on a first visit. Someone who has not used the app before
 *     has nothing to be caught up on, and a changelog is a strange first
 *     impression. The version is recorded silently the first time and the banner
 *     starts from the release after that.
 *
 * Failure here is silence, never an error. A missing or malformed changelog.json
 * means no banner and no menu entry — the release notes are not worth a console
 * full of red on an app whose job is moving text between machines.
 */

import { emit } from "../core/bus.js";
import { read, write } from "../core/storage.js";
import * as modal from "./modal.js";
import { esc } from "./dom.js";

const SEEN = "seenVersion";
const SOURCE = new URL("../../changelog.json", import.meta.url).href;
const FULL_LOG = new URL("../../CHANGELOG.md", import.meta.url).href;
const STYLE_HREF = new URL("../styles/whatsnew.css", import.meta.url).href;

let log = null;          // the parsed changelog, once it has loaded

export async function init() {
  log = await load();
  if (!log?.releases?.length) return;

  const seen = read(SEEN, null);
  const current = log.current;

  // First run on this device: record where they came in, say nothing.
  if (!seen) {
    write(SEEN, current);
    return;
  }
  if (seen === current) return;

  // Behind by one release or ten, the offer is the same.
  const behind = log.releases.findIndex(r => r.version === seen);
  const count = behind === -1 ? 1 : behind;

  emit("ui:banner", {
    key: "whatsnew",
    tone: "info",
    title: `Updated to ${current}`,
    body: count > 1
      ? `${count} releases have landed since you were last here.`
      : "A new version of Hopboard is running in this tab.",
    action: { label: "See what's new", onClick: () => open() },
    dismissAfter: 20000,
  });

  // Marked as seen on arrival, not on read. The alternative nags on every load
  // until the dialog is opened, which turns a courtesy into an obstacle.
  write(SEEN, current);
}

/** Is there anything to show? Used by the menu to hide a dead entry. */
export const available = () => !!log?.releases?.length;

/** The current version, for the status bar / about. Null before init(). */
export const version = () => log?.current ?? null;

export function open() {
  if (!log?.releases?.length) return;
  ensureStyles();

  modal.show({
    className: "wnmodal",
    labelledBy: "wnTitle",
    html: `
      <div class="wnhead">
        <h2 id="wnTitle">What's new</h2>
        <button class="wnclose" type="button" data-modal-dismiss
                aria-label="Close">✕</button>
      </div>
      <div class="wnbody">${log.releases.map(release).join("")}</div>
      <div class="wnfoot">
        <a href="${esc(FULL_LOG)}" target="_blank" rel="noopener noreferrer">Full history</a>
      </div>`,
  });
}

function release(r) {
  return `
    <section class="wnrel">
      <h3>${esc(r.version)}${r.date ? ` <span class="wndate">${esc(r.date)}</span>` : ""}${
        r.breaking ? ` <span class="wnbreak">breaking</span>` : ""}</h3>
      ${(r.groups ?? []).map(group).join("")}
    </section>`;
}

function group(g) {
  const more = g.more
    ? `<li class="wnmore">…and ${g.more} more</li>`
    : "";
  return `
    <h4>${esc(g.title)}</h4>
    <ul>${(g.items ?? []).map(i => `<li>${esc(i)}</li>`).join("")}${more}</ul>`;
}

/**
 * Fetch the notes.
 *
 * Deliberately not bundled into a module: the changelog changes on every
 * release and the code does not, so keeping it a data file means a release note
 * fix is not a code change. `cache: "no-cache"` because the service worker
 * serves this shell cache-first, and a stale changelog is the one file where
 * being one version behind defeats the entire point.
 */
async function load() {
  try {
    const res = await fetch(SOURCE, { cache: "no-cache" });
    if (!res.ok) return null;
    const data = await res.json();
    return data && Array.isArray(data.releases) ? data : null;
  } catch {
    return null;      // offline, missing, or not JSON. All the same answer.
  }
}

function ensureStyles() {
  if (document.querySelector('link[data-hb-style="whatsnew"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  link.dataset.hbStyle = "whatsnew";
  document.head.appendChild(link);
}
