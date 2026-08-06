# Accessibility

An audit of the app (`app.html` and `src/`) against **WCAG 2.2 level AA**, what
was fixed, and what is left.

This is not a checklist pass. It covers the four things that actually decide
whether this app works for someone who is not using a mouse and a pair of good
eyes: keyboard operability, focus management, contrast, and what the screen
reader is told.

---

## 1. Verdict

**No. Hopboard is not usable without a mouse today** — and the reason is a
short, fixable list, not a rewrite.

The bones are unusually good for a hand-rolled app. Every settings control is a
real `<button role="switch">` or a `<select>`. The mode switch is a proper
radiogroup with arrow keys. The QR dialog has a focus trap. `esc()` discipline
is absolute. Someone has clearly thought about this.

But four things are load-bearing and broken:

| | |
|---|---|
| **You cannot open a file.** | The tiles are `<div>`s with a click handler. Saving a received file and requesting a remote one are mouse-only. |
| **You cannot deny a file request.** | The approval dialog re-renders every 500 ms and force-focuses "Send it" each time. Focus is yanked off "Deny" within half a second of reaching it. This one is worse than inaccessible — it is a security control that only offers the unsafe answer. |
| **You cannot resize the panes.** | `#resizePanes` takes focus and then ignores every key. Its sibling splitter handles arrows; this one was missed. |
| **The app's central event is silent.** | A clip arriving from a peer changes a `<textarea>`'s value. Nothing announces it. |

Everything in §4 that is marked Blocker is on that list. With those four fixed,
the app is genuinely operable end to end without a pointer.

---

## 2. What was fixed

Files owned by this change: `src/ui/{qr,historyPanel,cursors,toast,banners,panes}.js`,
`src/styles/{base,components}.css`.

### `src/ui/panes.js` — pane headers are real buttons now

A `.paneh` was a clickable `<div>`: unreachable by keyboard, announced as
nothing (2.1.1, 4.1.2). The obvious repair — `role="button"` + `tabindex` on the
header — is wrong here, because a header also carries its own action buttons
(add file, clear files, clear history), and a button containing a button is
invalid and unpredictable in assistive tech.

So `upgrade()` wraps **only** the chevron and the label in a genuine `<button>`
at runtime, leaves the action buttons as siblings, and wires
`aria-expanded` / `aria-controls`. Enter and Space then come from the platform —
there is no key handling in the file, which is the point. A `MutationObserver`
scoped to added nodes keeps the module's original promise that a pane mounted
late is not missed. The delegated click handler was adjusted so the disclosure
button's own click falls through to exactly one toggle, and the whole header row
stays clickable for the mouse.

`.panebtn` styling in `components.css` reproduces the header's font, casing and
spacing exactly; the flex behaviour matches the text node it replaced.

### `src/ui/qr.js` — trap, Escape, restore, and a mount collision

It already had a trap, Escape and restore. Four things were still wrong:

- **The trap leaked on the first Shift+Tab.** Focus started on the close button;
  `trapTab` only wrapped when `active === first || active === last`, so anything
  else fell through to the browser. Now anything outside the ring is pushed to an
  end of it.
- **Focus landed on Close.** The first thing announced was "Close, button" —
  title, warning and link all skipped, and the only thing offered was the exit.
  Focus now goes to the dialog container (`tabindex="-1"`), so the name and
  description are read first, and Tab reaches Close as the first stop.
- **The page behind stayed reachable.** `aria-modal` is advisory. `.vs` is now
  `inert` while the dialog is open, restored on close — and restored *before*
  focus is returned, because `focus()` inside an inert subtree fails silently.
- **The dialog could be deleted mid-use.** It mounted into `#mount-modals`,
  which `filesPanel.drawPrompts()` drives with `host.innerHTML = …` every 500 ms.
  A file request arriving while the QR was open destroyed it, leaving a
  document-level keydown listener bound to a detached node and focus on nothing.
  It now mounts to `document.body`. See finding **B2** for the proper fix.

Also: the QR image's `aria-label` was the entire share link, read out character
by character immediately before the same URL appeared verbatim below it.

### `src/ui/toast.js` — it did not reliably announce, and it spammed

`#toast` is `role="status" aria-live="polite"`, which makes this module the app's
only real announcement channel. The old six-line version failed both halves.

- **Repeated messages were silent.** A polite region announces on *change*.
  Writing the same string twice is not a change. Clearing the node on hide makes
  every appearance a real mutation.
- **Stale text lived forever.** `opacity:0` hides it from the eye, not from the
  accessibility tree. The region is emptied once the fade finishes.
