"""Gate harness for the SSE + POST fallback (PRD §4.3 R3, §5.4).

The fallback exists because a corporate proxy may refuse the WebSocket upgrade.
That makes it a path most people will never exercise, on the networks least
convenient to debug from — so it gets its own gate, and the gate insists on the
property that actually matters: an SSE client and a WebSocket client in the same
room are the same kind of peer. Same roster, same fan-out, same limits, same
targeted forwarding, in both directions.

Usage:  python test_sse.py [base_url]      e.g. http://127.0.0.1:8000
        (a ws:// or wss:// base is accepted and converted)
"""

import asyncio
import json
import sys

import httpx
import websockets

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
HTTP = BASE.replace("wss://", "https://").replace("ws://", "http://")
WS = HTTP.replace("https://", "wss://").replace("http://", "ws://")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))
    return ok


def room_name(tag):
    return f"sse-{tag}-{id(object()) % 10**8}"


class SsePeer:
    """A client on the fallback transport: read the stream, POST the sends."""

    def __init__(self, room, origin, name="sse-device"):
        self.room = room
        self.origin = origin
        self.name = name
        self.sid = None
        self.status = None
        self.headers = {}
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.ready = asyncio.Event()
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None))
        self.task = None

    async def _read(self):
        try:
            async with self.client.stream("GET", f"{HTTP}/sse/{self.room}") as res:
                self.status = res.status_code
                self.headers = dict(res.headers)
                async for line in res.aiter_lines():
                    if not line.startswith("data: "):
                        continue                      # keepalive / padding comment
                    msg = json.loads(line[6:])
                    if msg.get("t") == "welcome" and msg.get("sid"):
                        self.sid = msg["sid"]
                        self.ready.set()
                    await self.inbox.put(msg)
        except asyncio.CancelledError:
            raise
        except Exception as err:                      # noqa: BLE001 - surfaced by the waiter
            await self.inbox.put({"t": "stream-error", "detail": repr(err)})
        finally:
            self.ready.set()

    async def open(self, timeout=10.0):
        self.task = asyncio.create_task(self._read())
        await asyncio.wait_for(self.ready.wait(), timeout)
        return self

    async def post(self, *frames, sid=None):
        """One request, one frame per line — the batching the client relies on."""
        body = "\n".join(json.dumps(f) for f in frames)
        return await self.client.post(
            f"{HTTP}/pub/{self.room}",
            params={"sid": sid or self.sid or ""},
            content=body,
            headers={"Content-Type": "text/plain;charset=UTF-8"},
        )

    async def hello(self, intent="join"):
        return await self.post(
            {"t": "hello", "intent": intent, "originId": self.origin, "name": self.name}
        )

    async def recv(self, timeout=5.0):
        return await asyncio.wait_for(self.inbox.get(), timeout)

    async def recv_data(self, timeout=5.0):
        """Next frame that is neither the welcome nor presence noise.

        `peers` frames are async and unordered relative to payloads, and the
        welcome always leads the stream — tests that care about payloads have to
        skip both or they assert against the handshake.
        """
        while True:
            msg = await self.recv(timeout)
            if msg.get("t") not in ("peers", "welcome"):
                return msg

    async def drain(self, timeout=0.5):
        out = []
        try:
            while True:
                out.append(await self.recv(timeout))
        except asyncio.TimeoutError:
            return out

    async def close(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
        await self.client.aclose()


class WsPeer:
    """The same peer over the transport the fallback has to be equivalent to."""

    def __init__(self, room, origin, name="ws-device"):
        self.room, self.origin, self.name = room, origin, name

    async def __aenter__(self):
        self.sock = await websockets.connect(f"{WS}/ws/{self.room}")
        await self.send({"t": "hello", "intent": "join",
                         "originId": self.origin, "name": self.name})
        return self

    async def __aexit__(self, *_):
        await self.sock.close()

    async def send(self, obj):
        await self.sock.send(json.dumps(obj))

    async def recv(self, timeout=5.0):
        return json.loads(await asyncio.wait_for(self.sock.recv(), timeout))

    async def recv_data(self, timeout=5.0):
        while True:
            msg = await self.recv(timeout)
            if msg.get("t") not in ("peers", "welcome"):
                return msg

    async def drain(self, timeout=0.5):
        out = []
        try:
            while True:
                out.append(await self.recv(timeout))
        except asyncio.TimeoutError:
            return out


# ------------------------------------------------------------------ S1

async def s1_handshake():
    print("\nS1  Stream handshake")
    peer = SsePeer(room_name("s1"), "peerS1")
    try:
        await peer.open()
        check("stream opens and delivers a welcome", peer.sid is not None,
              f"HTTP {peer.status}")
        check("welcome carries a session token", bool(peer.sid), peer.sid or "none")
        check("CORS is set — the app is on another origin",
              peer.headers.get("access-control-allow-origin") == "*",
              peer.headers.get("access-control-allow-origin", "missing"))
        check("stream is not cached anywhere",
              "no-cache" in peer.headers.get("cache-control", "")
              or "no-store" in peer.headers.get("cache-control", ""),
              peer.headers.get("cache-control", "missing"))

        res = await peer.hello()
        check("hello over POST is accepted", res.status_code == 204, f"HTTP {res.status_code}")

        res = await peer.post({"t": "ping"})
        pong = await peer.recv_data()
        check("ping answers with pong on the stream", pong.get("t") == "pong", json.dumps(pong))
    finally:
        await peer.close()


# ------------------------------------------------------------------ S2

async def s2_two_sse_peers():
    print("\nS2  Two fallback peers")
    room = room_name("s2")
    a, b = SsePeer(room, "peerA"), SsePeer(room, "peerB")
    try:
        await a.open()
        await a.hello()
        await b.open()
        await b.hello()

        roster = None
        for msg in await a.drain():
            if msg.get("t") == "peers":
                roster = msg
        check("the roster reaches an existing peer", roster is not None and roster["count"] == 2,
              json.dumps(roster))
        check("nicknames are in the roster",
              roster is not None and {p["peerId"] for p in roster["list"]} == {"peerA", "peerB"},
              json.dumps(roster["list"]) if roster else "none")

        await a.post({"t": "clip", "payload": "Y2lwaGVy", "iv": "aXY=", "originId": "peerA"})
        clip = await b.recv_data()
        check("a clip crosses two fallback peers",
              clip.get("t") == "clip" and clip.get("payload") == "Y2lwaGVy", json.dumps(clip))
        check("the sender does not get its own clip back",
              all(m.get("t") != "clip" for m in await a.drain()))
    finally:
        await a.close()
        await b.close()


# ------------------------------------------------------------------ S3

async def s3_mixed_room():
    print("\nS3  One room, both transports")
    room = room_name("s3")
    sse = SsePeer(room, "peerSSE")
    try:
        await sse.open()
        await sse.hello()

        async with WsPeer(room, "peerWS") as ws:
            await asyncio.sleep(0.3)

            await ws.send({"t": "clip", "payload": "ZnJvbVdT", "iv": "aXY=", "originId": "peerWS"})
            got = await sse.recv_data()
            check("WebSocket -> SSE clip arrives",
                  got.get("t") == "clip" and got.get("payload") == "ZnJvbVdT", json.dumps(got))

            await sse.post({"t": "clip", "payload": "ZnJvbVNTRQ==", "iv": "aXY=",
                            "originId": "peerSSE"})
            got = await ws.recv_data()
            check("SSE -> WebSocket clip arrives",
                  got.get("t") == "clip" and got.get("payload") == "ZnJvbVNTRQ==", json.dumps(got))

            # Targeted forwarding is what the file layer runs on, and `from` is
            # stamped from the connection the frame arrived on — which for a POST
            # is the stream its sid resolved to, not the request.
            await sse.post({"t": "rtc-offer", "to": "peerWS", "payload": "c2Rw", "iv": "aXY="})
            offer = await ws.recv_data()
            check("SSE -> WebSocket targeted frame is forwarded",
                  offer.get("t") == "rtc-offer", json.dumps(offer))
            check("`from` is stamped with the real sender",
                  offer.get("from") == "peerSSE", offer.get("from"))

            await ws.send({"t": "rtc-answer", "to": "peerSSE", "payload": "c2Rw", "iv": "aXY="})
            answer = await sse.recv_data()
            check("WebSocket -> SSE targeted frame is forwarded",
                  answer.get("t") == "rtc-answer" and answer.get("from") == "peerWS",
                  json.dumps(answer))

            await sse.post({"t": "rtc-ice", "to": "ghost", "payload": "eA=="})
            err = await sse.recv_data()
            check("unknown target is an error, not silence",
                  err.get("t") == "error" and err.get("code") == "NO_SUCH_PEER", json.dumps(err))

        # The WebSocket peer left; the roster the SSE peer sees must follow.
        await asyncio.sleep(0.4)
        roster = [m for m in await sse.drain() if m.get("t") == "peers"]
        check("a WebSocket peer leaving updates the SSE roster",
              bool(roster) and roster[-1]["count"] == 1,
              json.dumps(roster[-1]) if roster else "no peers frame")
    finally:
        await sse.close()


# ------------------------------------------------------------------ S4

async def s4_batching_and_replay():
    print("\nS4  Batched sends and last-clip replay")
    room = room_name("s4")
    a = SsePeer(room, "peerA")
    try:
        await a.open()
        await a.hello()

        # One request, several frames: what the client does with everything that
        # queues up while a POST is in flight.
        res = await a.post(
            {"t": "clip", "payload": "b25l", "iv": "aXY=", "originId": "peerA"},
            {"t": "clip", "payload": "dHdv", "iv": "aXY=", "originId": "peerA"},
            {"t": "ping"},
        )
        check("a batched POST is accepted", res.status_code == 204, f"HTTP {res.status_code}")
        pong = [m for m in await a.drain() if m.get("t") == "pong"]
        check("every frame in the batch is processed", len(pong) == 1, f"{len(pong)} pong(s)")

        # A device that arrives mid-session is caught up by welcome.last
        # (FR-3.3) — the same replay the WebSocket path gets, and the reason
        # the batch above ends in "two" rather than "one".
        b = SsePeer(room, "peerB")
        try:
            await b.open()
            welcome = await b.recv()          # always the first frame on the stream
            check("welcome replays the room's last clip (FR-3.3)",
                  welcome.get("t") == "welcome"
                  and (welcome.get("last") or {}).get("payload") == "dHdv",
                  json.dumps(welcome.get("last")))
            check("welcome reports the room as it was before we joined",
                  welcome.get("existing") == 1, f"existing={welcome.get('existing')}")
        finally:
            await b.close()
    finally:
        await a.close()


# ------------------------------------------------------------------ S5

async def s5_limits():
    print("\nS5  Limits and errors")
    room = room_name("s5")
    a = SsePeer(room, "peerA")
    try:
        await a.open()
        await a.hello()

        # 32 KB cap (FR-2.8) applies per line, not per request.
        big = {"t": "clip", "payload": "x" * (33 * 1024), "iv": "aXY=", "originId": "peerA"}
        await a.post(big)
        err = await a.recv_data()
        check("the 32 KB frame cap still applies",
              err.get("t") == "error" and err.get("code") == "TOO_LARGE", json.dumps(err))

        res = await a.post({"t": "nonsense"})
        check("an unknown frame type is rejected", res.status_code == 204)
        err = await a.recv_data()
        check("...on the stream, as an error frame",
              err.get("code") == "UNKNOWN_TYPE", json.dumps(err))

        res = await a.post({"t": "ping"}, sid="deadbeef" * 4)
        check("an unknown sid is 404, not silence", res.status_code == 404,
              f"HTTP {res.status_code}")
        check("...and names the reason",
              res.json().get("code") == "NO_STREAM", res.text[:80])

        # Rate limiting is per peer and survives across requests, because on this
        # transport there is no connection loop to hang a counter on.
        for _ in range(14):
            await a.post({"t": "clip", "payload": "eA==", "iv": "aXY=", "originId": "peerA"})
        limited = [m for m in await a.drain() if m.get("code") == "RATE_LIMITED"]
        check("rate limits carry across separate POSTs", bool(limited),
              f"{len(limited)} rejected")

        preflight = await a.client.options(f"{HTTP}/pub/{room}")
        check("preflight is answered for clients that send one",
              preflight.status_code in (200, 204)
              and preflight.headers.get("access-control-allow-origin") == "*",
              f"HTTP {preflight.status_code}")
    finally:
        await a.close()


# ------------------------------------------------------------------ S6

async def s6_departure():
    print("\nS6  Leaving")
    room = room_name("s6")
    a, b = SsePeer(room, "peerA"), SsePeer(room, "peerB")
    try:
        await a.open()
        await a.hello()
        await b.open()
        await b.hello()
        await a.drain(0.3)

        # Closing the stream is how a fallback client leaves: there is no close
        # frame, so the relay has to notice the response body being dropped.
        sid = b.sid
        await b.close()
        await asyncio.sleep(0.5)

        roster = [m for m in await a.drain() if m.get("t") == "peers"]
        check("dropping the stream removes the peer",
              bool(roster) and roster[-1]["count"] == 1,
              json.dumps(roster[-1]) if roster else "no peers frame")

        res = await a.post({"t": "ping"}, sid=sid)
        check("the dead peer's sid stops working", res.status_code == 404,
              f"HTTP {res.status_code}")
    finally:
        await a.close()
        await b.close()


async def main():
    print(f"\nSSE + POST fallback gate against {HTTP}")
    for section in (s1_handshake, s2_two_sse_peers, s3_mixed_room,
                    s4_batching_and_replay, s5_limits, s6_departure):
        try:
            await section()
        except Exception as err:                      # noqa: BLE001
            check(f"{section.__name__} completed", False, repr(err))

    passed = sum(1 for _, ok, _ in results if ok)
    print("\n" + "=" * 62)
    print(f"SSE FALLBACK GATE: {passed}/{len(results)} checks passed")
    print("=" * 62)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
