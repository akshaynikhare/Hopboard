# assets/

Static binary files, served from the site root at the path they sit at on disk.

### icons/ — the PWA icon set

| File | Used by |
|---|---|
| `icon.svg` | the favicon, and the mark in the header of every page and the app bar |
| `icon-192.png` `icon-512.png` | `manifest.webmanifest`, `purpose=any`; also `apple-touch-icon` |
| `maskable-192.png` `maskable-512.png` | `manifest.webmanifest`, `purpose=maskable` |

All of it is precached by `sw.js`, so the installed app renders offline.

**Generated, not hand-drawn** — `tools/build/build-icons.py` draws all five from one geometry
table, along with the seventeen files in `desktop/src-tauri/icons/`. There is no second copy of the
artwork anywhere: the page headers point an `<img>` at `icon.svg` rather than redrawing it.

```bash
npm run build:icons     # regenerate all twenty-two
npm run check:icons     # exit non-zero if any is stale
```

### social/ — the Open Graph card

`og-card.png`, 1200×630, referenced by absolute URL from every page's `<meta property="og:image">`.

**Generated, not hand-drawn** — `tools/build/build-og-card.py` renders it from the design tokens in
`src/core/config.js`, so the card cannot drift from the app's palette:

```bash
npm run build:og      # regenerate
npm run check:og      # exit non-zero if it is stale
```

Never precached: it is fetched by crawlers, not by users, and the app's offline cache holds only
what the app needs to run.

Which half a new file belongs in, and what else has to change when you add one: [CLAUDE.md](CLAUDE.md).
