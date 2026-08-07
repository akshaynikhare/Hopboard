# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

RealtimeClipboard — an end-to-end encrypted online clipboard. Text is encrypted in the browser
(AES-GCM), routed by `SHA-256(key)` through a relay that stores nothing; files go peer-to-peer over
WebRTC. Four surfaces share one codebase: the web app (`app.html` + `src/`), the marketing landing
page (`index.html` + `src/landing/`), a Node CLI (`cli/`), and a Tauri desktop shell
(`desktop/`) that loads `src/` unmodified.

**Zero runtime dependencies. No build step for development.** `src/` is native ES modules served
as-is; `npm run build` exists only to assemble the deploy.

## Commands

```bash
npm install                       # installs git hooks; three devDependencies, no runtime deps
npm run serve                     # frontend on :8080 (python http.server)
npm run relay                     # the FastAPI relay on :8000, second terminal

npm run verify                    # offline suite — what pre-commit runs
npm test                          # everything; needs a relay (see below)
node tests/live/e2e.mjs ws://127.0.0.1:8000     # any single suite takes a relay base URL
RELAY_BASE=ws://127.0.0.1:8000 npm test    # point the whole suite at a local relay

npm run build:site                # tools/build/build.mjs + site-check → _site (what Cloudflare runs)
npm run release -- minor          # verify, changelog, tag, push
```

The relay **must be on port 8000**: `src/core/config.js` points at `ws://127.0.0.1:8000` when
`location.hostname` is localhost and at production otherwise. The frontend port is yours.

Two windows on `http://127.0.0.1:8080/app.html#DEVKEY` is the fastest way to see it work.
Locally it is `app.html`, not `/app` — the clean URL is a deploy-time rewrite in `tools/build/build.mjs`.

Relay-side gates (test the server, not the client):

```bash
cd backend && python test_relay.py ws://127.0.0.1:8000   # protocol
python test_sse.py http://127.0.0.1:8000                 # SSE+POST fallback
python test_idle.py ws://127.0.0.1:8000 5                # run this against a DEPLOYED relay
```

### The test split, which catches people out

`npm run verify` is offline. `npm test` adds `bundle`, `e2e`, `boot`, `boot --locked` and
`fallback` — and **`e2e`/`boot` default to the deployed relay**, so a bare `npm test` reaches the
internet and fails on a plane for reasons unrelated to your change. `fallback` defaults to
localhost and skips cleanly when nothing answers.

Suites skip rather than fail when a prerequisite is missing (`jsdom` absent, no relay reachable).
A "skipped" line is not a pass — check it.

## Architecture

**Every directory has a `CLAUDE.md` stating its own rules — read the one for the directory you are
editing.** This file is repo-wide context; the specifics live next to the code they govern, and a
static check fails if a directory has neither `CLAUDE.md` nor `README.md`.

`src/main.js` is the composition root and **the only file that knows the whole module graph**.

**Imports point downhill, or stay inside their own directory. Nothing else.** A directory's rank
decides what it may reach:

```
 0   core/                                     bus, config, state, crypto, keys, storage, paths — no DOM
10   transport/  clipboard/  files/  landing/  peers — may not import each other
20   ui/primitives/                            dom, modal, statusMenu
21   ui/shell/  ui/features/                   peers — may not import each other
22   ui/panels/                                composes shell + features + primitives
99   main.js                                   the only file that may cross layers
```

One sideways edge is allowed and named in the check: `files/transfer.js` reads
`transport/protocol.js` for frame shapes, which are transport-agnostic. Everything else crosses via
`core/bus.js` — UI emits, `main.js` hears it and calls the transport. That boundary is what let the
WebSocket→SSE failover ship without one UI file changing.

Event names are `EV.*` constants in `bus.js` — a typo'd string literal is a silent no-op.
`state.js` is not reactive: mutate through its setters, which emit.

### Where things go

