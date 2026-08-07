/**
 * Clip size: does a clip at the limit actually fit through the relay?
 *
 * This exists because it did not. TEXT.MAX_CHARS was 50,000 (PRD FR-2.8) while
 * the relay rejects any frame over 32 KB — and a clip is UTF-8 encoded, sealed
 * with AES-GCM, base64'd (+1/3) and wrapped in a JSON envelope before it is
 * measured. So everything between ~24 KB and 50,000 characters was accepted by
 * the editor, encrypted, sent, and dropped on arrival.
 *
 * Nothing caught it. The crypto round-trips, the relay's cap is correct and
 * tested (test_relay.py), the editor's counter agreed with the constant it was
 * given. The two numbers were each right on their own and wrong together, and
 * the only thing that could have noticed is an assertion that spans them.
 *
 * Hence the shape of this file: it does not re-check the arithmetic in
 * config.js against the same arithmetic written a second time — that would
 * pass for a broken limit as happily as a correct one. It encrypts a real
 * worst-case clip with the real crypto, builds the real envelope, and measures
 * the bytes.
 *
 * Usage: node tests/unit/clipsize.mjs
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

const { TEXT, textBytes } = await load("src/core/config.js");
const proto  = await load("src/transport/protocol.js");
const crypto = await load("src/core/crypto.js");

/** backend/main.py MAX_FRAME_BYTES. Duplicated deliberately: this is the
 *  external constant the test exists to hold us to, not one of ours. */
const RELAY_FRAME_BYTES = 32 * 1024;

const { aesKey: key } = await crypto.deriveOpen("D75LV");

/** The real path: encrypt -> proto.clip -> JSON, and what the relay measures. */
async function wireBytes(text) {
  const { payload, iv } = await crypto.encrypt(key, text);
  const frame = proto.clip({ payload, iv, originId: "a1b2c3d4" });
  return textBytes(JSON.stringify(frame));
}

console.log("\nClip size\n");

/* ---------- a clip at the limit fits ---------- */
const atLimit = "x".repeat(TEXT.MAX_BYTES);
const atLimitWire = await wireBytes(atLimit);
ok("a clip at MAX_BYTES fits in a relay frame",
   atLimitWire <= RELAY_FRAME_BYTES,
   `${atLimitWire} bytes on the wire, cap ${RELAY_FRAME_BYTES}`);

/* ---------- and so does the character limit the UI advertises ---------- */
const atChars = "x".repeat(TEXT.MAX_CHARS);
const atCharsWire = await wireBytes(atChars);
ok("a clip at MAX_CHARS of ASCII fits too",
   atCharsWire <= RELAY_FRAME_BYTES,
   `${TEXT.MAX_CHARS.toLocaleString()} chars -> ${atCharsWire} bytes`);

/* ---------- the counter must never promise more than the wire allows ----- */
ok("MAX_CHARS cannot exceed MAX_BYTES",
   TEXT.MAX_CHARS <= TEXT.MAX_BYTES,
   `${TEXT.MAX_CHARS} chars vs ${TEXT.MAX_BYTES} bytes`);

/* ---------- multibyte: the reason the limit is bytes and not characters ---
   This is the case a character count cannot express. Well inside MAX_CHARS,
   three bytes each, and far too big for the frame — so if the send path ever
   goes back to testing `.length`, this fails.                             */
const cjk = "漢".repeat(Math.floor(TEXT.MAX_CHARS / 2));
ok("a multibyte clip inside MAX_CHARS is still over MAX_BYTES",
   cjk.length < TEXT.MAX_CHARS && textBytes(cjk) > TEXT.MAX_BYTES,
   `${cjk.length.toLocaleString()} chars = ${textBytes(cjk).toLocaleString()} bytes`);

const cjkWire = await wireBytes(cjk);
ok("...and that clip really would be rejected by the relay",
   cjkWire > RELAY_FRAME_BYTES,
   `${cjkWire} bytes on the wire`);

/* ---------- the largest clip we accept, whatever it is made of ----------
   MAX_BYTES is a byte budget, so the worst case is not "the most characters"
   but "the most bytes" — reached by any encoding. Emoji are the awkward one:
   4 UTF-8 bytes carried as 2 UTF-16 units, so `.length` understates them by
   half in the opposite direction to CJK.                                  */
const emoji = "🙂".repeat(Math.floor(TEXT.MAX_BYTES / 4));
ok("a clip of emoji at exactly MAX_BYTES fits",
   textBytes(emoji) <= TEXT.MAX_BYTES && (await wireBytes(emoji)) <= RELAY_FRAME_BYTES,
   `${textBytes(emoji).toLocaleString()} bytes -> ${await wireBytes(emoji)} on the wire`);

/* ---------- the budget is not wastefully conservative --------------------
   A cap that is correct but three times too small passes every test above.
   The envelope allowance is 512 bytes, so the headroom left over should be
   that and not much more — if this fails high, users are being denied space
   that the frame actually has.                                            */
const headroom = RELAY_FRAME_BYTES - atLimitWire;
ok("the limit leaves envelope headroom, and no more than ~1 KB",
   headroom >= 0 && headroom < 1024,
   `${headroom} bytes spare`);

console.log("\n" + "=".repeat(58));
console.log(`CLIP SIZE: ${pass}/${pass + fail} passed`);
console.log("=".repeat(58));
process.exit(fail ? 1 : 0);
