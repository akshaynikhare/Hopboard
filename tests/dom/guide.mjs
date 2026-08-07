/**
 * The installed app's guide: that it gates to the desktop, opens once, and
 * actually renders the three ways to link a device.
 *
 * The load-bearing assertion is the negative one — a web visitor must get
 * nothing at all. The gate is core/native.js's SURFACE, which is resolved at
 * MODULE EVALUATION, so the Tauri global has to be set before the import and
 * cannot be changed afterwards. That is why the "web" case is a child process
 * rather than another block in this file.
 *
 * Usage:  node tests/dom/guide.mjs
 */

import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  console.log("\nSKIP: guide test needs jsdom  (npm i -D jsdom)\n");
  process.exit(0);
}

const WEB_CHILD = process.argv[2] === "--as-web";

const dom = new JSDOM(`<div class="vs"><div id="mount-menus"></div></div>`, {
  url: "https://example.com/app.html",
  pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.location = window.location;          // keys.shareLink() reads it
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.CustomEvent = window.CustomEvent;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

/* core/state.js calls crypto.randomUUID() at module scope. */
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = { ...globalThis.crypto, randomUUID: () => "0000-test-0000" };
}

/* The whole gate. Set BEFORE the first import of anything reaching core/. */
if (!WEB_CHILD) globalThis.__TAURI_INTERNALS__ = {};

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const { emit } = await import("../../src/core/bus.js");
const state = await import("../../src/core/state.js");
const guide = await import("../../src/ui/panels/guidePanel.js");

const KEY = "D75LVX9QRS";       // ten characters, throwaway — never a real key
state.setKey({ key: KEY, roomHash: "deadbeef", aesKey: null });

/* ---- the web case, in its own process ---------------------------------- */
if (WEB_CHILD) {
  guide.init();
  emit("ui:guide");
  // Nothing rendered, and nothing recorded — a web visitor must not even have
  // "seen" the guide, or installing later would skip the one showing that
  // matters.
  const clean = !document.querySelector(".guide")
    && !window.localStorage.getItem("realtimeclipboard.guideSeen");
  process.exit(clean ? 0 : 1);
}

console.log("\nGuide\n");

/* ---- first launch: it introduces itself -------------------------------- */
guide.init();
check("it opens itself on the first launch", !!document.querySelector(".guide"));
check("...and records that it did",
      window.localStorage.getItem("realtimeclipboard.guideSeen") !== null);

const dlg = document.querySelector(".guide-dlg");
const html = dlg?.innerHTML ?? "";

check("it shows the session key", html.includes("D75LV"));
check("...grouped so it can be read aloud", html.includes("D75LV X9QRS"),
      dlg?.querySelector(".guidekey")?.textContent?.trim());
check("it renders a scannable QR", !!dlg?.querySelector("svg.qrsvg"));
check("it offers the link as well", !!dlg?.querySelector("[data-guide-copy]"));
check("it says how to quit", /Quit RealtimeClipboard/.test(html));
check("it says the X button does not quit", /keep running|keeps running/i.test(html));

/* The three ways to link a device, in the order the section claims. */
const order = ["Scan this", "send yourself the link", "type the key"]
  .map(s => html.toLowerCase().indexOf(s.toLowerCase()));
check("the three ways to link are easiest-first",
      order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2],
      order.join(" < "));

/* ---- it does not stack ------------------------------------------------- */
emit("ui:guide");
check("a second request replaces rather than stacks",
      document.querySelectorAll(".guide").length === 1);

/* ---- closing ----------------------------------------------------------- */
const modal = await import("../../src/ui/primitives/modal.js");
modal.close();
check("closing removes it", !document.querySelector(".guide"));

/* ---- and it never volunteers twice ------------------------------------- */
guide.init();
check("it does not introduce itself again on the next launch",
      !document.querySelector(".guide"));
emit("ui:guide");
check("...but the gear menu can still open it", !!document.querySelector(".guide"));

/* ---- opened before the session exists ----------------------------------
   boot() does not await openSession(), so on a first launch this dialog is
   built while the key derivation is still running. It must say so and then
   fill itself in — never render a QR for a link with no key in it, which
   scans as "open a new session". */
modal.close();
state.setKey({ key: null, roomHash: null, aesKey: null });
emit("ui:guide");
const pending = document.querySelector(".guide-dlg");
check("with no key yet it offers no QR to scan", !pending?.querySelector("svg.qrsvg"));
check("...and says the session is still opening", /Opening the session/.test(pending?.innerHTML));

state.setKey({ key: KEY, roomHash: "deadbeef", aesKey: null });
const filled = document.querySelector(".guide-dlg");
check("it fills itself in when the key arrives",
      filled?.innerHTML.includes("D75LV X9QRS"),
      filled?.querySelector(".guidekey")?.textContent?.trim());
check("...QR and all", !!filled?.querySelector("svg.qrsvg"));

/* ---- the web must get nothing ------------------------------------------ */
let webClean = false;
try {
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--as-web"], { stdio: "pipe" });
  webClean = true;
} catch { /* non-zero exit means it rendered something */ }
check("a web visitor gets no guide at all", webClean);

console.log("\n" + "=".repeat(58));
console.log(`GUIDE: ${pass}/${pass + fail} passed`);
console.log("=".repeat(58) + "\n");
process.exit(fail ? 1 : 0);
