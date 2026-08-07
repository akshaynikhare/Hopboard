# Launch kit — the copy, ready to paste

`SEO.md` §6 settles **where** to post and what each channel's rules are. This file is the other
half: the **text to submit**, written once so the same claims go out everywhere and a correction
has one place to happen.

Nothing here is scheduled. `SEO.md` §6 sets a hard timing gate — **hold every public channel until
two devices actually sync end to end** — and §10 items 12–16 list the objections that will be
raised on the day. Read both before using any of this.

---

## 1. The one string, and its shorter forms

The repo description, the `<title>` tail, the `meta description` and the OG card already carry the
same sentence (`SEO.md` §5). Every listing below is a length-cut of it, not a rewrite. **If the
product changes, change it here first, then propagate** — the failure mode this prevents is four
listings each describing a slightly different tool.

**Canonical (repo description, 138 chars)**

> End-to-end encrypted online clipboard: sync clipboard text between devices and send files
> peer-to-peer. No account, no install - just a short key.

**Short (60 chars — store subtitles, directory taglines)**

> Encrypted clipboard sync between devices. No account.

**Medium (~250 chars — AlternativeTo, SourceForge, most directories)**

> RealtimeClipboard is a free, end-to-end encrypted online clipboard. Open the same short key on
> two devices and text you copy on one lands on the other's clipboard — across different networks,
> with no account and nothing to install. Files travel peer-to-peer.

⚠️ AlternativeTo descriptions **may not contain URLs** (`SEO.md` §6).

**Long (~600 chars — Microsoft Store, awesome-list PRs, Reddit body)**

> RealtimeClipboard is a free and open-source online clipboard. Open it on two devices, type the
> same short key on both, and whatever you copy on one is on the other's system clipboard ready to
> paste. There is no account, no email address and nothing to install — it runs in a browser tab,
> and installs as a PWA if you want it to.
>
> Text is encrypted in your browser with AES-GCM before it is sent. The relay is addressed by a
> hash of your key rather than the key itself, so it routes messages it cannot read, and it stores
> nothing on disk. Files skip the server entirely and go directly between the two browsers over
> WebRTC.
>
> It works between devices on different networks, which most tools in this space do not — they
> discover each other by broadcasting on the local network, and that stops at the router. MIT
> licensed; the relay can be self-hosted.

**The caveats, which go in every long-form post.** Leaving them out is what turns a launch thread
into the QuickClip thread (`SEO.md` §6): pre-alpha · the short key is a bearer credential · files
capped at 5 MB · automatic clipboard capture needs a Chromium-based browser · no browser can read
the clipboard while its tab is in the background.

---

## 2. Titles

`SEO.md` §6 measured this: **the title is a checklist, not a headline.** PairDrop's 1,645-upvote
title ran verbatim across four subs with zero personality — every adjective pre-answers an
objection. Required tokens: Free · No Account · End-to-End Encrypted · Cross Platform · Browser
Based · Clipboard · Peer-to-Peer.

| Channel | Title |
|---|---|
| **r/InternetIsBeautiful** | RealtimeClipboard is a free, open-source, browser-based clipboard that syncs text between your devices with a short key — no account, end-to-end encrypted, and it works across different networks |
| **r/SideProject** | I built a browser-based clipboard that syncs between devices with a 5-character key — no account, no install, end-to-end encrypted |
| **r/coolgithubprojects** | RealtimeClipboard — end-to-end encrypted online clipboard, no account, files peer-to-peer over WebRTC |
| **r/opensource** | RealtimeClipboard: MIT-licensed encrypted clipboard sync between devices, no account, self-hostable relay |
| **r/webdev** *(Showoff Saturday only)* | Built an E2EE clipboard sync: WebRTC data channels for files, AES-GCM in the browser, and a relay that only ever sees SHA-256(key) |
| **r/degoogle / r/fossdroid** | Free, open-source clipboard sync between Android and desktop — no Google account, no telemetry, end-to-end encrypted |
| **Hacker News** | Lead on P2P file transfer, not clipboard — see the caution below |