- **Bursts were unreadable.** Dropping ten oversized files emits ten toasts in
  one tick (`filesPanel.intake()`). The node was overwritten ten times in a few
  milliseconds: the eye saw the last, the screen reader got fragments. Messages
  now queue with a minimum dwell (1100 ms), consecutive duplicates collapse, and
  a backlog deeper than three keeps the newest.

Verified in jsdom: a burst of five yields three sequential, fully-announced
messages, and the region ends empty.

### `src/ui/cursors.js` — reduced motion

`styles/cursors.css` already dropped the 110 ms transform transition under
`prefers-reduced-motion`, and that stays the primary mechanism. The JS half adds
two things the sheet cannot:

- the one-frame deferral of `.live` is skipped (it exists only to suppress a
  slide-in there is no longer anything to slide);
- `transition-property` is set on the element itself, which holds during the
  window before the injected sheet applies and if it fails to load. Only the
  *property* is set — duration and easing stay in CSS, so the opacity fade that
  `cursors.css` deliberately keeps survives.

The query is live: turning the OS setting on mid-session updates cursors already
on screen.

### `src/ui/historyPanel.js` — a real bug, plus naming

- **Enter on the Copy button did two things.** The row is `role="button"` and
  contains a real `<button>`. `onListClick` stops propagation for the pointer;
  the keydown handler had no equivalent, so Enter on Copy both copied the clip
  *and* restored it into the editor — one keystroke, two effects, one of them
  destroying whatever was being typed. Fixed.
- Rows announced as `RECV <preview> 14:32 Copy this clip button` — a code nobody
  says out loud, and the row's own action never named. Rows now carry an explicit
  `aria-label` ("Load into the editor — clip received at 14:32: …"), each copy
  button is named with its clip, and the pill/time are `aria-hidden` since the
  label already carries them.
- The header uses `panes.upgrade()`, so it gets the same disclosure semantics
  without restating them, and still owns its own toggle (deliberate — see the
  comment in the file).
- The bare count now reads "3 clips".

### `src/ui/banners.js` — announcements, and a timed dismissal

- Banners appear unbidden and announced nothing. Each is now a live region:
  `role="status"` for info/warn, `role="alert"` for the split-brain warning,
  which means sync has silently stopped and reads as lag until someone is told.
- The text is filled **one frame after** the region is in the tree. A live region
  that arrives with its content already inside it is announced inconsistently;
  populating it once it is being watched is the behaviour every screen reader
  agrees on.
- Three simultaneous banners had three buttons called "Dismiss". Now
  "Dismiss: Allow clipboard access".
- **2.2.1 Timing Adjustable:** the peer-joined banner auto-dismissed after 15 s,
  taking its "New key" button with it. Fifteen seconds is fine if you saw it
  arrive and nowhere near enough if a screen reader is two sentences behind. The
  clock now stops while the banner holds focus or the pointer, and restarts when
  attention leaves.

### `src/styles/base.css`, `src/styles/components.css`

- **Focus ring**: 2 px, drawn inside the element's box so it always sits on that
  element's own background — which is what makes the colour a per-surface
  decision rather than a guess. `--focus` is kept where it works (`--editor`,
  `--side`, `--tab-off`, `--hover`) and swapped for `--bright` on the four
  surfaces where it does not (`--title`, `--input`, `--bd2`, `--blue`). Measured
  numbers are in the comments and in §3.
- **Switch knob**: white on the light theme's `--bd2` track is 1.57:1 — the off
  state had no readable indicator, and the two track colours are only 2.87:1
  apart, so nothing else carried it either. Two knob colours now, one per track.
  The dark theme is visually unchanged.
- **Scrollbar thumb**: VS Code's own `rgba(121,121,121,.4)` is 1.61:1 against the
  light sidebar. Re-tokenised to `--text` at 55%, which is 3.15–4.11 everywhere.
- **`.ibtn:hover`**: was a white wash, a 1.04:1 change on the light theme's app
  header — no hover feedback at all for half the users. Now tinted with `--text`.
- **`.pill.p2p` / `.pill.relay`**: the tinted form is 3.45–3.56:1 in light at
  9.5 px. Now solid, matching the `.badge` treatment already in `files.css`.
- **Reduced motion**: a surgical block rather than the blanket
  `*{transition:none!important}` — movement goes, fades and colour changes stay,
  because `cursors.css` depends on a cross-fade to keep a peer's departure from
  being a jump cut. Covers the toast's 8 px rise, the switch knob, the chevron
  rotation and the transfer bar. `qr.css` and `cursors.css` already carry their
  own blocks and are correct.
- `.vh` (visually hidden) utility, used by the fixes above and by C3/C5 below.

### Verification

- `node --check` on all six JS files: clean.
- `node tests/static-check.mjs`: **11/11**.
- `node tests/files.mjs`: 39/39.
- A jsdom harness exercising focus trap, Escape, focus restore, inert, pane
  toggling, toast queueing, the history keydown bug and reduced motion:
  **65/65**.

