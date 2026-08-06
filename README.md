# Hopboard — an end-to-end encrypted online clipboard that syncs text between devices

Hopboard is a free, open-source online clipboard: open it on two devices, type the
same five-character key, and whatever you copy on one is ready to paste on the
other. No account, no install, no database. Files travel peer-to-peer and never
touch the server.

**[Try it → akshaynikhare.github.io/Hopboard](https://akshaynikhare.github.io/Hopboard/)**

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

## What it does

- **Sync clipboard text between devices** — Windows, macOS, Android, ChromeOS and Linux
- **Works across different networks**, not just the same Wi-Fi, and not just the same LAN
- **No account, no sign-up, no email** — a five-character key is the whole identity of a session
- **End-to-end encrypted** in the browser with AES-GCM; `PBKDF2` derives the key, `SHA-256` routes the room
- **Peer-to-peer file transfer** over a WebRTC data channel, 5 MB per file
- **Copy and paste images** — a screenshot copied on one machine previews on the other
- **Installable progressive web app** — own window, own icon, works offline
- **Nothing written to disk**, on your machine or the server
- **Self-hostable relay** — it is one small FastAPI service

## Why

Moving a snippet between a work laptop, a desktop and a phone is
disproportionately annoying. The alternatives want an account, an install with
admin rights, or an email to yourself. This wants a five-character key.

## How Hopboard compares to Snapdrop, PairDrop, LocalSend and AirDrop

The nearby tools are mostly *file droppers*: you pick a device and push a file at
it. Hopboard is a clipboard — what you copy shows up ready to paste, without
picking anything.

| Tool | Account | Install | Across networks | Lands on system clipboard | Files |
|---|---|---|---|---|---|
| **Hopboard** | None | None — browser | Yes | **Yes** | P2P, 5 MB |
| PairDrop | None | None — browser | Yes, via a 6-digit code | No — you send a message | P2P |
| Snapdrop | Optional since the LimeWire acquisition | None — browser | Same network only | No | P2P |
| LocalSend | None | Native app on both ends | Same network only | No | Unlimited, LAN |
| AirDrop | None | Built in | Nearby devices only | No | Unlimited |
| KDE Connect | None | App on both ends | Same network only | Yes | Yes |
| Pushbullet | Required | App or extension | Yes | Paid tier | Paid above a small cap |

Checked against each project's own documentation in August 2026. Corrections
welcome — open an issue.

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

## Frequently asked questions

### What is an online clipboard?

An online clipboard is a web page that holds what you copy on one device so you
can paste it on another. Both devices open the same page, identify themselves
with a short key, and share a single clipboard between them.

### How do I sync my clipboard between my phone and my PC?

Open Hopboard on both, type the same five-character key on each, and copy
something. It arrives on the other device ready to paste. Nothing to install, so
it works on a machine where you do not have admin rights.

### Does it work if the two devices are on different networks?

Yes. Text goes through a relay, so a laptop on home Wi-Fi and a phone on mobile
data share a clipboard fine. This is the main difference from Snapdrop, LocalSend
and AirDrop, which need both devices on the same network. Files are the
exception — they go directly between machines, and that is the part corporate
firewalls sometimes block.

### Is an online clipboard safe?

It depends on whether the server can read what you copy, and here it cannot. Text
is encrypted in the browser before it is sent; the server sees a room hash and
ciphertext and keeps neither. The honest caveat is that the key is a bearer
credential — anyone who learns it can read that session while it is open.

### Can it read my clipboard in the background?

No, and neither can any other web app on any browser. `readText()` requires
window focus. You switch to the Hopboard tab and it picks up what you copied.

### Which browsers work?

Chromium browsers get the full experience. Firefox and Safari can receive
everything and can send anything you paste in by hand, but cannot read the
clipboard on their own.

## Repo layout

```
index.html              marketing landing page (indexable)
app.html                the app itself (noindex)
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
| [SEO.md](docs/SEO.md) | Search, answer-engine and distribution strategy |

## Known limitations

- **No background clipboard capture.** No web app can do this on any browser —
  `readText()` requires window focus. You switch to Hopboard and it grabs what you
  copied. [Why](docs/CLIPBOARD-FLOW.md).
- **P2P file transfer may fail on corporate networks**, which block the UDP that
  WebRTC needs. Falls back to relay-chunked transfer, labelled visibly.
- **The share key is a bearer credential.** Anyone holding it can read the session.
- Chromium-first. Firefox and Safari can receive and can send via paste, but
  cannot silently read the clipboard.

## Licence

[MIT](LICENSE).