**Hacker News, specifically.** §6 measured the ceiling: clipboard posts top out around 141 points
ever, file-sharing posts reach 923. It also found every large post in this category was a
**third-party plain link, not a Show HN**. And it flags the trap: **the 5 MB file cap will become
the top comment if you lead with files.** Raise the cap or reframe before posting. Resubmission is
the strategy, not the fallback — LocalSend's same URL scored 1, 4 and 3 before it scored 563.

---

## 3. Product boards and directories

Ordered by the expected value measured in `SEO.md` §6. Every one of these is free.

| Target | Status | The submission |
|---|---|---|
| **AlternativeTo** | ⏳ Account must exist **one week** before submitting — create it now | Tag `clipboard-sync`. List as an alternative to **KDE Connect** (the big funnel), Pushbullet, and Apple Universal Clipboard. Use the Medium string, **no URLs in it**. Do *not* position as a clipboard *manager* (saturated) or as a Snapdrop clone (declined on sight) |
| **nuzulul/awesome-webrtc** | ✅ Submit first — no star minimum | File Transfer category, beside Snapdrop/PairDrop/ShareDrop. One line: name, link, Short string |
| **hemanth/awesome-pwa** | ✅ Ready | Same one-line form |
| **pluja/awesome-privacy** | ✅ Ready — needs a privacy policy and no user tracking, both true today | ⚠️ Becomes false the moment `src/ui/features/ads.js` gets a real network. See §6's ad-slot warning |
| **Microsoft Store via PWABuilder** | ✅ Registration is now free | Start at `storedeveloper.microsoft.com` — entering via Partner Center lands in the legacy paid flow. Review 24–48h. Bonus: Store installs send `Referer: app-info://platform/microsoft-store`, which is free install attribution |
| **awesome-selfhosted** | ⏳ Blocked until ~December 2026 (4-month rule from first release) | PR `awesome-selfhosted-data`, not the main list. Copy `software/privydrop.yml` as the template. Needs the Dockerfile — §10 item 16 |
| **GitHub social preview** | ⏳ Manual, no API | Settings → Social preview → upload `assets/social/og-card.png`. **Re-upload whenever the card is regenerated** — GitHub keeps a copy, not a reference |
| **Product Hunt** | ❌ Skip | LocalSend: 86,691 GitHub stars, **3 Product Hunt upvotes**. The category does not launch there |
| **Chrome Web Store** | ❌ Skip | Extensions and themes only; a wrapper extension is a standard rejection |
| **Wikipedia / Privacy Guides / BetaList / SaaSHub** | ❌ Skip for now | Each needs independent coverage or a security white paper that does not exist yet |

---

## 4. Search console registration — do these first, they gate everything else

1. **Google Search Console — Domain property** for `realtimeclipboard.com`, verified by **DNS TXT
   record**. A Domain property covers `www`, the apex and every scheme at once; the old `github.io`
   host was on the Public Suffix List and could never have one. Submit `sitemap.xml`. Request
   indexing **once** — re-submitting burns quota and speeds nothing.
2. **Bing Webmaster Tools** — register by **importing from Search Console**, which auto-verifies.
   Its **AI Performance report** reports Citations and grounding queries: the only first-party
   readout of query fan-out that exists anywhere, and free.
3. **IndexNow** is already wired — `npm run seo:indexnow`. It reaches Bing, Yandex, Seznam and
   Naver in one call. Google does not participate. Run it **after** a deploy is live, never before:
   the endpoint fetches each URL to verify it, so submitting early records a 404.
4. **Verify Cloudflare is not blocking answer-engine crawlers.** Measured 2026-08-07: it is not,
   and structurally cannot be while both DNS records stay `DNS only` — the zone security pipeline
   only runs on proxied traffic. Do not take that on trust after any DNS change; the check is one
   command and needs no dashboard access:

   ```bash
   for ua in OAI-SearchBot ClaudeBot PerplexityBot Googlebot bingbot; do
     echo "$ua $(curl -s -o /dev/null -w '%{http_code}' -A "$ua" https://realtimeclipboard.com/)"
   done
   ```

   Anything other than `200` means the edge is filtering. If it ever is: the control is under the
   zone's **Security → Bots** / **AI Crawl Control** section (Cloudflare has moved and renamed it
   more than once — look for AI crawlers or "Block AI bots", and note Cloudflare began enabling it
   by default for new zones in 2025). Allow `OAI-SearchBot`, `Claude-SearchBot` and
   `PerplexityBot` at minimum; blocking `GPTBot` costs nothing, since it is training-only.

