# How the clipboard actually reaches the OS

The single most confusing part of this product. This document is the answer to
"wait, so does it read my clipboard or not?"

**Short version:** writing to the OS clipboard is easy and automatic. *Reading* it
is the hard half — the browser only lets us read while our window is focused. So
sending requires you to come back to the app; receiving does not.

---

## 1. The OS boundary is exactly two function calls

Everything that touches the system clipboard goes through these:

```
        ┌─────────────────── the browser sandbox ────────────────────┐
        │                                                             │
 OS     │   navigator.clipboard.readText()   ──► text into the app   │
clip-   │        ▲ needs: focus + permission + HTTPS                  │
board   │                                                             │
        │   navigator.clipboard.writeText(t) ◄── text out of the app  │
        │        ▲ needs: focus                                       │
        └─────────────────────────────────────────────────────────────┘
```

That is the whole OS integration. No extension, no native helper, no daemon.
Which also means every limitation below is a browser rule we cannot engineer
around — only design around.

---

## 2. Sending: your copy → other machines

The browser gives us no "clipboard changed" event. Nothing exists to subscribe
to. So capture happens at moments we *are* allowed to look:

```
  You press Ctrl+C in any app
            │
            ▼
  ┌───────────────────────────────────────────────────────┐
  │  The OS clipboard now holds your text.                │
  │  RealtimeClipboard cannot see it yet — it isn't focused.       │
  └───────────────────────────────────────────────────────┘
            │
            │   ... one of these three things happens ...
            │
  ┌─────────┴──────────┬────────────────────┬──────────────────────┐
  ▼                    ▼                    ▼                      │
 T1 You paste      T2 You switch       T3 You're already          │
 into the app      back to the app     in the app                 │
 (Ctrl+V)          (Alt-Tab)           (polling, 1s)              │
  │                    │                    │                      │
  │ paste event        │ focus event        │ interval timer       │
  │ NO permission      │ needs permission   │ needs permission     │
  ▼                    ▼                    ▼                      │
  └─────────────► readText() / e.clipboardData ◄───────────────────┘
                          │
                          ▼
                 encrypt (AES-GCM, key never sent)
                          │
                          ▼
                 WebSocket ──► relay ──► other devices
```

**T1 always works.** No permission, every browser, every platform. It is the
floor the product stands on, not a fallback for edge cases.

**T2 is the everyday path** on desktop once permission is granted: copy, Alt-Tab
to RealtimeClipboard, and it is already sent by the time you look at it.

**T3 only helps while the window is already focused**, which is a narrower case
than it sounds — mostly copying from one part of a page to another.

---

## 3. Receiving: their copy → your machine

Much simpler, because writing needs no permission:

```
  relay ──► WebSocket ──► decrypt ──► navigator.clipboard.writeText()
                                              │
                                              ▼
                                    Your OS clipboard is updated.
                                    Ctrl+V anywhere now pastes it.
```

If the window happens to be unfocused when the clip arrives, `writeText()` is
refused. We do not drop the clip — it queues, the UI shows a **"1 pending"**
badge, and it is written the moment you focus the window. Same gesture as
sending, so the user learns one rule instead of two.

---

## 4. The round trip

```
   MACHINE A                    RELAY                    MACHINE B
   ─────────                    ─────                    ─────────
   Ctrl+C  (OS clipboard)
      │
      │ Alt-Tab to app
      ▼
   readText()  ← focus
      │
   encrypt
      │
      └──────────► ws ──────► fan out ──────► ws ──────────┐
                            (ciphertext only,              │
                             never decrypted)              ▼
                                                       decrypt
                                                           │
                                                     writeText()
                                                           │
                                                           ▼
                                                  Ctrl+V (OS clipboard)
```

Total time on the wire is a few hundred milliseconds. The human part — noticing
you need to switch windows — dominates.

---

## 5. Why not just watch the clipboard in the background?

Because no web app can, on any browser, by design. `readText()` rejects with
`DOMException: Document is not focused` the instant the window loses focus. It is
an anti-exfiltration rule: a background tab that could silently read your
clipboard would harvest every password you copy.

A Chrome extension with the `clipboardRead` permission *can* poll in the
background — but extensions are blocked in the target corporate environment
(PRD §1.4), so that door is closed permanently, not just for v1.

**The honest mental model to build into the UI:**

> *"Switch to RealtimeClipboard and it grabs what you copied"* — **not** *"it watches my
> clipboard."*

The app must never render a state implying background capture. If the last
capture was four minutes ago, the UI says so.

---

## 6. Loop prevention

Without care, this happens:

```
  A writes clip → B receives → B writes to its OS clipboard
                             → B's own poller sees a "new" clipboard value
                             → B broadcasts it back → A receives → ... forever
```

Three guards, any one of which would mostly work; together they close it:

1. **Sender exclusion** — the relay never echoes to the sender (verified in M0)
2. **Content dedupe** — `lastSeen` is set *before* writing, so a poller that sees
   the value we just wrote recognises it (FR-2.7)
3. **`originId` + suppression window** — 1500 ms after applying a remote clip,
   local capture is muted (FR-2.6)

---

## 7. Failure modes and what the user sees

| Situation | Cause | What the UI shows |
|---|---|---|
| Permission not yet granted | First visit | Blue banner: "Allow clipboard access" with the reason |
| Permission denied | User declined, or policy | "Paste with Ctrl+V — that always works." No dead end |
| Copy not picked up | Window never regained focus | Last-capture timestamp, so staleness is visible |
| Incoming clip while unfocused | `writeText()` refused | "1 pending" badge; written on focus |
| Firefox / Safari | No silent read exposed | Capability banner; T1 paste path only |
| Not HTTPS | Clipboard API unavailable | Hard error — the site is HTTPS-only (HSTS, see `_headers`), so this only bites local `file://` testing |

---

## 8. Try it

[`index.html`](../index.html) has this wired to the real OS clipboard — the
network is stubbed but the clipboard code is production. Open it, grant
permission, copy something in another app, then switch back: it appears. That
switch-back is the entire user model, and it is worth feeling before committing
to the design.
