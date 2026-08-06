# Hopboard relay

In-memory fan-out. No database, no disk, no Redis.

The relay never sees plaintext: payloads are ciphertext produced in the browser and
the room name is a hash of the user's key (PRD §7.3). Nothing here decrypts, stores
or logs clip content.

## Run locally

```bash
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Then serve the app from the repo root and open it in two windows with the same
key. On localhost the frontend points at `ws://127.0.0.1:8000` automatically
(see `src/core/config.js`), so no configuration is needed:

```bash
cd ..
python -m http.server 8080      # http://127.0.0.1:8080
```

## Test

```bash
# 45-check protocol gate
python test_relay.py ws://127.0.0.1:8000

# 30-check gate for the SSE+POST fallback, including a mixed-transport room
python test_sse.py http://127.0.0.1:8000

# hold a connection open on heartbeat alone
python test_idle.py ws://127.0.0.1:8000 5
```

From the repo root, `node tests/fallback.mjs ws://127.0.0.1:8000` drives the
real client modules against this relay with WebSockets simulated as blocked —
the failover itself, which is otherwise only reproducible from inside a network
that blocks them.

Both scripts take a relay base URL, so the same suite runs against the deployed
relay by passing `wss://<your-app>.fastapicloud.dev`.

## Deploy to FastAPI Cloud

```bash
fastapi login          # opens a browser
fastapi deploy         # from this directory
```

### ⚠️ Immediately after the first deploy: pin replicas to 1

There is no CLI flag for this — set it in the FastAPI Cloud dashboard under the
app's scaling settings (`max replicas = 1`).

Room state is a process-local dict. On two or more replicas, two devices can join
the same room name, land on different instances, and never see each other. It
presents as "sync just silently doesn't work", intermittently, and only under
load — the worst class of bug to chase later.

This is PRD **OI-3**. Two safety nets back up the dashboard setting:

- `GET /health` returns an `instance` id
- the client compares `instance` across reconnects and shows a red split-brain
  banner if it ever changes

If you see that banner, replicas are not pinned.

### Verify the deploy

```bash
curl https://<your-app>.fastapicloud.dev/health
python test_relay.py wss://<your-app>.fastapicloud.dev
```

`test_relay.py` reports the WebSocket upgrade time as its first check. On a
scale-to-zero cold start expect that number to be seconds rather than
milliseconds — that measurement is what resolves PRD **D8** (whether a keep-alive
is worth adding).

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | `{ok, instance, uptime_s, rooms, peers}` — instance id detects split-brain |
| `GET /stats` | Aggregate live counts for the landing-page globe. Counts and country codes only |
| `WS /ws/{room_hash}` | Join a room. Frames per PRD §6 |
| `GET /sse/{room_hash}` | Join the same room over `text/event-stream` — downstream half of the fallback |
| `POST /pub/{room_hash}?sid=…` | Upstream half. Body is one JSON frame per line |

### The SSE + POST fallback

PRD §4.3 R3 and §5.4. A TLS-inspecting corporate proxy may refuse the HTTP
Upgrade a WebSocket needs — or accept the connection and silently swallow it.
Both halves of the fallback are ordinary HTTP, so what gets through a proxy is
just a response body.

It is the same room, not a parallel one: an SSE client and a WebSocket client in
one room see each other in the roster, exchange clips, and forward WebRTC
signalling both ways. Everything below `Connection` in `main.py` is written
against a send-a-string interface so the two paths cannot drift apart — size
caps, rate limits, roster and routing are one implementation.

Three things are specific to this path:

- **`sid`.** A stream is a session, and a POST is a separate request that could
  claim to be anyone. The relay issues a token on `welcome`, and `?sid=` is what
  ties a POST back to the stream it belongs to. Frames are stamped `from` using
  the stream's identity, never anything the POST asserts.
- **One request, many frames.** A POST body is newline-separated JSON, because
  this path pays a round trip per request. Each *line* is still held to the
  32 KB cap and metered individually — batching buys latency, not allowance.
- **Nothing comes back in the response.** `204`, always. Every answer — `pong`,
  errors, `peers`, forwarded frames — goes down the stream, exactly as it would
  over a WebSocket. `404` is the exception and means "no such stream": the
  client must reopen rather than keep posting.

The client (`src/transport/relay.js`) picks this path on its own after two
WebSocket attempts that never become usable, and tells the user it did.

## Limits

| Limit | Value | Source |
|---|---|---|
| Frame size | 32 KB | FR-2.8 |
| Rate | 10 msg/s per connection | §6 |
| Peers per room | 8 | §6 |
| Room TTL after last peer leaves | 10 min | FR-3.4 |
| POST body (fallback) | 768 KB, one frame per line | each line still capped at 32 KB |
| POST requests (fallback) | 60/s per peer | charged on top of the frames inside them |
