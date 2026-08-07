# assets/

Binary files served as-is. Copied verbatim to the deploy — nothing here is an input to a build.

**At the repo root, not in `src/`, and that is deliberate.** `app.html` and `index.html` sit at the
root and reference these by root-absolute path. If the build lifted them from `src/` the way it
lifts `src/pages/`, those references would 404 under `npm run serve`, where nothing rewrites
anything. Here, the disk path and the URL are the same string.

## The two subdirectories are not interchangeable

| | Precached by `sw.js` | Why |
|---|---|---|
| `icons/` | **yes, all of it** | the PWA icon set — the app must render installed and offline |
| `social/` | **never** | a share card only crawlers fetch; it has no business in a user's offline cache |

`tests/unit/static-check.mjs` walks `assets/icons` by name for the SHELL comparison, precisely so
`social/` cannot drift into the precache list. Putting a new share image in `icons/` would ship it
to every installed client.

## Rules

- **Everything in `icons/` is generated**, by `tools/build/build-icons.py`, and so is every file in
  `desktop/src-tauri/icons/`. Do not hand-edit one, `icon.svg` included — it is a string template
  in that script, and the next run overwrites it. Change the geometry table at the top of the
  script instead, run `npm run build:icons`, and commit what it wrote.
- **`social/og-card.png` is generated**, by `tools/build/build-og-card.py`. Do not hand-edit it.
  `npm run check:og` exits non-zero when it is stale.
- **`og:image` is an absolute URL** in every page's `<meta>`, and social platforms cache it against
  links that were already shared. Moving or renaming that file needs a `_redirects` entry in the
  same commit, or previews go blank on posts nobody can edit. `/social/*` already has one from the
  last move.
- **Adding an icon means editing three places**: the file, `manifest.webmanifest`, and the `SHELL`
  list in `sw.js`. The static check fails on the third if you forget.
- Icon sizes are pinned by `site-check.mjs` — the manifest must stay PNG-only with a 512×512
  `purpose=any`, or Chrome silently drops installability.
