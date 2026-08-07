# src/files/

Files move directly between peers over a WebRTC data channel. Thumbnails go through the relay so a
preview appears immediately; the bytes only travel when someone asks for them.

| File | What it does |
|---|---|
| `transfer.js` | WebRTC negotiation and transfer, falling back to relay chunks when P2P cannot connect |
| `registry.js` | The in-memory file list. No IndexedDB, no server — closing the tab forgets everything |
| `chunker.js` | Chunking and reassembly. Pure data, no DOM, no network |
| `thumbs.js` | Thumbnail generation, entirely local |

Corporate networks often block the UDP that WebRTC needs. The transfer then falls back to
relay-chunked delivery, encrypted the same way, and the UI labels which path a file took.

Design: [../../docs/P2P-FILES.md](../../docs/P2P-FILES.md).
Rules that govern edits here: [CLAUDE.md](CLAUDE.md).