| Task | Place |
|---|---|
| Change any limit, timeout or cap | `src/core/config.js` — nowhere else |
| Add a wire message | `transport/protocol.js`, then handle in `relay.js` |
| Add a DOM helper with no domain knowledge | `ui/primitives/` |
| Add persistent chrome — a bar, a pane, a splitter | `ui/shell/` |
| Add a feature deletable without breaking the layout | `ui/features/` |
| Add a content surface composing the above | `ui/panels/`, register in `main.js` |
| Add a modal | `ui/primitives/modal.js` `show()`. Do not hand-roll one, and do not mount to `#mount-modals` — `filesPanel.js` rewrites that node every 500 ms |
| Add a setting | `state.js` defaults → a row in `sessionPanel.js`. No markup in `app.html`; menus render from state |
| Add a stylesheet | `styles/` to bundle it; `styles/lazy/` only if the component is optional **and** `mobile.css` says nothing about it |
| Add a content page | `src/pages/<name>/index.html` — **root-absolute links only** — plus a `sitemap.xml` entry |
| Add a colour | `styles/tokens.css` |

Adding a feature should change no existing module beyond one `init()` line in `main.js`. If it
does, the boundary is probably in the wrong place.

## Boundaries the static checks enforce

`tests/unit/static-check.mjs` fails the commit, not the review. Each of these exists because the bug
shipped once:

- `navigator.clipboard` only in `src/clipboard/`.
- `innerHTML` is written **only** in `src/ui/primitives/dom.js`; everything else uses `esc()` and `setHTML()`.
  Enforced by Trusted Types in the CSP too. (`= ""` stays legal.)
- No `ui/`, `files/` or `clipboard/` module imports `transport/{relay,ws,sse}.js`. `protocol.js` is
  exempt — it is frame shapes, transport-agnostic.
- **No module resolves a path from `import.meta.url`.** Use `core/paths.js`. Bundling collapses the
  tree and moves every such path at once; this silently broke the service-worker scope and PWA
  installability. (`cli/` is exempt — it ships unbundled.)
- No stray hex outside `tokens.css` (a few files are allow-listed with reasons).
- Every `$("id")` in `src/` exists in `app.html` or is built by a module.
- The `SHELL` precache list in `sw.js` matches what is on disk.
- Every page carries a CSP whose `connect-src` matches `config.js`'s relay; no executable inline
  `<script>`.
- Every module a page loads via `<script src>` is a `tools/build/build.mjs` entry point — a module
  reachable only from markup is invisible to the bundler and 404s in the deploy alone.
- Every import points downhill (the rank table above).
- Every stylesheet loads **exactly once** — `@import`ed by `main.css` or sitting in `styles/lazy/`,
  never both and never neither.
- Every `tests/…` or `tools/…` path named in a doc or config still resolves.
- Every code directory has a `CLAUDE.md` and a `README.md`.

## Traps

- **The service worker will lie to you.** Tick "Bypass for network" in DevTools once per profile.
  When you touch `src/` or the HTML, bump `VERSION` in `sw.js` and add new modules to `SHELL`.
  (Both are rewritten at deploy by `tools/build/build.mjs`; the committed values are what development uses.)
- **`import(variable)` is opaque to the bundler.** Lazy imports must use literal specifiers inside
  thunks: `() => import("./ui/features/qr.js")`. Passing path strings left both optional panels 404ing in the
  deploy — caught, warned and degraded exactly as designed, which is why it would have shipped.
  `tests/dom/bundle.mjs` boots the built output and fails on either.
- **ES modules need HTTP.** `file://` gives a blank page.
- **`http://192.168.x.x` is not a secure context**, so `crypto.subtle` is unavailable — a phone on
  your LAN cannot even derive a key, and points at the *production* relay besides.
- **Nothing decorative may block the session.** `main.js` starts the connection un-awaited and
  wraps every other `init()` in `safeInit()`; `tests/live/boot.mjs` enforces that boot reaches the
  transport.
- **No third-party script may ever be added to `app.html`** — it holds the session key in its
  fragment and decrypted clipboard content in its DOM. Ads and anything remotely updated live on
  the landing page, which holds nothing.
