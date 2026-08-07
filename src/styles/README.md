# src/styles/

Design tokens and one stylesheet per component.

`main.css` is the entry point — a single `<link>` in `app.html`, `@import`ing the rest in an order
that matters: `tokens.css` first, `mobile.css` last.

| Sheet | Covers |
|---|---|
| `tokens.css` | Every colour and metric in the app. Light and dark |
| `base.css` | Reset and scrollbars |
| `layout.css` | The shell grid |
| `appbar.css` `sidebar.css` `statusbar.css` `resizer.css` | Chrome |
| `editor.css` `files.css` `history.css` `qr.css` | Panels |
| `components.css` `banners.css` `hints.css` `ads.css` | Shared pieces |
| `mobile.css` | The phone layout. **Loads last**, and overrides earlier sheets by source order |

### lazy/

Fetched on first open rather than bundled, by the module that needs them:
`cursors.css`, `install.css`, `lock.css`, `whatsnew.css`.

Which half a new sheet belongs in is a correctness question, not a size one — see
[CLAUDE.md](CLAUDE.md).