---

## 3. Contrast — measured

Relative luminance per WCAG 2.x, with alpha compositing so `color-mix(… n%,
transparent)` and `opacity` are evaluated against what is actually painted
behind them. Both themes. Thresholds: 4.5:1 normal text, 3:1 large text
(≥18.66 px bold / ≥24 px) and non-text.

### Failures, worst first

| Ratio | Need | Theme | What | Where |
|---|---|---|---|---|
| **1.07** | 3 | both | focus ring `--focus` on `--blue` — no ring at all on the status bar, primary buttons, the active Live chip | *fixed* |
| **1.51 / 1.57** | 3 | dark / light | ad placeholder box border `--bd2` on `--editor` | `styles/ads.css` `.adslot-box` |
| **1.57** | 3 | light | switch knob (white) on the `--bd2` track — the off state's only indicator | *fixed* |
| **1.61 / 1.66** | 3 | light | scrollbar thumb `rgba(121,121,121,.4)` on `--side` / `--editor` | *fixed* |
| **1.94 / 1.98** | 4.5 | dark / light | editor hints, `--dim` at `opacity:.45` | `styles/hints.css:16` |
| **2.31 / 2.38** | 4.5 | dark / light | `.adslot-ph`, `--dim` at `opacity:.55`, 11 px | `styles/ads.css` |
| **2.57 / 2.71** | 4.5 | dark / light | `.adslot-note`, `--dim` at `opacity:.62`, 10.5 px | `styles/ads.css` |
| **2.62** | 3 | dark | focus ring `--focus` on `--title` / `--input` / `--bd2` | *fixed* |
| **2.86 / 2.87** | 4.5 | dark / light | `.pill.sent` — `--focus` on a 22% tint of itself | `styles/history.css:41` |
| **2.90 / 3.19** | 4.5 | dark / light | `.adslot-tag`, `--dim` at `opacity:.7`, 10 px | `styles/ads.css` |
| **2.90 / 3.19** | 4.5 | dark / light | `#editor::placeholder`, `--dim` at `opacity:.7` (dead today — no placeholder is set) | `styles/editor.css:36` |
| **2.99** | 4.5 | dark | breadcrumb `--dim` on `--title` | `styles/appbar.css:27` + `tokens.css` |
| **3.23** | 4.5 | light | `.badge.remote` — `#04231a` on `--ok` | `styles/files.css:99` |
| **3.25** | 4.5 | light | key warning, `--warn` at `opacity:.85` on `--tab-off` | `styles/sidebar.css:36` |
| **3.26** | 4.5 | both | **`--on-fixed-bad` on `--status`** — the over-limit character counter | `tokens.css:38` |
| **3.41** | 4.5 | light | `.badge.busy` / `.badge.relay` — `#241d00` on `--warn` | `styles/files.css:101` |
| **3.42** | 4.5 | dark | `.badge.want` — `--dim` on a 12% `--text` tint | `styles/files.css:116` |
| **3.45 / 3.56** | 4.5 | light | `.pill.relay` / `.pill.p2p` on 20% tints | *fixed* |
| **3.48 / 3.68** | 4.5 | light | `.pill.recv`, `.badge.err` on their own tints | `history.css:45`, `files.css:109` |
| **3.58** | 4.5 | dark | `.badge.err` — `--bad` on a 22% tint of itself | `styles/files.css:109` |
| **3.70** | 4.5 | dark | peer cursor label — `--editor` text on the `--blue` palette entry | `styles/cursors.css:106` |
| **3.86 / 4.02** | 4.5 | dark / light | `.alert` and `.qrfail` — `--bad` on a 10% tint of itself | `sidebar.css:125`, `qr.css:106` |
| **3.98** | 4.5 | light | `.qrnote` and `.warn` — `--warn` on a 9% tint of itself | `qr.css:96`, `sidebar.css:115` |
| **4.15** | 4.5 | dark | **`--dim` on `--side`** — every settings sublabel, group heading, pane count, empty state, drop-zone body, history timestamp, approval countdown | `tokens.css:24` |
| **4.17** | 4.5 | dark | breadcrumb key — `--str` on `--title` | `styles/appbar.css:38` |

### Passing, but worth knowing

| Ratio | What |
|---|---|
| **4.51** | `--on-fixed` on `--status` — the status bar. Passes AA for normal text **by 0.01**. Any darkening of the text, any lightening of the bar, or one 14 px→12 px change and it fails. It is the single most fragile number in the theme. |
| 4.52 | `--dim` on `--editor` (gutter, tile size, inactive mode button) — 0.02 of margin. |
| 4.56 | `--dim` on `--title` in *light* — 0.06 of margin. |
| 4.57 | `.pill.relay` on its tint in *dark*. |
| 4.67 | `.tile .sz.bad` — `--bad` on `--editor` at 9.5 px. |