- **`src/landing/land.js` is generated** by `tools/build/build-land-mask.mjs` and committed. Do not
  hand-edit it.

## Compatibility surfaces

Changing these strands existing users. `tests/unit/lock.mjs` holds golden vectors that will fail — that
failure is the feature. If the change is genuinely intended, say so explicitly in the commit body.

- Salts, iteration counts and domain-separation strings in `src/core/config.js` — the key
  derivation is a wire format. Every share link in existence depends on it.
- `STORAGE_PREFIX` — changing it orphans everyone's saved history and settings.
- The relay protocol in `docs/PRD.md` §6 — `backend/` shares no code with the frontend, only this.

Also: **never commit a real share key or PIN**, anywhere. Tests use throwaway keys like `D75LV`.

## Security invariants

`docs/ARCHITECTURE.md` §5 lists them with their enforcement point. Breaking one is a vulnerability,
not a bug. The subtle ones:

- The share key and the session PIN are never transmitted, never logged, never on disk — only
  `SHA-256(key)` and PBKDF2/HKDF output. `main.js` `announce()` prints the room hash only.
- A locked link opens **no connection** until the PIN is given, and never falls back to the
  unlocked room of the same key — that room is real and joinable by anyone holding the link.
- The lock flag is part of the room hash, so locking/unlocking/re-PINing is a *room change*, not a
  preference. `sendEviction()` tells the abandoned room so nobody is left connected to nothing.
- Signalling and cursor frames are sealed like clips (`encryptFrame()`); only routing fields stay
  clear, or the relay would learn every SDP, ICE candidate and peer IP.
- In `clipboard/capture.js` `apply()`, `lastSent` and the suppression window are set **before**
  writing to the OS clipboard. Write first and your own poller bounces the clip back forever.

## Git workflow

**There is no CI for the app.** `.husky` hooks are the entire gate: `pre-commit` refuses commits on
`main` and runs `npm run verify`; `pre-push` runs the full suite against whatever relay
`tools/release/relay-up.mjs` finds; `commit-msg` enforces Conventional Commits because
`tools/release/changelog.mjs` generates the changelog from them.

```bash
git switch -c fix/whatever
git commit -m "fix(scope): what changed"     # subject under 72 chars
```

Types: `feat fix perf refactor docs test build ci chore style revert`. `!` or a `BREAKING CHANGE:`
footer marks a release breaking.

The site deploys on **merge to main** (Cloudflare Pages runs `npm run build:site`). CLI, desktop
builds and the relay image deploy on a **`v*` tag** via `.github/workflows/release.yml`. So for the
web app, merged and live are the same event, and the hooks are the only thing between a commit and
production.

## Working conventions

**Comments: absolute minimum in new code.** Write code that does not need explaining — clear names,
small functions, obvious structure. Add a comment only where the *why* cannot be recovered from the
code (a non-obvious constraint, a bug the line prevents), never to restate what the line does.

Existing long comments are the exception, not the pattern to imitate. They record decisions and
what breaks if undone; `CONTRIBUTING.md` says deleting one without replacing the reasoning gets a
question back. Leave them alone unless the code they describe is going.

**Abstract and clean up as you go.** Factor out duplication when you meet it rather than filing it
for later; keep modules single-purpose and the layout organised. A change that leaves the file
tidier than it found it is the standard.

**Commits** carry the Claude Code attribution footer.

## Docs

`docs/ARCHITECTURE.md` (module layout, boundaries, security invariants) · `docs/DEVELOPMENT.md`
(local setup, the traps, checking a UI change headlessly) · `docs/PRD.md` (requirements, security
model, the `OI-*` open issues referenced throughout the code) · `docs/RELEASING.md` ·
`docs/CLIPBOARD-FLOW.md` · `docs/P2P-FILES.md` · `backend/README.md` (**including the
replica-pinning step**) · `CONTRIBUTING.md`.
