# LiveClip — Product Requirements Document

| Field | Value |
|---|---|
| Product | LiveClip — realtime multi-directional clipboard sync |
| Version | 0.2 (draft) |
| Date | 2026-08-05 |
| Status | Draft — core decisions settled (§11.1), remainder open (§11.2) |
| Platforms | Windows, macOS, Android — Chrome-first |
| Stack | Static PWA on GitHub Pages + FastAPI relay on FastAPI Cloud (free), E2E encrypted. Text over the relay, files P2P |
| Reference | https://live-clipboard.netlify.app/D75LV |

---

## 1. Overview

### 1.1 Problem
Moving a snippet of text between two machines you own (work laptop ↔ desktop ↔ phone, or a VM/RDP session ↔ host) is disproportionately annoying. Existing options require accounts (Google/Apple ecosystems), installs with admin rights, or emailing yourself.

### 1.2 Product
A static web app. Open it on machine A, get a short share key (e.g. `D75LV`). Enter the same key on machine B. From then on, copying on either machine makes that content available on the other — **multi-directional**, realtime, no account, no install required, and installable as a Chrome app if the user wants it.

### 1.3 Goals
| # | Goal |
|---|---|
| G1 | Two or more machines sync clipboard text in realtime via a short shared key |
| G2 | Sync is multi-directional — every peer is both reader and writer, no host/client roles |
| G3 | Installable as an app from Chrome (PWA), with its own window and icon |
| G4 | Read from and write to the **system** clipboard, not just an in-page textarea |
| G5 | Frontend is a static site hosted on GitHub Pages |
| G6 | Minimum backend: no database, no user accounts, all room state in memory |
| G7 | Zero-friction: land on URL → working in under 10 seconds, no signup |
| G8 | Cross-platform: Windows, macOS and Android, targeting Chrome on all three |
| G9 | Works inside locked-down corporate environments — **no extension install required** |

### 1.4 Non-goals
- **A Chrome extension — permanently excluded.** The target corporate environment blocks extension installation, so the product must work as a plain web app / PWA. This is a hard product constraint, not a phasing decision, and it means background clipboard capture is off the table for good (§5.1).
- User accounts, login, persistent history across sessions
- Native desktop apps (Electron/Tauri)
- Server-side file storage of any kind — files move peer-to-peer or not at all (§3.7)
- Server-side persistence of any clipboard content, ever
- Firefox/Safari **silent** clipboard read (platform-blocked — see §5.1)

### 1.5 Success criteria
- Two Chrome machines on the same key propagate a copied string in **< 300 ms** p95
- A cold visitor with a key reaches synced state in **≤ 3 interactions** (open link → grant clipboard permission → done)
- Total recurring infrastructure cost: **$0** at expected volume

---

## 2. Personas & journeys

**P1 — Dev on two machines.** Copies an error string on a VM, wants it in the browser on their laptop.
**P2 — Phone ↔ desktop.** Copies a URL on Android Chrome, wants it on desktop.
**P3 — Support/pairing.** Two people on a call share a temporary key to pass tokens/snippets back and forth.

### Journey A — Create a room
1. User opens `https://<user>.github.io/liveclip/`
2. App auto-generates key `D75LV` and shows it large, with a Copy-link button and a QR code
3. URL becomes `.../liveclip/#D75LV` (shareable, bookmarkable)
4. Status pill shows `Connected · 1 device`

### Journey B — Join from second machine
1. User types `D75LV` into the join box (or opens the link/scans QR)
2. Both devices show `Connected · 2 devices`
3. Latest clipboard value already in the room is delivered to the joiner immediately

### Journey C — Sync a copy
1. User copies text on machine A (Ctrl+C anywhere in the OS)
2. Machine A's LiveClip tab detects it (see §5.1 capture modes) and broadcasts
3. Machine B receives it; per its mode setting, either writes it to the system clipboard automatically or shows a "New clip — Paste" card with one-click copy
4. Both devices show the entry at the top of the session list

### Journey D — Install as app
1. Chrome shows the install icon in the address bar (PWA criteria met)
2. User installs; LiveClip opens in a standalone window with icon, remembering the last key

---

## 3. Functional requirements

### 3.1 Session / room key
| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | Auto-generate a key on first visit with no key present | Must |
| FR-1.2 | Key alphabet excludes ambiguous chars (`0/O`, `1/I/L`), i.e. Crockford-style base32; default length **6** | Must |
| FR-1.3 | Key is carried in the URL **fragment** (`#D75LV`), never the path or query — see §5.2 and §7.3 | Must |
| FR-1.4 | Manual join box accepts a key case-insensitively, trims whitespace/dashes | Must |
| FR-1.5 | "Copy link" and QR code for the current room | Should |
| FR-1.6 | Leave / rotate key (generates a new room, drops the old connection) | Should |
| FR-1.7 | Last-used key persisted in `localStorage`, offered as "Rejoin `D75LV`" on next launch | Should |

