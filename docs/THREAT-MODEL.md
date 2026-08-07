# Threat model

What RealtimeClipboard protects, what it does not, and the arithmetic behind both.

`PRD.md` §7 is the requirement and the design argument. This file is the **published** version:
written for someone who has opened the network tab, does not trust the marketing copy, and wants
the numbers. Where the two disagree, this file is newer.

Scope: the hosted service at `realtimeclipboard.com` and the relay in `backend/`, as of
**2026-08-07**, v0.4.0. No third-party audit has been done. Nothing here has been reviewed by
anyone but the author — read it as a self-assessment, not an assurance.

---

## 1. The one-paragraph version

Text is encrypted with AES-GCM-256 in your browser before it is sent. The relay stores nothing on
disk and routes by a room hash. **But for an unlocked session the room hash is a plain SHA-256 of
your share key, so a party that sees room hashes — which means the relay operator — can recover
the key by brute force and decrypt the session.** That is cheap for a 6-character key and
practical for a 10-character one. **Against the relay operator, only a PIN-locked session is
end-to-end encrypted.** Against everyone else, including anyone on your network or on the same
Wi-Fi, all sessions are.

If that is a surprise, §4 is the section to read.

---

## 2. What the relay can see

The relay is one Python file. It holds room state in memory, writes nothing to disk, and has no
database — `backend/Dockerfile` declares no `VOLUME` and no writable path deliberately.

| It sees | It does not see |
|---|---|
| The room hash | The share key, directly |
| Ciphertext and its length | Plaintext of clips, files or filenames |
| Device nicknames, sent in the clear on `hello` | Your identity — no account, no email, no cookie |
| Routing fields: `originId`, `id`, `seq`, `total`, `crc` | Which device is which person |
| Message timing and frequency | File contents — those go peer-to-peer |
| Connection IP addresses | |

Signalling and cursor frames are sealed like clips (`encryptFrame()`); only routing fields stay in
the clear. Without that the relay would learn every SDP, ICE candidate and peer IP.

**Metadata is not hidden.** A locked session hides content and membership, not the existence of a
session. The relay knows some room had devices in it at some time.

---

## 3. The keys, and what each is worth

Generated keys are drawn from a 30-character alphabet (`23456789ABCDEFGHJKMNPQRSTVWXYZ` — no
`0/O`, no `1/I/L`).

| | Keyspace | Entropy |
|---|---:|---:|
| 6 characters — web default | 729,000,000 | **29.4 bits** |
| 10 characters — desktop default, "longer keys" in settings | 5.9 × 10¹⁴ | **49.1 bits** |

29.4 bits is not a lot. The project's position is that short keys are the product — a key you
cannot read down a phone line is a key nobody uses — and that the honest response is to say so and
offer the longer one, not to claim 6 characters is strong.

Two derivations, from `src/core/crypto.js`:

```
OPEN      roomHash = SHA-256("realtimeclipboard:" + KEY)[0..16]      -> sent to the relay
          aesKey   = PBKDF2-SHA256(KEY, "realtimeclipboard-v1", 250k) -> never sent

LOCKED    prk       = PBKDF2-SHA256(PIN, "realtimeclipboard-lock-v1:" + KEY, 600k)
          aesKey    = HKDF(prk, ".../aes")
          roomHash  = HKDF(prk, ".../room")   -> sent
          authToken = HKDF(prk, ".../auth")   -> sent, proves PIN knowledge
```

---

## 4. The weakness: the open room hash is not stretched

**Read the two lines above again.** `aesKey` is stretched with 250,000 PBKDF2 iterations.
`roomHash` is a single SHA-256 with a fixed prefix and **no per-session salt and no stretching**.

The room hash is what travels to the relay. So the attack is not "brute-force the ciphertext", it
is "brute-force the room hash", and the room hash is the cheap one. Recovering `KEY` from it hands
over `aesKey` for one further PBKDF2 run.

Order-of-magnitude, one consumer GPU, SHA-256 at ~10 GH/s:

| Attack on an **unlocked** session | 6-char key | 10-char key |
|---|---|---|
| Sweep the whole keyspace | **0.07 seconds** | **16.4 hours** |
| Precomputed roomHash → key table | **10.2 GB** — build once, reuse forever | 10.6 PB — infeasible |
| Then: recover `aesKey` | one PBKDF2 run | one PBKDF2 run |

**A 10-character key does not fix this.** It defeats the *table*, but a targeted preimage search
against one room hash is under a day on a single GPU, and hours on a handful.

### What this means in practice

- **Against a passive network observer** — someone on your Wi-Fi, your ISP, a coffee-shop router —
  the design holds. The room hash travels inside TLS, so they never see it.
- **Against the relay operator, or anyone who obtains relay logs, metrics or memory** — an
  unlocked session is **not** end-to-end encrypted in any meaningful sense. They hold the room
  hash by construction. For a 6-character key, recovering the plaintext is minutes of work with a
  table that fits on a cheap SSD.
- **A PIN-locked session is unaffected.** There `roomHash` is HKDF over a 600k-iteration PBKDF2
  whose salt includes the share key, so no global table exists and each guess costs a full PBKDF2.
  This is the correct construction, and the codebase already contains it.

