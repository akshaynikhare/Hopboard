# Files: thumbnails over the relay, bytes over P2P

**Design in one line:** thumbnails travel automatically over the relay; the actual
file bytes only move when someone asks, and they move directly between browsers.

---

## 1. What travels, and when

```
   MACHINE A                        RELAY                       MACHINE B
   ─────────                        ─────                       ─────────
   drop photo.jpg (4.2 MB)
        │
        ├─ generate thumbnail locally (canvas, ~8 KB)
        │
        ├─ encrypt {id, name, size, type, thumb}
        │        └──────────► forward ──────────►  thumbnail appears
        │                                          in B's grid, marked P2P
        │
        │  ... the 4.2 MB stays on A's disk. Nothing was uploaded ...
        │
        │                                          B clicks the thumbnail
        │        ◄────────── "request id" ◄────────┘
        │
        ├─ WebRTC data channel opens (signalled over the relay)
        │
        └━━━━━━━━━━━━━ 4.2 MB, direct, A ⇄ B ━━━━━━━━━━━━━━━━►
                     (never touches the relay)
```

Two properties fall out of this:

- **The relay's bandwidth bill does not scale with file size.** Only ~8 KB of
  thumbnail per file crosses it. This matters on a free tier.
- **Nothing is stored anywhere.** The file exists on A's disk and, after transfer,
  on B's. There is no bucket, no object store, no cleanup job.

---

## 2. Why not just push files through the relay?

A 5 MB file through a 0.1 vCPU / 512 MB shared instance, for every transfer, on a
free plan — that is the fastest route to either a bill or a throttle. It also
turns the relay from a message router into a file server, which is the thing the
"minimum backend" goal (G6) exists to avoid.

---

## 3. How the P2P connection is made

WebRTC needs a signalling channel to exchange connection details. **We already have
one** — the relay. No new infrastructure:

```
  A ──► relay: {t:"rtc-offer",  to:B, sdp:…}
  B ──► relay: {t:"rtc-answer", to:A, sdp:…}
  A ⇄ relay: {t:"rtc-ice", …}          (ICE candidates, both ways)
  A ⇄ B: data channel open, transfer begins
```

The relay forwards these blindly, exactly as it forwards clips. It learns nothing
it did not already know.

---

## 4. ⚠️ The corporate-network problem

**This is the same class of risk as OI-1 and it deserves the same scepticism.**

WebRTC establishes direct connections over UDP. Managed corporate networks
routinely block outbound UDP except DNS, and TLS-inspecting proxies do not pass
peer-to-peer traffic at all. The environment this product is being built for
(PRD §5.4) is precisely the environment where P2P is least likely to connect.

Realistic expectations:

| Network | Direct P2P likely? |
|---|---|
| Home / consumer broadband | Usually yes |
| Mobile (Android on 4G/5G) | Often, but carrier-grade NAT breaks some pairs |
| Corporate managed network | **Frequently no** |
| Two machines on the same corporate LAN | Sometimes — host candidates may connect locally |

The standard fix is a **TURN server**, which relays the traffic when a direct path
cannot be found. But TURN has two properties that matter here: it costs bandwidth
money, and the data flows through it — so the transfer is no longer peer-to-peer
in any meaningful sense. It solves connectivity by abandoning the property that
motivated the design.

### Recommended answer: P2P preferred, relay-chunk fallback

Rather than run a TURN server, fall back to the relay we already have:

```
  1. Try WebRTC direct         (free, fast, private — works outside corporate)
  2. If ICE fails after ~5 s → chunk the file over the existing WebSocket
                               (encrypted, 32 KB frames, ~160 frames for 5 MB)
  3. Show the user which path was used — the peer list already has P2P / RELAY badges
```

This works because the file cap is 5 MB, not 5 GB. The relay stores nothing, and
the payload is end-to-end encrypted, so a fallback transfer is no more legible to
the relay than a direct one.

