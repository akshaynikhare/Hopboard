# RealtimeClipboard desktop

The Windows, macOS and Linux app. A Tauri v2 shell around **the repository's own
`src/`** — not a copy of it, not a port of it, the same files the website serves.

## Why it exists

One reason, and it is worth being precise about it. A web page can only read the
clipboard while its window is focused; that is a rule every browser enforces, and
[docs/CLIPBOARD-FLOW.md](../docs/CLIPBOARD-FLOW.md) §5 explains why it is never
going to change. So the browser version's model is *"switch to RealtimeClipboard and it
grabs what you copied"*.

A native process is not bound by that rule. This app watches the system clipboard
continuously, which turns the model into *"copy anywhere, it is already there"*.
That is the whole difference, and it is the reason a desktop app is worth
building while an Android or iOS one is not — both of those platforms forbid
background clipboard reads outright, so a native mobile app could not do this
either.

## What is in Rust, and what is deliberately not

`src-tauri/src/main.rs` is about 150 lines and does four things:

1. watches the system clipboard and emits `clipboard://text`
2. writes incoming clips to the clipboard without needing focus
3. tray icon, global hotkey, launch-at-login
4. refuses to run twice

**Rust never sees a frame, a room hash, or a key.** The protocol, the encryption,
the transport and the whole UI are the JavaScript in `../src/`, loaded unmodified
via `frontendDist: "../../"`. That is what keeps the wire protocol at exactly two
implementations — this app's JavaScript, and the Python relay — however many
platforms ship. A Rust client would have been a second place for the crypto to be
subtly and silently wrong.

On the JavaScript side the integration is one new capture tier, **T0**, in
[`src/clipboard/capture.js`](../src/clipboard/capture.js). It feeds the same
`capture()` funnel as the paste and focus tiers, so `main.js`, the editor, the
history and the transport are all untouched — the boundary in
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) §3 doing exactly what it was for.

## Build

