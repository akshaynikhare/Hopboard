# Search, answer engines and distribution

Research date: **2026-08-06**. Everything below is either measured or explicitly
marked as an estimate. Where a number could not be obtained, that is said rather
than filled in.

---

## 1. The finding that reordered everything else — now resolved

**This was the blocker: the site was not indexed, and nothing in this repo could
fix it. The domain move fixed it. Kept here because the reasoning still governs
what `robots.txt` may contain.**

`robots.txt` is only honoured at the root of an origin. The project used to
deploy to `https://akshaynikhare.github.io/RealtimeClipboard/`, so its
`robots.txt` landed in a subdirectory and was never fetched. The file that
actually governed that origin was served from
`https://akshaynikhare.github.io/robots.txt`, lived in a separate repository,
and declared the sitemap for an unrelated project and nothing for this one.

Since the move to `https://realtimeclipboard.com` (§7) this repo's `robots.txt`
sits at an apex and is authoritative. It declares the sitemap itself, and
`tools/site-check.mjs` fails the build if that line ever stops naming the
canonical origin.

The rule that survives: do **not** reintroduce `Disallow: /app.html`. A page
blocked by robots.txt is never fetched, so its `noindex` is never read, and
Google stays free to list the bare URL from the links pointing at it —
`index.html` links to `app.html` three times. The `Disallow` was the one change
that could actually have got the app indexed. The reasoning is recorded in the
file itself.

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

**Revised after the §3 autocomplete mine — an earlier draft of this section was
too dismissive.** It said the phrase "produces no autocomplete depth." That was
wrong: the mine surfaced three live completions carrying it.

| Score | Query |
|---:|---|
| 35 | `online clipboard sync automatically in realtime` |
| 31 | `online clipboard live` |
| 28 | `online clipboard realtime` |

So the term is real, but it lives **as a modifier on "online clipboard", never as
a head term of its own.** Nobody searches "realtime clipboard" bare; they search
"online clipboard … realtime". That distinction decides the page: target
`online clipboard` in the title and `realtime`/`live` in an H2 and the URL slug,
not the reverse.

Also relevant: **"live clipboard"** is 1,600/mo measured, and cl1p.net only ranks
7th for it — the weakest incumbent position in the whole set.

Treat "realtime clipboard" as a genuine secondary target for `/live-clipboard`,
not as a campaign of its own, and not as a domain name (§7).

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

Prefix `/RealtimeClipboard/` until the domain moves. Priority order:

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

**Added after the §3 mine** — these were not visible before and two of them are
the best intent in the whole set:

| Slug | Target keyword | Why |
|---|---|---|
| `/help/clipboard-sync-not-working` | `clipboard sync across devices greyed out`, `copy paste between devices not working` | ⭐ **Rescue traffic.** Their native sync is broken *right now* and nobody in this category writes for it |
| `/help/samsung-clipboard-sync` | `share clipboard between samsung devices` (43) | Samsung is its own cluster, twice in the top 45 |
| `/help/online-clipboard-qr-code` | `online clipboard qr code` (31), `with qr code` (29) | **The app already has a QR button** — the feature exists, the page does not |
| `/help/how-to-sync-clipboard-across-devices` | `how to sync clipboard across devices` (151) | Highest-scoring query found, anywhere |
| `/help/share-clipboard-between-android-devices` | (136) | Second highest |
| `/help/self-hosted-clipboard-sync` | `clipboard sync self hosted` (34), `open source` (30) | Feeds r/selfhosted and awesome-selfhosted (§6) |

⚠️ Do **not** build for `online clipboard pdf` or `online clipboard image editor`
— despite decent scores, that is image/PDF *editing* intent, not transfer. And
skip `online clipboard vercel` / `klipit`: people looking for a named competitor.

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

## 3. Google Trends — partly obtained. Read this.

**Trends' interest-over-time is still blocked.** `/trends/explore`, the
`/trends/api/explore` JSON endpoint and the embed endpoint all return **HTTP 429**
from here, consistently, IP-level, across many attempts on separate days. **There
is no interest-over-time series and no top-geography map in this document.**

To close that gap: run Trends manually from a browser on another IP, or use
SerpApi's Google Trends endpoint. Ten minutes of manual work.

**What did work, and is arguably the better data:** two endpoints answer normally.

| Endpoint | Status | Gives |
|---|---|---|
| `trends.google.com/trends/api/autocomplete` | ✅ 200 | Trends topic entities |
| `suggestqueries.google.com/complete/search` | ✅ 200 | **Live queries, ordered by popularity** |
| `trends.google.com/trending/rss` | ✅ 200 | Daily trending (not our topic) |

