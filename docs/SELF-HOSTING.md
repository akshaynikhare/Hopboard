# Running Hopboard yourself

For anyone who wants the relay inside their own network — a homelab, or an
organisation. It is one Python file with no database, so this is shorter than
you are expecting.

---

## 1. The relay

```bash
docker run -p 8000:8000 ghcr.io/akshaynikhare/hopboard-relay
```

That is a working relay. It holds ciphertext in RAM, writes nothing to disk, and
has no dependencies beyond Python.

For a real deployment you need TLS, and not for the usual reason: the app is
served over HTTPS, so a browser **refuses** a `ws://` connection from it as mixed
content. A relay without a certificate only works on localhost.

```bash
cd deploy
HOPBOARD_DOMAIN=relay.example.com docker compose up -d
```

Caddy obtains and renews the certificate itself. Point the app at the relay under
**Settings → Relay**, or hand people a link with `?relay=relay.example.com`.

For Kubernetes there is a chart in [`deploy/helm/`](../deploy/helm).

---

## 2. ⚠️ Pin replicas to 1, or turn on Redis

Room state is a process-local dict. With two replicas and no shared backend, two
devices can join the same room name, land on different processes, and **never see
each other**.

It does not error. It presents as "sync just silently doesn't work",
intermittently, and only under load — which is the worst possible way to find out
about it. This is PRD **OI-3**.

You get one of two safe configurations:

| | |
|---|---|
| **One replica** | The default. Correct, and fine for a few hundred users. |
| **Many replicas + Redis** | Set `HOPBOARD_REDIS_URL`. Frames, the replayed last clip and the roster then travel between processes. |

The Helm chart **refuses to render** `replicaCount > 1` unless `redis.enabled` is
true, because a comment is something a hurried operator can not-read.

Two safety nets back that up: `GET /health` returns an `instance` id, and the
client compares it across reconnects and shows a red split-brain banner if it ever
changes. **If your users report that banner, this section is why.**

The Redis it wants is cache-class: pub/sub and two short-TTL keys. No persistence,
no AOF, no backups — nothing durable is ever written. Install the extra with
`pip install -r requirements-ha.txt`.

---

## 3. Point the app at it

Three ways, in the order the app resolves them:

1. **`?relay=` in the address** — `https://…/app.html?relay=relay.example.com`.
   Best for deployment: an MSI transform, a macOS configuration profile, or a
   bookmark pushed by policy. The app remembers it, so the flag is needed once.
2. **Settings → Relay** — for a person setting up their own.
3. **The build default** — `DEFAULT_RELAY_URL` in
   [`src/core/config.js`](../src/core/config.js), if you host the frontend too.

> **You must also edit the Content-Security-Policy.** Every page pins
> `connect-src` to the relay it was built against, so a client pointed at a
> different one will load and then refuse every connection. Change the
> `connect-src` origins in `index.html`, `app.html` and the pages under `help/`
> and `blog/` to match. `tests/static-check.mjs` asserts they agree with
> `config.js`, so you will be told if you miss one.
>
> This is deliberate, not friction for its own sake. A build that can physically
> reach only your relay is a property worth having.

---

## 4. Policy

Every flag defaults to the hosted relay's behaviour, so an unconfigured relay is
exactly the relay described above.

| Variable | Default | What it does |
|---|---|---|
| `HOPBOARD_CORS_ORIGINS` | `*` | Comma-separated allowlist. Safe as `*` only because there are no credentials anywhere in this design; pin it anyway. |
| `HOPBOARD_JOIN_TOKEN` | none | A shared secret every client must present as `?org=…`. **A door on the relay, not user authentication** — see below. |
| `HOPBOARD_DISABLE_FILES` | off | Refuses WebRTC signalling and all file frames. Clipboard text is unaffected. |
| `HOPBOARD_MAX_SESSION` | `0` | Hard cap in seconds on a room's lifetime. |
| `HOPBOARD_MAX_PEERS` | `8` | Devices per room. |
| `HOPBOARD_ROOM_TTL` | `600` | Seconds a room survives after its last peer leaves. |
| `HOPBOARD_REDIS_URL` | none | Shared backend. See §2. |
| `HOPBOARD_MAX_FRAME_BYTES` | `32768` | Protocol limit. Changing it desynchronises you from stock clients. |

`backend/test_policy.py` is the gate for these. Run it after changing any of
them — a flag that silently does nothing looks exactly like a flag that works,
and an operator who sets `HOPBOARD_DISABLE_FILES` and sees no error has every
reason to believe files are disabled.

**On `HOPBOARD_JOIN_TOKEN`.** Everyone in your organisation holds the same value.
It says *"you may use this relay"*, never *"you may read this room"* — the session
key is still the only thing that decrypts anything. Its job is to stop an internal
deployment being an open relay for anyone who learns the hostname. It travels as a
query parameter because browsers cannot set headers on a WebSocket or an
EventSource, so treat it as a deployment secret, not a credential: it will appear
in proxy logs.

---

## 5. For a security review

The questions that get asked, and the honest answers.

**Where does clipboard data go?** To the relay you are running, as AES-GCM
ciphertext produced in the browser, and out again to the other devices sharing the
key. The relay cannot decrypt it: it holds a room hash and a payload, and neither
the key nor the PIN is ever transmitted (PRD §7.3, `src/core/crypto.js`).

**What is written to disk?** Nothing, on the relay. Room state is a dict, the last
clip is a string in RAM, and both die with the process or after the room TTL. The
container declares no volume. On a client, only preferences — never clip content.

**What egress does it need?** One hostname, port 443, outbound. That is it.
WebSocket first, falling back to SSE + POST on the same host if a TLS-inspecting
proxy eats the upgrade. Peer-to-peer file transfer additionally attempts UDP via
STUN, which corporate networks routinely block; it falls back to relaying the
chunks, visibly labelled — or set `HOPBOARD_DISABLE_FILES` and remove the question.

**Can you produce an audit log?** Of metadata, yes: joins, room hashes,
timestamps, peer counts. Not of content, because the relay provably cannot read
it. That is the stronger position and worth stating plainly rather than
apologising for.

**Is the client auditable?** Yes, and deliberately so. The deployed JavaScript is
minified but **not obfuscated**, and it ships with source maps. For a product
whose entire claim is "we cannot read your clipboard", being checkable is the
claim.

**What about the desktop app?** It watches the system clipboard continuously —
that is what it is for, and it is a materially larger thing to agree to than a
browser tab. It ships set to **Manual** for that reason: nothing leaves the
machine until the user sends it. It writes nothing to disk beyond its settings, it
needs no administrator rights, and it installs no service or driver.

**The honest caveat.** The share key is a bearer credential. Anyone who learns it
can read that session while it is open. Locked sessions add a PIN that never
travels in the link and is never sent to the relay — for a shared or high-value
session, use one.

---

## 6. What this is not

Not SSO, not user accounts, not per-user access control. Adding those would
contradict the thing that makes the product work — you open a page, type five
characters, and it works, with no directory to be in.

If your requirement is genuinely "only these named employees, authenticated
against our IdP", this is the wrong tool and you should say so early rather than
bolting an identity system onto something designed around not having one.