### 3.2 Clipboard engine
| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | Write received content to the system clipboard via `navigator.clipboard.writeText()` | Must |
| FR-2.2 | Read local clipboard via `navigator.clipboard.readText()` when permitted and focused | Must |
| FR-2.3 | Capture local copies via `paste` event (user presses Ctrl+V inside the app) with no permission required — the always-available fallback | Must |
| FR-2.4 | Poll/read clipboard on `focus` and `visibilitychange` → visible, so returning to the tab picks up whatever was copied elsewhere | Must |
| FR-2.5 | Optional foreground polling at a configurable interval (default 1000 ms) while the tab is focused | Should |
| FR-2.6 | **Loop suppression**: content written locally as a result of a remote message must not be re-broadcast. Enforced by content hash + `originId` + a 1500 ms suppression window | Must |
| FR-2.7 | Ignore empty strings and duplicates of the current value | Must |
| FR-2.8 | Max payload 32 KB in v1; larger clips are rejected with a visible toast | Must |
| FR-2.9 | In-session history list (last 20 clips, in memory + `sessionStorage` only), each with one-click copy | Should |

### 3.3 Sync / transport
| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | Persistent WebSocket to the relay, one connection per tab | Must |
| FR-3.2 | Server broadcasts a clip to **all peers in the room except the sender** | Must |
| FR-3.3 | Server holds only the **last** clip per room in memory, for delivery to late joiners | Must |
| FR-3.4 | Room state evicted after **10 min** with zero connected peers | Must |
| FR-3.5 | Auto-reconnect with exponential backoff (1s → 30s cap) and jitter; resubscribe on reconnect | Must |
| FR-3.6 | Heartbeat ping/pong every 30 s to survive idle-timeout proxies | Must |
| FR-3.7 | Presence: peer count broadcast on join/leave | Should |
| FR-3.8 | Last-write-wins ordering using a monotonic per-room sequence number assigned by the relay | Must |

### 3.4 Installability (PWA)
| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | `manifest.webmanifest` with `name`, `short_name`, `start_url`, `display: standalone`, `theme_color`, 192/512 px icons (incl. maskable) | Must |
| FR-4.2 | Service worker caching the app shell so the UI loads offline (sync itself requires network) | Must |
| FR-4.3 | Served over HTTPS — satisfied by GitHub Pages | Must |
| FR-4.4 | Custom in-app "Install app" button driven by `beforeinstallprompt` | Should |
| FR-4.5 | `start_url` must restore the last room from `localStorage` (fragments are not preserved by the manifest) | Must |
| FR-4.6 | SW update flow: new version detected → non-blocking "Update available · Reload" toast | Should |

### 3.5 Settings panel
Small, collapsible, persisted in `localStorage`.

| ID | Setting | Default |
|---|---|---|
| FR-5.1 | **Auto-write to clipboard** — apply incoming clips to system clipboard automatically | On |
| FR-5.2 | **Auto-read local clipboard** — capture local copies while focused (needs permission) | On, degrades to manual |
| FR-5.3 | **Poll interval** — 500 / 1000 / 2000 ms, or Off | 1000 ms |
| FR-5.4 | **Direction** — Both / Send only / Receive only | Both |
| FR-5.5 | **Notifications** — toast on incoming clip | On |
| FR-5.6 | **Clear history** / **Leave room** actions | — |
| FR-5.7 | Device nickname shown in the peer list | auto (`Chrome · Windows`) |

### 3.6 UI

Three panels, no navigation, everything on one screen. Built as [`index.html`](../index.html).

```
┌────────────────────────────────────────────┬──────────────────────────────┐
│ Text Editor      653/50000  ⛶ ⧉ ⎘ ⤳        │ Files & Images    ● P2P idle │
│────────────────────────────────────────────│──────────────────────────────│
│  1  https://tibco-p.aws.local:8000/…       │  ┌──────────────────────┐    │
│  2                                          │  │ Drop files or click  │    │
│  3  Correlation ID                          │  │ Max 5 MB each · P2P  │    │
│  4  c866bac7a1d54ccaa85455de0d9d667a        │  └──────────────────────┘    │
│  5                                          │   ┌────┐┌────┐┌────┐        │
│  6  [                                       │   │IMG ││ 📄 ││IMG │  HERE  │
│  7    {                                     │   └────┘└────┘└────┘        │
│  8      "error": "UNEXPECTED_ERROR",        │   shot.png  log.txt  ui.jpg  │
│  9      "message": "…"                      │   1.2 MB    18 KB    840 KB  │
│ 10    }                                     ├──────────────────────────────┤
│ 11  ]                                       │ Session            ● Preview │
│                                             │──────────────────────────────│
│                                             │ SHARE KEY                    │
│     (line numbers, monospace, wraps)        │  ┌───────┐ [Copy link][New]  │
│                                             │  │ D75LV │                   │
│                                             │  └───────┘                   │
│                                             │ ⚠ Anyone with this key…      │
│                                             │                              │
│                                             │ DEVICES                   3  │
│                                             │  ● This device (you)         │
│                                             │  ● Chrome · Windows    P2P   │
│                                             │  ● Chrome · Android   RELAY  │
│                                             │                              │
│                                             │ CLIPBOARD    T3 auto-capture │
│                                             │  Auto-write incoming   [=O]  │
│                                             │  Auto-read on focus    [=O]  │
│                                             │  Poll while focused  [1s ▾]  │
│                                             │                              │
│                                             │ TRANSFER                     │
│                                             │  Auto-accept files     [O=]  │
│                                             │  Direction          [Both ▾] │
└────────────────────────────────────────────┴──────────────────────────────┘
        PANEL 1 — main, full height              PANEL 2 (top 50%) — files
                                                 PANEL 3 (bottom) — session
```

Layout rules:
- Left column is fluid, right column is a fixed **400 px**. Below 900 px the grid
  collapses to a single stacked column (Android).
- Panel 1 owns the full height; panels 2 and 3 split the right column evenly.
- Each panel scrolls independently. The page itself never scrolls on desktop.

