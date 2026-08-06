/**
 * "What's new": when it appears, when it stays quiet, and what it renders.
 *
 * The interesting assertions are the negative ones. A release-notes feature is
 * judged by the times it does NOT interrupt — a first-time visitor being shown
 * a changelog, or a banner that reappears on every load because it waits to be
 * read before considering itself delivered.
 *
 * Usage:  node tests/whatsnew.mjs
 */

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  console.log("\nSKIP: what's-new test needs jsdom  (npm i -D jsdom)\n");
  process.exit(0);
}

const dom = new JSDOM(`<div class="vs"><div id="mount-banners"></div></div>`, {
  url: "https://example.com/app.html",
  pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.CustomEvent = window.CustomEvent;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

/* A changelog to serve. Shaped exactly like tools/changelog.mjs writes it. */
const LOG = {
  generated: "2026-08-06",
  current: "v1.2.0",
  releases: [
    { version: "v1.2.0", date: "2026-08-06", breaking: true, groups: [
      { title: "Breaking", items: ["share links changed format"], more: 0 },
      { title: "Added", items: ["locked sessions"], more: 3 },
    ] },
    { version: "v1.1.0", date: "2026-07-01", breaking: false, groups: [
      { title: "Fixed", items: ["<script>alert(1)</script>"], more: 0 },
    ] },
    { version: "v1.0.0", date: "2026-06-01", breaking: false, groups: [
      { title: "Added", items: ["first release"], more: 0 },
    ] },
  ],
};

let served = LOG;
global.fetch = async () => served === null
  ? { ok: false }
  : { ok: true, json: async () => served };

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const $ = s => document.querySelector(s);

const banners = await import("../src/ui/banners.js");
const whatsNew = await import("../src/ui/whatsNew.js");
banners.init();

console.log("\nWhat's new\n");

/* ---- first visit: record, say nothing ---- */

await whatsNew.init();
check("a first-time visitor is not shown a changelog", !$("#mount-banners .banner"));
check("but the version is recorded, so the next release is announced",
  localStorage.getItem("realtimeclipboard.seenVersion") === '"v1.2.0"',
  localStorage.getItem("realtimeclipboard.seenVersion"));

/* ---- same version again: still nothing ---- */

await whatsNew.init();
check("re-opening on the same version stays quiet", !$("#mount-banners .banner"));

/* ---- a release has landed ---- */

localStorage.setItem("realtimeclipboard.seenVersion", JSON.stringify("v1.0.0"));
await whatsNew.init();
await new Promise(r => setTimeout(r, 30));   // banners fill their text a frame late

const banner = $("#mount-banners .banner");
check("a returning user is told there is a new version", !!banner);
check("it names the version", banner?.textContent.includes("v1.2.0"), banner?.textContent?.slice(0, 50));
check("it counts the releases missed", banner?.textContent.includes("2 releases"),
  banner?.textContent?.slice(0, 90));
check("it is a banner, not a modal — nothing is blocked", !$(".wnmodal"));
check("the version is marked seen on arrival, not on read",
  localStorage.getItem("realtimeclipboard.seenVersion") === '"v1.2.0"');

/* ---- opening it ---- */

whatsNew.open();
check("the dialog opens on request", !!$(".wnmodal-dlg"));
check("the shell is inert while it is open", $(".vs").inert === true);
check("every release is listed", document.querySelectorAll(".wnrel").length === 3);
check("a breaking release is marked", !!$(".wnbreak"));
check("a truncated group says so", $(".wnmore")?.textContent.includes("3 more"));

// The items come from commit subjects, which are arbitrary text from the repo.
const injected = $(".wnbody").innerHTML.includes("<script>");
check("changelog text is escaped, not injected", !injected);
check("and the text is still readable",
  $(".wnbody").textContent.includes("alert(1)"));

const modal = await import("../src/ui/modal.js");
modal.close();
check("closing releases the shell", $(".vs").inert === false);

/* ---- a broken or missing changelog is silence, not an error ---- */

served = null;
localStorage.removeItem("realtimeclipboard.seenVersion");
// The banner from the previous step is keyed and still mounted; clear it so the
// assertion below is about this run rather than the last one.
document.getElementById("mount-banners").innerHTML = "";
let threw = false;
try { await whatsNew.init(); } catch { threw = true; }
check("a missing changelog does not throw", !threw);
check("and shows nothing", !$("#mount-banners .banner"));

console.log(`\n${"=".repeat(58)}`);
console.log(`WHATSNEW: ${pass}/${pass + fail} passed`);
console.log("=".repeat(58));
process.exit(fail ? 1 : 0);