### The fix, and why it is not shipped yet

Derive the open room hash from the PBKDF2 output instead of from the raw key — exactly the shape
`deriveLocked()` already uses. It costs **nothing at runtime**: `deriveKey()` already performs that
PBKDF2, so the room hash becomes one extra HKDF expansion over a value already in hand.

What it would cost instead, at the same GPU rate:

| | today | with the fix |
|---|---:|---:|
| 6-char sweep | 0.07 s | **40 GPU-hours** |
| 10-char sweep | 16.4 h | **~3,700 GPU-years** |

It is not shipped because **the key derivation is a wire format**. Changing it invalidates every
share link in existence and fails the golden vectors in `tests/unit/lock.mjs` — which is what
those vectors are for. It is a breaking change and it should be made deliberately, in its own
release, with the compatibility break stated in the commit body. Tracked as the top item in
`SEO.md` §10.

**Until it ships, the accurate claim is the one in §1**, and the marketing copy must not say more
than that.

### Why not Argon2

Argon2 is the better password hash and PBKDF2-HMAC-SHA256 is the dated one; that is not in dispute.
It is also **not the problem here**, and swapping it would fix nothing: the weakness is an
unstretched room hash, and an unstretched SHA-256 is equally unstretched whatever the *other*
derivation uses. Fix the construction first.

There is also a practical constraint worth stating plainly, because "just use Argon2" is the
predictable reply: `crypto.subtle` implements PBKDF2 and does not implement Argon2. Using Argon2
in the browser means shipping WebAssembly, which this project has avoided precisely so that the
whole cryptographic surface is a 175-line file anyone can read. That is a defensible trade at
250k/600k iterations. It would stop being defensible if it were being used as a reason not to fix
§4 — it is not.

---

## 5. Guessing and enumeration, online

Enumerating room hashes *against the live relay* is a different and much worse deal for the
attacker than offline work, which is the point of the limits in `backend/main.py`:

- `MAX_PEERS = 8` per room.
- Token buckets per connection, per class: **10 msg/s** interactive, 60 signalling, 400 bulk,
  60 HTTP. Over budget answers `RATE_LIMITED`; the HTTP path answers `429`.
- Rooms are evicted after **10 minutes idle**, so a room hash is only interesting while someone is
  using it.
- A locked room additionally checks `authToken` at join, trust-on-first-use per room. This is
  defence in depth against derivation bugs — the room's *name* already required the PIN — and is
  no defence against the relay operator.

None of this helps against §4, because §4 does not require talking to the relay at all.

---

## 6. The PIN, when a link leaks

The case the lock exists for: the link was forwarded, screenshotted, or pasted into a group chat.
Against someone **who has the link**, the share key contributes **zero** bits and the PIN is the
entire secret. One consumer GPU, PBKDF2-HMAC-SHA256 at 600k:

| PIN | Entropy | Offline |
|---|---|---|
| `1234` | ~13 bits | seconds |
| `445566` | ~20 bits | minutes |
| 6 characters, human-chosen | ~22 bits | minutes |
| 6 characters, mixed alphabet | ~36 bits | weeks |
| 4 dictionary words | ~52 bits | infeasible |

The UI reports entropy in bits at the point of entry rather than calling a short PIN "secure". The
minimum is 6 characters and free-form rather than 4–6 digits, because a 4-digit PIN is ~13 bits.

---

## 7. Files, WebRTC, and what happens when P2P fails

Files go **directly between the two browsers** over a WebRTC data channel and do not touch the
relay. They are encrypted in transit by DTLS, and the application layer encrypts on top, so no
fallback path ever exposes plaintext.

**There is no TURN server, deliberately.** TURN would fix connectivity on restrictive networks by
relaying the bytes — which costs bandwidth linear in file size and puts the operator back in the
data path, both of which contradict the design. `src/files/transfer.js` uses one public STUN
server (`stun.l.google.com:19302`), which learns only that some IP asked for its own reflexive
address.

**It does not silently fail.** Direct connection is attempted for `ICE_TIMEOUT_MS` (5 seconds);
if no candidate pair forms — the usual cause is a corporate network blocking UDP — the transfer
**falls back to relay-chunked delivery and is labelled visibly in the UI**. The relay sees
ciphertext chunks, the same as it does for text. `docs/P2P-FILES.md` §4 is the long version.

Limits: **5 MB** per file, 20 files per session, memory only.

---

## 8. What is out of scope

- **A compromised endpoint.** Malware, a hostile browser extension, or someone reading your screen
  defeats every clipboard tool including this one. The clipboard is readable by any app on the
  machine by design.
- **Traffic analysis.** Frame sizes and timing are not padded.
- **The relay operator's honesty about §2.** You are trusting a deployment you cannot inspect.
  `deploy/docker-compose.yml` brings up your own with TLS in one command; that is the answer, and
  it is why the Dockerfile has no volume.
- **Availability.** No uptime guarantee. Room state is in RAM and dies with the process.
- **Anything after decryption.** History is `sessionStorage` on your own device.

---

## 9. Reporting

`SECURITY.md` has the contact. Findings that contradict anything above are the most valuable kind
— particularly §4, which was found by reading the code rather than by an attack, and which nobody
outside the project has yet checked.
