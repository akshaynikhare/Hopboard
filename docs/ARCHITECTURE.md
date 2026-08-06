# Architecture

How the frontend is organised, why it is organised that way, and where to put
new code.

---

## 1. The framework question

There isn't one, and that is the decision — not an omission.

The app is **native ES modules**. Real module boundaries, real imports, no
bundler, no build step. That buys one specific thing: the GitHub Pages deploy is
a file copy. No `npm ci`, no build cache, no lockfile drift, no "works locally,
breaks in CI". For a static app of this size, a bundler would trade that away for
tree-shaking we do not need.

**When to revisit:** if the app grows past ~40 modules, needs a component
library, or the `@import` chain in `styles/main.css` becomes a visible load
delay. At that point add a concatenation step at *deploy* time — not a build step
in development.

The one constraint this imposes: **ES modules require HTTP**. Opening
`index.html` from `file://` fails on CORS. Use `python -m http.server 8080`.

---

## 2. Layout

```
index.html              markup only — no styles, no behaviour
src/
  main.js               composition root: the only file that knows the whole graph
  core/
    config.js           every tunable constant
    bus.js              pub/sub — the only channel between modules
    state.js            session state + setters that announce changes
    keys.js             share-key generation, normalisation, URL handling
    crypto.js           room hashing, PBKDF2 derivation, AES-GCM
    storage.js          localStorage, wrapped so it cannot throw
  transport/
    protocol.js         wire frame shapes (PRD §6)
    relay.js            WebSocket client, reconnect, heartbeat
  clipboard/
    os.js               the OS boundary — readText / writeText, nothing else
    capture.js          T1/T2/T3 tiers, permission detection, loop suppression
  files/
    thumbs.js           canvas thumbnails, icons, size formatting
    registry.js         in-memory file list
    transfer.js         P2P transfer (M7)
  ui/
    dom.js              $, $$, esc, bind
    toast.js            queued announcements (the app's only aria-live channel)
    banners.js          inline notices: permission, pending clip, peer joined
    editor.js           the main panel
    filesPanel.js       files and images
    sessionPanel.js     devices and settings
    historyPanel.js     session clip history
    statusbar.js        bottom bar
    syncMode.js         Live / Manual switch
    cursors.js          live peer pointers
    hints.js            getting-started overlay
    panes.js            collapsible sidebar panes (delegated)
    resizer.js          draggable splitters
    qr.js               QR modal
    install.js          PWA install + service worker
    ads.js              the single ad placeholder
  styles/
    main.css            @imports the rest
    tokens.css          every colour and metric
    base.css            reset, scrollbars
    layout.css          shell grid
    …                   one file per component
```

---

## 3. The one rule

**UI modules never import transport or clipboard modules. They publish and
subscribe on the bus.**

```
  clipboard/capture ──emit(TEXT_CAPTURED)──► bus ──► main.js ──► transport/relay
                                              │
  ui/editor ◄──────────on(TEXT_RECEIVED)──────┘
```

`main.js` is the only file allowed to know both sides. Everything else depends on
the bus and on `core/`, never sideways.

Why it matters here specifically: the transport is the least settled part of the
system. If the deployed relay turns out not to pass WebSocket upgrades
(PRD **OI-1**), `transport/relay.js` gets replaced with an SSE+POST client and
**no UI file changes**. That swap is the whole point of the boundary.

It got used, for the other half of the problem. The relay passes upgrades fine;
the *client's* network may not (PRD §5.4). So the transport is now chosen at
runtime and no UI file changed:

```
  transport/
    relay.js       the facade: protocol, heartbeat, backoff, and which channel
    ws.js          channel — WebSocket
    sse.js         channel — SSE downstream + POST upstream, for blocked networks
    protocol.js    frame shapes, transport-agnostic
```

`ws.js` and `sse.js` implement one contract (`create → {send, close, isOpen}`)
and know nothing but how to move frames. Everything that is easy to get subtly
different between two transports — the hello, the 30 s heartbeat, jittered
reconnect backoff, the last-clip replay — lives in `relay.js` once, for both.
Nothing above `relay.js` can tell which one is live, and the static check
enforces that no UI/files/clipboard module imports anything from `transport/`.

