# Releasing

How code gets from a branch to users, and why it works this way.

---

## The shape of it

```
  branch ──commit──►  hooks run the tests here, before the commit exists
     │
     └──merge──►  main ──► Cloudflare Pages builds and deploys the site
                    │
                    └── npm run release -- minor
                            verifies, writes the changelog, tags, pushes
                                    │
                                    └── tag v1.2.0 ──► .github/workflows/release.yml
                                            CLI, desktop builds, relay image
```

Note that the two arrows out of `main` are now independent, and that is a change
worth understanding before you rely on it. **The site deploys on merge; the
release artifacts deploy on tag.** Merging a copy fix to `main` puts it in front
of users within about a minute without producing a version — which is the point
— but it also means "merged" and "live" are the same event for the frontend, and
the tag no longer gates it. The `.husky` hooks are therefore the only thing
standing between a commit and production for the web app.

If that becomes uncomfortable — a second contributor, or one bad merge — the fix
is to point Cloudflare's *production branch* at a `release` branch and fast-
forward it from `main` deliberately. Pages settings, no code change.

Every rule that follows from that diagram is enforced rather than trusted:

| Rule | Enforced by |
|---|---|
| No commits directly on `main` | `.husky/pre-commit` |
| Tests pass before a commit exists | `.husky/pre-commit` → `npm run verify` |
| A commit says what kind of change it is | `.husky/commit-msg` |
| A broken site is never promoted | `tools/check/site-check.mjs`, in the Cloudflare build |
| Only a tag ships CLI/desktop/relay | `.github/workflows/release.yml` — its only trigger is `push: tags: v*` |
| And only a tag `main` already contains | `release.yml` → *Refuse a tag that is not on main* |
| Nothing else builds anything, anywhere | no workflow has a branch trigger; Pages previews are off |

---

## Where the site is deployed

**Cloudflare Pages, at `realtimeclipboard.com`.** Settings live in the Cloudflare
dashboard rather than in this repo, so they are recorded here:

| Setting | Value | |
|---|---|---|
| Production branch | `main` | |
| Automatic deployments — **Production** | Enabled | this is the thing that deploys on merge |
| Automatic deployments — **Preview** | **Disabled** | the build budget; see below |
| Build command | `npm run build:site` | |
| Build output directory | `_site` | |
| Root directory | *(blank — the repo root)* | |
| Build watch paths | Include `*` | deliberately everything; see below |
| Build system version | `3` | |
| Build cache | Enabled | fewer build *minutes*, same build *count* |
| Build comments | Enabled | |
| `NODE_VERSION` | `22` | plaintext variable, not a secret |

The two *Automatic deployments* rows are one setting seen twice: **Settings →
Build → Branch control** shows the production half when the environment picker
at the top of the page says *Production*, and the preview half when it says
*Preview*. Switching that picker is the whole change — there is no preview
setting on the Production view to find.

`npm run build:site` is `tools/build/build.mjs` followed by `tools/check/site-check.mjs`. The
second half is the gate: it asserts the required files exist, that the sitemap
and `robots.txt` name the canonical origin, that `app.html` still carries its
`noindex`, that the manifest has no SVG icon, and that the `_headers` CSP and the
`<meta>` CSP agree. A non-zero exit fails the build, and a failed build is not
promoted — production keeps serving the previous deploy.

### Preview deployments are off, and that is the build budget

Every non-production branch used to get a preview URL automatically. That is
what **Preview deployments: None** in the table above turns off, and it is the
single biggest lever on the build count: a branch pushed ten times over an
afternoon was ten builds, none of which anyone looked at. Cloudflare does not
charge for a build it *skips* — a skipped branch costs nothing against the
monthly quota, where a build that starts and then exits in four seconds still
counts as one.

So the trigger list for the whole project is now exactly two things:

| Push | What runs |
|---|---|
| a commit to `main` | Cloudflare Pages builds and deploys the site |
| a `v*` tag | `.github/workflows/release.yml` — CLI, desktop, relay image |
| anything else | **nothing** |

`.github/workflows/desktop.yml` is `workflow_dispatch` only, so it is a thing you
run, not a thing that happens.

**When you actually want a preview URL**, switch Branch control to *Custom* with
an include pattern — `preview/*` is the obvious one — push the branch under that
name, and switch it back. Nothing in the repo depends on preview URLs existing;
they were a convenience, and `npm run build:site && (cd _site && python -m
http.server 8080)` is the same bytes without the round trip.

Dashboard path: **Workers & Pages → the project → Settings → Build → Branch
control**. The same setting over the API, for reapplying it or checking it did
not drift:

```bash
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$CF_PROJECT" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":{"config":{"production_branch":"main","preview_deployment_setting":"none"}}}'
```

⚠️ Preview URLs, while they existed, were real, public and indexable by accident
— `robots.txt` was served from them too. Turning them off closes that as a side
effect, and it is a reason not to switch them back on casually.

### Build watch paths stay at `*`, and that is a decision

Watch paths are the obvious next lever — skip the build when a commit touched
nothing the site is made of — and they are set to `*`, everything, on purpose.

**The exclude list is much shorter than it looks, because `docs/` ships.**
`tools/build/build.mjs` copies `docs/`, `README.md`, `CHANGELOG.md` and
`changelog.json` into `_site` alongside `src/` and `assets/`. A docs-only commit
therefore *does* change the deployed site, and excluding `docs/*` — the first
thing anyone reaches for — would silently stop publishing it. What is genuinely
not an input is `backend/`, `cli/`, `desktop/`, `deploy/`, `tests/`, `.github/`,
`.husky/` and `tools/release/`.

Which is a real but small saving, against a failure mode this repo goes out of
its way to avoid everywhere else: a skipped build looks exactly like a
successful one. Nothing goes red, the dashboard shows the previous deploy as
current, and the first symptom is someone asking why a change from last week is
not live. `site-check.mjs` cannot catch it — it never runs.

So: previews off is a *count* problem solved by a setting that fails loudly if
it is wrong. Watch paths trade a smaller saving for a silent failure. Revisit it
only if merges to `main` ever get close to the monthly quota, and if you do,
exclude only the eight directories above.

**It used to be GitHub Pages, on a tag.** The move happened because GitHub Pages
cannot set an HTTP response header at all, which left `frame-ancestors` and
`Strict-Transport-Security` unavailable to a product whose pitch is
end-to-end encryption — see `_headers` and docs/SEO.md §7.

There was a `.github/workflows/tombstone.yml` to go with it, which would have
replaced the old origin with a redirect and a self-deleting service worker. It
was never run, and it is now deleted. GitHub Pages went down on its own — the
old origin already answers GitHub's own *Site not found* 404 — so the workflow
had nothing left to publish over. See docs/SEO.md §7 for what that costs, which
is not nothing.

---

## Why the tests are not on GitHub

The workflows in this repository build release artifacts. Nothing in them gates
a normal commit, and **no workflow has a branch trigger at all**. That is
deliberate.

CI runs *after* a push. By the time it goes red, the mistake is already in the
history, already fetched by anyone who pulled, and the fix is a second commit
that exists only to undo the first. A hook runs *before* the commit exists, so
the mistake never happens. The feedback is also immediate — no queue, no
runner boot, no waiting for a log to stream.

There is a second reason, and it is arithmetic rather than principle. Build
minutes and Cloudflare builds are both metered monthly, and a branch-triggered
workflow spends them at the rate you push — which, on a branch, is the rate you
think, not the rate you finish. Every automatic trigger was therefore paying for
an answer the hooks had already given locally, before the push, for free.

**The honest cost:** the gate is only as good as the machine it runs on. A hook
can be skipped with `--no-verify`, it only sees the machine's own Node version,
and it cannot prove the code works on anything else. That is a real trade, taken
knowingly for a project of this size. If this ever grows a second regular
contributor, or starts supporting a runtime nobody develops on, put the suite
back on GitHub as a required check for pull requests — the hooks stay useful
either way, as the fast first pass.

---

## Day to day

```bash
git switch -c fix/clipboard-race     # main will refuse the commit
# … work …
git commit -m "fix(clipboard): stop the poller racing a restored clip"
git push                             # pre-push runs the relay-backed suites too
# … open a PR, merge it …
```

**Commit messages** need a type, because the changelog is generated from them:

```
feat      a user can now do something they could not before
fix       something that was wrong is no longer wrong
perf      same behaviour, less time or fewer bytes
refactor  same behaviour, different shape
docs      documentation only
test      tests only
build     dependencies, the service worker shell, deploy plumbing
ci        the hooks and the workflow themselves
chore     none of the above, and not worth a release note
style     whitespace and formatting only
```

Add `!` for a breaking change — `feat!: change the share link format` — or a
`BREAKING CHANGE:` footer. Either one hoists the entry to the top of the release
notes and marks the release in the app.

`feat`, `fix`, `perf`, `refactor`, `docs` and `build` appear in the changelog.
`chore`, `style`, `ci` and `test` do not: they are real work, they are in the
git history, and a release note is read by someone deciding whether an update
matters to them.

