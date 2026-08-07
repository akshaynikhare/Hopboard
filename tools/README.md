# tools/

Development and release scripts. None of this ships to a browser.

### build/ — produces artifacts

| Script | What it does | Run by |
|---|---|---|
| `build.mjs` | Assembles the deployable site into `_site` — the only build step in the project | `npm run build:site` |
| `build-land-mask.mjs` | Regenerates `src/landing/land.js` from Natural Earth data. Not a build step; output is committed | by hand |
| `build-og-card.py` | The Open Graph social card | `npm run build:og` |
| `build-icons.py` | The app icon — `assets/icons/` and `desktop/src-tauri/icons/`, twenty-two files from one geometry table | `npm run build:icons` |

### check/ — answers yes/no, writes nothing

| Script | What it proves | Run by |
|---|---|---|
| `site-check.mjs` | An assembled `_site` is fit to publish — canonical origin, `/app` mapping, CSP, noindex | `npm run build:site` (and the Cloudflare build) |
| `csp-check.mjs` | The built site loads in real Chromium with no CSP or Trusted Types violation | `npm run check:csp` |

### release/ — version, changelog, tag

| Script | What it does | Run by |
|---|---|---|
| `release.mjs` | Verify, write the changelog, commit, tag, push — in that order | `npm run release -- minor` |
| `changelog.mjs` | Builds `CHANGELOG.md` and `changelog.json` from Conventional Commit subjects | `npm run changelog` |
| `manifest.mjs` | Homebrew and winget manifests from one release | the release workflow |
| `relay-up.mjs` | Is a relay reachable? Prints the one it found | `.husky/pre-push` |

### seo/ — research, wired into nothing

`kwmine.py` — mines Google Autocomplete for real queries in the online-clipboard space.

Rules that govern edits here: [CLAUDE.md](CLAUDE.md).
Release process: [../docs/RELEASING.md](../docs/RELEASING.md).
