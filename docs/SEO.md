# Search, answer engines and distribution

Research date: **2026-08-06**. Everything below is either measured or explicitly
marked as an estimate. Where a number could not be obtained, that is said rather
than filled in.

---

## 1. The finding that reorders everything else

**The site is not indexed, and nothing on this page can fix it from this repo.**

`robots.txt` is only honoured at the root of an origin. This project deploys to
`https://akshaynikhare.github.io/Hopboard/`, so `Hopboard/robots.txt` lands in a
subdirectory and is never fetched. The file that governs this origin is served
from `https://akshaynikhare.github.io/robots.txt` and lives in the separate
`akshaynikhare/akshaynikhare.github.io` repository. It currently declares the
sitemap for `career-compass` and nothing for Hopboard.

**Action, in the other repo, one line:**

```
Sitemap: https://akshaynikhare.github.io/Hopboard/sitemap.xml
```

Do **not** also move the old `Disallow: /Hopboard/app.html` up there. A page
blocked by robots.txt is never fetched, so its `noindex` is never read, and
Google stays free to list the bare URL from the links pointing at it. The
`Disallow` was the one change that could actually have got the app indexed. It
has been removed from this repo's `robots.txt`, and the reasoning is recorded in
the file itself.

---

## 2. Keyword strategy

### The head term was wrong

The page previously led with **"shared clipboard"** and **"clipboard sharing"**.
Google Autocomplete on both is dominated by `virtualbox`, `vmware`, `rdp` and
`remote desktop`. They are virtualisation keywords. Ranking for them would have
brought the wrong audience.

The real head term for this product is **"online clipboard"**.

### The one hard number

From cl1p.net's public Semrush profile (India database, June 2026):

| Keyword | Volume | cl1p.net position | Share of its traffic |
|---|---:|---:|---:|
| **online clipboard** | **201,000** | 9 | 46.98% |
| live clipboard | 1,600 | 7 | 0.49% |

The arithmetic checks out: 46.98% of cl1p.net's 14.21K organic ≈ **6,680 visits/month
from a ninth-place ranking**, a 3.3% CTR, which is textbook for position 9. That
consistency is why this figure is trusted and most others here are not.

**The prize: ninth place for "online clipboard" is worth roughly 6,700 visits a
month, and the incumbent's organic traffic fell 43.74% month-over-month.**

### On "Realtime Clipboard" specifically

You asked to rank for this. Honest reading: **"realtime clipboard" is not itself a
meaningful volume term** — it produces no autocomplete depth. Its two viable
relatives are:

- **"live clipboard"** — 1,600/mo measured, cl1p.net only ranks 7th. Winnable, and
  it matches the project's own original phrasing.
- **"online clipboard realtime"** — a long tail off the 201K head, held by thin sites.

Treat "realtime clipboard" as a phrase to *include in copy* and as the `/live-clipboard`
page's secondary target, not as a campaign of its own.

### Winnable in 3–6 months, ranked

1. `clipboard sync no app`, `clipboard sync free no account` — a site with **zero
   Wayback captures ever** holds positions 1, 2 **and** 3 on ~500-word pages, and a
   `github.io` project page already ranks here. Proof that neither authority nor a
   custom domain is a prerequisite.
2. `share text between devices` — the current #1 is an **Alibaba product-insights
   page**. Google has no good answer to this query.
3. `online clipboard no login` / `for files` / `with qr code` / `realtime` — long
   tails off the 201K head, held by thin exact-match domains.
4. `snapdrop alternative`, `sharedrop alternative` — 1.31M combined monthly visits
   sitting on two LimeWire-owned properties with documented user revolt. A
   Semrush-invisible site already ranks 5th. **This window is open but closing** —
   competitors published into it in March and July 2026.
5. The device-pair matrix — `android to pc clipboard`, `mac to windows clipboard`,
   `sync clipboard between linux and android`, and ten more, all with full
   autocomplete depth.
6. `live clipboard`, `pastebin alternative private`, `pushbullet alternative`.

### Unwinnable in that window — do not spend time here