---

## Cutting a release

```bash
git switch main && git pull
npm run release -- minor        # or patch, major, or v1.4.2 exactly
```

That single command:

1. refuses if you are not on `main`, the tree is dirty, or `main` is behind the remote
2. runs `npm run verify`
3. writes `CHANGELOG.md` and `changelog.json` from the commits since the last tag
4. commits them with the version bump, as `chore(release): v1.2.0`
5. creates an **annotated** tag whose message is that release's changelog section, so `git show v1.2.0` tells you what shipped
6. pushes `main` and the tag

Pushing the tag triggers `release.yml` — the CLI on npm, the desktop builds, the
relay image. **It does not deploy the site**; step 6's push to `main` already
did, a minute earlier, via Cloudflare Pages. So by the time the tag artifacts
finish building, the web app has been live for a while. That ordering is fine —
the site is versionless and the artifacts are not — but it does mean a release
is not a single atomic moment.

The download page is built for that gap rather than damaged by it. It asks the
releases API for the current assets at load time instead of being told them at
build time, and `release.yml` keeps the GitHub release a **draft** until all
three desktop builds have passed. `/releases/latest` skips drafts, so during
those twenty-odd minutes the page simply keeps offering the generic releases
link it shipped with. Nothing points at a file that does not exist, and nothing
has to be re-deployed when the binaries land.

### What the jobs do, and what stops

```
verify ──┬── desktop  (windows / macos / ubuntu-22.04)  ─┬── publish-release ── manifests
         ├── npm                                        ─┘
         └── relay-image
```

`publish-release` is the job that makes the release public, and it needs **all
three** desktop legs. A partial build therefore leaves a draft nobody can
download, which is the intended failure mode: better no installers than a
release page advertising a `.dmg` that failed to compile.

If it stops there, the artifacts are still on the draft and nothing is lost.
Re-running is `gh run rerun <id> --failed`, which restarts from the tag the run
started on — **not** a manual dispatch, because there is no longer one to reach
for. A dispatch off `main` would have handed every downstream job the version
string `"main"`; the trigger is gone rather than guarded, and the re-run path is
the one that was always correct anyway.

If the fix needs a code change rather than a re-run, it needs a new tag: land
the fix on `main`, then `git tag -a v0.3.1` and push that. `release.yml` refuses
a tag `main` does not contain, so tagging the fix on its branch will not work.

Use `--dry` first if you want to see the commit list and the version it would
pick without changing anything.

### Step 6 does not work, and you will hit it

The ruleset on `main` (Settings → Rules) requires every change to arrive through
a pull request, with no bypass actors. `npm run release` makes the version-bump
commit **on `main`** and pushes it, so it dies at the last step:

```
Error: Command failed: git push origin main
```

Everything before that has already happened and is correct — the changelog is
written, the versions are bumped, the tag exists locally. Only the push was
refused. Recover by moving the commit onto a branch and landing it the normal
way:

```bash
git tag -d v0.3.0                    # the local tag points at a commit main will never have
git branch release/v0.3.0            # keep the release commit
git reset --hard origin/main         # put main back
git switch release/v0.3.0 && git push -u origin release/v0.3.0
gh pr create --title "chore(release): v0.3.0" --fill
gh pr merge --squash

git switch main && git pull
git tag -a v0.3.0 -m "…"             # the changelog section, as release.mjs writes it
git push origin v0.3.0               # THIS is what starts release.yml
```

Tags are not covered by the ruleset, which is why the last line works.

**`git tag -d` on the first line is not optional, and the reason changed.** It
used to be tidiness — a local tag pointing at a commit `main` will never have.
Now it is the gate: `release.yml` refuses any tag whose commit `main` does not
already contain, so pushing that first tag would fail the release rather than
mis-release it. The two lines after the merge re-cut the tag on the squashed
commit, which is the one main actually has. Do the steps in the order written.

**Two ways to stop paying this every release**, and it is worth picking one:

1. Add a bypass actor for **Repository admin** on the ruleset. `npm run release`
   then works exactly as written above. The protection still applies to
   everyone else.
2. Change `tools/release/release.mjs` to push a `release/vX.Y.Z` branch and open
   the pull request itself, then tag after the merge. More faithful to the
   policy, and nobody has to remember the recovery above.

### First release — the one-time manual steps

None of these can be automated, all of them are invisible until they bite, and
each one silently breaks something the download page promises. They are done
once, ever.

