"""M0 gate harness for the LiveClip relay.

Exercises every M0 exit criterion against a running relay.
Usage:  python test_relay.py [base_url]      e.g. ws://127.0.0.1:8000
"""

import asyncio
import json
import sys
import time

import websockets
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:8000"
HTTP = BASE.replace("wss://", "https://").replace("ws://", "http://")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))
    return ok


async def recv(sock, timeout=5.0):
    return json.loads(await asyncio.wait_for(sock.recv(), timeout))


async def recv_data(sock, timeout=5.0):
    """Next frame that isn't presence noise — peers frames are async and unordered
    relative to clips, so tests that care about payloads must skip them."""
    while True:
        m = json.loads(await asyncio.wait_for(sock.recv(), timeout))
        if m.get("t") != "peers":
            return m


async def send(sock, obj):
    await sock.send(json.dumps(obj))


async def main():
    room = f"m0test{int(time.time())}"
    url = f"{BASE}/ws/{room}"

    print(f"\nRelay: {BASE}\nRoom:  {room}\n")

    # --- G1: WebSocket upgrade succeeds (OI-1, the blocker) -------------
    print("G1  WebSocket upgrade")
    t0 = time.monotonic()
    try:
        a = await asyncio.wait_for(websockets.connect(url), timeout=30)
        connect_ms = (time.monotonic() - t0) * 1000
        check("upgrade accepted", True, f"{connect_ms:.0f} ms")
    except Exception as e:
        check("upgrade accepted", False, f"{type(e).__name__}: {e}")
        return summarise()

    w = await recv(a)
    check("welcome frame", w.get("t") == "welcome", json.dumps(w)[:120])
    check("instance id present", bool(w.get("instance")), w.get("instance", ""))
    check("create on empty room: existing == 0", w.get("existing") == 0)

    # --- G2: two peers exchange a string --------------------------------
    print("\nG2  Two-peer exchange")
    b = await websockets.connect(url)
    wb = await recv(b)
    check("second peer welcomed", wb.get("t") == "welcome")
    check("collision signal: existing == 1", wb.get("existing") == 1,
          "an auto-generated key landing here would regenerate (OI-2)")

    pa = await recv(a)   # peers broadcast from b joining
    check("peer count broadcast", pa.get("t") == "peers" and pa.get("count") == 2,
          json.dumps(pa))

    t0 = time.monotonic()
    await send(a, {"t": "clip", "payload": "Y2lwaGVydGV4dA==", "iv": "aXYxMjM=",
                   "originId": "peerA"})
    got = await recv_data(b)
    hop_ms = (time.monotonic() - t0) * 1000
    check("A -> B delivered", got.get("t") == "clip" and got.get("payload") == "Y2lwaGVydGV4dA==",
          f"{hop_ms:.1f} ms")
    check("seq assigned by relay", got.get("seq") == 1, f"seq={got.get('seq')}")

    # --- G3: sender exclusion (loop prevention, FR-3.2) -----------------
    print("\nG3  Sender exclusion")
    try:
        echo = await recv_data(a, timeout=1.0)
        check("sender not echoed", False, f"got {json.dumps(echo)[:80]}")
    except asyncio.TimeoutError:
        check("sender not echoed", True)

    # --- G4: bidirectional ----------------------------------------------
    print("\nG4  Reverse direction")
    await send(b, {"t": "clip", "payload": "YmFja3dhcmRz", "iv": "aXY0NTY=",
                   "originId": "peerB"})
    got = await recv_data(a)
    check("B -> A delivered", got.get("payload") == "YmFja3dhcmRz")
    check("seq incremented", got.get("seq") == 2, f"seq={got.get('seq')}")

    # --- G5: last-clip replay to a late joiner (FR-3.3) -----------------
    print("\nG5  Late joiner replay")
    c = await websockets.connect(url)
    wc = await recv(c)
    last = wc.get("last") or {}
    check("late joiner gets last clip", last.get("payload") == "YmFja3dhcmRz",
          json.dumps(last)[:100])
    check("three peers reported", wc.get("peers") == 3, f"peers={wc.get('peers')}")
    await c.close()

    # --- G6: heartbeat (FR-3.6) -----------------------------------------
    print("\nG6  Heartbeat")
    await send(a, {"t": "ping"})
    m = await recv_data(a)
    check("ping -> pong", m.get("t") == "pong", json.dumps(m)[:80])

    # --- G7: size cap (FR-2.8) -------------------------------------------
    print("\nG7  Limits")
    await send(a, {"t": "clip", "payload": "x" * 40000, "iv": "aXY=", "originId": "peerA"})
    m = await recv_data(a)
    check("32 KB cap enforced", m.get("code") == "TOO_LARGE", json.dumps(m)[:80])
    check("connection survives oversize frame", a.state.name == "OPEN", a.state.name)

    # --- G8: rate limit ---------------------------------------------------
    for i in range(15):
        await send(a, {"t": "clip", "payload": "eA==", "iv": "aXY=", "originId": "peerA"})
    limited = False
    try:
        for _ in range(20):
            m = await recv(a, timeout=1.0)
            if m.get("code") == "RATE_LIMITED":
                limited = True
                break
    except asyncio.TimeoutError:
        pass
    check("rate limit enforced", limited)

    await a.close()
    await b.close()

    # --- G9: /health (OI-3) ----------------------------------------------
    print("\nG9  Health endpoint")
    try:
        with urllib.request.urlopen(f"{HTTP}/health", timeout=10) as r:
            h = json.loads(r.read())
        check("/health reachable", h.get("ok") is True, json.dumps(h))
        check("instance id stable", h.get("instance") == w.get("instance"),
              f"ws={w.get('instance')} http={h.get('instance')}")
    except Exception as e:
        check("/health reachable", False, f"{type(e).__name__}: {e}")

    return summarise()


def summarise():
    print("\n" + "=" * 62)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"M0 GATE: {passed}/{total} checks passed")
    for name, ok, detail in results:
        if not ok:
            print(f"   FAILED: {name}  {detail}")
    print("=" * 62)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
