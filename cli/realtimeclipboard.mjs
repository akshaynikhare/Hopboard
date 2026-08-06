#!/usr/bin/env node
/**
 * RealtimeClipboard on the command line.
 *
 * The interesting thing about this file is how little of it there is. It
 * imports the SAME modules the browser runs — core/crypto.js, core/keys.js,
 * transport/relay.js — because none of them ever touched `window` or
 * `document`, and Node has had `WebSocket`, `fetch` and `crypto.subtle` as
 * globals since 22. So the CLI gets the heartbeat, the jittered reconnect
 * backoff, the WebSocket→SSE failover and the encryption for free, and cannot
 * drift from the browser's behaviour, because there is nothing here to drift.
 *
 * That is also the constraint: nothing in this file may reimplement a protocol
 * detail. If something is missing, it belongs in src/ where both ends get it.
 *
 *   realtimeclipboard <KEY>              two-way: prints what arrives, sends what you type
 *   realtimeclipboard watch <KEY>        prints incoming clips and nothing else
 *   realtimeclipboard send <KEY>         reads stdin to EOF, sends it, exits
 *   realtimeclipboard new                prints a fresh key
 *
 * Made for pipes, so the rules are the usual ones: clip content goes to stdout
 * and nothing else does, and the exit code is what a script should branch on.
 */

import { createInterface } from "node:readline";
import { stdin, stdout, stderr, argv, exit, env } from "node:process";
import { hostname } from "node:os";

import * as keys from "../src/core/keys.js";
import * as cryptoBox from "../src/core/crypto.js";
import * as relay from "../src/transport/relay.js";
import * as proto from "../src/transport/protocol.js";
import { on, EV } from "../src/core/bus.js";
import { DEFAULT_RELAY_URL, normaliseRelay, TEXT, LOCK } from "../src/core/config.js";

const VERSION = "0.1.0";

/* ------------------------------------------------------------------ args -- */

function parse(args) {
  const opts = { relay: null, pin: null, once: false, json: false, timeout: 0, quiet: false };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const val = () => args[++i];
    if (a === "--relay") opts.relay = val();
    else if (a === "--pin") opts.pin = val();
    else if (a === "--timeout") opts.timeout = Number(val()) * 1000;
    else if (a === "--once") opts.once = true;
    else if (a === "--long") opts.long = true;
    else if (a === "--json") opts.json = true;
    else if (a === "-q" || a === "--quiet") opts.quiet = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else if (a.startsWith("-")) die(`unknown option ${a}`, 2);
    else rest.push(a);
  }
  return { opts, rest };
}

const USAGE = `realtimeclipboard ${VERSION} — an online clipboard, on the command line

  realtimeclipboard <KEY>              two-way; prints what arrives, sends what you type
  realtimeclipboard watch <KEY>        print incoming clips
  realtimeclipboard send <KEY>         read stdin to EOF and send it
  realtimeclipboard new [--long]       print a fresh key

Options
  --relay <url>    relay to use            (default ${DEFAULT_RELAY_URL})
                   or set REALTIMECLIPBOARD_RELAY
  --pin <pin>      join a locked session   (or set REALTIMECLIPBOARD_PIN)
  --once           watch: exit after the first clip
  --json           one JSON object per line instead of raw text
  --timeout <s>    give up after this many seconds
  -q, --quiet      no status on stderr
  -h, --help       this
  -v, --version    version

Examples
  echo "deploy key" | realtimeclipboard send D75LV
  realtimeclipboard watch D75LV > clip.txt
  realtimeclipboard watch D75LV --once --json | jq -r .text
  ssh box 'cat /etc/hosts' | realtimeclipboard send D75LV

The key is a bearer credential: anyone holding it can read the session while it
is open. Clip contents are encrypted here, before they are sent; the relay only
ever sees a room hash and ciphertext.`;

/* ---------------------------------------------------------------- output -- */

const note = (msg, opts) => { if (!opts.quiet) stderr.write(`${msg}\n`); };

function die(msg, code = 1) {
  stderr.write(`realtimeclipboard: ${msg}\n`);
  exit(code);
}

/* --------------------------------------------------------------- session -- */

/**
 * Everything needed to talk in a room, derived exactly as the browser derives
 * it — same salt, same iteration count, same HKDF info strings, because it is
 * the same function.
 */
async function derive(rawKey, pin) {
  const key = keys.normalise(rawKey);
  if (!keys.isValid(key)) die(`"${rawKey}" is not a valid key`, 2);

  if (pin) {
    const clean = cryptoBox.normalisePin(pin);
    if (!clean) die("that PIN is too short", 2);
    const d = await cryptoBox.deriveLocked(key, clean);
    return { key, roomHash: d.roomHash, aesKey: d.aesKey, auth: d.authToken, locked: true };
  }
  return {
    key,
    roomHash: await cryptoBox.roomHash(key),
    aesKey: await cryptoBox.deriveKey(key),
    auth: null,
    locked: false,
  };
}

/**
 * Connect and resolve once the relay has welcomed us.
 *
 * relay.js announces state on the bus rather than returning a promise, because
 * in the browser the connection outlives any one call. Here there is a script
 * waiting, so the bus event is adapted back into a promise — and a timeout,
 * since a pipe that hangs forever is worse than one that fails.
 */