| Term | Why |
|---|---|
| `universal clipboard` | Apple brand term, and mostly troubleshooting intent |
| `copy paste between devices` | Apple Support holds three of the top five |
| `shared clipboard`, `clipboard sharing` | VirtualBox/RDP queries — wrong audience |
| `send text from pc to phone` | 100% SMS-service intent |
| `clipboard sync across devices` | Windows-settings how-tos, owned by the big publishers |
| `clipboard manager online` | Desktop-app intent |
| `online clipboard` top three | Ten-plus entrenched EMDs. **Position 5–9 is the realistic target** — and that is where the traffic is anyway |

### Pages to build

Prefix `/Hopboard/` until the domain moves. Priority order:

| Slug | Target keyword |
|---|---|
| `/` | online clipboard *(done)* |
| `/online-clipboard-no-login` | online clipboard no login |
| `/clipboard-sync-no-app` | clipboard sync no app |
| `/share-text-between-devices` | share text between devices |
| `/clipboard-sync-different-networks` | sync clipboard without same wifi — **the differentiator** |
| `/snapdrop-alternative` | snapdrop alternative — **write this next** |
| `/live-clipboard` | live clipboard / realtime clipboard |
| `/android-to-pc-clipboard` | share clipboard android to pc |
| `/windows-to-android-clipboard` | sync clipboard windows android |
| `/mac-to-windows-clipboard` | clipboard between mac and windows |
| `/chromebook-clipboard-sync` | chromebook clipboard sync — low competition, supported platform |
| `/online-clipboard-for-files` | online clipboard for files |
| `/is-online-clipboard-safe` | snippet bait |
| `/what-is-an-online-clipboard` | snippet bait |

Depth rule from the competitors actually ranking: one wins on ~500 words, another
on ~4,500. **1,200–2,000 substantive words** beats the first without the cost of
the second. Note the competitive baseline in this niche is 200–400 URLs, not 14 —
a static generator becomes necessary before long.

### The differentiator to lead with — corrected

The claim "the competition is all LAN-only" is **wrong and was corrected before it
was published**. PairDrop pairs across networks with a 6-digit code and public
rooms. Snapdrop, LocalSend and AirDrop are genuinely same-network.

The accurate, defensible differentiator is the **combination**: no account, no
install, cross-network, **and it lands on the actual system clipboard**. PairDrop
is the closest competitor and it makes you send a message rather than copy;
KDE Connect does clipboard properly but needs an install on both ends and the same
network. Nothing else occupies that intersection.

---

## 3. Google Trends — NOT OBTAINED. Read this.

**Google Trends could not be accessed.** Eleven attempts across two agents and the
main session — `/trends/explore`, the `/trends/api/explore` JSON endpoint, the
embed endpoint, the `trends.google.co.in` geo variant, the topic-ID form and a
reader proxy — returned **HTTP 429** every time. The block was IP-level and did
not decay.

**So there is no interest-over-time series, no top-geography map, and no
rising/breakout related-query data in this document.** That was an explicit
requirement and it was not met.

To close the gap: run Trends manually from a browser on a different IP, or use
SerpApi's Google Trends endpoint. Ten minutes of manual work.

### Proxies used instead, and what they are worth

| Signal | Method | Reading |
|---|---|---|
| Category direction | Wikipedia "AirDrop" pageviews, 2021→2025 | **Rising ~50%** (~100K/mo → ~150K/mo) |
| Seasonality | cl1p.net −38%, localsend.org −28%, snapdrop.net −18%, pairdrop.net −8%, all Apr→Jun 2026 | Four unrelated sites falling together is **seasonal, not competitive**. Do not misread a summer dip as decay |
| Peak timing | Dec 2024 was the year's high; a recurring May local max | **Publish into Nov–Dec and Apr–May** |
| Geography | India is #1 or #2 on every property measured (cl1p 22.79%, snapdrop 14.11%, airdroid 26.07%) | Real, but 15–26% — the US is co-equal. **Do not build India-only** |

Also worth knowing: **Microsoft's native Windows↔Android clipboard sync has still
not shipped** — Dev-channel only for ~11 months, one-way PC→Android. Cannibalisation
is a 2027+ tail risk, not a 2026 fact.

---

## 4. Answer engine optimisation

### What Google actually says

From Google's AI-features documentation, verbatim: *"To be eligible to be shown as
a supporting link in AI Overviews or AI Mode, a page must be indexed and eligible
to be shown in Google Search with a snippet… You don't need to create new machine
readable files, AI text files, or markup. There's also no special schema.org
structured data that you need to add."*

