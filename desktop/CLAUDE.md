# desktop/

A Tauri v2 shell around **the repository's own `src/`** — not a copy, not a port. `tauri.conf.json`
sets `frontendDist: "../../"`, so this app ships the source tree as it stands.

## What that constrains

- **The source tree must keep saying `app.html`.** The clean `/app` URL is a deploy-time rewrite;
  `tauri://` does no extension stripping, so every `./app` link would 404 here — and nothing in the
  web build would show it.
- **Anything that breaks the no-build dev loop breaks this app**, because it serves the same
  unbundled files.

## Rust never sees a frame, a room hash, or a key

`src-tauri/src/main.rs` is about 150 lines and does four things: watch the system clipboard, write
incoming clips without needing focus, own the tray/hotkey/autostart, and refuse to run twice.

The protocol, the encryption, the transport and the entire UI stay in the JavaScript. That keeps
the wire protocol at exactly two implementations — this JavaScript and the Python relay — however
many platforms ship. **Do not move protocol or crypto work into Rust.** A third implementation is a
third place for it to be subtly and silently wrong.

The whole integration on the JS side is one capture tier, **T0**, in `src/clipboard/capture.js`,
feeding the same funnel as paste and focus.

## Rules

- The relay origins in `tauri.conf.json`'s CSP must match `src/core/config.js`.
  `tests/unit/static-check.mjs` asserts that for the web pages; a self-hoster changes both.
- Build on the oldest supported runner (`ubuntu-22.04`, webkit2gtk 4.1). A newer image silently
  raises the glibc floor and the binary then refuses to start on the distributions we claim.
- `.github/workflows/desktop.yml` answers "does it compile" on every push; `release.yml` signs and
  publishes, and only on a tag.