Google Suggest is the same corpus Trends' "related queries" panel draws from. It
gives *ordering* rather than an index number — and for choosing which pages to
build, knowing that `online clipboard no login` outranks `online clipboard pdf` is
worth more than a 0–100 index on a term nobody types.

### The mined query set — 1,095 real queries

Method: 30 seed phrases in the category, each expanded with an a–z suffix sweep,
run against Suggest for `gl=us` and `gl=in`, deduplicated. Each suggestion scores
`10 − rank` per appearance, so a phrase surfacing high under several unrelated
seeds outranks one appearing once at the bottom. Reproduce with
`tools/kwmine.py`. **US and India returned near-identical orderings** — the
top 20 differ only in minor position swaps, which means one set of pages serves
both markets.

**Every `online clipboard …` completion that exists** (this *is* the page plan):

| Score | Query | Build? |
|---:|---|---|
| 48 | `online clipboard` | ✅ homepage |
| **48** | **`online clipboard no login`** | ✅ **highest-value page** |
| 36/31 | `online clipboard vercel` / `vercel app` | ❌ people seeking a specific clone |
| **35** | **`online clipboard sync automatically in realtime`** | ✅ the realtime page |
| 33 | `online clipboard text` | ✅ fold into homepage |
| 31 | `online clipboard live` | ✅ |
| **31/29** | **`online clipboard qr code` / `with qr code`** | ✅ **the app already has QR** |
| 30 | `online clipboard klipit` | ❌ competitor brand |
| 30 | `online clipboard url` | ✅ fold in |
| 30/28 | `online clipboard zip file` / `file` | ✅ the files page |
| 29 | `online clipboard editor` / `document` / `retrieve` | ✅ fold in |
| 28 | `online clipboard pdf` / `image editor` | ⚠️ wrong intent — image *editing* |
| 28 | `online clipboard realtime` | ✅ |
| 27 | `online clipboard upload` / `io` / `board` | ✅ fold in |

**Informational head terms** — high score, high volume, snippet-winnable:

| Score | Query |
|---:|---|
| **151** | `how to sync clipboard across devices` |
| **136** | `share clipboard between android devices` |
| 77 | `how to copy and paste across devices` |
| 52 | `sync clipboard across devices easily windows` |
| 43 | `sync clipboard between android devices` |
| 43 | `share clipboard between samsung devices` — **Samsung is its own cluster** |
| 40 | `sync clipboard between pc and android` |
| 40 | `how to share clipboard between android and pc` |
| 36 | `clipboard sync across devices greyed out` — troubleshooting intent, high commercial value |
| 34 | `clipboard sync self hosted` · 30 `clipboard sync open source` |
| 28 | `copy paste between devices not working` — **rescue traffic** |

Two clusters worth calling out because they were invisible before this mine:

- **`clipboard sync across devices greyed out`** and **`copy paste between devices
  not working`** are people whose *native* clipboard sync (Windows/Samsung/Apple)
  has failed. They have the problem, right now, and the incumbent solution is
  broken for them. That is the highest-converting intent in the entire set, and
  nobody in this category is writing for it.
- **Samsung** appears as its own cluster twice in the top 45. Samsung ships its
  own clipboard sync; the queries are people trying to make it work across brands.

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
card. It previously read `RealtimeClipboard - Live Clipboard Sharing / Synking` — a typo,
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

1. **AlternativeTo.** 2.91M visits/month. **New accounts must wait a week before
   submitting — create the account today**, the clock starts on creation. The
   opening: the `clipboard-sync` tag holds only **13–15 apps**, most in single
   digits (Planck 33 likes, Sefirah 32, UniClipboard 20, ClipCascade 8, and a tail
   at 1–3). Compare the file-transfer side — LocalSend 454, KDE Connect 418. Submit
   under **clipboard-sync**, listed as an alternative to **KDE Connect** (418 likes
   is the big funnel), Pushbullet, and Apple Universal Clipboard — whose
   AlternativeTo page **returns 404 and does not exist**, an unclaimed keyword. Do
   **not** position as a clipboard *manager* (Ditto 424, CopyQ 342 — saturated) or
   as "another Snapdrop": they now explicitly decline clones. Descriptions may not
   contain URLs.