Four things the layout does deliberately:

- **Line numbers in the main panel.** The content people paste into this thing is
  stack traces and JSON — line numbers are what make a shared error message
  discussable ("look at line 10").
- **Actions live top-right of their own panel**, not in a global toolbar, so each
  panel is self-contained.
- **The capture tier is always on screen** (`T3 · auto-capture`), because what the
  app can and cannot see is the thing users get wrong. See
  [CLIPBOARD-FLOW.md](CLIPBOARD-FLOW.md).
- **The key warning sits next to the key**, not in a footer or modal. The key is a
  bearer credential and the UI should say so where it is read.

### 3.7 Files and images (P2P)

Full design in [P2P-FILES.md](P2P-FILES.md).

| ID | Requirement | Priority |
|---|---|---|
| FR-7.1 | Drag-drop or click to add files; **5 MB hard cap each**, rejected with a visible reason | Must |
| FR-7.2 | Image thumbnails generated **locally** (canvas, 160 px, JPEG q0.7, ~8 KB); non-images get an extension icon | Must |
| FR-7.3 | Only the thumbnail + metadata travel automatically, inside the normal encrypted envelope. **The file bytes never leave the machine until requested** | Must |
| FR-7.4 | Clicking a remote thumbnail requests the file; transfer runs over a WebRTC data channel, signalled through the existing relay | Must |
| FR-7.5 | Per-tile transfer progress and cancel | Should |
| FR-7.6 | If ICE fails within ~5 s, fall back to chunked transfer over the relay (32 KB frames) — **and label it visibly as RELAY, never silently** | Must |
| FR-7.7 | Max 20 files per session, memory only, cleared on leave | Should |
| FR-7.8 | Local files are click-to-save; remote files are click-to-request | Must |

| ID | Requirement |
|---|---|
| FR-6.1 | Single screen: key display, connection status pill, big paste/clip area, history list, settings drawer |
| FR-6.2 | Explicit permission-state UI: `granted` / `prompt` (show "Enable clipboard access" button) / `denied` (show manual-paste instructions) |
| FR-6.3 | Connection states are always visible: Connecting / Connected (n devices) / Reconnecting / Offline |
| FR-6.4 | Responsive down to 360 px; touch-friendly targets for mobile |
| FR-6.5 | Dark/light via `prefers-color-scheme` |
| FR-6.6 | No content ever rendered as HTML — clips are inserted as `textContent` only (XSS) |

---

## 4. Architecture

### 4.1 Recommended topology

```
  Windows PC            macOS                  Android
 ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
 │  Chrome PWA   │   │  Chrome PWA   │   │  Chrome PWA   │
 │  (GitHub      │   │  (GitHub      │   │  (installed   │
 │   Pages)      │   │   Pages)      │   │   to home)    │
 └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
         │                   │                   │
         │      wss://<app>.fastapicloud.dev/ws/<roomHash>
         └───────────────────┼───────────────────┘
                             ▼
        ┌────────────────────────────────────────────┐
        │  Relay — FastAPI, single replica            │
        │  rooms: dict[str, Room]                     │
        │    Room = { peers: set[WebSocket],           │
        │             last: ciphertext | None,         │
        │             seq: int }                       │
        │  evict room after 10 min with no peers      │
        │  NO DATABASE. NO DISK. NO REDIS.            │
        └────────────────────────────────────────────┘
```

- **Frontend**: static HTML/CSS/JS on GitHub Pages. No framework required; vanilla or Preact/Svelte if preferred. No build step is a valid choice.
- **Relay**: FastAPI (Python) on FastAPI Cloud Hobby (free). One `WebSocket` endpoint, a module-level dict of rooms, fan-out to the room's peer set. ~120 lines, no dependencies beyond FastAPI itself.
- **Content is end-to-end encrypted** (§7.3). The relay is a dumb, blind pipe that never sees plaintext.

```python
# backend/main.py — the entire sync model
rooms: dict[str, Room] = {}

@app.websocket("/ws/{room_hash}")
async def ws(sock: WebSocket, room_hash: str):
    await sock.accept()
    room = rooms.setdefault(room_hash, Room())
    room.peers.add(sock)
    await sock.send_json({"t": "welcome", "peers": len(room.peers), "last": room.last})
    try:
        async for raw in sock.iter_json():
            room.seq += 1
            room.last = raw | {"seq": room.seq}
            for p in room.peers - {sock}:          # sender excluded
                await p.send_json(room.last)
    finally:
        room.peers.discard(sock)
        if not room.peers:
            schedule_eviction(room_hash, after=600)
```

### 4.2 Split transport: relay for text, P2P for files

The two payload types have opposite economics, so they get different transports.

| | Text & thumbnails | File bytes |
|---|---|---|
| Size | Bytes to ~8 KB | Up to 5 MB |
| Transport | WebSocket relay | WebRTC data channel (P2P) |
| Why | Tiny, constant, must be reliable | Too big to push through a free-tier relay per transfer |

**Text does not use WebRTC** because WebRTC would still need a signalling server *plus* TURN for peers behind symmetric NAT — more infrastructure, not less, to move a few hundred bytes. A relay carrying already-encrypted payloads gives the same privacy property far more simply.

**Files do not use the relay** (by default) because a 5 MB body per transfer on a 0.1 vCPU free instance is how you acquire a throttle or a bill.

