/**
 * The PIN dialog, driven in a real DOM.
 *
 * It collects the one secret in the app that is never written down anywhere, and
 * it is the only thing standing between a locked link and a connection. Both of
 * those make "it looked fine when I clicked it" an inadequate standard, so the
 * things that would be quietly wrong are asserted here: that the field is a
 * password field, that focus is trapped and then given back, that a cancelled
 * prompt resolves rather than hanging its caller forever, and that no input node
 * carrying a typed PIN is left in the document afterwards.
 *
 * Usage:  node tests/dialog.mjs
 */

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  // Same bargain as tests/boot.mjs: jsdom is not a project dependency, because
  // the app ships with no npm install at all.
  console.log("\nSKIP: dialog test needs jsdom  (npm i -D jsdom)\n");
  process.exit(0);
}

const dom = new JSDOM(`<div class="vs"><button id="opener">x</button></div>`, {
  url: "https://example.com/app.html",
  pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
// navigator is getter-only in Node 24.
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

const dlg = await import("../src/ui/lockDialog.js");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const $ = sel => document.querySelector(sel);
const click = sel => $(sel).click();

console.log("\nPIN dialog\n");

document.getElementById("opener").focus();

/* ---- joining a locked session ---- */

const joining = dlg.ask({ mode: "join", key: "D75LV" });

check("a dialog mounts", !!$(".lockmodal-dlg"));
check("it is a modal dialog", $(".lockmodal-dlg").getAttribute("aria-modal") === "true");
check("the app shell is made inert behind it", $(".vs").inert === true);
check("focus lands in the PIN field", document.activeElement?.id === "lockPin");

// The obvious ones, which are exactly the ones that rot in a refactor.
check("the PIN field is a password field", $("#lockPin").type === "password");
check("autocapitalize is off", $("#lockPin").getAttribute("autocapitalize") === "none");
check("autocomplete is off", $("#lockPin").getAttribute("autocomplete") === "off");
check("joining does not ask twice", !$("#lockPin2"));
check("the session key is shown", $(".lockkey")?.textContent.includes("D75LV"));

$("#lockPin").value = "abc";
click("[data-ok]");
check("a PIN under the minimum is refused", !!$(".lockerr").textContent);
check("and the dialog stays open", !!$(".lockmodal-dlg"));

$("#lockPin").value = "hunter2!";
$("#lockPin").dispatchEvent(new window.Event("input", { bubbles: true }));
const strength = $(".lockstrength").textContent;
check("the strength line reports bits, not an adjective",
  /~\d+ bits/.test(strength), strength);

click("[data-ok]");
check("the PIN is handed back to the caller", await joining === "hunter2!");
check("the dialog is gone", !$(".lockmodal-dlg"));
check("the shell is interactive again", $(".vs").inert === false);
check("focus is returned to whatever opened it", document.activeElement?.id === "opener");
check("no field holding the typed PIN is left behind",
  document.querySelectorAll("#lockPin").length === 0);

/* ---- creating one ---- */

const creating = dlg.ask({ mode: "create" });
check("creating asks for it twice", !!$("#lockPin2"));

$("#lockPin").value = "abcdefgh";
$("#lockPin2").value = "different";
click("[data-ok]");
check("a mismatch is refused", $(".lockerr").textContent.includes("do not match"));

click("[data-modal-dismiss]");
check("cancelling resolves null, not a value", await creating === null);

/* ---- getting out ---- */

const escaping = dlg.ask({ mode: "join" });
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("Escape resolves null", await escaping === null);

// A caller awaiting a prompt that got replaced would otherwise wait forever —
// and in main.js that caller is the one deciding whether to connect at all.
const first = dlg.ask({ mode: "join" });
const second = dlg.ask({ mode: "join" });
check("a superseded prompt still settles", await first === null);
click("[data-modal-dismiss]");
check("and so does the one that replaced it", await second === null);
check("nothing is left mounted", !$(".lockmodal"));

console.log(`\n${"=".repeat(58)}`);
console.log(`DIALOG: ${pass}/${pass + fail} passed`);
console.log("=".repeat(58));
process.exit(fail ? 1 : 0);
