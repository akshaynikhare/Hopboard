"""M0 idle-survival test: hold a connection open for 5 minutes on heartbeat alone.

Against a deployed relay this is the real test — corporate and platform proxies
commonly reap idle connections at 60-120 s (PRD 5.4), and the 30 s heartbeat
(FR-3.6) exists to prevent that.

Usage:  python test_idle.py [ws_base] [minutes]
"""

import asyncio
import json
import sys
import time

import websockets

BASE = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:8000"
MINUTES = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
HEARTBEAT = 30


async def main():
    room = f"idle{int(time.time())}"
    url = f"{BASE}/ws/{room}"
    deadline = time.monotonic() + MINUTES * 60
    beats = 0
    started = time.monotonic()

    print(f"Relay:  {BASE}")
    print(f"Idle test: {MINUTES:.0f} min, heartbeat every {HEARTBEAT}s\n", flush=True)

    try:
        async with websockets.connect(url) as sock:
            welcome = json.loads(await sock.recv())
            print(f"  connected — instance {welcome.get('instance')}")

            while time.monotonic() < deadline:
                await asyncio.sleep(HEARTBEAT)
                t0 = time.monotonic()
                await sock.send(json.dumps({"t": "ping"}))
                reply = json.loads(await asyncio.wait_for(sock.recv(), 10))
                rtt = (time.monotonic() - t0) * 1000
                beats += 1
                elapsed = time.monotonic() - started
                ok = reply.get("t") == "pong"
                print(f"  t+{elapsed:5.0f}s  beat {beats:2d}  "
                      f"{'pong' if ok else reply}  {rtt:.0f} ms", flush=True)
                if not ok:
                    print("\nFAIL: heartbeat did not return pong")
                    return 1

    except Exception as e:
        elapsed = time.monotonic() - started
        print(f"\nFAIL: connection dropped after {elapsed:.0f}s "
              f"({beats} beats) — {type(e).__name__}: {e}")
        return 1

    print(f"\nPASS: survived {MINUTES:.0f} min idle, {beats} heartbeats, no drop")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