The relay doubles as the WebRTC signalling channel, so P2P costs no extra infrastructure. See [P2P-FILES.md](P2P-FILES.md) — including why the answer to P2P failing on corporate networks is a relay fallback rather than a TURN server (**OI-14**).

### 4.3 Relay hosting — FastAPI Cloud (chosen)

**Decision: FastAPI Cloud, Hobby tier ($0, no credit card).** Deploy is `fastapi deploy`; HTTPS and a subdomain come free, so `wss://` works out of the box.

Hobby tier allowances, and what each means here:

| Allowance | Impact on LiveClip |
|---|---|
| 3 apps, 1 custom domain | Fine — we need one app |
| 0.1 vCPU / 512 MB shared (burst to 0.5) | Ample. The relay does no crypto and no parsing beyond JSON fan-out |
| **Autoscale up to 2–3 replicas** | ⚠️ **Must be pinned to 1** — see R1 below |
| **Scale-to-zero** | ⚠️ Cold start on the first connect after idle — see R2 |
| 1-day log/metric retention | Fine — we log no content anyway (§7.3) |
| Compute not yet invoiced during public beta | Free today; re-evaluate before GA pricing lands |

#### Risks that must be resolved in M0

| # | Risk | Why it matters | Mitigation |
|---|---|---|---|
| **R1** | **Multi-replica breaks in-memory fan-out** | Room state is a process-local dict. If two devices land on *different* replicas they join the same room name but never see each other — a silent, intermittent "it just doesn't sync" bug that looks like a network problem | **Pin max replicas to 1.** A fan-out relay is I/O-bound, not CPU-bound; one async worker handles thousands of idle sockets. If we ever outgrow it, the fix is sticky routing on `roomHash` or Redis pub/sub — the latter would break the no-database goal, so pinning is strongly preferred |
| **R2** | **Scale-to-zero cold start** | After an idle period the first `wss://` connect must wake a container — seconds of dead air on what should be an instant-on app | Client shows an honest "Waking relay…" state rather than a spinner; retry with backoff; consider a cheap keep-alive ping if the tier permits. Measure actual wake time in M0 |
| **R3** | **WebSocket support is not documented** | FastAPI speaks WebSockets natively, but the *platform's* ingress proxy must pass the HTTP Upgrade through. This is unverified and is the single biggest unknown in the plan | **M0 exists to prove this first.** Deploy a 20-line echo endpoint and connect from two machines before any other work |
| **R4** | Scale-to-zero may drop live sockets when idle-scaling | A room could evaporate mid-session | Client auto-reconnect (FR-3.5) + last-clip replay (FR-3.3) already cover this; verify behaviour in M0 |

#### Fallbacks, in order, if R3 fails
1. **SSE + POST** — server-sent events downstream, `fetch` POST upstream. Plain HTTP, no Upgrade required, works through nearly every proxy, and needs no change to the message schema in §6. Costs one extra HTTP round trip per send.
2. **Another free Python-friendly host** — Railway, Render, or Fly.io free tiers, all of which document WebSocket support.
3. **Cloudflare Workers + Durable Objects** — no cold start and per-room isolation by construction, but the relay would be JavaScript rather than Python.

> The client's transport layer must be written behind a small interface (`connect / send / onMessage / close`) so that swapping WebSocket for SSE+POST touches one file and nothing else.

### 4.4 Repo layout
```
/                      → static site root (GitHub Pages)
  index.html           → app shell / layout
  app.js  ui.js  clipboard.js  crypto.js  transport.js
  manifest.webmanifest
  sw.js
  icons/
/backend/              → FastAPI relay (FastAPI Cloud "Application Directory")
  main.py              → WebSocket endpoint + in-memory rooms
  pyproject.toml       → required for deploy
  requirements.txt
  test_relay.py  test_idle.py
/m0/index.html         → M0 transport spike harness
/docs/                 → PRD.md, CLIPBOARD-FLOW.md, M0-RESULTS.md
```

Both halves live in one repo and deploy independently:

| Half | Trigger | Target |
|---|---|---|
| Static site | GitHub Actions on push | GitHub Pages |
| Relay | FastAPI Cloud watches the repo, builds on push to the **default branch** | FastAPI Cloud |

The frontend reaches the relay through a single configurable `RELAY_URL` constant.

### 4.5 FastAPI Cloud auto-deploy

FastAPI Cloud connects to the GitHub repo directly and redeploys on every push to
the default branch. Pushes to other branches are ignored.

**The `backend/` folder name is a convention, not a requirement.** FastAPI Cloud
defaults to the repository *root* and looks for the app there. Because this repo
has the static site at the root, the app location must be set explicitly — as
**Root Directory** when creating the app from GitHub, or **Application
Directory** in app settings afterwards. `backend` is a clear, conventional value
and is what this repo uses. Path rules: relative only, no `..`.

If deployments stop triggering after a push, the first thing to check is that the
Application Directory still points at `backend`.

> ⚠️ **Every push to the default branch restarts the relay** — including
> frontend-only commits. Restart drops all live WebSocket connections and clears
> in-memory rooms. Clients reconnect automatically (FR-3.5) and the last clip is
> gone, which is acceptable, but it means a busy commit day is a choppy day for
> anyone using it. Tracked as **OI-13**.

---

## 5. Hard platform constraints

> These are not design choices. They are browser rules that the product must be shaped around, and they are the most common source of "why doesn't it just work like a native app" confusion.

### 5.1 The clipboard cannot be read in the background
`navigator.clipboard.readText()` requires **all** of: a secure context, the `clipboard-read` permission, **and the document to be focused**. It rejects with `DOMException: Document is not focused` otherwise. There is no clipboard-change event on the web platform.

