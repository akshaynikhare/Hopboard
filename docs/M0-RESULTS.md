# M0 gate — results

| Field | Value |
|---|---|
| Date | 2026-08-05 |
| Milestone | M0 — de-risk the relay |
| Verdict | **Partially cleared — local transport proven, deployed transport still unverified** |
| Blocker remaining | OI-1 requires a FastAPI Cloud login to resolve |

M0 exists to test one assumption before anything is built on it: *can this
architecture carry a WebSocket?* Everything below is evidence for or against that.

---

## 1. What was built

| Artifact | Purpose |
|---|---|
| [`backend/main.py`](../backend/main.py) | The relay. ~170 lines, in-memory rooms, no DB |
| [`backend/test_relay.py`](../backend/test_relay.py) | 20-check protocol gate, runs against any relay URL |
| [`backend/test_idle.py`](../backend/test_idle.py) | Long-idle heartbeat survival test |
| [`m0/index.html`](../m0/index.html) | Two-machine browser harness — the human-visible proof |
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
| **WS upgrade on FastAPI Cloud (OI-1)** | ❌ **Not tested** | **Needs login — the actual blocker** |
| Cold-start wake time (R2 / D8) | ❌ Not tested | Needs deploy |
| Replicas pinned to 1 (OI-3) | ❌ Not applied | Dashboard setting, needs deploy |
| Corporate-network path (OI-12) | ❌ Not tested | Needs deploy + on-network machine |

**Local success proves the code is correct. It says nothing about OI-1**, which was
always a question about FastAPI Cloud's ingress proxy, not about FastAPI. Uvicorn
speaks WebSockets locally by definition; whether the platform passes an HTTP
Upgrade through is exactly what remains unknown.

---

## 4. To finish the gate

```bash
cd backend
fastapi login                                    # opens a browser — needs you
fastapi deploy
# then: dashboard -> scaling -> max replicas = 1  (OI-3, no CLI flag exists)

python test_relay.py wss://<app>.fastapicloud.dev
python test_idle.py  wss://<app>.fastapicloud.dev 5
```

The first check of `test_relay.py` prints the upgrade time, which answers both OI-1
(does it connect at all) and R2 (how long a cold start takes). If the upgrade is
refused, the fallback is SSE + POST — the message schema in PRD §6 is unchanged and
the client transport is already isolated behind `connect/send/onMessage/close`.

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
`SHA-256("liveclip:" + KEY)` truncated to 16 bytes. Verified against an
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
