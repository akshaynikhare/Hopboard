# src/ — the app

Native ES modules, served as they are on disk. No build step in development; `tools/build/build.mjs`
bundles this tree into `_site` for the deploy and never writes back into it.

## Imports point downhill, never up or sideways

Every directory has a rank. A module may import from a **lower** rank or from **its own directory**,
and nothing else. `tests/unit/static-check.mjs` enforces it.

```
 0   core/                                    imports nothing above it
10   transport/  clipboard/  files/  landing/ peers — may not import each other
20   ui/primitives/                           dom, modal, statusMenu
21   ui/shell/   ui/features/                 peers — may not import each other
22   ui/panels/                               composes shell + features + primitives
99   main.js                                  the only file that may cross layers
```

One sideways edge is allowed and listed by name in the check: `files/transfer.js` reads
`transport/protocol.js` for frame shapes, which are transport-agnostic by design.

Everything else crosses via `core/bus.js`. UI emits an event, `main.js` hears it and calls the
transport. That boundary is what let the WebSocket→SSE failover ship without one UI file changing.

## Placement

| Adding… | Goes in |
|---|---|
| A constant, limit, timeout or cap | `core/config.js` — nowhere else |
| A wire frame | `transport/protocol.js`, handled in `transport/relay.js` |
| Anything touching the system clipboard | `clipboard/os.js` — the only file that may |
| A reusable DOM helper | `ui/primitives/` |
| Persistent chrome (bar, pane, splitter) | `ui/shell/` |
| A self-contained feature | `ui/features/` |
| A content surface that composes the above | `ui/panels/` |
| A stylesheet | `styles/` if `main.css` should bundle it, `styles/lazy/` if a panel fetches it |
| A content page | `pages/<name>/index.html` — root-absolute links only, see `pages/CLAUDE.md` |

A new feature should touch no existing module beyond one `init()` line in `main.js`. If it does,
the boundary is in the wrong place.

## Non-negotiable

- **Never resolve a path from `import.meta.url`.** Use `core/paths.js`. Bundling collapses this
  tree and shifts every such path at once, silently.
- **`innerHTML` is written only in `ui/primitives/dom.js`**, through `setHTML()`. Trusted Types in
  the CSP enforces it at runtime; the static check enforces it at commit.
- **Every colour comes from `styles/tokens.css`.**
- **Event names are `EV.*` constants** from `core/bus.js`. A typo'd string literal is a silent no-op.
