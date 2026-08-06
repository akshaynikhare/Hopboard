/**
 * Hopboard service worker — app-shell cache (PRD FR-4.2).
 *
 * Scope note (PRD OI-9). The site is served from a GitHub Pages *subpath*,
 * https://<user>.github.io/Hopboard/, so nothing in this file may start with a
 * leading "/". Every URL below is relative to this script, which the browser
 * resolves against /Hopboard/sw.js — and a worker's default scope is its own
 * directory, so the registration covers exactly the app and nothing else.
 *
 * What is NOT cached, ever:
 *   - the relay (hopboard.fastapicloud.dev) and any ws:/wss: traffic. Clipboard
 *     content is live, encrypted and single-delivery; a cached copy would be
 *     both wrong and a disclosure risk.
 *   - cross-origin requests of any kind.
 *   - anything that is not a GET.
 *
 * VERSION and SHELL below are both REWRITTEN AT DEPLOY by tools/build.mjs —
 * VERSION from the release tag, SHELL from the files the bundle actually
 * produced. The values committed here are the ones development uses, where the
 * unbundled module tree is what gets served. Editing them by hand for a deploy
 * does nothing; editing them for local work is fine.
 *
 * Static assets are served cache-first, so VERSION is what tells the browser
 * there is an update at all: it byte-compares sw.js, sees the new string,
 * installs the new worker, and the page shows the reload prompt.
 *
 * ── KILL SWITCH ────────────────────────────────────────────────────────────
 * A service worker is the one thing here that OUTLIVES a bad deploy. It holds
 * the app shell in a cache-first cache on every machine that has ever opened
 * the app, so a compromised or broken build keeps being served from disk after
 * the origin has been fixed. Reverting the site does not reach those clients.
 *
 * To evict everyone: set KILL to true and deploy. Every client that fetches
 * sw.js — which the browser does on navigation, at most every 24h — drops all
 * caches, unregisters this worker, and reloads to the network. Recovery is one
 * commit, and it costs offline support until KILL goes back to false.
 */

const KILL = false;

const VERSION = "v4";
const CACHE = `hopboard-shell-${VERSION}`;

/** Hosts this worker must never touch, whatever the request looks like. */
const NEVER = new Set(["hopboard.fastapicloud.dev"]);

/** Directory this worker was served from, e.g. "/Hopboard/" or "/" locally. */
const ROOT = new URL("./", self.location).pathname;

/**
 * The app shell, enumerated by hand.
 *
 * This literal list is the DEVELOPMENT shell: the module tree as served by
 * `npm run serve`, with a line per module. tests/static-check.mjs keeps it
 * honest against disk. tools/build.mjs REPLACES it wholesale at deploy with the
 * bundled output, because the paths below do not exist there.
 *
 * Neither kind of drift is fatal. A missing entry still gets cached the first
 * time the page asks for it (see `cacheFirst`), so it costs offline-on-first-
 * -visit, not correctness; a stale entry for a deleted file fails its own
 * cache.add() and is logged rather than failing the whole install.
 */
const SHELL = [
  "./",
  "./index.html",
  "./app.html",
  "./manifest.webmanifest",
  "./src/clipboard/capture.js",
  "./src/clipboard/os.js",
  "./src/core/bus.js",
  "./src/core/config.js",
  "./src/core/crypto.js",
  "./src/core/device.js",
  "./src/core/history.js",
  "./src/core/keys.js",
  "./src/core/paths.js",
  "./src/core/state.js",
  "./src/core/storage.js",
  "./src/files/chunker.js",
  "./src/files/registry.js",
  "./src/files/thumbs.js",
  "./src/files/transfer.js",
  "./src/landing/faq.js",
  "./src/landing/globe.js",
  "./src/landing/land.js",
  "./src/landing/landing.js",
  "./src/main.js",
  "./src/transport/protocol.js",
  "./src/transport/relay.js",
  "./src/transport/sse.js",
  "./src/transport/ws.js",
  "./src/ui/ads.js",
  "./src/ui/appLinks.js",
  "./src/ui/banners.js",
  "./src/ui/cursors.js",
  "./src/ui/dom.js",
  "./src/ui/editor.js",
  "./src/ui/filesPanel.js",
  "./src/ui/hints.js",
  "./src/ui/historyPanel.js",
  "./src/ui/install.js",
  "./src/ui/lockDialog.js",
  "./src/ui/mobileNav.js",
  "./src/ui/modal.js",
  "./src/ui/panes.js",
  "./src/ui/qr.js",
  "./src/ui/resizer.js",
  "./src/ui/sessionPanel.js",
  "./src/ui/statusMenu.js",
  "./src/ui/statusbar.js",
  "./src/ui/syncMode.js",
  "./src/ui/toast.js",
  "./src/ui/whatsNew.js",
  "./src/landing/download.js",
  "./src/landing/landing.css",
  "./src/landing/redirect.js",
  "./src/styles/ads.css",
  "./src/styles/appbar.css",
  "./src/styles/banners.css",
  "./src/styles/base.css",
  "./src/styles/components.css",
  "./src/styles/cursors.css",
  "./src/styles/editor.css",
  "./src/styles/files.css",
  "./src/styles/hints.css",
  "./src/styles/history.css",
  "./src/styles/install.css",
  "./src/styles/layout.css",
  "./src/styles/lock.css",
  "./src/styles/main.css",
  "./src/styles/mobile.css",
  "./src/styles/qr.css",
  "./src/styles/resizer.css",
  "./src/styles/sidebar.css",
  "./src/styles/statusbar.css",
  "./src/styles/tokens.css",
  "./src/styles/whatsnew.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
];

