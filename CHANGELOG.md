# Changelog

Generated from the commit history by `tools/changelog.mjs` — do not edit by
hand, the next release will overwrite it. To change an entry, reword the
commit.

Format follows [Keep a Changelog](https://keepachangelog.com); versions follow
[Semantic Versioning](https://semver.org).

## Unreleased

### Added

- enhance QR code functionality and session locking

### Other changes

- First content page: clipboard sync not working
- Keyword mine from Google Autocomplete, and the ad-revenue arithmetic
- Project links from one constant, and the landing page's globe
- Move the settings out of the sidebar and into the status bar
- SEO doc: real domain prices, and realtimeclipboard.com is already taken
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
- Initial commit: RealtimeClipboard — shared clipboard
- Initial commit
