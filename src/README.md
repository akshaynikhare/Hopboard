# src/

The frontend. Plain ES modules — what is here is what the browser loads, so `python -m http.server`
is the whole development setup. The deploy is bundled from this tree but never replaces it.

`main.js` is the composition root: the one file that imports across layers and wires them together.
Everything else talks through `core/bus.js`.

| Directory | What it holds |
|---|---|
| [core/](core/) | bus, config, state, crypto, keys, storage, paths, device, history — no DOM, node-importable |
| [transport/](transport/) | the relay connection and its two interchangeable channels |
| [clipboard/](clipboard/) | the OS clipboard boundary and the capture tiers above it |
| [files/](files/) | peer-to-peer file transfer, chunking, thumbnails, the in-memory registry |
| [ui/](ui/) | everything that renders, split by role into primitives, shell, features and panels |
| [styles/](styles/) | design tokens and per-component CSS; `lazy/` is fetched on demand |
| [landing/](landing/) | the marketing page — a separate document from the app |
| [pages/](pages/) | static content pages, copied to the site root rather than bundled |

`core/` and `transport/` are also what the npm package ships, so the CLI in [../cli/](../cli/) runs
the same crypto and the same protocol as the browser.

Conventions and the import rules: [CLAUDE.md](CLAUDE.md). Design rationale:
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
