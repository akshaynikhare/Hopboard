# src/transport/ — rank 10

May import `core/`. May not import `clipboard/`, `files/`, `landing/` or anything in `ui/`.

**Nothing above this directory may import `relay.js`, `ws.js` or `sse.js`** — the static check
fails the commit. `protocol.js` is the one exception, because frame *shapes* are transport-agnostic
and `files/transfer.js` reads its type constants rather than hand-copying eleven string literals.

That boundary is not decoration. It is what let the entire SSE fallback land without a single UI
file changing, and it is the reason the transport could stay unsettled while everything above it
was built.

## The shape

`relay.js` is the facade. `ws.js` and `sse.js` are channels behind one contract —
`create → {send, close, isOpen}` — and know nothing but how to move frames.

Everything easy to get subtly different between two transports lives in `relay.js` **once**: the
hello, the 30 s heartbeat, jittered reconnect backoff, the last-clip replay, and which channel is
live. Adding a third channel should mean adding one file and one line.

## Rules

- A new frame type is declared in `protocol.js` and handled in `relay.js`. Nowhere else.
- The relay learns nothing. It sees a room hash and ciphertext, and is never told anything about
  the visitor. Widening that needs an argument in `docs/PRD.md` first.
- A blocked WebSocket usually **hangs rather than fails**, so there is no error to react to — only
  `NET.PROBE_MS` notices. Do not replace the probe with an error handler.
- Nothing here may decide which channel to use on a UI module's behalf. The status-bar picker emits
  `EV.TRANSPORT_SELECT`; `main.js` calls `setTransport()`.
