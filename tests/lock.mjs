/**
 * Locked sessions: the derivation, the fragment marker, and the properties the
 * feature actually claims.
 *
 * No relay and no network — everything here is a pure function, which is why it
 * runs first in the suite. The parts that need a real room are in e2e.mjs.
 *
 * Usage:  node tests/lock.mjs
 */

import * as cryptoBox from "../src/core/crypto.js";
import * as keys from "../src/core/keys.js";
import { LOCK, CRYPTO } from "../src/core/config.js";

let pass = 0, fail = 0;

function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  return ok;
}

const KEY = "D75LV";
const PIN = "correct horse";

/** Did decrypting throw? The only honest way to ask an AEAD a yes/no question. */
async function opens(aesKey, box) {
  try { await cryptoBox.decrypt(aesKey, box.payload, box.iv); return true; }
  catch { return false; }
}

console.log("\nLocked sessions\n");

/* ---------------------------------------------------------------- derivation */

const a = await cryptoBox.deriveLocked(KEY, PIN);
const b = await cryptoBox.deriveLocked(KEY, PIN);

check("the same key and PIN derive the same room",
  a.roomHash === b.roomHash, a.roomHash);
check("the room hash is 32 hex characters, like the open one",
  /^[0-9a-f]{32}$/.test(a.roomHash));
check("the room hash leaks neither the key nor the PIN",
  !a.roomHash.includes(KEY.toLowerCase()) && !a.roomHash.includes("correct"));

const wrongPin = await cryptoBox.deriveLocked(KEY, "wrong horse");
const otherKey = await cryptoBox.deriveLocked("ZZZZZZ", PIN);
const unlocked = await cryptoBox.roomHash(KEY);

// The load-bearing claim. Someone holding the link but not the PIN cannot even
// address the room, which is what makes this admission control rather than
// merely encryption.
check("a wrong PIN addresses a different room",
  wrongPin.roomHash !== a.roomHash);
check("a different key addresses a different room",
  otherKey.roomHash !== a.roomHash);
check("locked and unlocked are different rooms for one key",
  a.roomHash !== unlocked, `${a.roomHash} vs ${unlocked}`);

// One PBKDF2 run, three outputs, and they must be independent — reusing one
// value in two roles would mean handing the relay something that unlocks data.
check("the room hash and the auth token are not the same value",
  a.roomHash !== a.authToken);
check("neither one is a prefix of the stretched secret",
  !a.prk.startsWith(a.roomHash) && !a.prk.startsWith(a.authToken));

/* ------------------------------------------------------------------ contents */

const sealed = await cryptoBox.encrypt(a.aesKey, "sk-live-do-not-share");

check("the right PIN opens the message", await opens(a.aesKey, sealed));
check("the wrong PIN does not", !await opens(wrongPin.aesKey, sealed));
check("the unlocked derivation for the same key does not",
  !await opens(await cryptoBox.deriveKey(KEY), sealed));

/* ------------------------------------------------- PIN normalisation traps */

// NFC. Two byte strings, one character. Without normalisation these derive
// different rooms and NOTHING reports it — the second device is simply alone.
const composed   = "cafépin";       // U+00E9, one code point
const decomposed = "cafépin";      // "e" + U+0301, two code points
check("composed and decomposed PINs are the same PIN",
  (await cryptoBox.deriveLocked(KEY, composed)).roomHash
    === (await cryptoBox.deriveLocked(KEY, decomposed)).roomHash);

check("a pasted trailing newline is trimmed",
  (await cryptoBox.deriveLocked(KEY, "pass123\n")).roomHash
    === (await cryptoBox.deriveLocked(KEY, "pass123")).roomHash);

// The opposite of how a key is treated, and deliberately so: a PIN is typed
// from memory, not read aloud off a screen, so case is entropy worth keeping.
check("case is significant, unlike in a key",
  (await cryptoBox.deriveLocked(KEY, "passphrase")).roomHash
    !== (await cryptoBox.deriveLocked(KEY, "PASSPHRASE")).roomHash);

check("interior spaces are preserved",
  (await cryptoBox.deriveLocked(KEY, "two words")).roomHash
    !== (await cryptoBox.deriveLocked(KEY, "twowords")).roomHash);

check("punctuation is preserved",
  (await cryptoBox.deriveLocked(KEY, "p@ssw0rd!")).roomHash
    !== (await cryptoBox.deriveLocked(KEY, "pssw0rd")).roomHash);

