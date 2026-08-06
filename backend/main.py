"""
Hopboard relay — M0 clipboard fan-out + M7 peer-to-peer plumbing.

In-memory only: no database, no disk, no Redis. Room state lives in this
process, which is exactly why the deployment MUST be pinned to a single
replica (PRD OI-3). /health exposes INSTANCE_ID so a client can detect a
split-brain deployment loudly instead of silently failing to sync.

The relay never sees plaintext. Payloads are AES-GCM ciphertext produced in
the browser, and the room name is a hash of the user's key (PRD 7.3). Nothing
here decrypts, inspects, stores or logs clip content.

Two jobs:

  1. Clipboard fan-out (M0). `clip` frames go to everyone but the sender, and
     the last one is replayed to a late joiner (FR-3.3).
  2. P2P plumbing (M7). WebRTC signalling and file frames are forwarded to one
     *named* peer via a `to` field (docs/P2P-FILES.md §3), or fanned out to the
     room in the case of `file-meta`. The relay reads exactly three things out
     of these frames — `t`, `to`, and, from `hello`, the sender's id and
     nickname. `sdp`, `thumb`, `payload` and `data` are never touched.

Addressing. Every connection owns a `peerId`. It is provisional (relay
generated) until the client's `hello` arrives, at which point the client's own
`originId` is adopted, so both ends agree on names — the client already labels
files and clips with `originId`. `welcome.you` reports the provisional id; the
roster carried by `welcome.list` and every `peers` frame reports the live one.
Ids are unique per room: a second claimant keeps its provisional id and is told
so with PEER_ID_TAKEN, because targeted delivery is only meaningful if one id
means one socket.
"""

import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect

INSTANCE_ID = uuid.uuid4().hex[:8]
BOOTED_AT = time.time()

# PRD FR-2.8. Applies to *every* frame including file-chunk, per
# docs/P2P-FILES.md §5 ("chunk size matches the existing relay frame cap — no
# protocol change"). Note for client authors: 32 KB is the cap on the encoded
# JSON frame, not on the chunk inside it. Base64 inflates 4/3, so a chunk must
# be ~24 KB of ciphertext (~23 KB of file) to fit a 32 KB frame with its
# envelope. A literal 32 KB chunk becomes a ~44 KB frame and is rejected.
MAX_FRAME_BYTES = 32 * 1024
MAX_PEERS = 8                 # PRD §6
ROOM_TTL_SECONDS = 600        # PRD FR-3.4 — evict 10 min after the last peer leaves
MAX_ID_CHARS = 64             # peerId / `to` — long enough for a uuid, bounded
MAX_NAME_CHARS = 64           # nickname, e.g. "Chrome · Windows" (FR-5.7)

RATE_LIMIT_WINDOW = 1.0

# Rate limits are per connection, per frame class, over a fixed 1 s window.
# Three classes, because one number cannot serve three very different jobs:
#
#   interactive   10/s  PRD §6, unchanged from M0. Human-speed traffic — clip,
#                       ping, hello, and anything unrecognised.
#   signal        60/s  WebRTC setup and file metadata. Trickle ICE emits a
#                       burst of candidates in well under a second, and a user
#                       dropping the 20-file session cap (P2P-FILES §5) emits
#                       20 file-meta frames at once. Both would trip a 10/s cap
#                       and stall connection setup for no good reason.
#   bulk         400/s  file-chunk only — the relay fallback used when ICE
#                       fails (FR-7.6). A 5 MB file is ~160 frames at the 32 KB
#                       cap (P2P-FILES §5, ~220 once base64 overhead is taken
#                       into account), so 400/s clears the largest legal
#                       transfer inside a single window with headroom to spare.
#                       This is a runaway bound, not a fairness scheduler:
#                       400 x 32 KB = 12.8 MB/s worst case from one connection,
#                       and MAX_PEERS bounds how many can do that at once.
RATE_LIMIT_MSGS = 10          # kept as the documented PRD §6 number
CLASS_LIMITS = {"interactive": RATE_LIMIT_MSGS, "signal": 60, "bulk": 400}

# Frames the relay forwards without looking inside them. Targeted frames name
# one recipient in `to`; ROOM_WIDE frames fan out to everyone but the sender.
#
# The five file-* control frames after file-req are not in docs/P2P-FILES.md,
# which only sketches the happy path. They are what the client actually emits
# (src/files/transfer.js FRAMES): a transfer needs an accept/deny handshake,
# a completion marker and a way to abort, and every one of them is addressed to
# a single peer. Left out, they come back UNKNOWN_TYPE and the fallback path in
# FR-7.6 cannot complete. The relay still reads nothing but `t` and `to`.
TARGETED = {
    "rtc-offer", "rtc-answer", "rtc-ice",
    "file-req", "file-accept", "file-deny",
    "file-chunk", "file-done", "file-cancel", "file-error",
}
ROOM_WIDE = {"file-meta", "file-gone", "cursor"}