**Consequence:** a PWA in a background window cannot notice that you copied something in another app. Capture is therefore defined as three tiers:

| Tier | Mechanism | Permission | Works when |
|---|---|---|---|
| T1 | `paste` event (Ctrl+V into the app) | none | always — universal fallback |
| T2 | `readText()` on focus/visibility change | `clipboard-read` | user switches back to the app |
| T3 | `readText()` polling while focused | `clipboard-read` | app window is focused |
| ~~T4~~ | ~~Chrome extension with `clipboardRead` + offscreen document~~ | ~~install-time~~ | **Unavailable — extensions are blocked by corporate policy (§1.4)** |

**T4 is permanently out of reach, so T1–T3 must carry the whole product.** Practical consequence for design: the user's mental model must be *"switch to LiveClip and it grabs what you copied"*, not *"it watches my clipboard forever"*. Making that switch cheap is therefore a primary UX concern, not a detail:

- Installed as a PWA, LiveClip is one Alt-Tab / Cmd-Tab away in its own window
- Capture on focus (T2) is instant and silent, so the round trip is: copy → Alt-Tab → it's already sent
- The UI must confirm capture visibly ("Sent · 2s ago") so the user learns to trust the focus gesture
- Never present a state that implies background capture is happening when it isn't

**Receiving is easier than sending.** `writeText()` works whenever the document is focused, so auto-apply on the receiving side is reliable; when the tab is unfocused the clip is queued and written on next focus, with a visible "1 pending clip" badge.

### 5.2 GitHub Pages is static-only, and subpath-hosted
- No server code, so no WebSocket endpoint — hence the separate relay in §4.
- Project sites live at `/<repo>/`, and Pages has no SPA rewrite. Therefore **the room key lives in the URL fragment (`#D75LV`), not the path** — this also happens to be exactly what the E2E encryption design needs (§7.3). A path-style URL like the reference app's `/D75LV` would require a `404.html` redirect hack; we deliberately avoid it.

### 5.3 Platform & browser support matrix

Target platforms: **Windows, macOS, Android** — Chrome on all three.

| Platform / browser | Write | Silent read | PWA install | Verdict |
|---|---|---|---|---|
| Chrome — Windows | ✅ | ✅ after prompt | ✅ standalone window | **Primary** |
| Chrome — macOS | ✅ | ✅ after prompt | ✅ standalone window | **Primary** |
| Chrome — Android | ✅ | ✅ after prompt | ✅ home-screen app | **Primary** |
| Edge (Chromium) — Win/Mac | ✅ | ✅ after prompt | ✅ | Supported, same engine |
| Safari — macOS/iOS | ✅ (gesture) | ❌ per-read gesture required | iOS: Add to Home Screen | Degraded — T1 paste tier only |
| Firefox — all | ✅ | ❌ not exposed to web content | ❌ no install | Degraded — T1 paste tier only |

Platform notes:
- **macOS** — Cmd-based shortcuts; the `paste` handler must accept Cmd+V as well as Ctrl+V.
- **Android** — no window focus in the desktop sense; T2 capture fires on `visibilitychange`, which is the dominant path on mobile. Long-press paste into the app (T1) is the reliable fallback. Android also aggressively suspends background tabs, making auto-reconnect on resume (FR-3.5) essential rather than optional.
- **All platforms** — the app must **detect and communicate** its capture tier rather than silently doing nothing.

### 5.4 Corporate network constraints

The primary deployment context is a managed corporate environment, which shapes several requirements:

| Constraint | Consequence |
|---|---|
| Extension installation blocked | PWA-only, permanently (§1.4). Already reflected throughout |
| Outbound traffic restricted to 443 | `wss://` on 443 is standard and should pass. No custom ports, ever |
| TLS-inspecting proxies may not pass WebSocket Upgrade | Reinforces the SSE+POST fallback in §4.3. Test from inside the actual corporate network during M0, not only from a home connection |
| Proxies commonly kill idle connections at 60–120 s | 30 s heartbeat (FR-3.6) is a hard requirement, not a nicety |
| Domain allowlisting | Relay lives on one stable hostname so IT can allowlist a single domain. Avoid rotating subdomains; a custom domain (D5) makes this easier to justify to IT |
| Data-handling policy | E2EE (§7.3) means clipboard contents never exist in plaintext outside the browser — the strongest available answer to "where does our data go?" Worth documenting for any security review |

---

## 6. Wire protocol

Transport: WebSocket, JSON text frames. URL: `wss://<app>.fastapicloud.dev/ws/<roomHash>`.

The schema below is transport-agnostic on purpose: if the SSE+POST fallback (§4.3) is needed, the same envelopes travel over `GET /sse/<roomHash>` and `POST /pub/<roomHash>` with no other change.

### Client → Server
```jsonc
// first frame after connect — declares why we are here (see OI-2)
{ "t": "hello", "intent": "create" | "join", "originId": "u7f3" }

{ "t": "clip", "payload": "<base64 ciphertext>", "iv": "<base64>", "originId": "u7f3", "ts": 1754400000000 }
{ "t": "ping" }
```

`intent` exists to prevent a silent collision: an auto-generated key that happens to match a **live** room would otherwise drop the user straight into a stranger's clipboard. On `intent: "create"`, a `welcome` reporting `peers > 0` means the key is taken — the client discards it, regenerates, and reconnects (max 5 attempts). On `intent: "join"`, `peers == 0` is legitimate and simply means you arrived first.