Two consequences:

- **Never put `nosnippet` or a tight `max-snippet` on the landing page.** Snippet
  controls are the one thing that *does* remove you from AI Overviews.
- `Google-Extended` is not an AI Overviews control. It governs Gemini training
  only, and Google states it is not a ranking signal. This is the most widely
  misunderstood point in the field.

### Why a zero-authority site has a real chance here

Ahrefs, March 2026, 863K SERPs and 4M AI-Overview URLs: only **37.9%** of
AI-Overview-cited pages rank in the top 10, **31% rank outside the top 100
entirely**. The cause is **query fan-out** — the query splits into sub-queries and
citations come from those tangential SERPs.

**You do not need to rank top-10 for "share clipboard between devices." You need to
be the single best answer to one sub-query** — *"can you sync clipboard without an
account"*, *"online clipboard that doesn't store your data"*, *"clipboard sync
across different networks"*. That is exactly what the FAQ section on the landing
page is built to do.

### Format evidence

Evertune, May 2026, ~25,000 cited URLs across six engines: **63% of citations point
to listicles**, 71–86% of those are numbered Top-N lists, the typical cited page is
**941 words with 4 H2s** and **53.4% are under 1,000 words**. Structure beats length.

Microsoft is the only search company on record telling publishers that headings,
tables and FAQ sections increase Copilot citations — and the only one saying schema
helps its LLMs. Claude's web-search API attaches `cited_text` of **up to 150
characters** to every citation, which is direct evidence that **citation is
passage-level, not page-level**. That is the mechanism behind answer-first
paragraphs, and it is why every FAQ answer on the landing page opens with a
sentence that stands alone when lifted out.

### Freshness

AI-cited URLs average 25.7% fresher than organic top-10 results, and **ChatGPT
cites content 458 days newer**. But **Google AI Overviews cites content 16 days
*older*** — freshness is a ChatGPT/Perplexity lever, not a Google one. Cosmetic
timestamp bumps do not work; crawlers diff snapshots.

### Crawlers to keep allowed

| Bot | Owner | Why it matters |
|---|---|---|
| `OAI-SearchBot` | OpenAI | **The ChatGPT citation crawler.** Opting out removes you from ChatGPT answers entirely. `GPTBot` is training-only — blocking it costs nothing |
| `PerplexityBot` | Perplexity | Citation crawler, respects robots.txt, not used for training |
| `Claude-SearchBot` | Anthropic | Citation crawler |
| `Googlebot` | Google | Serves AI Overviews off the regular index |

The `Allow: /` in `robots.txt` covers all of these. Do not add bot-specific blocks.

### Deliberately not done, with reasons

| Thing | Why not |
|---|---|
| **`llms.txt`** | Ahrefs, 137,210 domains: **97% of published files got zero traffic**; of those that got any, **1.1% of requests came from AI retrieval bots**. Their finding, verbatim: *"Zero requests came from AI bots for llms.txt files that don't exist. They never go looking."* Mueller and Illyes have both confirmed Google is not pursuing it. Google's own docs pre-emptively reject "AI text files" |
| **`FAQPage` schema** | **Dead.** Google stopped showing FAQ rich results entirely in May 2026, deleted the docs in June, and removed Search Console API support in August 2026. The visible Q&A text is what still works |
| **`HowTo` schema** | Dead since September 2023 |
| **`SearchAction` / sitelinks searchbox** | Removed November 2024 |
| **`aggregateRating`** | Google's review policy: *"If the entity that's being reviewed controls the reviews about itself, their pages… are ineligible."* Self-supplied ratings are a manual-action risk. This does mean the Software rich result is unattainable — accept that |
| **`BreadcrumbList`** | One page, no hierarchy. Fabricating one is a markup/visible-text mismatch |

On schema generally, the best available study (Ahrefs, 1,885 pages that added
JSON-LD vs 4,000 controls) found **no uplift on any platform** — and a small
*decline* on AI Overviews. The important limitation cuts in this project's favour:
the sample was pages **already heavily cited**. Nobody has tested whether schema
helps a page achieve *initial* visibility, which is the situation here. That, plus
Microsoft's on-record Copilot confirmation, justifies the thirty minutes spent —
and not a minute more.

---

## 5. GitHub

### The asymmetry that dictates everything

