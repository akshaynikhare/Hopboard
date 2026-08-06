# Releasing

How code gets from a branch to users, and why it works this way.

---

## The shape of it

```
  branch ──commit──►  hooks run the tests here, before the commit exists
     │
     └──merge──►  main        merged is not released; main can sit
                    │
                    └── npm run release -- minor
                            verifies, writes the changelog, tags, pushes
                                    │
                                    └── tag v1.2.0 ──► GitHub Pages deploys
```

Three rules follow from that diagram, and each is enforced rather than trusted:

| Rule | Enforced by |
|---|---|
| No commits directly on `main` | `.husky/pre-commit` |
| Tests pass before a commit exists | `.husky/pre-commit` → `npm run verify` |
| A commit says what kind of change it is | `.husky/commit-msg` |
| Only a tag deploys | `.github/workflows/pages.yml` |

---

## Why the tests are not on GitHub

There is one workflow in this repository and it does nothing but copy files to
Pages. That is deliberate.

CI runs *after* a push. By the time it goes red, the mistake is already in the
history, already fetched by anyone who pulled, and the fix is a second commit
that exists only to undo the first. A hook runs *before* the commit exists, so
the mistake never happens. The feedback is also immediate — no queue, no
runner boot, no waiting for a log to stream.

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

Pushing the tag is what triggers the deploy. Nothing else does.

Use `--dry` first if you want to see the commit list and the version it would
pick without changing anything.

### The one place `--no-verify` is used on purpose

The release commit is made on `main`, which the pre-commit hook exists to
prevent. `tools/release.mjs` passes `--no-verify` for that one commit, having
already run the checks itself a moment earlier. It is the only automated bypass
in the repository.

---

## The changelog

`tools/changelog.mjs` reads the git history and writes two files from one pass:

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

`src/ui/whatsNew.js` fetches `changelog.json` and shows a dismissible banner
when the running version differs from the last one this browser saw. Two rules:

- **It never interrupts.** Arrival is a banner; the dialog only opens if asked.
  A modal stealing focus while someone is pasting a password would be a worse
  bug than anything it announces.
- **It never shows on a first visit.** A new user has nothing to be caught up
  on. The version is recorded silently and the banner starts from the release
  after that.

A missing or malformed `changelog.json` produces silence, not an error.

### One version, one identity

The deploy stamps `sw.js`'s `VERSION` from the **tag**. So the string that keys
a user's offline cache, the heading in `CHANGELOG.md`, and the version shown in
"What's new" are all the same — one release has one name rather than three.

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

The workflow does no building, so a failure is almost always the sanity check
catching something real — a file that moved, a missing `noindex` on `app.html`,
an SVG that crept back into the manifest's `icons[]`. Read the step that failed;
each one says what it was protecting.

To redeploy an unchanged tag, use **workflow_dispatch** from the Actions tab and
pick the tag from the ref dropdown. That path stamps the service worker from the
commit SHA instead, since there is no tag in the context.