# Every forwarded frame is setup/teardown control traffic — bursty for a moment,
# then silent — except file-chunk, which is the bulk path, and cursor, which is
# a steady trickle.
FRAME_CLASS = dict.fromkeys(TARGETED | ROOM_WIDE, "signal")
FRAME_CLASS.update({
    "clip": "interactive",
    "ping": "interactive",
    "hello": "interactive",
    "file-chunk": "bulk",
    # Live pointers. Its own class deliberately: the client throttles to ~10/s,
    # but presence is a nicety and clipboard sync is the product. Sharing the
    # interactive bucket would let a moving mouse starve the thing people came
    # for. 20/s leaves the client room to jitter without ever competing.
    "cursor": "cursor",
})
CLASS_LIMITS["cursor"] = 20

app = FastAPI(title="Hopboard relay", version="0.2.0-m7")


@dataclass
class Peer:
    sock: WebSocket
    peer_id: str
    name: str = ""
    # Two-letter country, read once from Cloudflare's header at connect time
    # and kept only as a counter input for /stats. The address it was derived
    # from is never stored, and this is never sent to any peer — a country code
    # is coarse, but it is still more than anyone in a clipboard session needs
    # to know about the others.
    country: str = ""


@dataclass
class Room:
    # Keyed by socket: the socket is the identity that always exists, whereas a
    # peerId only becomes meaningful once `hello` lands.
    peers: dict[WebSocket, Peer] = field(default_factory=dict)
    last: str | None = None       # last clip envelope, as a JSON string. Ciphertext.
    seq: int = 0
    evict_task: asyncio.Task | None = None


rooms: dict[str, Room] = {}


class RateBuckets:
    """Fixed-window counters, one per frame class, for a single connection."""

    __slots__ = ("count", "start")

    def __init__(self) -> None:
        now = time.monotonic()
        self.count = dict.fromkeys(CLASS_LIMITS, 0)
        self.start = dict.fromkeys(CLASS_LIMITS, now)

    def allow(self, cls: str) -> bool:
        now = time.monotonic()
        if now - self.start[cls] > RATE_LIMIT_WINDOW:
            self.count[cls], self.start[cls] = 0, now
        self.count[cls] += 1
        return self.count[cls] <= CLASS_LIMITS[cls]


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


@app.get("/stats")
async def stats(response: Response):
    """Aggregate activity, for the live globe on the landing page.

    Deliberately blunt about what it is NOT. This returns counts and country
    codes and nothing else:

      - no room hashes. A room hash is derived from the share key, so
        publishing the set of live hashes would let anyone confirm whether a
        guessed key is currently in use — an oracle for the one secret the
        whole design rests on.
      - no session contents, ever. The relay only holds ciphertext anyway.
      - no IP addresses, and none are stored. The country is read from the
        Cloudflare header already attached to the connection, counted, and the
        header itself is discarded.

    The counts are per-instance, which is honest given replicas are pinned to
    one (OI-3), and they are live rather than cumulative — a device that closes
    its tab stops being counted.
    """
    # CORS, on this route only.
    #
    # The site is served from github.io and the relay from fastapicloud.dev, so
    # this is a cross-origin fetch. WebSockets never needed CORS, which is why
    # nothing else here sets it — and without this header the landing page's
    # globe silently stays dark forever, with the request failing in a way only
    # the browser console mentions.
    #
    # "*" rather than a pinned origin because the payload is public aggregate
    # counts with no credentials, and pinning would break local development, a
    # future custom domain and anyone running their own copy. Deliberately not
    # applied app-wide: the WebSocket route has no business advertising this.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Cache-Control"] = "public, max-age=15"

    countries: dict[str, int] = {}
    for room in rooms.values():
        for peer in room.peers.values():
            if peer.country:
                countries[peer.country] = countries.get(peer.country, 0) + 1

    return {
        "rooms": len(rooms),
        "devices": sum(len(r.peers) for r in rooms.values()),
        "countries": countries,
        "instance": INSTANCE_ID,
    }


# ---------------------------------------------------------------- helpers

def _short(value, limit: int) -> str | None:
    """Accept a short, non-empty string; reject everything else.

    Applied to routing metadata only (ids, `to`, nicknames) so a hostile or
    buggy client cannot inject a 30 KB peer id or a non-string into the roster.
    """
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed and len(trimmed) <= limit:
            return trimmed
    return None


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
        room.peers.pop(peer, None)


def _roster(room: Room) -> list[dict]:
    """Who is in the room, in join order. Nicknames only — no payload, ever.

    An empty `name` means the client has not told us one (it has not sent hello
    yet, or sent it without a nickname). The relay does not invent a label for
    it: naming a device is the client's job (FR-5.7), and `""` is the signal the
    UI needs to substitute its own wording.
    """
    return [{"peerId": p.peer_id, "name": p.name} for p in room.peers.values()]


def _find(room: Room, peer_id: str | None) -> Peer | None:
    if peer_id is None:
        return None
    for peer in room.peers.values():
        if peer.peer_id == peer_id:
            return peer
    return None


async def _announce_peers(room: Room, exclude: WebSocket | None = None) -> None:
    """Presence frames report *changes*: who is here and what they are called.

    `count` is kept alongside `list` because existing clients read it (and the
    M0 gate asserts it). A peer that just joined already learned the roster from
    its own welcome, so it is excluded to avoid a duplicate frame.
    """
    await _broadcast(
        room,
        json.dumps(
            {"t": "peers", "count": len(room.peers), "list": _roster(room)},
            separators=(",", ":"),
        ),
        exclude=exclude,
    )