### The two token changes worth making

`tokens.css` is not owned by this change, so nothing here was edited. Both of
these are one-line replacements.

**1. `--dim` in the dark theme: `#858585` → `#a8a8a8`.**

`--dim` carries every secondary label in the app and fails on the dark theme's
two main surfaces. Measured for the candidates:

| value | on `--side` | on `--editor` | on `--tab-off` | on `--title` | on `--hover` |
|---|---|---|---|---|---|
| `#858585` (current) | 4.15 ✗ | 4.52 | 3.73 ✗ | 2.99 ✗ | 3.76 ✗ |
| `#9d9d9d` | 5.65 | 6.15 | 5.08 | 4.07 ✗ | 5.12 |
| **`#a8a8a8`** | **6.44** | **7.01** | **5.79** | **4.64** | **5.84** |

`#a8a8a8` is the first value that clears 4.5 on *every* surface `--dim` is used
on, including the app header. The light theme's `#616161` already passes
everywhere (worst case 4.56 on `--title`) and needs no change.

**2. `--status` in both themes: `#007acc` → `#005a9e`.**

This fixes the 0.01-margin status bar and the over-limit counter in one move:

| `--status` | white text | `--on-fixed-bad` | ok dot | wait dot |
|---|---|---|---|---|
| `#007acc` (current) | 4.51 | 3.26 ✗ | 2.21 ✗ | 1.95 ✗ |
| **`#005a9e`** | **7.10** | **5.14** | **3.49** | **3.08** |

`--blue` (buttons, accents, the active Live chip) stays `#007acc` — the two are
already separate tokens, which is why this is a one-liner.
`<meta name="theme-color">` in `app.html:7` should follow.

Note the dots on the status bar fail 3:1 against the current blue in every
state. That is acceptable as it stands, because each dot sits immediately next
to the same information as text ("Connected", "Offline") — SC 1.4.11 does not
apply to a redundant indicator. `#005a9e` fixes two of the three anyway; the
`--bad` dot stays at 1.99:1 and would need `--on-fixed` as a ring rather than a
colour change.

### Other contrast fixes, per file

| File | Fix |
|---|---|
| `styles/hints.css:16` | Drop `opacity:.45` from `.hints` (keep `.hints.gone{opacity:0}` for the fade). With `--dim` at `#a8a8a8` that is 7.01 dark / 6.19 light. At `.8` it is only 3.90 in light — the opacity has to go, not shrink. |
| `styles/ads.css` | Same: remove the `.7` / `.55` / `.62` opacities on `.adslot-tag`, `.adslot-ph`, `.adslot-note`. Even at full opacity `--dim` is only 4.52 dark today, so this depends on the `--dim` change above. `.adslot-box`'s dashed border needs `color-mix(in srgb, var(--text) 45%, transparent)` or similar to reach 3:1. |
| `styles/sidebar.css:36` | Drop `opacity:.85` from `.keyhead-warn`. That gets light to 4.16 — still short, so it also needs light `--warn` darkened from `#8a6d00` to `#7a6000` (4.80 on its own 9% tint, 5.41 on `--side`, and 6.00 with white on it). |
| `styles/sidebar.css:115,125`, `styles/qr.css:96,106` | The "colour on a tint of itself" pattern is 3.86–4.02 for `--bad` and 3.98 for light `--warn`. Either darken/brighten the tokens (light `--bad` `#cd3131`→`#c02020` gives 4.65; dark `--bad` `#f14c4c`→`#ff6b6b` gives 4.78) or drop the tint to ~5%. |
| `styles/history.css:41,45` | `.pill.sent` is 2.86 — the worst text failure in the app. Match what `components.css` now does for `.pill.p2p`: solid background, `color:var(--editor)`. `--focus` as a solid gives 4.51/4.51; `--ok` gives 8.18/5.16. |
| `styles/files.css:99–120` | `.badge.remote` and `.badge.busy` use fixed dark foregrounds that only work against the dark theme's brighter `--ok`/`--warn`. Replace both with `color:var(--editor)` — the same relationship the peer-cursor labels use — which gives 8.18/5.16 and 7.22/4.92. `.badge.err` and `.badge.want` should go solid the same way. |
| `styles/cursors.css:106` | `.hb-cursor.c0 { --peer:var(--blue) }` puts `--editor` text on `--blue`: 3.70 in dark. Add `.hb-cursor.c0 .hb-cursor-name { color:var(--on-fixed); }` (4.51 both themes) rather than changing the palette entry. |
| `styles/appbar.css:27,38` | The breadcrumb is `--dim` (2.99) and its key is `--str` (4.17) on `--title` in dark. The `--dim` change fixes the first (4.64). For the second, either accept it as decorative context or darken dark `--title` to `#333333`, which takes `--str` to 4.78. |