**Be honest about the speed, though.** The earlier "~160 frames" figure was wrong
twice over: the real chunk size is ~18 KB (see §5), giving **289 frames**, and the
sender paces at 8 frames/sec to stay under the relay's interactive cap and leave
room for heartbeats. So a 5 MB file over the fallback takes roughly **36 seconds**,
not the few seconds this document previously implied.

That is survivable, but it is not a footnote: on the target corporate network the
fallback is the *common* path, not the exception. The UI must show progress and
the RELAY label from the moment the fallback is chosen — a 36-second transfer with
no feedback is indistinguishable from a hang.

**The UI must never silently fall back.** A user in a corporate office should be
able to see that their file went via the relay, because that is a different
privacy and performance story from a direct transfer.

---

## 5. Limits

| Limit | Value | Why |
|---|---|---|
| Max file size | 5 MB | Keeps relay fallback viable; keeps thumbnails cheap |
| Thumbnail | 160 px longest edge, JPEG q0.7, ~8 KB | Rides inside the normal encrypted envelope |
| Files per session | 20 | In-memory only; a browser tab is not a filing cabinet |
| Chunk size (P2P) | 32 KB | Raw binary over the data channel |
| Chunk size (relay fallback) | ~18 KB, derived | See the correction below |

> **Correction.** An earlier version of this document claimed the fallback could
> reuse the 32 KB chunk size because it "matches the existing relay frame cap —
> no protocol change". That is wrong. The relay's 32 KB cap applies to the
> *encoded JSON frame*, and a relay chunk is base64'd (×4/3) with an AES-GCM tag
> and envelope fields on top. A 32 KB chunk becomes a ~44 KB frame and the relay
> rejects it — the fallback would have failed on its first chunk, on exactly the
> corporate networks it exists to serve.
>
> `files/chunker.js` therefore *derives* `RELAY_CHUNK_BYTES` from
> `FILES.CHUNK_BYTES` by working backwards through the expansion, landing at
> ~18 KB and 289 chunks for a 5 MB file. Derived rather than hand-tuned, so the
> two cannot drift apart. Still comfortably inside the relay's 400 chunks/sec
> bulk allowance.

Non-image files get an extension-based icon instead of a thumbnail. There is no
server-side rendering of anything.

---

## 6. Security notes

- Thumbnails are encrypted with the same session key as text. The relay sees
  ciphertext.
- WebRTC data channels are DTLS-encrypted by default, and we encrypt the payload
  on top, so a TURN or relay fallback never exposes plaintext.
- **A thumbnail is a preview of your file that travels automatically.** For a
  screenshot of something sensitive, the thumbnail may be legible. Worth a
  setting: "send thumbnails" on/off, defaulting to on for images under a size
  threshold. Raised as an open question rather than decided.
- File requests are authenticated only by session membership — anyone with the key
  can request any file in the session. Same bearer-credential model as the text.
- **The approval prompt is docked, not modal** (FR-7.9). It used to cover the
  screen, on the reasoning that it is the last point at which anything can stop
  bytes leaving the disk. That reasoning was half right: the safety comes from
  nothing moving without a click and from an unanswered prompt expiring into a
  denial — both still true — while covering the screen only meant one device
  could stop another being used by asking for a file and walking away.
- **"Allow all" is deliberately small.** A standing approval for one device,
  scoped to the room and the tab, dropped when the key rotates, and every
  transfer it authorises still announces itself. Three limits, each with a
  failure it prevents: not global, or one impatient click covers strangers who
  join later; not cross-room, or rotating the key — the way a device is thrown
  out — would leave it trusted; not persistent, or "just this once" quietly
  becomes forever. `autoaccept` in Settings remains the permanent version, where
  a permanent choice is made deliberately.

---

## 7. Build order

| Stage | Scope |
|---|---|
| Now (layout) | Drop zone, 5 MB cap, local thumbnail generation, tile grid — **all working** |
| M1 | Thumbnails ride the relay; remote tiles appear on other devices |
| M7 | WebRTC signalling over the relay, data channel, progress, cancel |
| M7.1 | Relay-chunk fallback + explicit P2P / RELAY labelling |
