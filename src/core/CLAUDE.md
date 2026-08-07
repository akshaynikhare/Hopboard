# src/core/ — rank 0

The bottom of the tree. **Nothing here may import from anywhere else in `src/`.**

Also the boundary the npm package ships (`package.json` `files:`), so `cli/realtimeclipboard.mjs`
runs these exact modules. Two consequences:

- **No `window`, no `document`, no DOM.** Guard anything ambient the way `config.js` guards
  `location` and `paths.js` guards `document` — a bare reference throws at import time and takes
  the whole graph down, including in the node tests.
- **A change here is a change to a published package**, not just to the site.

## Compatibility surfaces — changing these strands existing users

- **The key derivation is a wire format.** Salts, iteration counts and domain-separation strings in
  `config.js` are baked into every share link in existence. `tests/unit/lock.mjs` holds golden
  vectors that fail if you touch them; that failure is the feature. If the change is intended, say
  so explicitly in the commit body.
- **`STORAGE_PREFIX`** — changing it orphans everyone's saved history and settings.
- **`paths.js` resolves from `document.baseURI`**, never from `import.meta.url`. Six modules used
  to compute their own depth in the tree, and bundling moved all six at once with no error.

## Rules

- Every tunable constant in the app lives in `config.js`. A magic number anywhere else is a bug.
- `state.js` is not reactive. Mutate through its setters, which emit on the bus.
- Event names are `EV.*` constants in `bus.js`. Adding an event means adding a constant.
- A bus event that **reports** is never named the same as one that **commands** — `EV.LOCK_STATE`
  and `"session:lock"` once shared a name and every `setKey()` opened the PIN dialog by itself.
- The share key and the session PIN are never logged, never stored, never transmitted. Only
  `SHA-256(key)` and PBKDF2/HKDF output leave this directory.