GitHub's own docs: *"When you omit this qualifier, only the repository **name,
description, and topics** are searched."* **The README is not in GitHub's default
search index.** It is reachable only via `in:readme`, which nobody types.

Conversely, the repo page's README is **server-side rendered** — Googlebot and LLM
crawlers see all of it without executing JavaScript.

**So: write the description and topics for GitHub search. Write the README for
Google and LLMs.** Both have been done.

### One string, four surfaces

The repo description is verbatim the tail of the page `<title>`, the `meta
description`, the `og:title`, **and** the body text of the auto-generated social
card. It previously read `Hopboard - Live Clipboard Sharing / Synking` — a typo,
and zero target keywords.

Now:

> End-to-end encrypted online clipboard: sync clipboard text between devices and
> send files peer-to-peer. No account, no install - just a 5-character key.

### Topics — the exploit

Verified empirically: `github.com/topics/<name>` is a **pure stars-descending
list**. No relevance blending, no recency boost. A 0-star repo lands at the bottom.

**The only exploit is picking topics whose total repo count is small enough that
"the bottom" is still page 1.** All 20 slots are now set as a deliberate barbell:

| Topic | Repos | Effect |
|---|---:|---|
| `clipboard-sharing` | 12 | **Page 1 at zero stars** |
| `webrtc-datachannel` | 12 | **Page 1 at zero stars** |
| `no-account` | 23 | **Page 1 at zero stars** |
| `secure-file-transfer` | 59 | **Page 1 at zero stars** |
| `datachannel` | 81 | **Page 1 at zero stars** |
| `clipboard-sync` … `pwa` | 158 – 18,806 | Keyword matching in repo search |

Realistic expectation: permanent page-1 presence on five low-traffic topic pages.
At zero stars, that is the entire organic GitHub discovery available.

### GitHub passes zero link equity

The About-sidebar website link and **every** external README link carry
`rel="nofollow"`. Verified in the repo's own HTML. **Stop treating GitHub as a
backlink source** — awesome-list inclusion is worth pursuing for discovery and LLM
citation, not PageRank. Links *from* the Pages site *to* the repo are followed, so
the traffic flows that way.

Also: `github.com/robots.txt` has `Disallow: /*/tree/`, so files in subdirectories
are **not crawled**. Anything that must be indexed belongs in the root README, not
in `docs/`.

### Awesome lists — verified status

| Target | Stars | Verdict |
|---|---:|---|
| **nuzulul/awesome-webrtc** | 44 | ✅ **Submit first.** Has a "File Transfer" category whose existing entries are literally Snapdrop, PairDrop, ShareDrop and Chitchatter. No star minimum, no maturity gate |
| **hemanth/awesome-pwa** | 4,885 | ✅ Genuinely alive |
| **pluja/awesome-privacy** | 19,340 | ✅ Accessible. Needs a privacy policy and no user-tracking on the site — both already true here |
| awesome-selfhosted | 310,911 | ⏳ **Blocked ~4 months.** Hard rule: first released more than 4 months ago. **Tag a release now to start the clock.** PR `awesome-selfhosted-data`, not the main repo |
| rtckit/awesome-rtc | 495 | ❌ Libraries only |
| sindresorhus/awesome | 492,864 | ❌ Lists only, never projects |

The MIT licence added in this pass is a prerequisite for awesome-selfhosted (needs
an SPDX identifier) and removes the standard rejection reason on the others.

---

## 6. Distribution — where this category is actually found

Ranked by measured expected value:

1. **AlternativeTo.** 2.91M visits/month, 36.5K referring domains. The Snapdrop
   page alone lists 57 alternatives. **New accounts must wait a week before
   submitting — create the account today**, the clock starts on creation. Tag as an
   alternative to Pushbullet, KDE Connect, Snapdrop, PairDrop, LocalSend, AirDrop,
   ShareDrop, Clipt and Universal Clipboard. The "alternative to" graph *is* the
   value — it is where LLMs go for "X alternative" queries. They reject
   "apps indistinguishable from widely available alternatives", so lead with the
   clipboard-not-file-dropper angle, not "another Snapdrop".
