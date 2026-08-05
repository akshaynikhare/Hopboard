# LiveClip relay

In-memory WebSocket fan-out. No database, no disk, no Redis. ~170 lines.

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
# 20-check protocol gate
python test_relay.py ws://127.0.0.1:8000

# hold a connection open on heartbeat alone
python test_idle.py ws://127.0.0.1:8000 5
```

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
| `WS /ws/{room_hash}` | Join a room. Frames per PRD §6 |

## Limits

| Limit | Value | Source |
|---|---|---|
| Frame size | 32 KB | FR-2.8 |
| Rate | 10 msg/s per connection | §6 |
| Peers per room | 8 | §6 |
| Room TTL after last peer leaves | 10 min | FR-3.4 |
