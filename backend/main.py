"""
LiveClip relay — M0 spike.

In-memory only: no database, no disk, no Redis. Room state lives in this
process, which is exactly why the deployment MUST be pinned to a single
replica (PRD OI-3). /health exposes INSTANCE_ID so a client can detect a
split-brain deployment loudly instead of silently failing to sync.

The relay never sees plaintext. Payloads are AES-GCM ciphertext produced in
the browser, and the room name is a hash of the user's key (PRD 7.3). Nothing
here decrypts, inspects, stores or logs clip content.
"""

import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

INSTANCE_ID = uuid.uuid4().hex[:8]
BOOTED_AT = time.time()

MAX_FRAME_BYTES = 32 * 1024   # PRD FR-2.8
MAX_PEERS = 8                 # PRD §6
ROOM_TTL_SECONDS = 600        # PRD FR-3.4 — evict 10 min after the last peer leaves
RATE_LIMIT_MSGS = 10          # PRD §6 — per connection
RATE_LIMIT_WINDOW = 1.0

app = FastAPI(title="LiveClip relay", version="0.1.0-m0")


@dataclass
class Room:
    peers: set[WebSocket] = field(default_factory=set)
    last: str | None = None       # last clip envelope, as a JSON string. Ciphertext.
    seq: int = 0
    evict_task: asyncio.Task | None = None


rooms: dict[str, Room] = {}


# ---------------------------------------------------------------- health

@app.get("/health")
async def health():
    """Instance identity, so the client can detect multi-replica split-brain (OI-3)."""
    return {
        "ok": True,
        "instance": INSTANCE_ID,
        "uptime_s": round(time.time() - BOOTED_AT, 1),
        "rooms": len(rooms),
        "peers": sum(len(r.peers) for r in rooms.values()),
    }


# ---------------------------------------------------------------- helpers

async def _send(sock: WebSocket, obj: dict) -> bool:
    try:
        await sock.send_text(json.dumps(obj, separators=(",", ":")))
        return True
    except Exception:
        return False


async def _broadcast(room: Room, frame: str, exclude: WebSocket | None = None) -> None:
    """Fan out a raw frame to every peer but the sender (PRD FR-3.2)."""
    dead = []
    for peer in list(room.peers):
        if peer is exclude:
            continue
        try:
            await peer.send_text(frame)
        except Exception:
            dead.append(peer)
    for peer in dead:
        room.peers.discard(peer)


async def _announce_peers(room: Room, exclude: WebSocket | None = None) -> None:
    """Presence frames report *changes*. The peer that just joined already learned
    the count from its own welcome, so it is excluded to avoid a duplicate frame."""
    await _broadcast(room, json.dumps({"t": "peers", "count": len(room.peers)}), exclude=exclude)


async def _evict_later(room_hash: str) -> None:
    """Drop the room (and its last clip) once it has been empty for the TTL."""
    try:
        await asyncio.sleep(ROOM_TTL_SECONDS)
    except asyncio.CancelledError:
        return
    room = rooms.get(room_hash)
    if room and not room.peers:
        rooms.pop(room_hash, None)


# ---------------------------------------------------------------- websocket

@app.websocket("/ws/{room_hash}")
async def ws(sock: WebSocket, room_hash: str):
    await sock.accept()

    room = rooms.get(room_hash)
    if room is None:
        room = rooms[room_hash] = Room()

    if len(room.peers) >= MAX_PEERS:
        await _send(sock, {"t": "error", "code": "ROOM_FULL"})
        await sock.close(code=1013)
        return

    # A room that was counting down to eviction is alive again.
    if room.evict_task and not room.evict_task.done():
        room.evict_task.cancel()
        room.evict_task = None

    existing = len(room.peers)   # peers already here, BEFORE we join — the collision signal
    room.peers.add(sock)

    # `existing > 0` on an intent:"create" means the auto-generated key is taken,
    # and the client must regenerate rather than land in a stranger's room (OI-2).
    await _send(sock, {
        "t": "welcome",
        "instance": INSTANCE_ID,
        "existing": existing,
        "peers": len(room.peers),
        "last": json.loads(room.last) if room.last else None,
    })
    await _announce_peers(room, exclude=sock)

    bucket, bucket_start = 0, time.monotonic()

    try:
        while True:
            raw = await sock.receive_text()

            if len(raw.encode("utf-8")) > MAX_FRAME_BYTES:
                await _send(sock, {"t": "error", "code": "TOO_LARGE"})
                continue

            now = time.monotonic()
            if now - bucket_start > RATE_LIMIT_WINDOW:
                bucket, bucket_start = 0, now
            bucket += 1
            if bucket > RATE_LIMIT_MSGS:
                await _send(sock, {"t": "error", "code": "RATE_LIMITED"})
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send(sock, {"t": "error", "code": "BAD_JSON"})
                continue

            kind = msg.get("t")

            if kind == "ping":                      # heartbeat (PRD FR-3.6)
                await _send(sock, {"t": "pong"})

            elif kind == "hello":                   # intent declared, already answered by welcome
                pass

            elif kind == "clip":
                room.seq += 1
                envelope = {
                    "t": "clip",
                    "payload": msg.get("payload"),
                    "iv": msg.get("iv"),
                    "originId": msg.get("originId"),
                    "seq": room.seq,
                }
                room.last = json.dumps(envelope, separators=(",", ":"))
                await _broadcast(room, room.last, exclude=sock)

            else:
                await _send(sock, {"t": "error", "code": "UNKNOWN_TYPE"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        room.peers.discard(sock)
        if room.peers:
            await _announce_peers(room)
        else:
            room.evict_task = asyncio.create_task(_evict_later(room_hash))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
