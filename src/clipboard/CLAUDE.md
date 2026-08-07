# src/clipboard/ — rank 10

May import `core/`. May not import `transport/`, `files/` or `ui/`.

**`os.js` is the only file in the repository that may touch `navigator.clipboard`.** The static
check greps for it everywhere else. Two calls, one boundary — so the browser quirks, the permission
states and the failure modes all live in one readable file instead of being rediscovered per panel.

## The suppression ordering is the subtle part

In `capture.js` `apply()`, `lastSent` and the suppression window are set **before** writing to the
OS clipboard. Write first and the poller sees a "new" clipboard value one tick later, decides it is
a local capture, and bounces it back to the sender — forever. See `docs/CLIPBOARD-FLOW.md` §6.

## Rules

- Capture tiers are T0–T3 and they all funnel through one `capture()`. The desktop shell's native
  watcher is T0 and feeds the same funnel, which is why `main.js` and the editor needed no changes
  for it.
- No web app can read the clipboard in the background, on any browser — `readText()` requires
  window focus. Do not add code that appears to work around this; document it instead.
- Firefox and Safari cannot read the clipboard silently. Feature-detect and degrade; never assume
  Chromium.
- This directory announces what it captured on the bus. It does not know the network exists.