The switch itself: try WebSocket, give it `NET.PROBE_MS` to become usable, and
after `NET.SWITCH_AFTER` attempts that never do, move to SSE and say so. The
probe matters more than it looks — a blocked WebSocket usually does not fail, it
hangs, so there is no error to react to and nothing but a timer will notice.

### Consequences worth knowing

- Event names live in `bus.js` as `EV.*` constants. A typo'd string literal is a
  silent no-op — always use the constant.
- `state.js` is not reactive. Mutate through its setters, which emit. Nothing
  observes the object directly, so data flow stays one-directional and greppable.
- Every colour comes from `tokens.css`. A hex literal in a component file is a
  bug: it means the theme cannot be changed in one place.

---

## 4. Where things actually live

| I want to… | Go to |
|---|---|
| Change a limit (file size, char cap, timeout) | `core/config.js` — nowhere else |
| Add a wire message | `transport/protocol.js`, then handle it in `relay.js` |
| Change how a clip is captured | `clipboard/capture.js` |
| Touch the system clipboard | `clipboard/os.js` — the only file that may |
| Add a UI panel | new `ui/*.js` + `styles/*.css`, register in `main.js` |
| Change a colour | `styles/tokens.css` |
| Add a setting | `state.js` defaults → markup in `index.html` → `sessionPanel.js` |

### Adding a feature, worked example

Say incoming clips should ding.

1. `core/config.js` — `export const SOUND = { enabled: true, url: "…" }`
2. `ui/sound.js` — `on(EV.TEXT_RECEIVED, play)`
3. `main.js` — `sound.init()`

No existing module changes. That is the test of whether the boundaries hold.

---

## 5. Security invariants

These are load-bearing. Breaking one is a vulnerability, not a bug.

| Invariant | Enforced in |
|---|---|
| An incoming clip never destroys unsent editor text | `main.js` checks `editor.isDirty()` before overwriting; otherwise it offers |
| A device joining the session is announced, not silent | `state.setPeers()` diffs the roster → `ui/banners.js` |
| Signalling and cursor frames are sealed like clips | `main.js` `encryptFrame()`; only routing fields stay clear |
| A peer may retract only files it announced | `files/registry.js` `applyGone()` checks the relay-stamped `from` |
| The share key is never transmitted — only `SHA-256(key)` and ciphertext | `core/crypto.js` |
| Keys are normalised (uppercased) before hashing | `core/keys.js` |
| Peer content is escaped before entering `innerHTML` | `ui/dom.js` `esc()` |
| `lastSent` and the suppression window are set *before* writing to the OS clipboard | `clipboard/capture.js` `apply()` |
| The AES key is derived once per session, never per message | `core/crypto.js` cache |
| Rejected files always report why | `files/registry.js` → `filesPanel.js` |
| The transfer path (P2P vs relay) is always visible | `ui/filesPanel.js` `badge()` |

The suppression ordering is the subtle one. Write first and your own poller sees
a "new" clipboard value and bounces it back to the sender, forever. See
[CLIPBOARD-FLOW.md §6](CLIPBOARD-FLOW.md).

---

## 6. Testing

No test runner in the repo — the modules are pure enough to exercise directly:

```bash
mkdir -p /tmp/t && cp -r src /tmp/t/ && echo '{"type":"module"}' > /tmp/t/package.json
cd /tmp/t && node -e 'import("./src/core/crypto.js").then(async c => {
  const k = await c.deriveKey("D75LV");
  const { payload, iv } = await c.encrypt(k, "hello");
  console.log(await c.decrypt(k, payload, iv));
})'
```

`core/` and `files/thumbs.js` are node-testable as-is. `ui/` needs a DOM and is
currently verified by a static check that every `$("id")` in `src/` exists in
`index.html`.

**A bug this caught:** `keys.isValid()` originally required every character to be
in the generation alphabet — which rejected `D75LV`, the worked example used
throughout these docs, because `L` is excluded as ambiguous with `1`. The
alphabet constrains what we *produce*; validation must accept anything a peer
might hand us, or a future alphabet change strands every existing link.

---

## 7. Backend

`backend/` is a separate deployment (FastAPI Cloud) and shares no code with the
frontend — only the protocol in [PRD §6](PRD.md). See
[backend/README.md](../backend/README.md), **including the replica-pinning step**.
