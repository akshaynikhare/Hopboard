/**
 * Files layer: does adding a file actually tell anyone?
 *
 * This exists because it did not. transfer.js handled inbound `file-meta`
 * announcements from peers but never sent one, so a file added on this machine
 * was visible only on this machine — dropped files and clipboard images alike.
 *
 * Every other test passed while that was broken: the relay forwards file-meta
 * correctly (relay gate G12), the chunker round-trips, the UI renders. Nothing
 * checked the one line that connects them.
 *
 * Usage: node tests/files.mjs
 */

import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = p => import(pathToFileURL(join(REPO, p)).href);

let pass = 0, fail = 0;
const ok = (name, good, detail = "") => {
  good ? pass++ : fail++;
  console.log(`  ${good ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const registry = await load("src/files/registry.js");
const transfer = await load("src/files/transfer.js");
const state    = await load("src/core/state.js");
const { FILES } = await load("src/core/config.js");

/* Capture what the module tries to put on the wire. */
const sent = [];
transfer.setSignalSender(frame => { sent.push(frame); return true; });

console.log("\nFiles layer\n");

/* ---------- adding a local file announces it ---------- */
const file = new File([new Uint8Array(1024)], "screenshot.png", { type: "image/png" });
const { added, rejected } = await registry.add([file], { makeThumbs: false });

ok("file accepted", added === 1, rejected.map(r => r.reason).join(", "));

const meta = sent.find(f => f.t === "file-meta");
ok("adding a file sends file-meta", Boolean(meta),
   meta ? "" : "THE REGRESSION: nothing was announced to peers");

if (meta) {
  ok("announcement carries the name", meta.name === "screenshot.png", meta.name);
  ok("announcement carries the size", meta.size === 1024, String(meta.size));
  ok("announcement carries the type", meta.type === "image/png", meta.type);
  ok("announcement carries an id", Boolean(meta.id), meta.id);
  ok("announcement carries no bytes",
     !("blob" in meta) && JSON.stringify(meta).length < 2000,
     "only metadata may travel automatically");
  ok("announcement is a broadcast, not targeted", meta.to === undefined,
     "every device in the room should learn the file exists");
}

/* ---------- a late joiner gets told about what is already here ---------- */
sent.length = 0;
const reannounced = transfer.announceAll();
ok("announceAll re-announces held files", reannounced === 1, `${reannounced} sent`);
ok("re-announcement is also file-meta",
   sent.length === 1 && sent[0].t === "file-meta");

/* ---------- the thumbnail setting is honoured ---------- */
sent.length = 0;
state.setSetting("thumbs", false);
const entry = registry.all()[0];
entry.thumb = "data:image/jpeg;base64,AAAA";     // pretend one was generated
transfer.announce(entry);
ok("thumbs=off suppresses the preview", sent[0]?.thumb === null,
   "a 160px preview of a screenshot can be legible, and it travels unrequested (OI-15)");

state.setSetting("thumbs", true);
sent.length = 0;
transfer.announce(entry);
ok("thumbs=on includes the preview", typeof sent[0]?.thumb === "string");

/* ---------- remote files are never announced by us ---------- */
sent.length = 0;
registry.addRemote({ id: "remote1", name: "theirs.pdf", size: 10,
                     type: "application/pdf", thumb: null, originId: "peerX" });
const theirs = registry.get("remote1");
transfer.announce(theirs);
ok("we do not re-announce someone else's file", sent.length === 0,
   "otherwise two peers would echo each other's announcements forever");

/* ---------- the size cap still holds ---------- */
sent.length = 0;
const huge = new File([new Uint8Array(FILES.MAX_BYTES + 1)], "big.bin");
const res = await registry.add([huge], { makeThumbs: false });
ok("oversize file rejected", res.added === 0 && res.rejected.length === 1,
   res.rejected[0]?.reason ?? "");
ok("and nothing was announced for it", sent.length === 0);

console.log("\n" + "=".repeat(58));
console.log(`FILES: ${pass}/${pass + fail} passed`);
console.log("=".repeat(58));
process.exit(fail ? 1 : 0);
