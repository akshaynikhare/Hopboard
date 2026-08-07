# src/landing/ — rank 10

The marketing page. A **separate document** from the app, and the separation is a security
boundary, not an organisational one.

This page carries no key and no clipboard content, which is why analytics and ads were allowed here
first. They now run in `app.html` too — see the root `CLAUDE.md` and `src/ui/features/ads.js` for
what that cost. `tags.js` is this page's half of it; the app has its own, because `core/` is the
only directory both may import and `core/` may not touch the DOM.

**Anything new and remotely updated still starts here, not in the app.**

May import `core/` (config and keys, for the hand-off). May not import `ui/`, `transport/`,
`clipboard/` or `files/`.

## Rules

- **CSS is co-located here** (`landing.css`), unlike the app, which keeps `styles/` separate. This
  page is one document with one sheet; the split would buy nothing.
- **`land.js` is generated** by `tools/build/build-land-mask.mjs` and committed like any other
  source file. Do not hand-edit it. Nothing at build or test time regenerates it.
- **The globe draws what the relay reports and nothing else.** No floor, no demo mode, no seeded
  traffic. Arcs between countries are absent on purpose — `/stats` reports per-country totals and
  nothing about who is paired with whom, so an arc would draw something we do not know.
- **Never make visibility depend on a frame arriving.** Anything that eases checks `canAnimate()`
  and jumps to its target when that is false. An earlier version faded markers in unconditionally,
  so any browser throttling `requestAnimationFrame` showed a permanently blank globe.
- **Size loose prose in columns, not characters.** A `max-width` in `ch` lands wherever the font
  happens to put it, which is how the FAQ ended up with a rule drawn through every answer.
- Every block gets `padding-inline: var(--gut)` so type stays off the vertical hairlines.
- **Nothing may be wider than the viewport, decoration included.** `body` has
  `overflow-x:hidden`, and that hides the symptom rather than fixing anything: mobile Chrome sizes
  the *layout viewport* to the widest box in the document, so one absolutely positioned wash bled
  20% past the container and a 390px phone laid the whole page out at 469px — the right of every
  section, the top bar's button included, clipped away with nothing able to scroll to it. Hence:
  insets stay `>= 0` on the inline axis, `code` and `pre` break long tokens, and a row that runs out
  of room drops parts (`.tag`, then `.brand b`, then the secondary links) instead of shrinking them.
  Flex items shrink before they overflow, so anything in a row that must not squash says `flex:none`.
- **Phone spacing is retuned, not phone content.** The `@media (max-width:620px)` block resets the
  vertical rhythm because every clamp floor in this sheet was chosen for blocks sitting *beside*
  each other; stacked, those floors are most of the page height. Sections themselves stay — this
  page is indexed mobile-first, so the phone rendering *is* the indexed one and anything behind a
  `display:none` there is content that was not written. **One exception, and it is a knowing
  trade:** the comparison table is hidden below 620px, because seven columns cannot be made to work
  in 326px. Its section, heading and intro paragraph stay, so the claim survives in prose; the seven
  rows do not. Before hiding anything else, check whether it can be collapsed into a `<details>` the
  way the FAQ is — that stays indexed, and it is the reason the FAQ is built the way it is.
- A module named in a `<script src>` must also be an entry point in `tools/build/build.mjs`, or it
  will not exist in the deploy. The static check enforces it.