### Server → Client
```jsonc
{ "t": "welcome", "peers": 2, "last": { /* clip envelope or null */ } }
{ "t": "clip",    "payload": "...", "iv": "...", "originId": "u7f3", "seq": 42 }
{ "t": "peers",   "count": 3 }
{ "t": "pong" }
{ "t": "error",   "code": "TOO_LARGE" | "RATE_LIMITED" | "ROOM_FULL" }
```

**Rules**
- Server never inspects, decrypts, logs, or persists `payload`.
- Server assigns `seq`; clients discard out-of-order `seq`.
- Sender is excluded from its own broadcast; `originId` is a second-line defence against loops.
- Limits: 32 KB/message, 10 messages/sec/connection, 8 peers/room.

---

## 7. Security & privacy

### 7.1 Threat model
The clipboard carries passwords, tokens, and PII. The share key is a **bearer credential**: anyone who has it can read everything pasted into that room. This must be stated plainly in the UI, not buried.

### 7.2 Risks
| Risk | Mitigation |
|---|---|
| Key guessing / enumeration | 6-char Crockford base32 ≈ 30 bits; server-side rate limiting on connect; short room TTL; offer 10-char "high security" keys in settings |
| Relay operator reads clips | E2E encryption (§7.3) — relay only ever sees ciphertext |
| Key leaks via URL sharing | Fragment is not sent to the server and not stored in server logs; warn on "Copy link" that the link *is* the password |
| Persistence | Nothing written to disk anywhere; browser keeps history in `sessionStorage` only; server keeps one clip in RAM with a 10-min idle eviction |
| Stale room reuse | Room key rotation; explicit Leave |
| XSS via clip content | `textContent` only, strict CSP, no `innerHTML`, no `eval` |

### 7.3 End-to-end encryption (recommended, and it's cheap)
The elegant part of the fragment-based design: the key the user types can serve **both** purposes without the server ever learning it.

```
user key       :  D75LV                       (never transmitted)
roomHash       :  SHA-256("liveclip:" + key)  → first 16 bytes, hex  (sent in the WS URL)
encryption key :  PBKDF2-SHA256(key, salt="liveclip-v1", 250k iters) → AES-GCM-256
payload        :  AES-GCM(plaintext, random 12-byte IV per message)
```
The relay sees only `roomHash` and ciphertext. It cannot derive the key from the hash, so it cannot decrypt. All of this is `crypto.subtle` — no libraries.

**Honest caveat:** a 6-char key is ~30 bits of entropy, so an attacker who captures ciphertext could brute-force it offline. PBKDF2 stretching raises the cost, but for genuinely sensitive material the UI should offer (and document) the 10-char key option. This tradeoff is deliberate: short keys are the product's core UX, so the default optimises for convenience and the app says so.

### 7.4 Notices required in UI
- On room creation: "Anyone with this key can read what you copy here."
- On first clipboard-permission prompt: what is read, when, and that it never leaves encrypted.

---

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | p95 end-to-end propagation < 300 ms (same region), < 800 ms cross-continent |
| NFR-2 | App shell < 100 KB gzipped; first paint < 1 s on 4G |
| NFR-3 | Reconnect within 5 s of network restoration |
| NFR-4 | $0 recurring cost up to ~50 k messages/day |
| NFR-5 | No cookies, no analytics, no third-party requests at runtime; strict CSP |
| NFR-6 | Keyboard accessible; visible focus rings; status changes announced via `aria-live` |
| NFR-7 | Graceful degradation to T1 (manual paste) on any browser lacking the async clipboard read |

---

## 9. Milestones

| M | Scope | Exit criteria |
|---|---|---|
| **M0 — De-risk the relay** ⚠️ | Deploy a ~20-line FastAPI echo WebSocket to FastAPI Cloud Hobby. Pin replicas to 1. Nothing else gets built until this passes | **Gate:** WS Upgrade succeeds (R3); two machines exchange a string; cold-start wake time measured (R2); connection survives 5 min idle with heartbeat; **verified from inside the corporate network** (§5.4). If it fails → switch to SSE+POST before M1 |
| **M1 — Core sync** | Key generation, fragment routing, transport interface, reconnect, loop suppression, last-clip replay | Two machines sync via a typed key |
| **M2 — System clipboard** | Permission flow, T1–T3 capture tiers, auto-write, pending-clip queue, capture-confirmation UI | Ctrl+C on A appears in Ctrl+V on B across Win/Mac/Android |
| **M3 — PWA** | Manifest, service worker, install prompt, offline shell, `start_url` room restore | Installs from Chrome on Windows, macOS and Android |
| **M4 — Settings & polish** | Settings drawer, history list, QR, presence, toasts, dark mode | All §3.5 settings functional and persisted |
| **M5 — Security** | E2EE, rate limits, size caps, CSP, privacy copy | Relay logs verified to contain no plaintext |
| **M6 — Ship** | GitHub Actions deploy to Pages, relay deploy, README, full matrix tested | Public URL live |
| **M7 — P2P files** | Thumbnails over the relay, WebRTC signalling + data channel, progress/cancel, relay-chunk fallback with visible labelling | 5 MB file moves between two machines directly; corporate path falls back and says so (§3.7, OI-14) |

> **M0 is a genuine gate, not a formality.** WebSocket support on FastAPI Cloud is undocumented (R3) and it is the assumption the entire architecture rests on. Proving it costs an afternoon; discovering it at M4 costs a rewrite.