---

## 4. Findings outside the files this change owns

Severity: **Blocker** = a task cannot be completed. **High** = completable but
badly degraded. **Medium** = a real barrier with a workaround. **Low** = polish.

### B1 · The file-approval dialog steals focus twice a second — **Blocker**

**Where:** `src/ui/filesPanel.js:331` (`setInterval(sweep, 500)`) →
`filesPanel.js:345–354` (`sweep()` calls `drawPrompts()` unconditionally) →
`filesPanel.js:356–391` (`drawPrompts()` replaces `host.innerHTML`, then line
**383** calls `host.querySelector("[data-allow]")?.focus?.()`).

**Problem:** every 500 ms the dialog's DOM is destroyed and rebuilt, and focus is
forced back onto "Send it". Tab to "Deny" and focus is gone within half a second.
Screen readers re-announce the whole dialog twice a second. This is the app's
one security decision point — the only thing between "someone has the key" and
"someone has your files" (`filesPanel.js:314–316`) — and the keyboard path leads
only to the unsafe answer.

**Fix:** separate the structural render from the countdown tick.

```js
// drawPrompts() — structure only. Called from ask() and settle().
// Track which tokens are already on screen; focus only a NEW card.
const drawn = new Set();

function drawPrompts() {
  const host = $("mount-modals");
  if (!host) return;
  if (!prompts.size) {
    host.innerHTML = "";
    drawn.clear();
    document.removeEventListener("keydown", onKey);
    return;
  }
  const fresh = [...prompts.keys()].filter(t => !drawn.has(t));
  host.innerHTML = `…`;                       // as now
  for (const t of prompts.keys()) drawn.add(t);
  if (fresh.length) {
    host.querySelector(`[data-token="${fresh[0]}"] [data-allow]`)?.focus?.();
  }
  host.onclick = …;                           // as now
  document.addEventListener("keydown", onKey);
}

// sweep() — text only, never innerHTML.
function sweep() {
  const now = Date.now();
  for (const [token, p] of [...prompts]) {
    if (p.expires <= now) {
      emit(EV.TOAST, `Request for ${p.req.name} expired — nobody answered`);
      settle(token, false);                   // this re-renders structurally
      continue;
    }
    const cd = document.querySelector(`[data-token="${token}"] .cd`);
    if (cd) cd.textContent = `${Math.max(0, Math.ceil((p.expires - now) / 1000))}s`;
  }
}
```

Also give the countdown `aria-hidden="true"` — a number ticking in a dialog is
not something a screen reader should read once a second. The deadline belongs in
the dialog's static text instead ("expires in about 30 seconds").

### B2 · `#mount-modals` has three owners and one of them wipes it — **High**

**Where:** `src/ui/filesPanel.js:361` and `:366` (`host.innerHTML = …`).
`filesPanel.js:400–411` already documents the hazard and routes `confirmAction()`
around it to `document.body`; `src/ui/qr.js` now does the same for the same
reason. That is two workarounds for one design problem.

**Fix:** give each consumer its own child, and never write the container's
`innerHTML`:

```html
<!-- app.html:249 -->
<div id="mount-modals"><div id="modal-files"></div><div id="modal-qr"></div></div>
```

then `drawPrompts()` writes to `$("modal-files")`, `confirmAction()` appends to
`$("modal-files")`, and `qr.js` appends to `$("modal-qr")`. Once that exists, the
`document.body` fallbacks in `qr.js` and `confirmAction()` can be reverted.

### B3 · File tiles are not reachable — **Blocker**

**Where:** `src/ui/filesPanel.js:212–226` renders `<div class="tile" data-id=…>`;
`filesPanel.js:59–84` binds `click` only.

**Problem:** the tile's primary action — save a received file, or request a
remote one — has no keyboard path at all (2.1.1, 4.1.2). The `.tcancel` and
`.tremove` buttons inside it *are* reachable, so a keyboard user can delete a
file but not open it.

**Fix:** add `role="button" tabindex="0"` and an `aria-label` to the tile, plus a
keydown handler on `#grid` that mirrors the click handler — and, critically, the
same nested-button guard `historyPanel.js` now has, or Enter on Remove will also
trigger the tile:

```js
bind("grid", "keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (e.target.closest("button")) return;      // Remove / Cancel own their keys
  const tile = e.target.closest(".tile");
  if (!tile) return;
  e.preventDefault();
  tile.click();                                // one code path, not two
});
```

The `aria-label` should say what activating it does, since the visible text is
just a filename: `` `${f.name}, ${formatSize(f.size)} — ${f.blob ? "save to disk" : "request from the peer that has it"}` ``.

