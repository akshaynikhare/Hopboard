# src/clipboard/

The sending half — how text gets from the operating system into the session.

| File | What it does |
|---|---|
| `os.js` | The entire OS clipboard boundary. Two calls, and the only place `navigator.clipboard` appears |
| `capture.js` | The T0–T3 capture tiers, permission detection, and echo suppression |

Tiers, in the order they are preferred: **T0** a native watcher (desktop shell only, no focus
needed), **T1** paste, **T2** window focus, **T3** a poll while focused. Each falls back to the
next when the browser will not allow it.

Why background capture is impossible in a browser, and what that costs:
[../../docs/CLIPBOARD-FLOW.md](../../docs/CLIPBOARD-FLOW.md).

Rules that govern edits here: [CLAUDE.md](CLAUDE.md).
