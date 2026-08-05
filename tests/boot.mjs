/**
 * Boot the real app in a DOM and confirm it reaches a connected state.
 *
 * This closes the gap e2e.mjs leaves. e2e proves the transport works by
 * driving it directly; this proves boot() actually GETS to the transport.
 *
 * It exists because it caught exactly that failure: an unguarded
 * `install.init()` threw, the exception escaped boot(), openSession() never
 * ran, and the app silently never connected. Every isolated test passed. The
 * only symptom was "Not connected" in the status bar.
 *
 * Usage:  node tests/boot.mjs [ws_base]
 */

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  // jsdom is deliberately not a project dependency — the app ships with no
  // npm install at all. Skip rather than fail so this is safe to run anywhere.
  console.log("\nSKIP: boot test needs jsdom  (npm i -D jsdom)\n");
  process.exit(0);
}

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELAY = process.argv[2] || "wss://hopboard.fastapicloud.dev";

const dom = new JSDOM(readFileSync(join(REPO, "app.html"), "utf8"), {
  url: "https://akshaynikhare.github.io/Hopboard/app.html#BOOTTEST",
  pretendToBeVisual: true,
});
const { window } = dom;

// navigator is getter-only in Node 24, so globals need defineProperty.
const put = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

global.window = window;
global.document = window.document;
global.location = window.location;
put("navigator", window.navigator);
global.localStorage = window.localStorage;
global.sessionStorage = window.sessionStorage;
global.performance = window.performance;
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.CustomEvent = window.CustomEvent;
global.WebSocket = globalThis.WebSocket;
put("crypto", globalThis.crypto);
if (!window.crypto?.subtle) {
  Object.defineProperty(window, "crypto", { value: globalThis.crypto, configurable: true });
}

// jsdom has no clipboard API. The app must degrade rather than crash — which
// is itself part of what this asserts.
Object.defineProperty(window.navigator, "clipboard", { value: undefined, configurable: true });

const log = [];
for (const level of ["warn", "error", "info"]) {
  const original = console[level];
  console[level] = (...a) => { log.push([level, a.join(" ")]); original(...a); };
}

console.log("\nBooting the real app against " + RELAY + "\n");

const states = [];
const bus = await import(pathToFileURL(join(REPO, "src/core/bus.js")).href);
bus.on(bus.EV.CONN_STATE, ({ state, detail }) => {
  states.push(state);
  console.log("  conn -> " + state + (detail ? " (" + detail + ")" : ""));
});
bus.on(bus.EV.PEERS_CHANGED, ({ count }) => console.log("  peers -> " + count));

const started = Date.now();
await import(pathToFileURL(join(REPO, "src/main.js")).href);
window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

await new Promise(r => setTimeout(r, 12000));

const connected = states.includes("connected");
const reachedEnd = log.some(([lvl, m]) => lvl === "info" && m.includes("booted"));

console.log("\n" + "=".repeat(60));
console.log("  reached end of boot():  " + (reachedEnd ? "YES" : "NO"));
console.log("  states:                 " + (states.join(" -> ") || "(none)"));
console.log("  CONNECTED:              " + (connected ? "YES" : "NO") +
            "  (" + (Date.now() - started) + " ms)");

const problems = log.filter(([lvl]) => lvl === "warn" || lvl === "error");
if (problems.length) {
  console.log("\n  contained failures (did not stop the session):");
  problems.forEach(([lvl, m]) => console.log("    [" + lvl + "] " + m.slice(0, 150)));
}
console.log("=".repeat(60));

process.exit(connected && reachedEnd ? 0 : 1);
