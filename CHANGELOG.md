# Changelog

Generated from the commit history by `tools/release/changelog.mjs` — do not edit by
hand, the next release will overwrite it. To change an entry, reword the
commit.

Format follows [Keep a Changelog](https://keepachangelog.com); versions follow
[Semantic Versioning](https://semver.org).

## v0.4.0 — 2026-08-07

### Added

- ui: one header row for the app offer, a gate on locked links (#19)
- sync: Off/App/Clipboard ladder, and typing that streams (#18)
- download: Homebrew is live, winget is in review — say which (#17)

### Documentation

- release: npm run release cannot push to main, and says so (#16)

## v0.3.0 — 2026-08-07

### Added

- download: ship real installers, and a page that links to them

### Fixed

- ci: do not define APPLE_* at all when there is no certificate (#15)
- ci: stop the ad-hoc signature breaking the macOS build (#14)
- ci: do not let a failed npm publish hide the installers (#11)
- desktop: make beforeBuildCommand independent of its cwd (#10)
- release: match the Cargo version through CRLF line endings (#8)
- cli: read the version from package.json

### Build & deploy

- deploy: move the site to Cloudflare Pages and the new domain

## v0.2.1 — 2026-08-07

### Fixed

- test: keep the fallback suite on a local relay

## v0.2.0 — 2026-08-07

### Added

- desktop: scaffold a Tauri shell and native capture tier
- add the download and installation pages
- relay: optional Redis backend for several replicas
- relay: add deployment policy flags
- cli: add a command-line client
- let the relay address be configured
- relay: add deployment policy flags
- cli: add a command-line client
- let the relay address be configured
- security: enforce a CSP and Trusted Types on every page
- implement modal dialog for consistent user experience
- enhance QR code functionality and session locking

### Fixed

- relay: ship shared.py in the image and the package
- social: regenerate the OG card, which still said Hopboard
- test: point the suites at the relay the hook actually found

### Changed

- core: resolve asset paths from document.baseURI

### Documentation

- add a code of conduct and a contributing guide
- add SECURITY.md and funding metadata
- self-hosting, and record why there is now a build step

### Build & deploy

- relay: ship a Dockerfile, compose stack and Helm chart
- assemble the deploy with esbuild

### Other changes

- First content page: clipboard sync not working
- Keyword mine from Google Autocomplete, and the ad-revenue arithmetic
- Project links from one constant, and the landing page's globe
- Move the settings out of the sidebar and into the status bar
- SEO doc: real domain prices, and hopboard.com is already taken
- Slide the transport menu up out of the item that opens it
- Pick the transport by hand; stop file requests holding the app hostage
- Fire the rate-limit probe concurrently, not in a loop
- CORS on every response, so a stale relay stops reading as a CORS bug
- Phone layout: one view at a time, behind a bottom tab bar
- Transport failover: SSE + POST when WebSockets are blocked
- Refactor app structure and enhance accessibility
- SEO: keyboard-reachable comparison table, and the search strategy doc
- All improvements: data loss, security signals, a11y, file removal
- Move the editor hints to the bottom
- Landing page: Cloudflare-editorial theme, dotted path, live globe
- Live peer cursors, /stats endpoint, session panel redesign
- Fix: files and clipboard images were never announced to peers
- Landing page, SEO, and editor hints
- Clipboard images, Live/Manual mode, equal panes
- Service worker: network-first for code, so builds cannot go stale
- Fix: the app never connected. Plus layout rework.
- Integrate P2P files, history and QR; fix three real bugs
- PWA: manifest, service worker, install prompt
- Relay: peer identity, targeted signalling, file frames
- Remove the m0 spike harness
- M1: transport wired end to end, encrypted
- M0 CLEARED: 20/20 against the deployed relay
- Fix relay image build: declare py-modules
- Point RELAY_URL at the deployed relay; trigger rebuild
- Pages: self-enable on first run
- Modularise the frontend and add Pages deploy
- Initial commit: Hopboard — shared clipboard
- Initial commit