2. **GitHub topics + awesome lists.** Section 5.
3. **The Snapdrop-refugee content play** — `/snapdrop-alternative` on your own site.
4. **Hacker News.** The winning formula is measurable: LocalSend scored 923, 563 and
   447 with the identical framing *"open-source cross-platform alternative to
   AirDrop"*; the same link with different titles scored 3–4. But the decisive
   finding is that **HN's clipboard interest is about privacy, not sync** — the
   top clipboard stories ever are *"TikTok may snoop clipboard contents"* (1,847),
   *"LinkedIn is copying my clipboard"* (928), *"Don't touch my clipboard"* (718).
   **Pitch the E2EE/no-server story, not the sync feature.** "clipboard sync" as a
   topic has only 6 HN stories ever, all ≤3 points.
5. **Reddit** — r/SideProject and r/coolgithubprojects first (lowest risk),
   then r/selfhosted (lead with the self-hostable relay), r/privacy, r/degoogle,
   r/androidapps. **Subreddit rules could not be verified** — reddit.com was
   unfetchable from this environment. Check every sidebar before posting; most ban
   self-promotion. The README's "Known limitations" section is the single greatest
   asset there: Reddit rewards that and punishes marketing copy.
6. **Category listicles** — LinuxLinks, LinuxToday, XDA, TextExpander, SourceForge,
   Slashdot. 63% of AI citations point at listicles you do not control.

**Timing gate:** Show HN and Product Hunt are single-shot per project, and the
frontend network is still stubbed. A Show HN where two devices do not sync is the
worst available outcome. **Hold both until the product actually syncs end to end.**

Not worth attempting: **Wikipedia** (needs multiple independent reliable reviews;
a launch-day traffic burst explicitly does not establish notability, and writing it
yourself is a COI flag that follows the project) and **Privacy Guides** (requires a
security white paper, audit disclosure and a threat model — submitting now burns
credibility with exactly the community you want).

---

## 7. Custom domain

**Verdict: yes, move — but not for the ranking reason people usually give.**

| Factor | Weight |
|---|---|
| **robots.txt control returns to this repo** | **Decisive.** Currently broken and unfixable from here |
| **Brand and trust for a security product** | **Decisive.** `username.github.io/Project/` undercuts an end-to-end-encryption pitch |
| Clean, host-level Search Console property | High |
| **Ranking uplift from the domain string itself** | **Low. Do not expect this** |
| Cost | ~$10–13/yr |