**1. `NPM_TOKEN`.** The `npm` job skips itself when this is missing, so the
release still produces installers — it just never publishes the CLI, and every
`npx realtimeclipboard` example on the site keeps failing.

npm → **Access Tokens** → **Granular Access Token**, and the settings that
matter:

| | |
|---|---|
| **Bypass two-factor authentication (2FA)** | **ticked** |
| Packages and scopes | **Read and write**, **All packages** |
| Expiration | as far out as it allows |

```bash
gh secret set NPM_TOKEN
```

Each of those is a way to fail:

- **Without the 2FA bypass**, publishing dies with `E403 — Two-factor
  authentication or granular access token with bypass 2fa enabled is required`.
  CI cannot answer a 2FA prompt, so this is not optional. It is also the setting
  npm is phasing out (account changes Aug 2026, direct publishing Jan 2027);
  when it goes, move to npm's **Trusted Publishing** over OIDC instead — the
  `npm` job already has the `id-token: write` permission that needs.
- **Scoped to selected packages** does not work for a *first* publish: the
  package does not exist yet, so it cannot be selected, and the token ends up
  with write access to nothing.
- **Expiry** is the quiet one. The default 30 days means a release two months
  from now fails with an auth error nobody connects to a token set today.

**2. Make the relay image public.** A package pushed by `GITHUB_TOKEN` is
created **private**, and linking it to the repository does not grant public
read. Until this is done, the `docker run ghcr.io/…` line on `/download/` and in
`docs/SELF-HOSTING.md` fails with an authentication error for everybody, for
ever — and nothing anywhere reports that it is happening.

Only possible after the first `release.yml` run has created the package:

1. GitHub → your profile → **Packages** → `realtimeclipboard-relay`
2. **Package settings → Manage Actions access** → add the repository with
   **Write**, or the next tag's push gets a 403 now that the package exists
3. **Danger Zone → Change visibility → Public**

**3. The Homebrew tap.** `manifest.mjs` generates the cask and the CLI formula,
but they land in `dist/manifests/` on the runner and are uploaded as an
artifact. They have to be committed to `akshaynikhare/homebrew-tap`, which has
to exist first. Until it does, the `brew install --cask` line stays tagged *not
published yet* on the page.

**4. The winget manifest.** Generated the same way and submitted to
`microsoft/winget-pkgs`, where people who do not work on this project review it.
Expect days, not minutes — which is why the page tags it rather than claiming it
works.

**Nothing on the site claims any of these before they are true.** If you turn
one on, remove its *not published yet* tag on `/download/` **and** in the
matching `src/pages/help/install/` guide in the same commit; they duplicate each
other, and a half-update leaves the site contradicting itself.

### The one place `--no-verify` is used on purpose

The release commit is made on `main`, which the pre-commit hook exists to
prevent. `tools/release/release.mjs` passes `--no-verify` for that one commit, having
already run the checks itself a moment earlier. It is the only automated bypass
in the repository.

---

## The changelog

`tools/release/changelog.mjs` reads the git history and writes two files from one pass:

- **`CHANGELOG.md`** — every release, in full, for the repository
- **`changelog.json`** — the last few releases, capped, shipped with the app

Both are generated. Editing them by hand works until the next release
overwrites it; to change an entry, reword the commit.

Commits that predate the hook, or were made with `--no-verify`, are not dropped
— they land in a general "Other changes" section. A changelog that silently
omits work is worse than one with an untidy heading.

```bash
npm run changelog           # regenerate both
npm run changelog -- --check  # exit 1 if they are stale
```

### In the app

`src/ui/features/whatsNew.js` fetches `changelog.json` and shows a dismissible banner
when the running version differs from the last one this browser saw. Two rules:

- **It never interrupts.** Arrival is a banner; the dialog only opens if asked.
  A modal stealing focus while someone is pasting a password would be a worse
  bug than anything it announces.
- **It never shows on a first visit.** A new user has nothing to be caught up
  on. The version is recorded silently and the banner starts from the release
  after that.

A missing or malformed `changelog.json` produces silence, not an error.

### One version, one identity