async def _forward(room: Room, me: Peer, msg: dict) -> None:
    """Relay a signalling/file frame to the peer named in `to`.

    `from` is stamped by the relay and overwrites anything the sender put
    there: the socket a frame arrived on is the one fact a client cannot lie
    about, and the recipient needs it to address its reply (an rtc-offer with
    no verified sender is unanswerable).
    """
    target = _find(room, _short(msg.get("to"), MAX_ID_CHARS))
    if target is None:
        # Also covers a missing/blank/non-string `to`; the echoed value tells a
        # client which of the two it was without adding a second error code.
        await _send(me.sock, {
            "t": "error",
            "code": "NO_SUCH_PEER",
            "to": _short(msg.get("to"), MAX_ID_CHARS),
        })
        return

    msg["from"] = me.peer_id
    if not await _send(target.sock, msg):
        room.peers.pop(target.sock, None)
        await _announce_peers(room)


def _adopt_identity(room: Room, me: Peer, msg: dict) -> tuple[bool, bool]:
    """Apply `hello`. Returns (roster_changed, id_was_taken)."""
    changed = False
    taken = False

    wanted = _short(msg.get("originId"), MAX_ID_CHARS)
    if wanted and wanted != me.peer_id:
        if _find(room, wanted) is None:
            me.peer_id = wanted
            changed = True
        else:
            taken = True

    nickname = _short(msg.get("name"), MAX_NAME_CHARS)
    if nickname and nickname != me.name:
        me.name = nickname
        changed = True

    return changed, taken


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

    # Provisional id: welcome must go out immediately (a client is entitled to
    # sit silent and still be told the room state), and `hello` has not arrived
    # yet. It is replaced by the client's originId the moment hello lands.
    # Cloudflare fronts this service, so CF-IPCountry is already on the request.
    # Read it here, count it in /stats, and never keep the address it came from.
    country = (sock.headers.get("cf-ipcountry") or "").upper()
    if len(country) != 2 or not country.isalpha():
        country = ""

    me = Peer(sock=sock, peer_id=uuid.uuid4().hex[:8], country=country)
    room.peers[sock] = me

    # `existing > 0` on an intent:"create" means the auto-generated key is taken,
    # and the client must regenerate rather than land in a stranger's room (OI-2).
    await _send(sock, {
        "t": "welcome",
        "instance": INSTANCE_ID,
        "existing": existing,
        "peers": len(room.peers),
        "you": me.peer_id,
        "list": _roster(room),
        "last": json.loads(room.last) if room.last else None,
    })
    await _announce_peers(room, exclude=sock)

    buckets = RateBuckets()

    try:
        while True:
            raw = await sock.receive_text()

            if len(raw.encode("utf-8")) > MAX_FRAME_BYTES:
                # Charged to the interactive bucket. Before this, an oversize
                # frame `continue`d past the rate check, so a flood of 33 KB
                # frames bought an unmetered error echo for free.
                code = "TOO_LARGE" if buckets.allow("interactive") else "RATE_LIMITED"
                await _send(sock, {"t": "error", "code": code})
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                msg = None

            # `[]`, `"x"` and `5` are all valid JSON and none of them is a
            # frame. Rejecting them here keeps a stray frame from raising
            # AttributeError deep in the loop and dropping the connection.
            if not isinstance(msg, dict):
                code = "BAD_JSON" if buckets.allow("interactive") else "RATE_LIMITED"
                await _send(sock, {"t": "error", "code": code})
                continue

            kind = msg.get("t")

            if not buckets.allow(FRAME_CLASS.get(kind, "interactive")):
                await _send(sock, {"t": "error", "code": "RATE_LIMITED"})
                continue

            if kind == "ping":                      # heartbeat (PRD FR-3.6)
                await _send(sock, {"t": "pong"})

            elif kind == "hello":                   # intent already answered by welcome
                changed, taken = _adopt_identity(room, me, msg)
                if taken:
                    # Never silent: the client is addressable, just not under
                    # the name it asked for, and it needs to know which.
                    await _send(sock, {
                        "t": "error", "code": "PEER_ID_TAKEN", "you": me.peer_id,
                    })
                if changed:
                    # Sender included: this is the frame that tells it which id
                    # and nickname the room actually knows it by.
                    await _announce_peers(room)

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

            elif kind in ROOM_WIDE:                 # file-meta: thumbnails to the room
                msg["from"] = me.peer_id
                await _broadcast(
                    room, json.dumps(msg, separators=(",", ":")), exclude=sock
                )

            elif kind in TARGETED:                  # rtc-*, file-req, file-chunk
                await _forward(room, me, msg)

            else:
                await _send(sock, {"t": "error", "code": "UNKNOWN_TYPE"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        room.peers.pop(sock, None)
        if room.peers:
            await _announce_peers(room)
        else:
            room.evict_task = asyncio.create_task(_evict_later(room_hash))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