### B4 · The horizontal splitter takes focus and ignores every key — **Blocker**

**Where:** `app.html:150–151` gives `#resizePanes` `tabindex="0"` and
`role="separator"`. `src/ui/resizer.js:57–75` (`horizontal()`) has no keydown
handler; its sibling `vertical()` does, at `resizer.js:44–53`.

**Problem:** a focus stop that does nothing (2.1.1), and a drag-only operation
with no single-pointer alternative (**2.5.7 Dragging Movements**, new in WCAG
2.2). The vertical splitter is compliant; this one was simply missed.

**Fix:** mirror `vertical()`'s handler inside `horizontal()`:

```js
handle.addEventListener("keydown", e => {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  const step = e.shiftKey ? 40 : 12;
  const available = $("side").getBoundingClientRect().height;
  const height = clamp(files.getBoundingClientRect().height + (e.key === "ArrowDown" ? step : -step),
                       FILES_PANE.min, available * FILES_PANE.max);
  files.style.flex = "none";
  files.style.height = `${height}px`;
  write(FILES_PANE.key, Math.round(height));
});
```

### B5 · Nothing announces an incoming clip — **High**

**Where:** `src/main.js` `on(EV.TEXT_RECEIVED, …)` → `src/ui/editor.js:38`
(`setText`). A `<textarea>`'s `value` changing is not announced by anything.

**Problem:** the app's central event is silent unless the editor happens to be
dirty, in which case `banners.js` now announces the "New clip received" banner.

**Fix:** a dedicated announcer, and a deliberately quiet one. Add to `app.html`,
just before `#toast`:

```html
<p id="srAnnounce" class="vh" role="status" aria-live="polite" aria-atomic="true"></p>
```

and in `src/ui/statusbar.js` (or a 15-line `src/ui/announce.js`):

```js
let lastAnnounce = 0;
on(EV.TEXT_RECEIVED, ({ text }) => {
  const now = Date.now();
  if (now - lastAnnounce < 2000) return;        // Live mode polls once a second
  lastAnnounce = now;
  $("srAnnounce").textContent = `Clip received, ${text.length} characters`;
});
```

**Do not put the clip text in it.** In Live mode with a 1 s poll on the far side,
that is a firehose that reads someone's passwords aloud. The count is enough to
know something arrived; the editor is right there to read.

### B6 · The status bar: silent now, a firehose if fixed naively — **High**

**Where:** `app.html:224–243`.

**Problem:** no live region anywhere, so connection loss, reconnection, peer
count and transfer path are never announced (**4.1.3 Status Messages**). But
`#sbLnCol` and `#sbChars` are rewritten on **every keystroke**
(`src/ui/editor.js:87–95`), and `#sbP2P` on every progress tick
(`src/ui/statusbar.js:54–57`). Putting `aria-live` on `.statusbar` would make the
app unusable with a screen reader on.

**Fix — per item, not per bar:**

| Line | Item | Do |
|---|---|---|
| 229 | `#sbConn` | `role="status" aria-live="polite" aria-atomic="true"` — connection state is exactly what a status message is for. |
| 230 | `#sbPeers` | Same. Peer changes are rare and security-relevant. |
| 231 | `#sbMode` | Leave silent — `syncMode.js:72–76` already toasts the change. |
| 235 | `#sbCursor` | Leave silent — it is a standing indicator, not an event. |
| 236 | `#sbP2P` | Leave silent — per-tick progress. |
| 238 | `#sbTier` | Leave silent. |
| 239 | `#sbLnCol` | Leave silent, and add `aria-hidden="true"` — "Ln 4, Col 12" in browse mode is noise the textarea already conveys. |
| 240 | `#sbChars` | Leave silent. The one moment worth announcing is crossing the limit: `editor.js:91` toggles `.over`; emit a one-shot toast there instead. |

### B7 · `#sbKey` is a clickable `<div>` — **Blocker**

**Where:** `app.html:225–228`, handler at `src/ui/sessionPanel.js:15`.

**Problem:** not focusable, no role, and `title` on a generic `<div>` is not an
accessible name. "Copy the share link" — arguably the app's most-used action —
has no keyboard path from the status bar. (`#bLink` at `app.html:114` is a
reachable duplicate, so this is degradation rather than a dead end, but the
status-bar affordance advertises itself and then cannot be used.)

**Fix:** `<button type="button" class="sitem" id="sbKey" aria-label="Copy the share link">`
plus, in `styles/statusbar.css`, `.statusbar button { font:inherit; color:inherit; background:none; border:0; }`.
The focus ring for it is already in `components.css` (`.statusbar :focus-visible`).

### B8 · `#drop` is a clickable `<div>` — **High**