`tools/build/build.mjs` stamps `sw.js`'s `VERSION` as **`<package.json version>+<short
commit sha>`** — `0.3.1+9f2c4ab10e77`. The leading half is the same string that
heads `CHANGELOG.md` and appears in "What's new", so a cache name still reads as
a release rather than as an opaque hash.

The commit half is not decoration. `VERSION` is the cache key, and a changed
`sw.js` is the *only* thing that tells a browser an update exists — so it has to
change on every deploy, and deploys are now per-commit rather than per-tag. A
docs fix that ships without touching `package.json` must still invalidate the
shell; keyed on the version alone it would not, and those users would sit on the
old bundle until the next release happened to bump a number.

**This is the part that had to change when the site moved to Cloudflare Pages.**
The stamp read `GITHUB_REF_NAME` before, and none of the `GITHUB_*` variables
exist in a Cloudflare build. The fallback was the literal string `"dev"` — a
perfectly stable cache name, which would have meant a byte-identical `sw.js` on
every deploy, no update ever detected, and every returning visitor pinned to the
first shell ever published. Nothing would have looked wrong from the outside.

---

## Supply chain: what a user can actually verify

Zero runtime dependencies does most of the work here — there is no transitive
package that can be taken over, and `npx realtimeclipboard` installs `src/core`
and `src/transport` unbundled, so what runs is what is in the repository. Three
things back that up, and one gap remains open on purpose.

**Actions are pinned to commit SHAs.** Every `uses:` in `.github/workflows/`
names a 40-character SHA with the tag beside it as a comment. A tag is a movable
pointer in somebody else's repository: `@v4` today and `@v4` next month can be
different code, and a compromised popular action runs inside a job that holds
`GITHUB_TOKEN` and `NPM_TOKEN`. Pinning is what makes "the workflow did not
change" a true statement.

To bump one deliberately:

```bash
gh api repos/actions/checkout/commits/v5 --jq .sha     # then paste it in, keeping the # v5 comment
```

**`SHA256SUMS` is attached before the release goes public.** The `publish-release`
job downloads every asset, hashes it and uploads the file, then flips the draft.
There is no window in which an installer is downloadable and unverifiable.

**npm publishes with `--provenance`**, which mints a signed attestation through
OIDC tying the tarball to this repository and this workflow run.

### The gap: the desktop installers are unsigned

`desktop/src-tauri/tauri.conf.json` has `certificateThumbprint: null` and
`signingIdentity: null`. Two consequences, and neither is fixed by the checksum
file:

- Windows SmartScreen and macOS Gatekeeper warn on first run. Users are trained
  through that warning, which is the worst possible outcome — it teaches the
  gesture that a real attack needs.
- Nothing in the binary says who built it. `SHA256SUMS` is served from the same
  release as the assets, so anyone able to replace one could replace both. What
  it gives is a fixed value that can be quoted elsewhere — release notes, a Scoop
  manifest, a mirror's records — so a substitution *after the fact* is detectable
  by anyone who wrote the number down. That is weaker than a signature and worth
  having anyway.

Closing this needs a purchased certificate (an EV certificate for Windows, an
Apple Developer ID plus notarisation for macOS) and the secrets already wired up
in `release.yml` — `APPLE_CERTIFICATE` and friends are read, and are simply
absent. It is a spending decision, not an engineering one.

---

## Hooks

| Hook | Runs |
|---|---|
| `pre-commit` | branch guard, then `npm run verify` — static checks, crypto, dialogs, files. Offline and fast; a hook that needs a network fails on a train |
| `commit-msg` | Conventional Commits, and a 72-character subject cap |
| `pre-push` | `verify` again, then the relay-backed suites — **skipped** if no relay answers, so being offline never forces a habit of `--no-verify` |

Set up automatically by `npm install` (husky's `prepare` script). If hooks stop
firing, run `npm install` again, or `npx husky` directly.

Start a relay for the full suite with `npm run relay`; `npm run relay:up` is the
one-second reachability check the pre-push hook uses.

---

## If the deploy fails

Read the Cloudflare build log. A failure is almost always `tools/check/site-check.mjs`
catching something real — a file that moved, a missing `noindex` on `app.html`,
an SVG that crept back into the manifest's `icons[]`, a canonical URL still
naming the old origin. Each check prints what it was protecting.

Reproduce it exactly, locally, without pushing anything:

```bash
npm run build:site
```

That is the same command Cloudflare runs. If it passes locally and fails there,
the difference is the environment — check `NODE_VERSION` is 22 and that
`package-lock.json` is committed.

**Production is unaffected by a failed build.** Cloudflare only promotes a
successful one, so the previous deploy keeps serving. To redeploy an unchanged
commit, use *Retry deployment* in the Pages dashboard; to roll back, promote an
earlier deployment from the same list.

Note that a rollback does **not** roll back the service worker for anyone who
already loaded the bad build — their browser holds a shell keyed to that
version. It will pick up the rollback on its next update check, because the
restored `sw.js` carries a different `VERSION` string than the one they have.
