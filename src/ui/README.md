# src/ui/

The rendering layer, split by role. The split is also a dependency order: panels compose features
and shell, and all three compose primitives.

### primitives/ — no domain knowledge

| File | What it does |
|---|---|
| `dom.js` | `$`, `$$`, `esc`, `bind`, and `setHTML()` — the one place HTML is written |
| `modal.js` | One focus-trapping dialog shell, so there cannot be three slightly different ones |
| `statusMenu.js` | The slide-up menus every status-bar item opens |

### shell/ — chrome that is always there

| File | What it does |
|---|---|
| `statusbar.js` | The bottom bar, and the transport picker on it |
| `banners.js` | Inline notices: clipboard permission, a pending clip, a peer joining |
| `lockGate.js` | The app greyed out and inert while a locked link has no PIN |
| `panes.js` | Collapsible sidebar panes |
| `resizer.js` | Draggable splitters |
| `mobileNav.js` | The phone layout's bottom tab bar |
| `toast.js` | Transient messages — and the app's only `aria-live` channel |

### features/ — self-contained, deletable without breaking the layout

| File | What it does |
|---|---|
| `lockButton.js` | "Lock session" in the header, and who is allowed to press it |
| `lockDialog.js` | The PIN prompt, and the notice shown to a device a lock removed |
| `syncMode.js` | The Live / Manual switch |
| `qr.js` | QR code for the current room |
| `whatsNew.js` | Release notes, read from `changelog.json` |
| `install.js` | PWA install criteria and the service-worker lifecycle |
| `cursors.js` | Live peer pointers |
| `hints.js` | Getting-started overlay on the empty editor |
| `appLinks.js` | Report / sponsor links in the header |
| `ads.js` | The single sponsor slot, under the editor |

### panels/ — the content surfaces

| File | What it does |
|---|---|
| `editor.js` | The main editor: gutter, Ln/Col, character counter |
| `filesPanel.js` | Files and images — thumbnails here, bytes over P2P |
| `sessionPanel.js` | Devices and settings, rendered into the status-bar menus |
| `historyPanel.js` | In-session clip history |

Rules that govern edits here, including where a new module belongs: [CLAUDE.md](CLAUDE.md).