2. **GitHub topics + awesome lists.** Section 5.
3. **The Snapdrop-refugee content play** — `/snapdrop-alternative` on your own site.
4. **Microsoft Store, via PWABuilder.** Registration is now **free** — the old
   $19/$99 fees were removed, and most guides online are still wrong about this.
   You must start at `storedeveloper.microsoft.com`; entering through Partner
   Center directly lands you in the legacy paid flow. Review is 24–48h, and code
   changes ship live without resubmission (only manifest changes need a new
   package). Free bonus: Store-installed PWAs send
   `Referer: app-info://platform/microsoft-store` on first navigation, so reading
   `document.referrer` gives exact install attribution at zero cost.
5. **Hacker News — and the obvious move is the wrong one.** Every large post in this
   category was a **third-party plain link, not a Show HN**: LocalSend 923, Magic
   Wormhole 816, LocalSend 563, **Snapdrop 527**, KDE Connect 476, LocalSend 447.
   Show HNs in the same category top out far lower — LANDrop 250, an AirDrop clone
   165, a WebRTC transfer tool 44, *"I built a universal clipboard that syncs
   realtime on multiple devices"* **40**, and every clipboard-sync Show HN from
   2013–2026 scored **1–5 points**.
   Two consequences. **Timing dominates over quality:** LocalSend's *same URL*
   scored 1, 4 and 3 before scoring 563, then 447, then 923 — nothing material
   changed between the 3-point and 563-point submissions. **Resubmission is the
   strategy, not the fallback.** And **lead with P2P file transfer, not clipboard**
   — the clipboard ceiling on HN is ~141 points ever, the file-sharing ceiling is
   923. ⚠️ But the 5 MB file cap will become the top comment if you lead with
   files. Raise it or reframe first.
