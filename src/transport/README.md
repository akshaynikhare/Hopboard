# src/transport/

Getting frames to the relay and back, over whichever channel the network allows.

| File | What it does |
|---|---|
| `relay.js` | The facade: protocol, hello, heartbeat, reconnect backoff, and which channel is live |
| `ws.js` | WebSocket channel — the default |
| `sse.js` | SSE downstream + POST upstream — the fallback for networks that swallow WebSockets |
| `protocol.js` | Wire frame shapes, transport-agnostic. See `docs/PRD.md` §6 |

The client tries WebSocket, gives it `NET.PROBE_MS` to become usable, and after
`NET.SWITCH_AFTER` attempts that never do, moves to SSE and says so in the status bar. Nothing
above this directory can tell which channel is carrying the session.

Rules that govern edits here: [CLAUDE.md](CLAUDE.md).
