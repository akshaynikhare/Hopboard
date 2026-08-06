"""
Deployment policy gate — the REALTIMECLIPBOARD_* flags a self-hoster sets.

test_relay.py proves the protocol. This proves the switches that change it, and
it exists because every one of them fails in the same dangerous direction: a
flag that silently does nothing looks exactly like a flag that works. An
operator who sets REALTIMECLIPBOARD_DISABLE_FILES and gets no error has every reason to
believe files are disabled.

Runs its own relays, on their own ports, with their own environments — the flags
are read at import time, so they cannot be toggled inside one process.

  python test_policy.py
"""

import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request

import websockets

PORT_TOKEN = 8021
PORT_FILES = 8022
HERE = os.path.dirname(os.path.abspath(__file__))

passed = failed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")


def spawn(port: int, env_extra: dict) -> subprocess.Popen:
    env = {**os.environ, **env_extra}
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=HERE, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1):
                return proc
        except Exception:
            time.sleep(0.25)
    proc.kill()
    raise RuntimeError(f"relay on {port} did not come up")


# Frames the relay sends on its own initiative. Saying hello produces a roster
# announcement, so a test that reads "the next frame" reads that instead of the
# answer it asked for — and then reports the product broken when it is not.
UNSOLICITED = {"welcome", "peers"}


async def first_frame(url: str, send: dict | None = None, hello: bool = False):
    """Connect, optionally speak, and return the first frame that ANSWERS us."""
    try:
        async with websockets.connect(url) as ws:
            if hello:
                await ws.send(json.dumps({"t": "hello", "intent": "join",
                                          "originId": "policy", "name": "test"}))
            if send is not None:
                await ws.send(json.dumps(send))

            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=4))
                # When nothing was asked, the welcome IS the answer.
                if send is None:
                    return frame
                if frame.get("t") not in UNSOLICITED:
                    return frame
            return {"t": "__timeout__"}
    except Exception as exc:
        return {"t": "__error__", "detail": f"{type(exc).__name__}: {exc}"}


async def main() -> None:
    print("\nDeployment policy\n")

    # ---- REALTIMECLIPBOARD_JOIN_TOKEN -------------------------------------------
    token = spawn(PORT_TOKEN, {"REALTIMECLIPBOARD_JOIN_TOKEN": "s3cret"})
    files = spawn(PORT_FILES, {"REALTIMECLIPBOARD_DISABLE_FILES": "true"})
    try:
        base = f"ws://127.0.0.1:{PORT_TOKEN}/ws/{'a' * 32}"

        got = await first_frame(base)
        check("no token is refused", got.get("code") == "ORG_TOKEN_REQUIRED", json.dumps(got)[:90])

        got = await first_frame(base + "?org=wrong")
        check("a wrong token is refused", got.get("code") == "ORG_TOKEN_REQUIRED", json.dumps(got)[:90])

        # The refusal must not distinguish "no token" from "wrong token": one of
        # those tells an attacker the door exists and the other tells them their
        # guess was the wrong shape.
        a = await first_frame(base)
        b = await first_frame(base + "?org=wrong")
        check("and the two refusals are identical", a == b)

        got = await first_frame(base + "?org=s3cret")
        check("the right token is welcomed", got.get("t") == "welcome", json.dumps(got)[:90])

        # A relay with no token configured must not start demanding one.
        got = await first_frame(f"ws://127.0.0.1:{PORT_FILES}/ws/{'b' * 32}")
        check("an unconfigured relay asks for nothing", got.get("t") == "welcome",
              json.dumps(got)[:90])

        # ---- REALTIMECLIPBOARD_DISABLE_FILES ------------------------------------
        base = f"ws://127.0.0.1:{PORT_FILES}/ws/{'c' * 32}"

        got = await first_frame(base, send={"t": "file-meta", "id": "1", "name": "x",
                                            "size": 1, "type": "text/plain"}, hello=True)
        check("a file frame is refused", got.get("code") == "FILES_DISABLED", json.dumps(got)[:90])

        got = await first_frame(base, send={"t": "rtc-offer", "to": "someone", "sdp": "x"},
                                hello=True)
        check("WebRTC signalling is refused too", got.get("code") == "FILES_DISABLED",
              json.dumps(got)[:90])

        # Refused, not silently dropped: a transfer that never starts and never
        # fails is one the user retries for five minutes.
        check("the refusal is an error frame, not silence", got.get("t") == "error")

        # The product still works. Disabling files must not disable the clipboard.
        got = await first_frame(base, send={"t": "ping"}, hello=True)
        check("clips and pings still work", got.get("t") == "pong", json.dumps(got)[:90])
    finally:
        token.kill()
        files.kill()

    print("\n" + "=" * 56)
    print(f"POLICY: {passed}/{passed + failed} passed")
    print("=" * 56)
    sys.exit(1 if failed else 0)


asyncio.run(main())