Supporting facts: `github.io` is on the Public Suffix List (verified in
`public_suffix_list.dat`, submitted by GitHub's own security team), so a Search
Console **Domain property is impossible**. Google's **Change of Address tool is
also unavailable** — it works only at domain level and explicitly cannot move
path-level properties. Both roads are closed, so equity only ever gets harder to
move. Site-level quality signals are pooled across `akshaynikhare.github.io`,
meaning Hopboard's reputation is entangled with every side project published there.

**Do it now precisely because there are zero backlinks and zero traffic.** The
migration cost is near zero today and rises monotonically forever.

### Name

**`hopboard.app` is the recommendation.** Not an exact-match domain — Mueller has
confirmed there is no ranking bonus for keywords in a domain, the 2012 EMD update
killed that shortcut, and `clipboardsync.com` would make branded search volume
(a genuine authority signal) impossible to distinguish from generic queries.

The specific argument for `.app`: the **entire `.app` and `.dev` TLDs are
HSTS-preloaded with `force-https` and `include_subdomains`** — verified in
Chromium's `transport_security_state_static.json`. GitHub Pages **cannot send an
HSTS header**, so on a `.com` a first request from a fresh browser can go out over
plaintext before the 301 upgrades it. On `.app` the browser refuses plaintext
before sending a packet. For an E2EE tool on a platform that cannot set security
headers, that converts a real weakness into a non-issue.

Avoid `.io`: roughly 3× the cost, no HSTS benefit, and unresolved long-term
registry uncertainty tied to the British Indian Ocean Territory's status.

### Setup — the parts that bite

**DNS, all records set to DNS-only (grey cloud):**

```
@    A     185.199.108.153
@    A     185.199.109.153
@    A     185.199.110.153
@    A     185.199.111.153
@    AAAA  2606:50c0:8000::153
@    AAAA  2606:50c0:8001::153
@    AAAA  2606:50c0:8002::153
@    AAAA  2606:50c0:8003::153
www  CNAME akshaynikhare.github.io        ← the user, not the repo
```

Delete any registrar-default parked `@` records first — GitHub's docs say extra
records block certificate issuance.

- **SSL/TLS mode: Full (strict). Never Flexible.** Flexible sends plaintext to the
  origin; GitHub Pages then 301s to HTTPS; Cloudflare returns the 301; the browser
  retries — `ERR_TOO_MANY_REDIRECTS`. GitHub Pages presents a real Let's Encrypt
  cert, so Full (strict) validates cleanly.
- **Grey cloud, not orange.** With the proxy on, GitHub's DNS check sees Cloudflare
  IPs instead of `185.199.x.153` and **refuses to issue a certificate** — this is
  why "Enforce HTTPS" greys out. The under-appreciated part is that grey→cert→orange
  *appears* to work **for up to 90 days**, then Let's Encrypt renewal fails, the
  origin cert expires, and Cloudflare in Full (strict) hard-fails with a **526 —
  months later, when you have forgotten you did it.**
- You do not need the proxy anyway. GitHub Pages is already on Fastly (`Via: 1.1
  varnish` is in the live response headers). www↔apex redirects are handled by
  GitHub itself, HTTP→HTTPS by "Enforce HTTPS".
- **Cloudflare caches `.js` — including `sw.js`.** The deploy workflow stamps
  `VERSION` from the commit SHA specifically to drive service-worker updates. An
  edge-cached `sw.js` blunts that and pins users to a stale shell. Another reason
  for grey cloud.
- **Do not add a `CNAME` file.** The deploy uses a custom Actions workflow, and
  GitHub's docs state that in that case *"no CNAME file is created, and any existing
  CNAME file is ignored and is not required."* Set the domain in Settings → Pages only.

**Order of operations — step 2 is the one that takes the site down if skipped:**

1. Register the domain.
2. **Add the new origin to the FastAPI relay's CORS allowlist, before anything
   else.** If it pins `Access-Control-Allow-Origin` to the github.io host, the app
   breaks the instant you cut over. Keep both origins during transition.
3. Delete default `@` records; add the nine above, all grey.
4. `dig +short yourdomain` → exactly the four `185.199.*` and nothing else.
5. Cloudflare → SSL/TLS → **Full (strict)**.
6. GitHub → Settings → Pages → Custom domain. No CNAME file.
7. Wait for the green check and certificate.
8. Tick **Enforce HTTPS**.
9. Verify before touching content:
   ```
   curl -sI http://yourdomain/                          # 301 → https://
   curl -sI https://www.yourdomain/                     # 301 → apex
   curl -sI https://yourdomain/robots.txt               # this repo's file, at last
   curl -sI https://akshaynikhare.github.io/Hopboard/   # 301 → custom domain
   ```
10. Only then update the URLs in `index.html` (canonical, `og:url`, `og:image`,
    four JSON-LD `@id`/`url` values), `app.html` (canonical), `robots.txt` and
    `sitemap.xml`.

**The old URLs redirect automatically.** Verified against a real project site:
setting a custom domain makes `user.github.io/Repo/*` issue a **301 to
`yourdomain/*`**, repo prefix stripped, path preserved. Caveats: the target is
`http://` (one extra hop, harmless), GitHub documents this nowhere, and **the
redirect dies if you rename the repo or turn Pages off.**

**PWA gotcha worth one deploy:** service workers, Cache Storage and localStorage
are all origin-scoped, so existing installs do not migrate, and the old `sw.js`
serves the shell cache-first — a returning visitor may never see the 301. Ship one
final deploy to the old origin with a `sw.js` that calls
`self.registration.unregister()` and clears `caches.keys()`, wait a few days, then
cut over. At zero users this is close to theoretical; in six months it would not be.

**Cloudflare Pages vs Workers:** if you ever leave GitHub Pages, target **Workers**
— Cloudflare's own position is *"you should start with Workers"* and that all
investment now goes there. The real reason to consider it is that **GitHub Pages
cannot set HTTP response headers at all**, so a genuine `Content-Security-Policy`
with `frame-ancestors`, and `Strict-Transport-Security`, are both unavailable. For
an E2EE tool that is a real gap, not a nitpick. It changes nothing for SEO. **Do
the domain move first and separately** — the deploy workflow here is well-built and
should not be thrown away in the same change as a DNS migration.

---

## 8. What was changed in this pass

| File | Change |
|---|---|
| GitHub repo | Description rewritten around "online clipboard"; typo fixed; all 20 topics set; homepage set |
| `LICENSE` | MIT added — starts the awesome-selfhosted clock, unblocks the curated lists |
| `index.html` | Title and description retargeted to "online clipboard"; H1 and four H2s made query-shaped; comparison table added; nine-question FAQ added; schema replaced with an `@graph` of Organization / WebSite / WebPage / WebApplication; `summary_large_image` and 1200×630 `og:image` declared |
| `src/landing/landing.css` | Styles for the comparison table (scrolls inside its own container, never the page) and the FAQ |
| `app.html` | Canonical made self-referential — it was contradicting its own `noindex` |
| `robots.txt` | `Disallow: /Hopboard/app.html` removed (it would have caused the problem it was meant to prevent); the file's inertness documented |
| `sitemap.xml` | `lastmod` added |
| `manifest.webmanifest` | Description retargeted |
| `README.md` | Restructured for Google and LLM extraction: keyword-bearing H1, one-sentence description above the fold, feature bullets in search phrasing, comparison table, question-shaped FAQ |

## 9. Still to do, in order

**Today, free, ~1 hour**

1. **Add the sitemap line to the root `akshaynikhare.github.io` repo's robots.txt.**
   Nothing else in this document matters until this is done.
2. Verify Google Search Console — **URL-prefix property** at
   `https://akshaynikhare.github.io/Hopboard/`, **HTML meta-tag method** (DNS is
   impossible, and file-upload placement in a subdirectory is ambiguously
   documented). Submit the sitemap. Request indexing once — re-submitting burns
   quota and speeds nothing.
3. Register Bing Webmaster Tools by **importing from Search Console** (auto-verifies).
   Its **AI Performance report**, launched February 2026, reports Citations and
   *grounding queries* — the only first-party readout of query fan-out that exists
   anywhere, and it is free.
4. Create the AlternativeTo account — the one-week submission clock starts on
   account creation.
5. Tag a `v0.1.0` release to start the awesome-selfhosted four-month clock.

**This week**

6. Upload the GitHub social preview: Settings → Social preview → upload
   `social/og-card.png`. It is 1200×630, comfortably over GitHub's 640×320
   minimum, and there is no API for this — it has to be done in the UI. Until it
   is, the repo shares as a grey text box.
7. Link `/Hopboard/` from the portfolio page and a blog post on the user site.
   Same-host internal links, currently forgone entirely.
8. Submit to **nuzulul/awesome-webrtc** (File Transfer category) and **hemanth/awesome-pwa**.
9. Run Google Trends manually and fill in section 3.
10. Write `/snapdrop-alternative` — the highest-value single page available, and the
    window is closing.

**After the product actually syncs end to end**

12. AlternativeTo submission → Show HN (privacy framing) → Reddit → Product Hunt →
    awesome-selfhosted at the four-month mark.

## 10. Uncertainty register

**Not obtained:** all Google Trends data (§3) · search volumes for 13 of 14 seed
terms — only "online clipboard" at 201,000 is measured, the rest are inferred from
autocomplete depth and SERP composition · all Reddit data (API and web both blocked)
· Authority Scores for 12 of 14 direct competitors (below Semrush's public
threshold) · exact Search Console "request indexing" daily quota (unpublished) ·
whether Bing Webmaster Tools accepts a path-scoped property · GitHub's repo-search
relevance formula (never published) · Cloudflare Registrar exact pricing
(aggregators disagreed by ±7%).

**SERP orderings** come from Bing and DuckDuckGo — Google direct-fetch was blocked
— and are directionally reliable to roughly ±1–2 positions.

**Actively rejected as unsourced:** the "4.2× citations from 40–75 word answers" /
"2.8× from sequential headings" / "44.2% of citations from the first 30% of a
document" genre · Bing's alleged `data-snippet` attribute · "FAQ schema = 40%
higher ChatGPT citation weighting" · any "top 50 most-cited domains" ranking
(PR-published and mutually contradictory by 5–10×).

**Corrected before publication:** the claim that PairDrop is LAN-only. It is not —
it pairs across networks with a 6-digit code. The comparison table was rewritten
against each vendor's own documentation before it shipped.