/* ---------------- lifecycle ---------------- */

self.addEventListener("install", event => {
  // Take over immediately when killed. The usual reason to wait for the user's
  // consent — not swapping code under someone mid-sentence — is outranked by
  // the reason this switch is being used at all.
  if (KILL) return void self.skipWaiting();

  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Deliberately not cache.addAll(): that is atomic, so one renamed file
    // would fail the whole install and leave users with no offline shell at
    // all. Fetch each with cache:"reload" so the HTTP cache cannot hand us the
    // very build we are trying to replace.
    await Promise.all(SHELL.map(async url => {
      try {
        await cache.add(new Request(url, { cache: "reload" }));
      } catch (err) {
        console.warn("[sw] shell entry skipped:", url, err);
      }
    }));
    // No skipWaiting() here on purpose. The new worker waits until the user
    // accepts the "Update available · Reload" prompt (FR-4.6), which posts
    // SKIP_WAITING below. Swapping the code under a page mid-session would
    // reload it while someone is typing into the editor.
  })());
});

self.addEventListener("activate", event => {
  if (KILL) {
    event.waitUntil((async () => {
      // Every cache, not just this origin's shell prefix: the point of the
      // switch is that we no longer trust what is on disk.
      await Promise.all((await caches.keys()).map(n => caches.delete(n)));
      await self.registration.unregister();
      // Reload each open tab. Unregistering alone leaves the current pages
      // still controlled by this worker until they navigate on their own.
      for (const client of await self.clients.matchAll({ type: "window" })) {
        client.navigate(client.url).catch(() => { /* nothing better to try */ });
      }
    })());
    return;
  }

  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith("hopboard-shell-") && n !== CACHE)
        .map(n => caches.delete(n))
    );
    // Take over already-open tabs so the first visit works offline without a
    // manual reload.
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* ---------------- fetch ---------------- */

self.addEventListener("fetch", event => {
  const req = event.request;

  // Anything not a plain same-origin GET inside our own scope is none of this
  // worker's business — returning without respondWith() hands it straight to
  // the network, exactly as if no service worker were installed.
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // ws:/wss: never reaches a fetch handler by spec; the check documents the
  // invariant and covers blob:, data: and chrome-extension: too.
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  if (NEVER.has(url.hostname)) return;                 // the relay
  if (url.origin !== self.location.origin) return;     // any third party
  if (!url.pathname.startsWith(ROOT)) return;          // outside /Hopboard/

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  // Code is network-first; assets are cache-first.
  //
  // Cache-first for JS/CSS is correct for a stable app and wrong for this one.
  // It pins a returning visitor to whatever build their cache holds until the
  // worker version changes AND they reload — which presented as the app being
  // "still on the preview build" several deploys after that build was gone,
  // with no way for the user to tell. Code changes on every push; icons and
  // the manifest do not.
  //
  // Offline still works: network-first falls back to the cache, so the shell
  // loads with no connection. The cost is one conditional request per asset
  // when online, which for ~30 small files is not worth the confusion.
  if (/\.(js|mjs|css|html)$/.test(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(cacheFirst(req));
});

/**
 * Navigations: network-first, so a deploy is picked up on the next load rather
 * than after a cache eviction. Falls back to the cached shell when offline.
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(request))
        || (await cache.match("./index.html"))
        || offline();
  }
}

/**
 * Static assets: cache-first. The shell is versioned as a unit, so a hit is
 * always a hit on the build that shipped it — see the VERSION note at the top.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  try {
    const fresh = await fetch(request);
    // Only same-origin, successful, non-opaque responses are worth storing.
    if (fresh && fresh.ok && fresh.type === "basic") cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const stale = await cache.match(request, { ignoreSearch: true });
    if (stale) return stale;
    throw err;
  }
}

function offline() {
  return new Response(
    "Hopboard is offline and the app shell has not been cached yet.",
    { status: 503, headers: { "Content-Type": "text/plain;charset=utf-8" } }
  );
}