**Where:** `app.html:138–140`, handler at `src/ui/filesPanel.js:49`.

**Problem:** the visible primary "add files" affordance is unreachable. `#bAdd`
(`app.html:133`) is a reachable duplicate.

**Fix:** `<button type="button" class="drop" id="drop">`. It is already
`text-align:center` and full-width; `styles/files.css:3–12` needs
`font:inherit; color:var(--dim); width:100%;` added and nothing removed. Drag
and drop stays as it is — a `<button>` fires the same events.

### B9 · The approval and confirmation dialogs are not trapped — **Medium**

**Where:** `src/ui/filesPanel.js:356–391` (approval) and `:415–458` (confirm).

**Problem:** both are `role="dialog" aria-modal="true"`, both focus something
sensible, both handle Escape — and Tab walks straight out of both into the page
behind.

**Fix:** lift `trapTab()` and `setShellInert()` from `src/ui/qr.js`; they were
written with no QR-specific state for this reason. `confirmAction()` also needs
focus restore: capture `document.activeElement` before `appendChild` (line 453)
and call `restore.focus?.()` in `closeConfirm()` after `el.remove()`.

### B10 · Focusable separators carry no value — **Medium**

**Where:** `app.html:100–101` and `:150–151`.

**Problem:** ARIA requires a focusable `separator` (a window splitter) to expose
`aria-valuenow`, `aria-valuemin` and `aria-valuemax`. Neither has them, so a
screen reader announces "Resize sidebar, splitter" with no position and no sense
of whether a key press did anything.

**Fix:** set them in `resizer.js` wherever the size is written — in `move`, in
the keydown handler and in `restore()`:

```js
const setValue = (handle, value, min, max) => {
  handle.setAttribute("aria-valuenow", Math.round(value));
  handle.setAttribute("aria-valuemin", Math.round(min));
  handle.setAttribute("aria-valuemax", Math.round(max));
};
```

### B11 · The mode switch's arrow keys flip rather than move — **Medium**

**Where:** `src/ui/syncMode.js:52–57`.

**Problem:** both ArrowLeft and ArrowRight run the same "toggle to the other
one" branch. In a two-option radiogroup that happens to look right, but it is not
the pattern — Left/Up move to the previous option, Right/Down to the next, and
Home/End to first/last. It also breaks the moment a third mode is added. And
because `paint()` (`syncMode.js:79–85`) uses a roving `tabIndex` without moving
focus, focus is left on an element that has just become `tabindex="-1"`.

**Fix:** select by direction, add ArrowUp/ArrowDown/Home/End, and move focus to
the newly-checked button at the end of `set()`:

```js
document.querySelector(".modebtn.on")?.focus();
```

(guarded so it only runs when the change came from the keyboard).

### B12 · `#editor` has no focus indicator — **Medium**

**Where:** `src/styles/editor.css:21–34` — `outline:none` on `#editor`.

**Problem:** the caret is the only indication the textarea has focus, and it is
invisible half of every blink cycle. The base rule in `base.css` cannot reach it.

**Fix:** replace `outline:none` with a scoped version:

```css
#editor:focus-visible { outline:1px solid var(--focus); outline-offset:-1px; }
```

`--focus` on `--editor` is 3.96 dark / 4.21 light.

### B13 · Bare numbers in pane headers — **Medium**

**Where:** `app.html:132` (`#fileN`) and `app.html:161` (`#peerN`).

**Problem:** announced as "Files & Images, 0" and "Devices, 1".

**Fix:** mirror what `historyPanel.js` now does — `.vh` is already defined in
`components.css`:

```html
<span class="soft"><span id="fileN">0</span><span class="vh"> files</span></span>
<span class="soft"><span id="peerN">1</span><span class="vh"> devices</span></span>
```

### B14 · Icon buttons are named by `title` alone — **Medium**

**Where:** `app.html:52, 55, 58, 61, 66, 111, 114, 117, 133`.

**Problem:** `title` is the last resort in the accessible-name computation. It
works in current browsers, but it doubles as the tooltip (so the two cannot be
worded independently) and is not exposed under every AT configuration. The inline
`<svg>` inside each button is also unlabelled, which some ATs announce as
"graphic".

**Fix:** add `aria-label` alongside each `title`, and `aria-hidden="true"` on
each `<svg>`. `filesPanel.js:190` and `:257` and `historyPanel.js` already do
exactly this — the markup is the odd one out.

### B15 · The share key is pronounced as a word — **Medium**

**Where:** `app.html:110` (`#key`), `app.html:45` (`#bcKey`), `app.html:227`
(`#sbKeyText`). Written by `src/ui/sessionPanel.js:69–71`.

