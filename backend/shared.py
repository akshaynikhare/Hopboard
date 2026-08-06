"""
The shared backend that makes more than one replica safe — PRD OI-3.

Room state is a process-local dict. That is the right design for one process and
the wrong one for two: with two replicas and no shared state, two devices can
join the same room name, land on different processes, and never see each other.
It does not error. It presents as "sync just silently doesn't work",
intermittently and only under load, which is the worst way to find out.

This module is the answer, and it is deliberately the smallest one that works.

  What it shares      every frame the room fans out, the last clip for replay,
                      and the roster.
  What it stores      nothing durable. Pub/sub is fire-and-forget, and the two
                      keys carry the room's TTL, so a Redis restart costs open
                      sessions and nothing else. No persistence, no AOF, no
                      backups — a cache-class instance is the right shape.
  What it never sees  plaintext. Frames are already ciphertext produced in a
                      browser (PRD §7.3); Redis holds exactly what the relay
                      holds, which is nothing readable.

OFF BY DEFAULT. With HOPBOARD_REDIS_URL unset this module is inert and the relay
behaves exactly as it did before it existed — same code path, same in-memory
dict. That matters because the single-process deployment is the common one and
must not pay for a feature it does not use.
"""

from __future__ import annotations

import asyncio
import json
import os

# redis is an optional dependency. A self-hoster running one replica should not
# have to install it, and an import error at startup for a feature nobody asked
# for is a worse outage than the feature being unavailable.
try:
    import redis.asyncio as aioredis
except ImportError:                                       # pragma: no cover
    aioredis = None

REDIS_URL = os.getenv("HOPBOARD_REDIS_URL", "") or None


class Backend:
    """Cross-replica fan-out. Inert unless a Redis URL was configured."""

    def __init__(self, url: str | None, instance: str) -> None:
        self.instance = instance
        self.enabled = bool(url) and aioredis is not None
        self._url = url
        self._redis = None
        self._pubsub = None
        self._tasks: dict[str, asyncio.Task] = {}

        if url and aioredis is None:
            print("[relay] HOPBOARD_REDIS_URL is set but the redis package is not "
                  "installed. Running single-process — do NOT scale this deployment. "
                  "Install with: pip install 'redis>=5'")

    async def connect(self) -> None:
        if not self.enabled or self._redis is not None:
            return
        self._redis = aioredis.from_url(self._url, decode_responses=True)
        await self._redis.ping()
        print(f"[relay] shared backend connected; replicas may exceed 1 "
              f"(instance {self.instance})")

    # ---- fan-out --------------------------------------------------------

    async def publish(self, room_hash: str, frame: str) -> None:
        """
        Hand a frame to the other replicas.

        Stamped with this instance's id so the delivery loop below can drop its
        own echo. Without that, a two-replica deployment doubles every message
        and a three-replica one triples it.
        """
        if not self.enabled:
            return
        await self._redis.publish(
            f"hb:{room_hash}",
            json.dumps({"o": self.instance, "f": frame}, separators=(",", ":")),
        )

    async def subscribe(self, room_hash: str, deliver) -> None:
        """
        Start relaying this room's remote frames into `deliver`.

        One task per room rather than one shared task, so a room going quiet
        cleans itself up and a slow room cannot stall the others.
        """
        if not self.enabled or room_hash in self._tasks:
            return

        async def pump() -> None:
            pubsub = self._redis.pubsub()
            await pubsub.subscribe(f"hb:{room_hash}")
            try:
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue
                    try:
                        envelope = json.loads(message["data"])
                    except (ValueError, TypeError):
                        continue
                    # Our own publish, coming back around.
                    if envelope.get("o") == self.instance:
                        continue
                    await deliver(envelope.get("f", ""))
            except asyncio.CancelledError:
                raise
            except Exception as exc:                      # pragma: no cover
                # A dead subscription is a silently desynced room, which is the
                # exact failure this module exists to prevent. Say so.
                print(f"[relay] room {room_hash[:8]} lost its shared subscription: {exc}")
            finally:
                await pubsub.unsubscribe(f"hb:{room_hash}")
                await pubsub.aclose()

        self._tasks[room_hash] = asyncio.create_task(pump())

    async def unsubscribe(self, room_hash: str) -> None:
        task = self._tasks.pop(room_hash, None)
        if task:
            task.cancel()

    # ---- replay ---------------------------------------------------------
    #
    # FR-3.3: a late joiner is replayed the room's last clip. On one process
    # that is an attribute; across replicas it has to be somewhere both can see,
    # or joining "the same room" gives you a different history depending on
    # which pod the load balancer picked.

    async def set_last(self, room_hash: str, frame: str, ttl: int) -> None:
        if not self.enabled:
            return
        await self._redis.set(f"hb:{room_hash}:last", frame, ex=ttl)

    async def get_last(self, room_hash: str) -> str | None:
        if not self.enabled:
            return None
        return await self._redis.get(f"hb:{room_hash}:last")

    # ---- roster ---------------------------------------------------------
    #
    # The peer count is on screen, and "2 devices" when there are three is worse
    # than no number at all — it is the number someone checks to confirm their
    # other laptop actually joined.

    async def add_peer(self, room_hash: str, peer_id: str, name: str, ttl: int) -> None:
        if not self.enabled:
            return
        key = f"hb:{room_hash}:peers"
        await self._redis.hset(key, peer_id, json.dumps({"name": name, "i": self.instance}))
        await self._redis.expire(key, ttl)

    async def drop_peer(self, room_hash: str, peer_id: str) -> None:
        if not self.enabled:
            return
        await self._redis.hdel(f"hb:{room_hash}:peers", peer_id)

    async def remote_peers(self, room_hash: str) -> list[dict]:
        """Peers held by the OTHER replicas. This one already knows its own."""
        if not self.enabled:
            return []
        raw = await self._redis.hgetall(f"hb:{room_hash}:peers")
        out = []
        for peer_id, blob in raw.items():
            try:
                entry = json.loads(blob)
            except ValueError:
                continue
            if entry.get("i") == self.instance:
                continue
            out.append({"id": peer_id, "name": entry.get("name", ""), "mode": ""})
        return out

    async def close(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()
        if self._redis is not None:
            await self._redis.aclose()
