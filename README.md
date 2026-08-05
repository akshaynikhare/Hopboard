# Hopboard

**Live clipboard sharing / syncing.**

Open it on two devices, type the same short key, and text copied on one is
available on the other. Files ride peer-to-peer. No account, no install, no
database.

```
  Machine A  ──┐                                  ┌──  Machine B
               │   text  ──►  relay  ──►  text    │
               │   (encrypted in the browser)     │
               │                                  │
               └───  files ═══ direct P2P ═══─────┘
                     (never touch the server)
```

**Status: pre-alpha.** The relay is built and tested; the frontend is a layout
preview with the OS clipboard wired up and the network stubbed. See
[docs/M0-RESULTS.md](docs/M0-RESULTS.md) for exactly what is proven.

---

## Why

Moving a snippet between a work laptop, a desktop and a phone is
disproportionately annoying. The alternatives want an account, an install with
admin rights, or an email to yourself. This wants a five-character key.

## How it works

| Layer | Choice |
|---|---|
| Frontend | Static HTML/JS on GitHub Pages, installable as a Chrome PWA |
| Relay | FastAPI on FastAPI Cloud — in-memory rooms, no database, no disk |
| Text | WebSocket through the relay, AES-GCM encrypted in the browser |
| Files | WebRTC data channel, direct between peers, 5 MB cap |
| Key | `SHA-256(key)` routes the room; `PBKDF2(key)` encrypts. The key itself is never transmitted |

The relay only ever sees a room hash and ciphertext. It cannot decrypt anything,
and it stores nothing beyond the last message in RAM.

## Repo layout

```
index.html              entry point
src/
  main.js               composition root — wires modules together
  core/                 bus, config, state, crypto, storage
  transport/            relay client, protocol, reconnect
  clipboard/            OS clipboard read/write, capture tiers
  files/                thumbnails, registry, P2P transfer
  ui/                   one module per panel + shared helpers
  styles/               design tokens + per-component CSS
backend/                FastAPI relay — deployed separately
tests/e2e.mjs           two peers, real crypto, live relay
docs/                   PRD, clipboard design, P2P design, M0 results
```

Details and conventions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it

**Frontend** — any static server (ES modules need HTTP, not `file://`):
```bash
python -m http.server 8080
# http://127.0.0.1:8080
```

**Relay:**
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --port 8000
python test_relay.py ws://127.0.0.1:8000    # 45-check protocol gate
```

See [backend/README.md](backend/README.md) for deployment, **including the
replica-pinning step that must not be skipped.**

## Docs

| Doc | What it covers |
|---|---|
| [PRD.md](docs/PRD.md) | Requirements, architecture, security model, open issues |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module layout, boundaries, and how to add a feature |
| [CLIPBOARD-FLOW.md](docs/CLIPBOARD-FLOW.md) | How the browser reaches the OS clipboard, and why background capture is impossible |
| [P2P-FILES.md](docs/P2P-FILES.md) | Thumbnails over the relay, bytes over WebRTC, and the corporate-network problem |
| [M0-RESULTS.md](docs/M0-RESULTS.md) | Transport gate results |

## Known limitations

- **No background clipboard capture.** No web app can do this on any browser —
  `readText()` requires window focus. You switch to Hopboard and it grabs what you
  copied. [Why](docs/CLIPBOARD-FLOW.md).
- **P2P file transfer may fail on corporate networks**, which block the UDP that
  WebRTC needs. Falls back to relay-chunked transfer, labelled visibly.
- **The share key is a bearer credential.** Anyone holding it can read the session.
- Chromium-first. Firefox and Safari can receive and can send via paste, but
  cannot silently read the clipboard.
