/**
 * Characters that let a string lie about what it is.
 *
 * One definition, because there are three places that need it and a security
 * character class that drifts between them is worse than one that is wrong
 * everywhere — at least the second is visible. The callers:
 *
 *   clipboard/guard.js   an arriving clip, before it reaches the OS clipboard
 *   files/registry.js    a peer-supplied filename, before it reaches a download
 *   cli/                 clip text, before it reaches a terminal (which adds
 *                        escape SEQUENCES on top of these single characters)
 *
 * `clipboard/` and `files/` are peers and may not import each other, and `cli/`
 * ships only `src/core/` and `src/transport/`. Rank 0 is the one place all
 * three can reach.
 *
 * The ranges, and why each is here:
 *
 *   U+0000-0008, U+000B-001F, U+007F-009F   C0/C1 controls. A bare CR (U+000D)
 *       returns a terminal's cursor to the start of the line, so what is
 *       rendered is the tail of a string written over the head of it. NUL
 *       truncates in anything that reaches C.
 *   U+200E/200F, U+202A-202E, U+2066-2069   bidi marks, overrides and isolates.
 *       These reverse rendered order: `invoice[RLO]txt.exe` displays as
 *       `invoiceexe.txt`, and the extension you see is not the one that runs.
 *
 * TAB (U+0009) and LF (U+000A) fall inside those ranges and are deliberately
 * excluded: both are ordinary text and neither hides anything. A filename has no
 * business containing either, but that is a filename rule, not a text rule —
 * files/registry.js applies it.
 *
 * Written as escapes, never as literals. A literal control character in source
 * is invisible in a diff, which is the property being defended against.
 */
const INVISIBLE = "[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F"
                + "\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]";

/** The class itself, for a caller building a larger pattern around it. */
export const INVISIBLE_SOURCE = INVISIBLE;

// Two objects, and the second has no /g on purpose: test() on a global regex
// advances lastIndex, so it answers differently every other call. That bug is
// silent, intermittent, and exactly the kind a security check must not have.
const STRIP = new RegExp(INVISIBLE, "g");
const DETECT = new RegExp(INVISIBLE);

export const stripInvisible = s =>
  (typeof s === "string" ? s.replace(STRIP, "") : "");

export const hasInvisible = s =>
  typeof s === "string" && DETECT.test(s);