/* --------------------------------------------------------- the remembered prk */

const replay = await cryptoBox.deriveLockedFromPrk(a.prk);
check("a remembered unlock reproduces the room",
  replay.roomHash === a.roomHash && replay.authToken === a.authToken);
check("and reproduces a key that still opens the message",
  await opens(replay.aesKey, sealed));

/* ------------------------------------------------------------ the derived key
   cache

   The open-session cache is a single slot. If it ever keyed on the share key
   alone while a PIN was also in play, retyping a corrected PIN would hand back
   the key derived from the wrong one — silently, and forever. */

const openKey = await cryptoBox.deriveKey(KEY);
const openBox = await cryptoBox.encrypt(openKey, "hello");
cryptoBox.clearCache();
check("clearing the cache does not change what the key derives to",
  await opens(await cryptoBox.deriveKey(KEY), openBox));
check("a locked derivation does not poison the open cache",
  (await cryptoBox.deriveLocked(KEY, PIN)).roomHash === a.roomHash
    && await opens(await cryptoBox.deriveKey(KEY), openBox));

/* --------------------------------------------------------- the fragment marker

   This one encodes an ordering, not a value. normalise() strips everything
   outside [A-Z0-9], so parsing the marker AFTER it would turn a locked link
   into a valid unlocked one for a different key — silently downgrading a
   session the user was told was private. */

check("a marked fragment parses as locked",
  JSON.stringify(keys.parseFragment(`${LOCK.SIGIL}${KEY}`)) === JSON.stringify({ key: KEY, locked: true }));
check("a plain fragment parses as open",
  JSON.stringify(keys.parseFragment(KEY)) === JSON.stringify({ key: KEY, locked: false }));
check("the marker is read before the key is stripped",
  keys.parseFragment(`${LOCK.SIGIL}${KEY}`).key === KEY);
check("a hyphen is not a marker",
  keys.parseFragment("ABCDEF-L").locked === false
    && keys.parseFragment("ABCDEF-L").key === "ABCDEFL");
check("lowercase and whitespace still normalise",
  keys.parseFragment(` ${LOCK.SIGIL}d75lv `).key === "D75LV");

const round = keys.fragment(KEY, true);
check("fragment() and parseFragment() round-trip lockedness",
  keys.parseFragment(round).locked === true && keys.parseFragment(round).key === KEY);
check("an unmarked round-trip stays unlocked",
  keys.parseFragment(keys.fragment(KEY, false)).locked === false);

/* ------------------------------------------------------------------ entropy */

check("a 4-digit PIN is reported as the ~13 bits it is",
  Math.round(keys.pinEntropyBits("1234")) === 13, `${keys.pinEntropyBits("1234")}`);
check("entropy is counted from the alphabet used, not the widest one",
  keys.pinEntropyBits("123456") < keys.pinEntropyBits("a1B2c3"));
check("an empty PIN is zero bits", keys.pinEntropyBits("") === 0);

/* --------------------------------------------------------------- the beacon */

check("the beacon cannot be typed by a user",
  LOCK.BEACON.charCodeAt(0) === 0);
const beaconBox = await cryptoBox.encrypt(a.aesKey, LOCK.BEACON);
check("the beacon round-trips to exactly the sentinel",
  await cryptoBox.decrypt(a.aesKey, beaconBox.payload, beaconBox.iv) === LOCK.BEACON);
check("a peer without the PIN cannot read the beacon",
  !await opens(wrongPin.aesKey, beaconBox));

/* ------------------------------------------------ the open path is untouched

   A change to the unlocked derivation would strand every link in existence.
   These are golden values, rebaselined when the domain-separation strings were
   renamed to realtimeclipboard-*. If one fails, the wire format has changed. */

check("the unlocked room hash for D75LV is unchanged",
  unlocked === "e545a3e184158f9344abe7f3ded4b6e2", unlocked);
check("the unlocked salt and iteration count are unchanged",
  CRYPTO.SALT === "realtimeclipboard-v1" && CRYPTO.ITERATIONS === 250_000);

console.log(`\n${"=".repeat(58)}`);
console.log(`LOCK: ${pass}/${pass + fail} passed`);
console.log("=".repeat(58));
process.exit(fail ? 1 : 0);