**Problem:** the key exists to be read off one screen and typed on another. A
screen reader says "D75LV" as a word, which is unusable for that.

**Fix:** in `renderKey()`, keep the visible element and add a spoken one:

```js
function renderKey(key) {
  ["key", "bcKey", "sbKeyText"].forEach(id => { const el = $(id); if (el) el.textContent = key; });
  const spoken = $("keySpoken");
  if (spoken) spoken.textContent = `Share key: ${key.split("").join(", ")}`;
}
```

with `<div class="key" id="key" aria-hidden="true">—</div><span class="vh" id="keySpoken"></span>`
in `app.html:110`. Do the same for `#sbKeyText`, or mark it `aria-hidden` since
the sidebar already carries the spoken copy.

### B16 · Target size — **Low**

**WCAG 2.2 SC 2.5.8** wants 24×24 CSS px unless the spacing exception applies.

- `.ibtn` is 22×22 (`components.css`). Every place it is used has ≥24 px
  centre-to-centre spacing (`.tabacts{gap:3px}` → 25 px; `.keyhead-row{gap:5px}`
  → 27 px; `.paneh{gap:5px}` → 27 px), so the exception holds. It holds by 1 px.
  Going to 24×24 would remove the argument entirely.
- `.tile .tcancel` is 16×16 (`styles/files.css:83`) and `.tile .tremove` is 17×17
  (`files.css:110`), both inside a ~92 px tile that is itself a target. The
  spacing exception does not save overlapping targets. **This fails.** Give both
  a 24×24 hit area and keep the 11–12 px icon inside it.

### B17 · Landmarks — **Low**

- `app.html:104` `<aside class="side" id="side">` has no accessible name, and
  `src/ui/ads.js` adds a second `<aside aria-label="Advertisement">`. Two
  complementary landmarks, one unnamed. Add `aria-label="Session"` to the former.
- `app.html:224` the status bar is a plain `<div>`. `role="contentinfo"` or
  `role="status"`-per-item (B6) would make it findable.
- No skip link. `<a class="skip vh" href="#editor">Skip to the editor</a>` as the
  first child of `<body>`, with `.skip:focus-visible { position:static; width:auto;
  height:auto; clip-path:none; }` — five lines, and the appbar is only five tab
  stops, so this is genuinely optional.

### B18 · Focus can be obscured by the toast — **Low**

**Where:** `styles/components.css` `.toast { bottom:34px; right:14px; z-index:50 }`.

**WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum)** requires that a focused
element is not *entirely* hidden by author content. The toast is
`pointer-events:none` but it is opaque, and "Leave session" (`app.html:216`) sits
in the bottom-right of the sidebar. On a short viewport a toast can cover it
completely while it holds focus. Low frequency; worth knowing. The cheapest fix
is to suppress the toast, or shift it up, while `document.activeElement` is
underneath it.

---

## 5. Things that are already right

Worth recording so they do not get "simplified" away:

- Every settings control is a real `<button role="switch" aria-checked>` with a
  proper `aria-label` (`app.html:177–211`), and `sessionPanel.js:25–29` keeps
  `aria-checked` in sync. This is the part most hand-rolled apps get wrong.
- `#gutter` is `aria-hidden` (`app.html:84`) and `#mount-hints` is too
  (`app.html:90`) — line numbers and duplicated onboarding prose are exactly what
  should not be in the accessibility tree.
- `styles/qr.css:115` gates its entry animation on
  `prefers-reduced-motion: no-preference` — the safe polarity, and the right one.
- `styles/cursors.css:118` drops the transform transition under reduced motion
  while deliberately keeping the opacity fade, with the reasoning written down.
- The cursor layer is `aria-hidden` (`cursors.js` `layer()`): announcing where
  somebody else's mouse is would be pure noise.
- `<html lang="en">`, and the layout reflows to a single column at 900 px
  (`layout.css:26`), which covers 1.4.10.
- `esc()` on every interpolation, enforced by `tests/static-check.mjs`.

---

## 6. Not verified

- **No real screen reader was run.** Everything in §2 was verified structurally
  in jsdom (roles, labels, focus order, live-region mutations) and everything in
  §3 was computed, not eyeballed. The claims about *announcement behaviour* —
  particularly the live-region timing in `banners.js` — are based on the
  documented behaviour of NVDA/JAWS/VoiceOver, not on a session with each.
- Contrast was computed against token values, not sampled from a rendered page.
  Anywhere a browser blends differently than modelled (notably `color-mix` in a
  non-sRGB working space) the numbers will shift slightly; the failures here are
  not marginal enough for that to change any verdict except the 4.51 status bar,
  which is marginal by definition.
- Zoom to 400 % (1.4.10) and text spacing (1.4.12) were not tested.
- The landing page (`index.html`) was out of scope and is not covered here.
