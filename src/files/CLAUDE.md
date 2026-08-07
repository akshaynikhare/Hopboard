# src/files/ — rank 10

May import `core/`, and `transport/protocol.js` for frame shapes — the one sideways edge the
architecture allows, listed by name in `tests/unit/static-check.mjs`. May not import
`transport/relay.js`, `clipboard/` or `ui/`.

**The wire arrives by injection, not import.** `main.js` hands `transfer.js` and `registry.js` a
sender via `setSignalSender()`, which seals the frame and puts it on the relay. That is what keeps
this layer ignorant of which transport is live.

## Rules

- **The relay never sees file bytes in the clear.** Signalling — SDP, ICE candidates, and every
  chunk on the relay-fallback path — is encrypted by `main.js` `encryptFrame()`. Only routing
  fields stay readable. Adding a field means deciding which half it belongs in.
- **A peer may retract only files it announced.** `registry.js` `applyGone()` checks the
  relay-stamped `from`. Do not trust a `from` inside the payload.
- **Frame types are driven off `transfer.FRAMES`**, never a hand-written case list in `main.js`. An
  earlier version enumerated six of eleven and silently dropped file-accept, which carries the
  chunk plan — every transfer stalled with no error anywhere.
- **The transfer path is always visible.** P2P and relay-fallback are labelled in the UI. A silent
  downgrade is a privacy change the user did not agree to.
- Rejected files always report why. Silence reads as a broken app.

Design: [../../docs/P2P-FILES.md](../../docs/P2P-FILES.md).
