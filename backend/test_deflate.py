"""
Is permessage-deflate actually off?

The relay disables the WebSocket compression extension at import time, because
`websockets` negotiates it by default and every accepted connection then holds a
zlib context — a ~256 KB window per socket. Measured against this relay:

    deflate on    63.6 MB baseline + 276 KB/connection  ->  ~1,600 sockets/512 MB
    deflate off   38.3 MB baseline +  80 KB/connection  ->  ~5,900 sockets/512 MB

and it was compressing AES-GCM ciphertext, which is incompressible by
construction. So it was a quarter of a megabyte per peer, spent to achieve
nothing.

This gate exists because that fix is a monkeypatch against uvicorn's internals
and its failure mode is silence. If a uvicorn upgrade renames or relocates
`Config.ws_per_message_deflate`, nothing raises, no test that checks clipboard
behaviour notices, and the relay simply starts costing 3.5x the memory it should
and falls over three quarters earlier than expected under load.

So the assertion here is deliberately about the OUTCOME on the wire rather than
about the patch: what did the server negotiate with a client that offered
compression? That question stays meaningful however uvicorn rearranges itself.

Usage:  python test_deflate.py [ws://127.0.0.1:8000]
"""

import asyncio
import hashlib
import json
import sys

import websockets

BASE = (sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:8000").rstrip("/")
HTTP = BASE.replace("ws://", "http://").replace("wss://", "https://")

passed = failed = 0


def ok(name: str, good: bool, detail: str = "") -> None:
    global passed, failed
    if good:
        passed += 1
    else:
        failed += 1
    print(f"  {'PASS' if good else 'FAIL'}  {name}" + (f"  - {detail}" if detail else ""))


def extensions_of(ws) -> list:
    """Whatever this websockets version calls the negotiated extension list."""
    for holder in (ws, getattr(ws, "protocol", None)):
        exts = getattr(holder, "extensions", None)
        if exts is not None:
            return list(exts)
    return []


async def main() -> int:
    print("\nWebSocket compression\n")

    room = hashlib.sha256(b"DEFLATEGATE").hexdigest()

    # websockets' client offers permessage-deflate unless told otherwise, which
    # is exactly what a browser does. So an empty list here is the server having
    # declined an offer that was definitely made, not an offer never made.
    async with websockets.connect(f"{BASE}/ws/{room}") as ws:
        exts = extensions_of(ws)
        names = ", ".join(str(e) for e in exts) or "(none)"

        ok("no extension is negotiated", not exts, names)
        ok("permessage-deflate specifically is off",
           not any("deflate" in str(e).lower() for e in exts), names)

        # And the connection still works uncompressed, which is the other half:
        # a relay that saves memory by refusing to talk is not an improvement.
        await ws.send(json.dumps({"t": "hello", "peerId": "deflate-gate", "name": "Gate"}))
        await ws.send(json.dumps({"t": "ping"}))
        got = None
        for _ in range(6):
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if msg.get("t") == "pong":
                got = msg
                break
        ok("the connection still round-trips", got is not None, json.dumps(got or {}))

    # /health reports it, so this is checkable against a deployed relay too --
    # which is the case that actually matters, since the patch targets a
    # dependency the deploy resolves and we do not.
    try:
        import urllib.request
        with urllib.request.urlopen(f"{HTTP}/health", timeout=10) as r:
            health = json.loads(r.read())
        state = health.get("ws_deflate")
        ok("/health reports the deflate state", state is not None, str(state))
        ok("...and reports it as disabled",
           state in {"off", "already off"},
           f"{state!r} - 'skipped' or 'could not disable' means the patch missed")
    except Exception as exc:
        ok("/health reports the deflate state", False, f"{exc.__class__.__name__}: {exc}")

    print("\n" + "=" * 58)
    print(f"DEFLATE: {passed}/{passed + failed} passed")
    print("=" * 58)
    return 1 if failed else 0


sys.exit(asyncio.run(main()))
