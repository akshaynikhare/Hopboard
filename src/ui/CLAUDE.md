# src/ui/ — ranks 20–22

Everything that renders. Four folders, and the folder is a rank:

```
20  primitives/   dom, modal, statusMenu        no domain knowledge at all
21  shell/        persistent chrome              peers — shell and features
21  features/     self-contained behaviour       may not import each other
22  panels/       the content surfaces           composes all three
```

A panel may reach down to a feature, the shell, or a primitive. Nothing reaches up, and shell and
features do not reference each other — the first edge between them fails the static check rather
than quietly becoming a precedent.

**No module here may import `transport/relay.js`, `ws.js` or `sse.js`.** Emit on the bus and let
`main.js` do it. Importing `clipboard/` and `files/` *is* allowed and several modules do.

## Where a new module goes

| It is… | Folder |
|---|---|
| A DOM helper with no idea what the app does | `primitives/` |
| Chrome that is always on screen — a bar, a pane, a splitter | `shell/` |
| A feature that could be deleted without breaking the layout | `features/` |
| A content surface built out of the other three | `panels/` |

Register it with one `init()` line in `main.js`, inside `safeInit()`. Its stylesheet goes in
`../styles/` — see that directory's `CLAUDE.md` for which half.

## Non-negotiable

- **`innerHTML` is written only in `primitives/dom.js`**, through `setHTML()`. Everything else uses
  `esc()`. Anyone holding the session key can put markup on your clipboard, so this is a
  vulnerability boundary, not a style preference — Trusted Types in the CSP enforces it at runtime.
  Emptying a node is `clear()`: Chromium rejects `= ""` too, and the throw lands in whatever
  `catch` the caller happens to sit inside.
- **Use `primitives/modal.js`.** Do not hand-roll a dialog: it owns the inert shell, the tab ring,
  Escape and focus restore. And never mount to `#mount-modals` — `panels/filesPanel.js` rewrites
  that node on a 500 ms tick and would delete a dialog out from under its own focus trap.
- **No hex colours.** `../styles/tokens.css` owns every one.
- **An incoming clip must never destroy unsent editor text.** `main.js` checks `editor.isDirty()`
  and offers rather than applies. Anything else that overwrites user input owes the same care.
- **A failure here must not take down the session.** Every `init()` runs inside `safeInit()`;
  syncing is the product and nothing decorative gets to prevent it.