function connect(session, opts, onClip) {
  const url = opts.relay ?? env.REALTIMECLIPBOARD_RELAY ?? undefined;
  if (opts.relay && !normaliseRelay(opts.relay)) die(`"${opts.relay}" is not a usable relay address`, 2);

  return new Promise((resolve, reject) => {
    // Connecting has its own bound, separate from --timeout below: "the relay
    // never answered" and "nothing was ever sent to this room" are different
    // failures, and a script that gets one when it expected the other has been
    // told a lie about its own network.
    const timer = setTimeout(
      () => reject(new Error("the relay did not answer")),
      Math.max(opts.timeout || 0, 20_000),
    );

    on(EV.CONN_STATE, ({ state, detail }) => {
      if (state === "connected") { clearTimeout(timer); resolve(); }
      if (state === "error" && detail) note(`  ${detail}`, opts);
    });

    relay.setFrameHandler(async msg => {
      if (msg.t !== proto.T.CLIP || !msg.payload) return;
      try {
        const text = await cryptoBox.decrypt(session.aesKey, msg.payload, msg.iv);
        // The lock beacon is a control frame wearing a clip's clothes: it is
        // what lets a joiner tell "wrong PIN" from "first one here". Receivers
        // drop it rather than render it, and a pipe must not see it either.
        // Compared against the constant, not a guess at its shape: it starts
        // with NUL, and "looks like a control character" would also
        // swallow a legitimate clip that happened to.
        if (text === LOCK.BEACON) return;
        onClip(text, msg);
      } catch {
        // Undecryptable means a different secret, not a corrupt relay: someone
        // in the room with another PIN, or a stale frame from a rotated key.
        note("  (a clip arrived that this key cannot read)", opts);
      }
    });

    relay.connect({
      roomHash: session.roomHash,
      intent: "join",
      name: `cli@${hostname()}`,
      auth: session.auth,
      ...(url ? { url: normaliseRelay(url) } : {}),
    });
  });
}

async function sendText(session, text, opts) {
  if (!text) die("nothing on stdin to send", 2);
  if (text.length > TEXT.MAX_CHARS) {
    die(`that is ${text.length} characters; the limit is ${TEXT.MAX_CHARS}`, 2);
  }
  const { payload, iv } = await cryptoBox.encrypt(session.aesKey, text);
  relay.send(proto.clip({ payload, iv, originId: `cli-${Date.now().toString(36)}` }));
  // The frame is handed to a socket, not delivered. Give it a moment to flush
  // before the process exits out from under it.
  await new Promise(r => setTimeout(r, 250));
}

const readStdin = () => new Promise(resolve => {
  let buf = "";
  stdin.setEncoding("utf8");
  stdin.on("data", d => { buf += d; });
  stdin.on("end", () => resolve(buf));
});

/**
 * `seq` and `originId` are the only provenance there is, and that is on purpose:
 * the relay rebuilds a clip envelope from scratch (backend/main.py, "clip") and
 * carries neither a timestamp nor a sender identity on it. `at` is therefore
 * when THIS process received it, and is labelled as such rather than implying a
 * send time nobody recorded.
 */
const emitClip = (text, msg, opts) => stdout.write(
  opts.json
    ? `${JSON.stringify({ text, seq: msg.seq ?? null, origin: msg.originId ?? null, receivedAt: new Date().toISOString() })}\n`
    : (text.endsWith("\n") ? text : `${text}\n`),
);

/* ------------------------------------------------------------------ main -- */

const { opts, rest } = parse(argv.slice(2));
if (opts.help) { stdout.write(`${USAGE}\n`); exit(0); }
if (opts.version) { stdout.write(`${VERSION}\n`); exit(0); }

opts.pin ??= env.REALTIMECLIPBOARD_PIN ?? null;

let [cmd, keyArg] = rest;
if (cmd === "new") {
  stdout.write(`${keys.generate(opts.long ? keys.LENGTHS.LONG : keys.LENGTHS.NORMAL)}\n`);
  exit(0);
}
// `realtimeclipboard D75LV` — no verb, so the first word is the key and the mode is both.
if (cmd && !["send", "watch"].includes(cmd)) { keyArg = cmd; cmd = "both"; }
if (!cmd) { stdout.write(`${USAGE}\n`); exit(2); }
if (!keyArg) die(`${cmd} needs a key — try: realtimeclipboard ${cmd} D75LV`, 2);

if (typeof WebSocket === "undefined") {
  die("this needs Node 22 or newer (for the built-in WebSocket)", 3);
}

const session = await derive(keyArg, opts.pin);
note(`realtimeclipboard · room ${session.roomHash.slice(0, 8)}…${session.locked ? " · locked" : ""}`, opts);

/**
 * --timeout bounds the WHOLE run, not just the connection.
 *
 * The distinction matters and was got wrong first time. `watch --once` on a
 * room nobody sends to connects perfectly happily and then waits forever — and
 * with a locked room that is not even an error, because the wrong PIN names a
 * different room, which legitimately exists and is legitimately empty. A
 * connect-only timeout leaves every one of those cases hanging a pipeline.
 */
if (opts.timeout) {
  setTimeout(() => {
    relay.close();
    note(`  timed out after ${opts.timeout / 1000}s`, opts);
    exit(5);
  }, opts.timeout).unref?.();
}

let got = 0;
try {
  await connect(session, opts, (text, msg) => {
    got++;
    emitClip(text, msg, opts);
    if (cmd === "watch" && opts.once) { relay.close(); exit(0); }
  });
} catch (err) {
  die(err.message, 4);
}
note("  connected", opts);

if (cmd === "send") {
  await sendText(session, await readStdin(), opts);
  relay.close();
  exit(0);
}

if (cmd === "both") {
  // Not readStdin(): that waits for EOF, and this mode has to send each line as
  // it is typed while still printing what arrives in between.
  const rl = createInterface({ input: stdin, terminal: false });
  rl.on("line", line => { if (line.length) sendText(session, line, opts).catch(() => {}); });
  rl.on("close", () => { relay.close(); exit(0); });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    relay.close();
    note(`  ${got} clip${got === 1 ? "" : "s"} received`, opts);
    exit(0);
  });
}