6. **Reddit.** Rules below are verbatim from Wayback snapshots of each sub's
   `about/rules`, June–August 2026. Post data is from the PullPush archive.

   | Sub | Members | Verdict |
   |---|---:|---|
   | **r/InternetIsBeautiful** | 16.6M | 🥇 **The only 1,000+ shot.** Rule 6 bans sites requiring an email, name or account — practically written for RealtimeClipboard. Snapdrop scored **2,744** here, PairDrop **1,645**. Risk is Rule 2 ("Not Unique") since both already ran — **so lead on clipboard, not file transfer**. Link the live site, not GitHub. Rule 8 removes posts whose site buckles: harden for the hug of death |
   | **r/coolgithubprojects** | 112k | 🟢 **Post here first as a dry run.** Sub exists for this; no promo restriction. Ceiling is low (top hot post: 49) |
   | **r/SideProject** | 800k | 🟢 No configured rules. Best reach-to-risk. The pinned *"Share your **Not-AI** projects"* thread (652 upvotes) shows what the sub is rewarding now |
   | **r/opensource** | 373k | 🟡 Rule 4 requires an **OSI licence file** — satisfied as of this pass. Needs correct flair and hours in the comments; Rule 6 removes drive-by posts |
   | **r/PrivacyGuides** | 98k | 🟡 Small but exactly on-audience. Explicitly dev-friendly *if* you disclose authorship, never ask for stars, and say you are not yet PG-evaluated. ⚠️ See the ad-slot note below before posting here |
   | **r/degoogle** | 522k | 🟡 PairDrop scored 87. Rule 3 asks for pre-vetting; a solo dev is not "company affiliated", but modmail first costs nothing |
   | **r/fossdroid** | 102k | 🟡 PairDrop 209, LocalSend 110. Needs a real FOSS licence |
   | **r/webdev** | 3.3M | 🟡 **Showoff Saturday only** — any other day is auto-removed. Must read as an engineering post: WebRTC signalling, key derivation, Clipboard API quirks |
   | **r/selfhosted** | 814k | 🔴 **Main feed is closed to you.** Fails three rules at once: not self-hosted, not production-ready, and under 3 months old. Only routes are the **New Project Megathread** or a **Wednesday** tools-flair post. (PairDrop's 306 predates this regime) |
   | **r/privacy** | 1.7M | 🚫 Rule 3: promotion of any kind risks **"immediate ban without warning."** Being open source does not exempt you. Comment only |
   | **r/androidapps** | 568k | 🚫 Rule 2 bans **all** self-promo → use **r/droidappshowcase** instead |
   | **r/AppHookup** | 206k | 🚫 No always-free apps **and** no alpha/beta apps. Doubly ineligible |
   | **r/somethingimade** | 3.1M | 🚫 Handmade only; apps explicitly excluded |
   | **r/roastmystartup** | 34k | ⚠️ Rule 1 removes free-subdomain links — **needs the custom domain first** |

   **The title is a checklist, not a headline.** PairDrop's 1,645-upvote title ran
   verbatim across four subs: *"Pairdrop Is a Free, Open Source, Cross Platform,
   Browser Based Airdrop Like File and Text Sharing App That Uses Encrypted
   Peer-To-Peer Connections."* Zero personality, zero "I built" — every adjective
   pre-answers an objection. The RealtimeClipboard version needs: Free, No Account,
   End-to-End Encrypted, Cross Platform, Browser Based, Clipboard, Peer-to-Peer.

   **Two calibrations.** A dud is not a verdict — PairDrop's first two
   r/InternetIsBeautiful attempts scored **1 upvote each** before the third hit
   1,645. And the realistic target is **~150–300 upvotes, not 1,600**: ClipCascade,
   the true analogue, got 158 in r/selfhosted and is at 1.9k stars today. Note also
   that LocalSend — the project that actually won, at 86.8k stars against PairDrop's
   11.1k — **never had a big Reddit post at all.** Budget Reddit as a credibility
   beachhead, not the growth engine.

7. **Category listicles** — LinuxLinks, LinuxToday, XDA, TextExpander, SourceForge,
   Slashdot. 63% of AI citations point at listicles you do not control.
8. **YouTube — a lagging indicator you cannot push.** Coverage follows Hacker News
   by about ten days: LocalSend's HN 563 on 2023-10-19 → Brodie Robertson video on
   2023-10-29 → Techno Tim (202K views) → eventually Kevin Stratvert at 4.38M subs,
   **26 months later**. No evidence anyone pitched them; they mine HN and Reddit.
   Two channels are worth an email *after* traction: **Brodie Robertson**
   (`brodierobertsonbusiness@gmail.com`, explicitly invites suggestions, most
   tolerant of early projects) and **Lon.TV** (`lon@lon.tv`, explicitly invites
   review requests). Do **not** make founder demo videos — every one in this niche
   measured under 150 views. Make exactly one 45–90 second silent screen recording
   whose job is to be *embeddable* in the README and in comments.

**Timing gate:** the frontend network is still stubbed. A launch where two devices
do not sync is the worst available outcome, and you get roughly one good shot per
community. **Hold every public channel until the product syncs end to end.**

**Fire the channels on one day, not over three weeks.** GitHub Trending ranks star
*velocity* against a repo's own baseline, so a zero-star repo needs a concentrated
spike rather than a large one. Spreading launches guarantees you never trend.

⚠️ **The ad slot is a distribution decision, not just a product one.**
`src/ui/ads.js` is currently an inert placeholder — no third-party script, no
network request — and while it stays that way nothing here is affected. The moment
a real ad network goes in, three of the channels above change:
**pluja/awesome-privacy** requires *"no user-tracking on the project website"* and
would reject or drop the listing; **r/privacy** and **r/PrivacyGuides** audiences
will find it and lead with it; and it undercuts the no-telemetry claim that is the
whole pitch. It sits on `app.html`, which is `noindex`, so **search impact is nil**
— this is purely about the communities. If the relay needs paying for, a
self-hosted, no-JS house ad or a sponsor link in the README costs none of this.

Not worth attempting: **Product Hunt** — the decisive number is that **LocalSend
has 86,691 GitHub stars and 3 Product Hunt upvotes**; the 2026-08-05 leaderboard
was entirely AI and enterprise products, and #10 needed 123 upvotes. The category
does not launch there. Also skip **Chrome Web Store** (accepts extensions and
themes only — a PWA cannot be published, and a wrapper extension is a standard
rejection), **Wikipedia** (needs multiple independent reliable reviews; a launch
burst explicitly does not establish notability, and writing it yourself is a COI
flag that follows the project), **Privacy Guides** (requires a security white
paper, audit disclosure and a threat model — and a rejection is publicly logged),
**BetaList** and **SaaSHub** until the domain exists (both reject free
subdomains), and **Bluesky** (TechHut: 282,000 YouTube subs, 168 Bluesky
followers).

---

## 7. Custom domain — done

**Status: shipped. The site is `https://realtimeclipboard.com`, served by
Cloudflare Pages.** This section was a recommendation; it is now a record of
what was actually done and which parts of the original advice turned out to be
wrong. Read it before touching DNS or the deploy.

Two decisions were taken at once, which the earlier draft of this section
explicitly advised against ("do the domain move first and separately"). That
advice assumed the existing GitHub Pages workflow was worth preserving. It was
not, once the header problem below was weighed properly, and doing both at once
avoided two service-worker migrations instead of one — which is the expensive,
user-visible part of either change.

### Why it was worth doing

| Factor | Weight |
|---|---|
| **Response headers become possible at all** | **Decisive, and under-rated in the original analysis** |
| **robots.txt control returns to this repo** | **Decisive.** Was broken and unfixable from here |
| **Brand and trust for a security product** | **Decisive.** `username.github.io/Project/` undercuts an end-to-end-encryption pitch |
| Clean, host-level Search Console property | High |
| **Ranking uplift from the domain string itself** | **Low. Do not expect this** |

`github.io` is on the Public Suffix List (verified in `public_suffix_list.dat`,
submitted by GitHub's own security team), so a Search Console **Domain property
was impossible**. Google's **Change of Address tool was also unavailable** — it
works only at domain level and explicitly cannot move path-level properties.
Both roads were closed, so equity only ever got harder to move.

**It was done at zero backlinks and zero traffic**, which is the cheapest this
migration was ever going to be. The cost rises monotonically forever.

### The header argument, which is the real one

The original draft filed "GitHub Pages cannot set HTTP response headers" under a
footnote about a possible future move to Workers. That was the wrong altitude
for it. **A `<meta>` CSP cannot express `frame-ancestors`** — the specification
says it is ignored there — and `Strict-Transport-Security` is a header or it does
not exist. So the deployed app had no clickjacking protection at the policy
level and no HSTS, on a product whose entire pitch is that the server never sees
your plaintext.

Cloudflare Pages reads a `_headers` file, which closes both. See `_headers` at
the repo root; `tools/site-check.mjs` asserts its CSP and the `<meta>` CSP agree,
because browsers **intersect** multiple policies rather than letting one win, and
a directive that is stricter in only one of them produces an effective policy
that no file in the repository describes.

### Name

`realtimeclipboard.com`. The earlier revision of this section recommended
`realtimeclipboard.app` and recorded the `.com` as already registered — that
changed, and the `.com` was acquired.

**The `.app` argument does not survive the move to Cloudflare Pages.** It rested
entirely on the `.app` and `.dev` TLDs being HSTS-preloaded with `force-https`
(verified in Chromium's `transport_security_state_static.json`), which mattered
*because GitHub Pages could not send an HSTS header*. That premise is gone:
`_headers` sends `Strict-Transport-Security: max-age=63072000; includeSubDomains;
preload` on every response. The `.com` now gets the same protection by the
ordinary mechanism, and keeps the recognition advantage a `.com` still carries
with non-technical users — who are most of the audience for "share text between
my phone and laptop".

Not an exact-match-domain play: Mueller has confirmed there is no ranking bonus
for keywords in a domain and the 2012 EMD update killed that shortcut. The name
was chosen because it is the product's name.

**Worth doing once, and not yet done:** submit the apex to
[hstspreload.org](https://hstspreload.org/). The header already declares
`preload`, which is the prerequisite, but declaring it is not the same as being
on the list — until submission, a genuinely first-ever visit can still make one
plaintext request.

### Setup — as actually built

**DNS.** Nothing to configure by hand. `realtimeclipboard.com` is registered at
Cloudflare Registrar and the zone is on the same account, so attaching the
custom domain in the Pages project creates the records itself. There is **no**
`A`/`AAAA` record set to maintain.

⚠️ **Ignore any older instructions to point `A` records at `185.199.x.153`.**
Those are GitHub Pages' anycast IPs. Adding them now would send visitors to the
tombstone (§ below) instead of the live site.

⚠️ **The grey-cloud rule is also obsolete, and inverting it is the point.** The
old advice was DNS-only, never proxied, because GitHub's certificate check would
fail behind Cloudflare's proxy and Let's Encrypt renewal would then fail ~90 days
later with a 526 long after anyone remembered doing it. Cloudflare Pages *is* the
origin now — the records it creates are proxied by design, and that is correct.

**Redirect rules configured in the dashboard**, because `_redirects` matches
paths and cannot see the hostname:

- `www.realtimeclipboard.com/*` → `https://realtimeclipboard.com/:splat`, 301.
  Both hostnames are attached to the same Pages project, so without this the
  same content is reachable at two origins — split signals, and two separate
  service-worker registrations.

In-repo redirects live in `_redirects`; today that is one rule catching the old
`/RealtimeClipboard/*` path shape against the new host.

**Verification, after DNS resolves:**

```
curl -sI http://realtimeclipboard.com/                  # 301 -> https://
curl -sI https://www.realtimeclipboard.com/             # 301 -> apex
curl -sI https://realtimeclipboard.com/robots.txt       # this repo's file, at last
curl -sI https://realtimeclipboard.com/ | grep -i 'strict-transport\|content-security'
curl -sI https://realtimeclipboard.com/RealtimeClipboard/help/   # 301 -> /help/
```

The relay needed **no** change: `backend/main.py` defaults
`REALTIMECLIPBOARD_CORS_ORIGINS` to `*`, and the payload is ciphertext the relay
cannot read anyway. Had it been pinned to the old origin, the app would have
broken the instant the domain cut over — check this first if a self-hosted relay
starts refusing the browser.

### The old origin

`akshaynikhare.github.io/RealtimeClipboard/` is a **tombstone**, published by
`.github/workflows/tombstone.yml`. It is not merely a redirect, and that
distinction is the whole reason the workflow exists.

Service workers, Cache Storage and localStorage are all **origin-scoped**, so
none of it followed the app to the new domain. Worse, the old service worker
serves the shell **cache-first**: a returning visitor's browser answers the
navigation from Cache Storage and may never make a request that a 301 could
intercept, and an installed PWA launches straight at the cached `start_url`.
Those users would have kept running a pre-move build indefinitely, with no
server-side lever to reach them.

The one channel that still works is `sw.js` — browsers recheck the worker script
on navigation and byte-compare it. The tombstone uses it to install a worker
whose only behaviour is to delete every cache, unregister itself, and reload the
page into the redirect.

**Do not turn GitHub Pages off.** An origin that 404s cannot serve the worker
that cleans up the installs still out there, and the old URLs are what every
pre-move link points at. GitHub's own `user.github.io/Repo/*` → custom-domain
301 is *not* a substitute either: it is undocumented, it targets `http://`, and
it dies if the repo is renamed or Pages is disabled.

### Post-migration checklist

- [x] Canonicals, `og:url`, `og:image` and JSON-LD `@id`/`url` on every page
- [x] `robots.txt` — now authoritative for the first time, and it declares the sitemap
- [x] `sitemap.xml` — all five URLs on the new origin
- [x] `tools/site-check.mjs` fails the build if any crawlable file names the old host
- [ ] Search Console: add `realtimeclipboard.com` as a **Domain property** (now possible), verify by DNS, submit the sitemap
- [ ] Submit to [hstspreload.org](https://hstspreload.org/)
- [ ] Run `.github/workflows/tombstone.yml`, once, after confirming the new site is live


## 8. Paying for the domain with ads — the arithmetic

The goal is modest: cover a **$10.46/yr** domain, and ideally the relay bill. Ads
can do that. But two hard gates sit in front of the money, and neither is about
traffic volume.

### Gate 1 — AdSense will reject the site as it stands

Approval is a content-quality review, not a traffic threshold. The current bar:
**anything under 500 words per page is "thin content" and triggers rejection**, and
reviewers expect roughly **15–20 substantial pages** of original material
([approval requirements](https://innopanda.com/google-adsense-in-2026/)). RealtimeClipboard
today is one landing page plus a `noindex` app. It would be declined.

**This is not a detour.** The 14-page keyword plan in §2, rewritten against the
mined queries in §3, is *exactly* what AdSense approval requires. Build the pages
for traffic and the ad eligibility arrives with them. Do not apply before then — a
rejection is on record and re-application is slower than a first application.

### Gate 2 — the $100 payout threshold is the real constraint

AdSense pays out at **$100 minimum** ([Google](https://support.google.com/adsense/answer/1709871?hl=en)).
Below that the balance simply sits there. So the question is not "can ads cover
$10.46" — it is "how long until any money moves at all."

Realistic RPM (revenue per 1,000 pageviews) for a free utility tool:

| Traffic source | RPM | Source |
|---|---:|---|
| India | **$0.60–3.00** (₹50–250) | [partnerkin](https://partnerkin.com/en/blog/articles/adsense_rpm_rates_by_country) |
| United States | ~$6.00 | same |
| Generic sites, all niches | $0.25–3.00 | same |

This category skews heavily to India (22.8% of cl1p.net's traffic), and a
free-tool audience has no purchase intent, so **assume a blended $1.00 RPM. Treat
$2 as optimistic and $0.50 as the pessimistic case.**

At $1.00 RPM:

| Pageviews/yr | Pageviews/day | Gross/yr | Covers the $10.46 domain? | Reaches the $100 payout? |
|---:|---:|---:|---|---|
| 10,000 | 27 | $10 | ✅ on paper | ❌ **never paid** |
| 50,000 | 137 | $50 | ✅ | ❌ still below threshold |
| **100,000** | **274** | **$100** | ✅ | ✅ **one payout per year** |
| 250,000 | 685 | $250 | ✅ | ✅ comfortable |

**So the real target is ~100,000 pageviews/year — about 274/day.** Below that the
earnings are theoretical: you accrue a balance you cannot withdraw.

**The encouraging part:** §2 measured that a ninth-place ranking for "online
clipboard" is worth ~6,700 visits/month — **80,400/yr from that one keyword**, and
pageviews exceed visits because people open the app after the landing page. **One
top-ten ranking on the head term roughly hits the payout threshold on its own.**
That is the whole monetisation plan in a sentence.

### The conflict nobody will raise until it is too late

An ad network that tracks users **destroys the product's central claim**. RealtimeClipboard's
pitch is "the server cannot read what you copy and nothing is stored." A page
carrying Google's ad tags is loading a third-party tracker onto the same origin as
a clipboard tool. Concretely, it costs:

- **pluja/awesome-privacy** — requires *"no user-tracking on the project website."*
  Listing refused, or removed later.
- **r/privacy, r/PrivacyGuides, r/degoogle** — the three most on-audience
  communities. They will find it and lead with it.
- **Hacker News** — see §6: a commenter opened DevTools on a comparable clipboard
  launch and dismantled its privacy claim publicly.

**Recommended split, which keeps both the money and the claim:**

| Surface | Monetisation |
|---|---|
| **Landing + keyword pages** (public, indexed, no user data) | Ads are fine here. This is where search traffic lands and where ~all impressions occur anyway |
| **`app.html`** (where clipboard content lives) | **No third-party ad tags.** House ad, sponsor link, or nothing |

That split is defensible in any forum: *"the marketing pages carry ads; the app
does not load third-party code."* And it costs almost no revenue, because search
traffic hits the content pages first.

Worth evaluating as a straight upgrade: **EthicalAds** and **Carbon Ads** serve
developer audiences without cookies or personal-data tracking, which would let ads
run on the app page too without breaking anything above. ⚠️ **Their current
publisher terms, traffic minimums and CPMs could not be verified — ethicalads.io
returned 429.** Check before committing.

Also already wired into `app.html`: **GitHub Sponsors**. For covering $10.46/yr,
a single sponsor beats a year of ads at 27 pageviews/day — and carries none of
the above cost.

## 9. What was changed in this pass

| File | Change |
|---|---|
| GitHub repo | Description rewritten around "online clipboard"; typo fixed; all 20 topics set; homepage set |
| `LICENSE` | MIT added — starts the awesome-selfhosted clock, unblocks the curated lists |
| `index.html` | Title and description retargeted to "online clipboard"; H1 and four H2s made query-shaped; comparison table added; nine-question FAQ added; schema replaced with an `@graph` of Organization / WebSite / WebPage / WebApplication; `summary_large_image` and 1200×630 `og:image` declared |
| `src/landing/landing.css` | Styles for the comparison table (scrolls inside its own container, never the page) and the FAQ |
| `app.html` | Canonical made self-referential — it was contradicting its own `noindex` |
| `robots.txt` | `Disallow: /RealtimeClipboard/app.html` removed (it would have caused the problem it was meant to prevent); rewritten again for the apex, where it is finally live |
| `sitemap.xml` | `lastmod` added |
| `manifest.webmanifest` | Description retargeted |
| `README.md` | Restructured for Google and LLM extraction: keyword-bearing H1, one-sentence description above the fold, feature bullets in search phrasing, comparison table, question-shaped FAQ |

## 10. Still to do, in order

**Today, free, ~1 hour**

1. ~~Add the sitemap line to the root `akshaynikhare.github.io` repo's robots.txt.~~
   **Obsolete — superseded by the domain move (§7).** This repo's `robots.txt` is
   now authoritative at the apex and declares the sitemap itself.
2. Verify Google Search Console — **Domain property** for `realtimeclipboard.com`,
   verified by **DNS TXT record**. This is the option that was impossible before:
   `github.io` is on the Public Suffix List, which capped the old site at a
   URL-prefix property. A Domain property covers `www`, the apex and every
   scheme in one. Submit the sitemap. Request indexing once — re-submitting
   burns quota and speeds nothing.
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

   **Re-upload it whenever the card is regenerated.** The upload is a copy held
   by GitHub, not a reference to the file in the repo, so it does not follow a
   rebuild and nothing in this repo can tell it has gone stale. The card itself
   is generated by `npm run build:og` from `tools/build-og-card.py`, which reads
   the product name out of `src/core/config.js`; `npm run check:og` fails if the
   committed PNG no longer matches. It was a source-less binary until the
   Hopboard → RealtimeClipboard rename shipped a card still showing the old
   name to every link preview.
7. Link `/RealtimeClipboard/` from the portfolio page and a blog post on the user site.
   Same-host internal links, currently forgone entirely.
8. Submit to **nuzulul/awesome-webrtc** (File Transfer category) and **hemanth/awesome-pwa**.
9. Run Google Trends manually and fill in section 3.
10. Write `/snapdrop-alternative` — the highest-value single page available, and the
    window is closing.

11. Submit to the **Microsoft Store via PWABuilder** — registration is free now, and
    it is the exact user base. Start at `storedeveloper.microsoft.com`.

**Before any public launch — these are the objections that will be raised**

Two Hacker News threads in this precise category show what happens next. On
QuickClip (a clipboard-sync launch), a commenter opened DevTools, found clipboard
contents being POSTed in plaintext, and publicly demolished the E2EE claim; the
founder had to post a mea culpa. On a WebRTC transfer tool, the thread turned into
TURN-relay mechanics — roughly two-thirds of user pairs cannot connect P2P without
a relay, and there are no reliable free TURN servers.

12. **Publish a threat model** before posting anywhere. Someone *will* open the
    network tab. It should state what the key derives, the entropy of a
    five-character key, rate limiting, room-hash collision handling, session
    lifetime, and exactly what the relay sees.
13. **Reconsider PBKDF2.** HN commenters explicitly flagged PBKDF2 as outdated and
    named Argon2 in the QuickClip thread. Combined with a 5-character shared secret,
    this is the most likely single point of attack on the launch.
14. **Document the WebRTC fallback.** Is there TURN? What happens when the direct
    connection fails? "It silently fails" is the recurring complaint about every
    tool in this category.
15. **Answer "why not KDE Connect?" in one line.** It came up twice, unprompted, in
    the QuickClip thread. The real answers: no install, works on ChromeOS, works
    across networks rather than one LAN, no pairing step.
16. **Ship a Dockerfile for the relay** — it is what makes r/selfhosted and
    awesome-selfhosted read RealtimeClipboard as self-hostable rather than as a hosted
    service, and awesome-selfhosted explicitly excludes *"applications requiring
    separate synchronization servers."*

**After the product actually syncs end to end — all on one day**

17. AlternativeTo submission → **r/coolgithubprojects as a dry run** →
    r/InternetIsBeautiful (clipboard-led, live-site link) → r/SideProject →
    r/opensource → HN as a **plain link, not a Show HN**, titled around P2P file
    transfer. If HN flops, resubmit in three months: LocalSend needed four tries.
    Email Brodie Robertson and Lon.TV the day *after* any traction.
18. **awesome-selfhosted at the four-month mark (December 2026).** The target is
    reachable: its "File Transfer — Peer-to-peer Filesharing" tag holds only **8
    entries**, and PrivyDrop — a near-identical WebRTC text/file tool — got in at
    **136 stars**. Copy its `software/privydrop.yml` as the template. PR the
    `awesome-selfhosted-data` repo, not the main list.

## 11. Uncertainty register

**Reddit data is now measured, with one gap.** Subscriber counts come from
gummysearch, rule text from Wayback snapshots of each sub's `about/rules`
(June–August 2026), post scores from the PullPush archive. reddit.com itself was
hard-blocked. Two caveats: PullPush scores for posts from 2024 onward are captured
seconds after submission and are near-useless, so only pre-2024 scores are cited;
and rules for r/chromeos, r/software, r/Windows11, r/homelab, r/Android,
r/androiddev, r/PWA, r/foss and r/webapps could not be retrieved — **check those
sidebars yourself before posting.**

**Not obtained:** all Google Trends data (§3) · search volumes for 13 of 14 seed
terms — only "online clipboard" at 201,000 is measured, the rest are inferred from
autocomplete depth and SERP composition · all Reddit data (API and web both blocked)
· Authority Scores for 12 of 14 direct competitors (below Semrush's public
threshold) · exact Search Console "request indexing" daily quota (unpublished) ·
whether Bing Webmaster Tools accepts a path-scoped property · GitHub's repo-search
relevance formula (never published).

**Since resolved:** Cloudflare Registrar pricing and domain availability were
looked up directly on 2026-08-06 and are now stated as fact in §7, not estimated.

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