Needs the [Rust toolchain](https://rustup.rs) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install -g @tauri-apps/cli    # or: cargo install tauri-cli --version "^2"

# dev — serve the frontend first, because the app loads the real src/
npm run serve                     # from the repo root, port 8080
cargo tauri dev --config desktop/src-tauri/tauri.conf.json

# release
cargo tauri build --config desktop/src-tauri/tauri.conf.json
```

Artifacts land in `desktop/src-tauri/target/release/bundle/`.

### The icons

`src-tauri/icons/` is generated and committed. It is not decoration: `build.rs`
runs `tauri-build`, which compiles the first `.ico` into the Windows resource, so
a missing icon set fails `cargo build` on Windows — not just `tauri build`. That
is exactly what it did, silently, through the v0.2.0 and v0.2.1 tags.

Regenerate it only when the logo changes:

```bash
# assets/icons/icon.svg at 1024, because `tauri icon` wants >=1024 and the
# committed PNG is 512. Any SVG rasteriser does; headless Chrome is already here.
chrome --headless=new --disable-gpu --window-size=1024,1024 \
       --screenshot=icon-1024.png file:///…/icon.svg

npx --yes @tauri-apps/cli@2 icon icon-1024.png -o desktop/src-tauri/icons
rm -rf desktop/src-tauri/icons/{android,ios}   # no mobile target ships
```

Transient `npx` rather than a devDependency: this runs when the logo changes, and
nobody should pay 35 MB of native binaries on every `npm install` for it.

> **Not yet compiled.** This scaffold was written without a Rust toolchain
> available, so it has never been through `cargo build`. Treat the first build as
> part of the work: expect plugin API details — particularly the
> `tauri-plugin-clipboard-manager` v2 trait import in `main.rs` — to need
> adjusting against the crate versions that actually resolve.

## Why tauri.conf.json looks like that

The file carries no `"//"` comment keys. **It cannot**: `tauri-build` deserializes
the config with unknown fields denied, so a `"//"` key is not an ignored comment
but a hard build failure — `unknown field '//version', expected one of …`. The
config had carried six of them since it was written and nobody found out, because
the app had never been compiled. The reasoning they held lives here instead.

- **`version: "../../package.json"`** is a path, not a number. Tauri reads the
  version from the repository's own manifest rather than restating it. A second
  copy is a copy that drifts, and this one already had: the config said `0.1.0`
  through both the v0.2.0 and v0.2.1 tags, which would have named every artifact
  after a version nobody released. `tools/release/release.mjs` bumps the two
  remaining copies — `Cargo.toml` and `Cargo.lock` — together, because
  `cargo build --locked` fails outright when they disagree.

- **`frontendDist: "../../"`** is the repository's own `src/`, taken as it stands.
  Not a copy, not a variant, not a build output — the same files the website
  serves. This is the most important line in the file: it is what stops the
  desktop app becoming a second implementation that drifts.

- **`security.csp`** is the website's policy plus what the shell needs. The
  webview renders clipboard content arriving from other devices, so it gets the
  same protection. `tauri:` and `ipc:` are how the frontend reaches the four
  commands in `main.rs`; `asset:` is how bundled files are served. The relay
  origins must match `src/core/config.js` — `tests/unit/static-check.mjs` asserts
  that for the web pages, and a self-hoster changes both.

- **`trayIcon.iconAsTemplate: false`**, and it must stay false while the tray
  icon is `icons/icon.png`. A macOS template image is drawn from its **alpha
  channel alone**, and that icon is a full-bleed opaque square — as a template it
  renders as a solid black block in the menu bar rather than a clipboard. Turning
  it on needs a separate monochrome-on-transparent asset, which would then be
  invisible on a dark Windows taskbar. Hence one colour icon for all three.

- **`trayIcon.menuOnLeftClick: false`** — left click shows the window. Quit lives
  in the menu, because an app that watches your clipboard must have a visible way
  to stop it.

- **`app.windows[0].visible: true`** — started hidden when launched at login
  (`--hidden`); shown from the tray or the global hotkey.

- **`bundle.targets`** is one list covering every desktop platform; `tauri-action`
  picks the ones each runner can actually produce.

- **`bundle.linux.deb.depends`** names webkit2gtk **4.1** as the floor, so apt
  refuses the install on a distribution too old to run it. Without it the package
  installs cleanly and then fails at launch with a missing symbol, which reads as
  "the app is broken" rather than "the dependency is wrong".

- **`bundle.windows.certificateThumbprint: null`** and **`macOS.signingIdentity:
  null`** are empty so a local build still works. See [Signing](#signing) for what
  CI does when the secrets exist, and what users see when they do not.

## The thing to get right

`ECHO_SUPPRESS` in `main.rs`, and the ordering in `set_clipboard`.

A clip arrives, we write it to the clipboard, and our own watcher sees a "new"
value and sends it back — forever, to every device in the session. Three guards
close that loop (CLIPBOARD-FLOW §6), and `set_clipboard` must **remember before it
writes**. Reversed, the watcher thread can observe the value before it has been
recorded, and the storm starts.

This mattered less in the browser, where the poller only ran while the window was
focused. A background watcher has no such bound. Before shipping any change here,
run the loop test: two agents, one session, Live mode, copy once, and assert the
clip crosses exactly once each way and then stops — for five minutes.

## Signing

Not optional for this app in particular. SmartScreen and most antivirus treat an
unsigned binary that reads the clipboard and opens outbound TLS connections as
suspicious, which is a fair description of what this does.

- **Windows** — Azure Trusted Signing (~$10/month) or an EV certificate
  ($300–600/year). CI reads `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`.
- **macOS** — Apple Developer Program ($99/year). **Notarization is mandatory**:
  without it Gatekeeper refuses the download rather than warning about it. CI
  reads `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
- **Linux** — nothing to sign.

## Defaults worth knowing

The app ships set to **Manual** sync, unlike the website. It reads every copy you
make while it is running, and that is a materially larger thing to agree to than
a browser tab that can only look when you are looking at it. The
[`SYNC_MODES` comment in `core/config.js`](../src/core/config.js) makes the same
argument. Live is one click away for anyone who wants it.

Nothing is written to disk beyond the settings file — no history, no cache, no
log. That claim is checkable and should be checked: run a full session under
Procmon, `fs_usage` or `strace` before a release.
