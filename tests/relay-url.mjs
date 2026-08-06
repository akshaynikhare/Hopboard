/**
 * Relay address resolution — core/config.js.
 *
 * The failure this guards is uniquely nasty to diagnose: a malformed stored
 * address does not throw anywhere. The app loads, looks completely normal, and
 * every connection is refused. The console says the network failed; the cause
 * is a trailing slash that turned "/ws/<room>" into "//ws/<room>" eight months
 * ago. So the normaliser is strict about what it accepts and total about what
 * it returns, and this pins both.
 *
 * Usage:  node tests/relay-url.mjs
 */

import { normaliseRelay, DEFAULT_RELAY_URL, RELAY_URL, RELAY_IS_CUSTOM }
  from "../src/core/config.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const eq = (raw, want) => check(
  `${JSON.stringify(raw)} -> ${want === null ? "rejected" : want}`,
  normaliseRelay(raw) === want,
  normaliseRelay(raw) === want ? "" : `got ${normaliseRelay(raw)}`,
);

console.log("\nRelay address\n");

/* Accepted, and normalised to scheme + host with nothing after it. */
eq("wss://relay.corp.example", "wss://relay.corp.example");
eq("ws://127.0.0.1:8000", "ws://127.0.0.1:8000");
eq("wss://relay.corp.example:9443", "wss://relay.corp.example:9443");

/* https:// is what a person copies out of a browser bar when IT hands them an
   address. Converting beats rejecting: the alternative is a support ticket. */
eq("https://relay.corp.example", "wss://relay.corp.example");
eq("http://127.0.0.1:8000", "ws://127.0.0.1:8000");

/* Path, query and fragment are meaningless — the routes are fixed — and a
   trailing slash is the one that silently produces "//ws/<room>". */
eq("wss://relay.corp.example/", "wss://relay.corp.example");
eq("wss://a.b:9443/ws/ROOM?x=1#frag", "wss://a.b:9443");
eq("  wss://relay.corp.example  ", "wss://relay.corp.example");

/* Rejected. Every one of these must come back null rather than part-parsed:
   a half-accepted address is what produces the silent failure above. */
for (const bad of ["ftp://nope.example", "not a url", "relay.corp.example",
                   "javascript:alert(1)", "", "   ", null, undefined, 42, {}]) {
  eq(bad, null);
}

/* A bare host is rejected here ON PURPOSE — ui/sessionPanel.js adds `wss://`
   before calling, so the guess about scheme is made once, where a human typed
   it, rather than inside a function that also parses stored values. */
check("a bare host is rejected, not guessed at",
  normaliseRelay("relay.corp.example") === null);

check("the shipped default is a wss:// address",
  /^wss:\/\/[^/]+$/.test(DEFAULT_RELAY_URL), DEFAULT_RELAY_URL);
check("normalising the default is a no-op",
  normaliseRelay(DEFAULT_RELAY_URL) === DEFAULT_RELAY_URL);
check("with no browser and no storage, RELAY_URL is the default",
  RELAY_URL === DEFAULT_RELAY_URL && RELAY_IS_CUSTOM === false,
  `${RELAY_URL} custom=${RELAY_IS_CUSTOM}`);

console.log("\n" + "=".repeat(56));
console.log(`RELAY URL: ${pass}/${pass + fail} passed`);
console.log("=".repeat(56));
process.exit(fail ? 1 : 0);
