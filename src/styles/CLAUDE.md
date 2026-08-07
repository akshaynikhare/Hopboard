# src/styles/

Two halves, and **the directory is the whole contract**:

- **`styles/`** — eager. `main.css` `@import`s it; the build bundles the chain into one file.
- **`styles/lazy/`** — fetched on first open by the panel that needs it, via
  `core/paths.js` `lazyStyleHref()`, which can address nothing else.

A sheet in both is a bug. `qr.css` and `history.css` were `@import`ed *and* injected as a `<link>`,
so both shipped twice — once inside the bundle and once over the wire — and nothing caught it,
because CSS is idempotent and the page looked right. `tests/unit/static-check.mjs` now fails on it.

## Choosing a half — payload is not the deciding factor

**`mobile.css` loads last and overrides nearly every other sheet at equal specificity, relying on
source order to win.** A lazy sheet is injected *after* `main.css`, so it would beat `mobile.css`.
Anything `mobile.css` restyles must therefore stay eager whatever it costs — `qr.css` and
`history.css` share ten classes with it and are the standing example.

Lazy is correct only when the sheet's component is genuinely optional **and** `mobile.css` says
nothing about it.

## Rules

- **Every colour and metric comes from `tokens.css`.** A hex literal elsewhere means the theme
  cannot be changed in one place. The four exemptions are listed with their reasons in the static
  check; adding a fifth means arguing for it there.
- **`mobile.css` stays last in `main.css`.** The comment above that line says why; do not tidy it
  into alphabetical order.
- Adding a sheet means adding it to `main.css` **or** to `lazy/` — never neither. The check fails
  on an orphan in either direction, including a lazy sheet nobody fetches.
- One sheet per component, named after the module it styles.