---

## 10. Out of scope for v1 (candidate v2)

| Item | Note |
|---|---|
| ~~Chrome extension (MV3)~~ | **Excluded permanently, not deferred** — extension installation is blocked in the target corporate environment. Background clipboard capture is therefore unavailable at any point in the roadmap; T1–T3 (§5.1) are the complete capture story |
| ~~Image & file transfer~~ | **Now in scope** as P2P (§3.7, M7). Moved in because peer-to-peer transfer avoids the object storage that made it a scope problem — the relay carries an 8 KB thumbnail, not a 5 MB file |
| Copying images *via the clipboard* | Distinct from file transfer: reading image blobs out of the system clipboard with `clipboard.read()`. Still deferred |
| Persistent history across sessions | Conflicts with the no-persistence privacy stance; would be local-only (IndexedDB) if built |
| Rich text / HTML flavours | `text/html` clipboard type, sanitisation burden |
| Device pairing without typing a key | QR is v1; BLE/local discovery is not viable on the web |
| Self-hosted relay | Document a one-command deploy so users can run their own |

---

## 11. Decisions

### 11.1 Settled

| # | Decision | Resolution |
|---|---|---|
| D1 | Relay host | ✅ **FastAPI Cloud, Hobby (free)**. Must be pinned to 1 replica (R1). WebSocket support is unverified and is M0's gate (R3); SSE+POST is the documented fallback |
| D2 | E2E encryption in v1? | ✅ **Yes, from the start.** ~40 lines of `crypto.subtle`; it is what makes "no DB, blind relay" a real privacy claim rather than a slogan, and it is the answer to corporate data-handling review |
| D6 | Chrome extension? | ✅ **No — excluded permanently.** Corporate policy blocks extension installs. PWA only |
| D7 | Target platforms | ✅ **Windows, macOS, Android — Chrome on each.** Firefox/Safari degrade gracefully to the paste tier rather than being blocked |

### 11.2 Still open

| # | Decision | Recommendation |
|---|---|---|
| D3 | Default key length | **6** chars for UX parity with the reference app, with a 10-char option in settings |
| D4 | Frontend stack | **Vanilla JS, no build step** — keeps GitHub Pages deployment trivial; revisit if the UI grows |
| D5 | Custom domain? | **Worth it here.** Beyond a shorter URL, a stable custom hostname is much easier to get onto a corporate allowlist than a platform subdomain (§5.4) |
| D8 | Keep-alive against scale-to-zero? | Open until M0 measures actual cold-start time. If wake is under ~2 s, do nothing; if it is 10 s+, consider a low-frequency ping — weighed against Hobby-tier fair use |

---

## 12. Acceptance test matrix

| # | Scenario | Expected |
|---|---|---|
| T1 | A creates room, B joins by typing key | Both show "2 devices" within 2 s |
| T2 | Copy on A (app focused) | Appears on B < 300 ms; B's system clipboard contains it |
| T3 | Copy on A while A unfocused, then focus A | Captured on focus and propagated |
| T4 | B receives while unfocused | Queued; "1 pending" badge; written on focus |
| T5 | Remote clip written locally | Is **not** re-broadcast (no ping-pong loop) |
| T6 | Kill network on B for 30 s, restore | Auto-reconnects; receives the room's last clip |
| T7 | Third device joins mid-session | Immediately receives the current last clip |
| T8 | Clip > 32 KB | Rejected with a clear toast; connection stays alive |
| T9 | Clipboard permission denied | App still works via Ctrl+V paste tier; UI explains this |
| T10 | Firefox / Safari visit | Receive works; send works via paste tier; capability banner shown |
| T11 | Install as Chrome app, relaunch | Opens standalone, rejoins last room |
| T12 | Relay logs inspected after a session | Contain no plaintext clipboard content |
| T13 | Room idle 10 min, then revisited | Room is empty (evicted), no stale clip served |
| T14 | **Windows ↔ macOS ↔ Android, all three in one room** | All three sync; Cmd+V and Ctrl+V both captured; Android captures on `visibilitychange` |
| T15 | **Two devices connect after relay has scaled to zero** | Both wake the relay and land in the *same* room — the direct check for R1/R2 |
| T16 | **Connect from inside the corporate network** | WS Upgrade passes the proxy; session survives 5 min idle on heartbeat alone |
| T17 | Android tab backgrounded 10 min, then resumed | Reconnects automatically and receives the room's last clip |
| T18 | Relay restarted mid-session (redeploy) | All clients reconnect; no crash, no duplicate delivery |
| T19 | Auto-generated key collides with a live room | Client detects `peers > 0` on a `create` and silently regenerates — never joins a stranger |
| T20 | Two tabs open on the same machine, same room | Content sent once, not twice; no self-echo between tabs |

---

## 13. Open issues register

Severity: **Blocker** = stops the build · **High** = silent wrong behaviour if unfixed · **Medium** = degrades UX or trust · **Low** = polish/spec gap · **Watch** = external, monitor only.

