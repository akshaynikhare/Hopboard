# M0 gate — results

| Field | Value |
|---|---|
| Date | 2026-08-05 |
| Milestone | M0 — de-risk the relay |
| Verdict | ✅ **CLEARED — 20/20 against the deployed relay** |
| Relay | https://realtimeclipboard.fastapicloud.dev |
| OI-1 | ✅ **Closed.** FastAPI Cloud passes WebSocket upgrades |

M0 exists to test one assumption before anything is built on it: *can this
architecture carry a WebSocket?* Everything below is evidence for or against that.

---

## 1. What was built

| Artifact | Purpose |
|---|---|
| [`backend/main.py`](../backend/main.py) | The relay. ~170 lines, in-memory rooms, no DB |
| [`backend/test_relay.py`](../backend/test_relay.py) | 45-check protocol gate, runs against any relay URL |
| [`backend/test_idle.py`](../backend/test_idle.py) | Long-idle heartbeat survival test |
| ~~`m0/index.html`~~ | Two-machine browser harness. **Removed once M0 closed** — the real app does everything it did, and [`tests/live/e2e.mjs`](../tests/live/e2e.mjs) automates the same checks against live crypto |
| [`backend/README.md`](../backend/README.md) | Deploy runbook, including the replica-pinning warning |

The relay went slightly beyond a throwaway echo spike because the real thing is
only ~170 lines. It already implements sender exclusion, last-clip replay, presence,
heartbeat, room eviction, size caps, rate limiting and the `intent` collision
handshake — so M1 inherits a working transport rather than restarting.

---

## 2. Local results — 20/20 passed

```
G1  WebSocket upgrade
  PASS  upgrade accepted — 21 ms
  PASS  welcome frame / instance id present
  PASS  create on empty room: existing == 0
G2  Two-peer exchange
  PASS  collision signal: existing == 1
  PASS  peer count broadcast
  PASS  A -> B delivered — 0.3 ms
  PASS  seq assigned by relay
G3  PASS  sender not echoed          (loop prevention, FR-3.2)
G4  PASS  B -> A delivered, seq incremented    (multi-directional)
G5  PASS  late joiner gets last clip, three peers reported
G6  PASS  ping -> pong
G7  PASS  32 KB cap enforced, connection survives oversize frame
    PASS  rate limit enforced
G9  PASS  /health reachable, instance id stable across WS and HTTP
```

**Same-host hop latency: 0.3 ms.** NFR-1 budgets 300 ms p95 over a real network, so
the relay itself consumes a negligible share of that. The number that matters is
the deployed one, still to be measured.

### Protocol defect found and fixed
The relay sent a newly joined peer a `peers` frame duplicating the count its
`welcome` had already carried. Harmless in isolation, but it desynchronised every
client that reads frames in order, and it would have surfaced during M1 as
"messages arriving in the wrong order" — expensive to diagnose then, trivial now.
Presence frames now report *changes* only and exclude the joiner.

### Client defects found and fixed
Two bugs in the browser harness, both in the OI-2 collision path:
- clicking **Connect** overwrote `intent` back to `"join"`, so a generated key would
  never have been checked for collision — the exact bug OI-2 was written to prevent
- receiving a clip cleared the last-hop latency readout

---

## 3. Gate criteria status

| Criterion | Status | Evidence |
|---|---|---|
| WS upgrade succeeds **locally** | ✅ Pass | 21 ms, 20/20 checks |
| Two peers exchange a string | ✅ Pass | Both directions, seq ordering correct |
| Sender exclusion (no loop) | ✅ Pass | G3 |
| Late-joiner replay | ✅ Pass | G5 |
| Split-brain detection (OI-3) | ✅ Built | `/health` instance id + client banner |
| Collision handshake (OI-2) | ✅ Built | `intent` + `existing`, verified in G1/G2 |
| 5-minute idle survival, local | ✅ Pass | 10 heartbeats, no drop — §5 |
| **WS upgrade on FastAPI Cloud (OI-1)** | ✅ **PASS** | **973 ms, 20/20 — §4** |
| Cold-start wake (R2 / D8) | ✅ Measured | 973 ms first connect — see D8 below |
| **Replicas pinned to 1 (OI-3)** | ❌ **Not applied** | **Dashboard only, still needs doing** |
| Corporate-network path (OI-12) | ❌ Not tested | Needs an on-network machine |

**OI-1 was the architecture's load-bearing assumption and it holds.** The SSE+POST
fallback in PRD §4.3 is no longer needed. The transport interface stays behind
`connect/send/onMessage/close` anyway — it cost nothing and keeps the option open.

