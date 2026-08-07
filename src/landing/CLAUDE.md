# src/landing/ — rank 10

The marketing page. A **separate document** from the app, and the separation is a security
boundary, not an organisational one.

**No third-party script may ever be added to `app.html`.** It carries the session key in its
fragment and decrypted clipboard content in its DOM. Anything remotely updated — analytics, ads,
embeds — belongs here, on a page that holds nothing.

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
- A module named in a `<script src>` must also be an entry point in `tools/build/build.mjs`, or it
  will not exist in the deploy. The static check enforces it.