| # | Severity | Issue | Proposed resolution | Owner milestone |
|---|---|---|---|---|
| **OI-1** | 🔴 Blocker | **WebSocket support on FastAPI Cloud is unverified** (R3). The entire architecture assumes the ingress proxy passes the HTTP Upgrade; nothing in their docs confirms it | M0 echo spike. If it fails, switch to SSE + POST — schema unchanged, transport interface isolates the swap | M0 |
| **OI-2** | 🟠 High | **Key collision joins a stranger's room.** The app auto-generates a key on first visit and connects. If that key matches a *live* room, two unrelated people silently share a clipboard. The protocol currently has no create-vs-join distinction | Add `intent: "create" \| "join"` to the connect frame. On `create`, if `welcome.peers > 0`, discard the key, regenerate, retry (max 5). On `join`, `peers == 0` is legitimate (first arrival). See §6 | M1 |
| **OI-3** | 🟠 High | **Multi-replica split-brain** (R1). Room state is a process-local dict; two devices on different replicas silently never see each other | Pin max replicas to 1. Add `GET /health` returning an instance id so the client can detect a mismatch and warn loudly rather than failing quietly | M0 |
| **OI-4** | 🟡 Medium | **Duplicate sends from multiple tabs.** Two LiveClip tabs on one machine both poll the same system clipboard and both broadcast the same clip | Leader election across tabs via the Web Locks API (fallback: `BroadcastChannel`). Only the leader tab polls and sends; followers render | M2 |
| **OI-5** | 🟡 Medium | **Password-manager content lingers on remote machines.** A copied credential syncs to another device's system clipboard and stays there indefinitely — LiveClip would be *undoing* the auto-clear that password managers deliberately perform | Product decision needed. Options: auto-clear remote clipboard after N seconds; a "sensitive — don't auto-write" heuristic; or default `auto-write` off and require a click. Recommend surfacing it as an explicit setting with a documented default | M4 |
| **OI-6** | 🟡 Medium | **Android Chrome clipboard-read UX is unverified.** Desktop shows a persistent per-origin permission prompt; mobile Chrome's behaviour around `readText()` differs and may require a gesture or a paste chip each time | Verify on a real device in M2. If silent read is unavailable, Android falls back to T1 (long-press paste) — which must therefore be a first-class mobile flow, not a desktop afterthought | M2 |
| **OI-7** | 🟡 Medium | **Cold-start dead air** (R2). Scale-to-zero means the first connect after idle waits for a container to wake | Measure in M0, then resolve D8. Under ~2 s: show "Waking relay…" and do nothing else. 10 s+: consider a low-frequency keep-alive, weighed against Hobby-tier fair use | M0 → M4 |
| **OI-8** | 🟢 Low | **PBKDF2 cost on low-end Android.** 250k iterations can take several hundred ms | Derive the `CryptoKey` once per session and cache it in memory — never per message. Show an "Unlocking…" state during derivation | M5 |
| **OI-9** | 🟢 Low | **Service worker scope and updates on a Pages subpath.** SW scope is confined to `/<repo>/`; registration must use a relative path, and a stale `sw.js` can pin users to an old build | Register relatively; version the cache name; ship the update toast in FR-4.6. Verify an update actually reaches an installed PWA | M3 |
| **OI-10** | 🟢 Low | **PWA install drops the URL fragment.** `start_url` cannot carry `#KEY`, so the installed app opens with no room | FR-4.5 restores from `localStorage`. Undefined today: what the app shows when that is empty — specify "generate a fresh key and explain why" rather than a blank screen | M3 |
| **OI-11** | ⚪ Watch | **FastAPI Cloud is in public beta and compute is not yet invoiced.** The $0 assumption (NFR-4) rests on beta pricing | Monitor. The relay is ~120 lines of standard FastAPI with no platform lock-in, so migrating to another free host is days, not weeks |
| **OI-12** | ⚪ Watch | **Corporate-network verification needs physical access to that network.** A proxy that blocks WS Upgrade would not show up in testing from a home connection | Schedule an on-network test as part of the M0 gate, not after it | M0 |
| **OI-14** | 🟠 High | **WebRTC is least likely to work in exactly the environment this is built for.** P2P uses UDP; managed corporate networks routinely block outbound UDP and TLS-inspecting proxies do not pass peer traffic. Direct transfer will frequently fail on the target network — the same class of unknown as OI-1, and it cannot be answered from a home connection | Do **not** buy a TURN server: TURN relays the bytes, so it fixes connectivity by discarding the property that motivated P2P. Instead fall back to chunked transfer over the relay we already have (FR-7.6) — viable precisely because the cap is 5 MB, and the payload is already encrypted so the relay still sees nothing. Label the path visibly. Test on the corporate network alongside OI-12 | M7 |
| **OI-15** | 🟡 Medium | **Thumbnails leak content automatically.** A 160 px preview of a screenshot can be perfectly legible, and thumbnails travel without being requested — the file's privacy model does not extend to its preview | Add a "send thumbnails" setting. Open question: default on (useful) or off (safe)? Recommend on for images under a threshold, with the setting surfaced rather than buried | M7 |
| **OI-13** | 🟡 Medium | **Frontend commits restart the relay.** FastAPI Cloud redeploys on any push to the default branch, so a CSS tweak drops every live WebSocket and clears in-memory rooms | Clients already auto-reconnect and re-fetch the last clip, so the blast radius is a brief blip rather than data loss. If it becomes disruptive: develop the frontend on a branch and merge in batches, or move the relay to its own repo so its deploys are independent of site changes | M6 |

### 13.1 Decisions still open
Carried from §11.2, repeated here so the register is complete: **D3** default key length (rec. 6, with a 10-char option) · **D4** frontend stack (rec. vanilla JS, no build) · **D5** custom domain (rec. yes — allowlisting) · **D8** keep-alive vs scale-to-zero (blocked on M0 measurement).