5. **`www` is currently `HTTP 522` — fix before any launch.** DNS is fine: `www` CNAMEs to
   `realtimeclipboard.pages.dev`, resolves to Cloudflare, and TLS completes (a 522 means the
   handshake succeeded). What is missing is a route — `www` is not attached to the Pages project,
   so the edge terminates the connection and has nowhere to send it.

   **Do not fix it by adding `www` as a Pages custom domain.** That makes it serve a second copy
   of the whole site at a second hostname: split ranking signals and two separate service-worker
   registrations. `www` should redirect, not serve. `_redirects` cannot express it — that file
   matches paths, not hostnames.

   **Step 1 — proxy the `www` record.** DNS → Records → the `www` CNAME → Edit → set **Proxy
   status** to **Proxied** (orange cloud) → Save. A Redirect Rule only runs on proxied traffic, so
   this is what makes step 2 possible. Leave the **apex on `DNS only`**: proxying it is what would
   put it behind the AI-crawler blocking in item 4, and it is serving correctly as it is.

   **Step 2 — create the redirect.** Rules → **Redirect Rules** → Create rule. Newer dashboards
   offer a **"Redirect from www to root domain"** template, which does all of this; if you see it,
   use it and skip to step 3. Otherwise, by hand:

   | Field | Value |
   |---|---|
   | Rule name | `www to apex` |
   | If — custom filter expression | `(http.host eq "www.realtimeclipboard.com")` |
   | Then — Type | **Dynamic** |
   | Expression | `concat("https://realtimeclipboard.com", http.request.uri.path)` |
   | Status code | **301** |
   | Preserve query string | ✅ |

   Dynamic rather than Static, because a static target drops the path: `www…/help/` has to land on
   `/help/`, not on the homepage. Same reasoning as the `:splat` note in `_redirects`.

   **Step 3 — verify.** Both must pass:

   ```bash
   curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' https://www.realtimeclipboard.com/help/
   #   expect: 301 -> https://realtimeclipboard.com/help/

   curl -s -o /dev/null -w '%{http_code} %{url_effective}\n' -L https://www.realtimeclipboard.com/
   #   expect: 200 https://realtimeclipboard.com/
   ```

   Then re-run the crawler check in item 4 — `www` is now proxied, so the zone security pipeline
   applies to it for the first time.

---

## 5. The one video

`SEO.md` §6: founder demo videos in this niche all measured under 150 views, and YouTube coverage
follows Hacker News by about ten days without anyone pitching it. So make exactly one asset — a
**45–90 second silent screen recording** whose only job is to be embeddable in the README and
droppable into comments. Two devices, one key, copy on the left, paste on the right. No voiceover,
no intro, no logo.

Worth an email only *after* traction: **Brodie Robertson** (`brodierobertsonbusiness@gmail.com`)
and **Lon.TV** (`lon@lon.tv`). Both explicitly invite suggestions.

---

## 6. Fire everything on one day

GitHub Trending ranks star *velocity* against a repo's own baseline, so a zero-star repo needs a
concentrated spike rather than a large one. Spreading launches across three weeks guarantees you
never trend.

Order, from `SEO.md` §10 item 17: AlternativeTo → **r/coolgithubprojects as a dry run** →
r/InternetIsBeautiful (clipboard-led, live-site link, *not* GitHub) → r/SideProject → r/opensource
→ HN as a plain link. Harden the relay for the hug of death first: r/InternetIsBeautiful's Rule 8
removes posts whose site buckles.

Calibration, so a quiet day is not read as a verdict: PairDrop's first two r/InternetIsBeautiful
attempts scored **1 upvote each** before the third hit 1,645. The realistic target here is
**150–300 upvotes**, not 1,600 — and LocalSend, the project that actually won this category, never
had a big Reddit post at all.