**D8 resolves to "do nothing".** Cold start was 973 ms including TLS handshake —
well under the ~2 s threshold where a keep-alive would have been worth its
fair-use cost. Show a brief "Connecting…" and move on.

---

## 4. Deployed results — 20/20 passed ✅

`python test_relay.py wss://realtimeclipboard.fastapicloud.dev`

```
G1  PASS  upgrade accepted — 973 ms          <-- OI-1 ANSWERED
    PASS  welcome / instance 2cd9c0e9 / existing == 0
G2  PASS  collision signal, peer broadcast
    PASS  A -> B delivered — 278 ms          <-- real cross-region hop
    PASS  seq assigned by relay
G3  PASS  sender not echoed
G4  PASS  B -> A delivered, seq incremented
G5  PASS  late joiner replay, three peers
G6  PASS  ping -> pong
G7  PASS  32 KB cap, survives oversize, rate limit
G9  PASS  /health reachable, instance stable across WS and HTTP
```

| Measure | Local | Deployed | Note |
|---|---|---|---|
| WS upgrade | 21 ms | **973 ms** | First connect includes TLS + scale-to-zero wake |
| Warm hop A→B | 0.3 ms | **278 ms** | NFR-1 budgets 300 ms p95 — **just inside it** |
| `/health` round trip | — | 312 ms | Warm |

**Latency is the finding that matters.** 278 ms sits right on the 300 ms budget,
and the app is in `us-east-1` while the test ran from India. Two consequences:

- For same-continent users this is comfortable. For the intended
  India-based users it is borderline, and **NFR-1 should be restated as a
  same-region target** with a separate cross-region figure, rather than quietly
  failing a global one.
- If it needs improving, region choice is the lever, not code. The relay spends
  ~0 ms on the message — this is all network.

### Deployment failures, and what caused them

Three failed deployments before the green one. Both causes were configuration,
neither was the relay code:

| Deployment | Status | Cause |
|---|---|---|
| `eebabe96` | `verifying_failed` | **Application Directory was `null`**, so FastAPI Cloud built the repository *root* — where the static site lives and no ASGI app exists. Fixed by setting it to `backend` |
| `21f9f6d3` | `verifying_failed` | Same; started before the directory was set |
| `5f151430` | `building_image_failed` | `Multiple top-level modules discovered in a flat-layout: ['main', 'test_relay', 'test_idle']` — setuptools would not guess which module to package. Fixed with `py-modules = ["main"]` in `backend/pyproject.toml` |
| `success` | ✅ | Serving |

The directory default is the trap worth remembering: FastAPI Cloud assumes the
repo root, and this repo deliberately puts the static site there.

### A Cloudflare quirk

`/health` initially failed the gate with **403 Forbidden** — from urllib only.
`curl` and browsers got 200 throughout. Cloudflare fronts FastAPI Cloud and
blocks the default `Python-urllib/3.x` User-Agent. The harness now sends a
normal UA. Worth knowing before writing any monitoring or uptime check against
this relay.

---

## 5. Idle survival (local, 5 min) — ✅ passed

```
connected — instance 785fa4d7
  t+  30s  beat  1  pong  1 ms
  t+  60s  beat  2  pong  1 ms
  ...
  t+ 300s  beat 10  pong  1 ms

PASS: survived 5 min idle, 10 heartbeats, no drop
```

Ten heartbeats at 30 s, no drop, sub-millisecond replies throughout. The relay
holds an idle connection open and the heartbeat mechanism (FR-3.6) works.

The local run only proves the relay does not drop idle connections *itself*. The
meaningful version is against the deployed relay from inside the corporate
network, where TLS-inspecting proxies commonly reap idle connections at 60–120 s
(PRD §5.4). That run is what validates the 30 s interval as the right choice.

---

## 6. Additional verification

**Room-hash derivation is correct.** The browser derives the room name as
`SHA-256("liveclip:" + KEY)` truncated to 16 bytes. **The prefix was later
renamed to `"realtimeclipboard:"` when the product was named, so the hashes below no
longer reproduce against the shipped code — they are kept as the record of
what was actually verified at M0.** Verified against an
independent Python implementation:

```
D75LV   659a0ae29a116cfdd3a02c84f3113bf9   (JS and Python agree)
ABCDEF  527b60b99dcd0f9847c4b0b68b4176c8   (JS and Python agree)
```

Note `D75LV` and `d75lv` hash differently, which is why the client uppercases the
key before hashing — otherwise FR-1.4's case-insensitive join would silently put
two users in different rooms. Already handled; worth keeping in mind for M1, since
every future key-handling path must normalise before hashing.

**Client JS syntax-checked** with `node --check`.
