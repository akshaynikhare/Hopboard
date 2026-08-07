# Contributing

Thanks for looking. This is a small project with a strong opinion about what it
is, so the most useful thing you can do before writing code is check that the
change is one the project wants — [docs/PRD.md](docs/PRD.md) records what has
already been settled and deliberately ruled out (no accounts, no extension, no
server-side storage). An issue first saves you building something that gets
turned down for reasons that were never written where you could see them.

Bug reports and documentation fixes need no such preamble. Open them.

## Setting up

```bash
npm install          # installs the git hooks; there are no runtime dependencies
npm run serve        # http://127.0.0.1:8080
npm run relay        # the Python relay on :8000, in a second terminal
```

The frontend is native ES modules and needs no build step to develop against —
`npm run build` exists only to assemble the deploy.
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the layout, the test suite,
and the traps that have caught people before.

## The loop

```bash
git switch -c fix/whatever    # main refuses direct commits
npm run verify                # what the pre-commit hook runs
npm test                      # everything, needs a relay running
```

**The tests run locally, in a git hook, before the commit exists.** There is no
CI to catch what you miss — the only GitHub workflow publishes Pages on a
version tag. If you bypass the hooks with `--no-verify`, nothing else is
checking. The reasoning behind that trade is in
[docs/RELEASING.md](docs/RELEASING.md).

`npm test` needs a relay. Point the suites at one with `RELAY_BASE`, or start a
local one with `npm run relay`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org), enforced by the
`commit-msg` hook, because `tools/release/changelog.mjs` generates the changelog from
them:

```
<type>(<optional scope>)<optional !>: <subject>

feat(files): resume an interrupted transfer
fix!: stop the poller overwriting a restored clip
```

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
`chore`, `style`, `revert`. The `!` — or a `BREAKING CHANGE:` footer — is what
marks a release breaking. Keep the subject under 72 characters; that is where
GitHub truncates it in a list, and a changelog is read as a list.

## What the code review will ask

The repository has boundaries that the static checks enforce, and they will fail
the commit rather than the review:

- `navigator.clipboard` is confined to `src/clipboard/`.
- `innerHTML` is written only in `src/ui/primitives/dom.js`. Everything else uses `esc()`
  and `setHTML()`.
- No UI, files, or clipboard module imports a transport channel directly.
- No module resolves a path from `import.meta.url` — see `src/core/paths.js`
  for why that breaks the moment the deploy bundles modules.
- Colours come from tokens, not stray hex.
- Every page carries a CSP, and no page has an executable inline `<script>`.

Beyond that: comments here explain **why**, not what. The existing ones are long
on purpose — they record the decision and the thing that will go wrong if it is
undone. A patch that deletes one of those without replacing the reasoning will
get a question back.

## Things that need care

- **Never commit a real share key or PIN**, in code, tests, fixtures, or an
  issue. Tests use throwaway keys like `D75LV`.
- **The key derivation is a wire format.** Changing the salts, the iteration
  counts, or the domain-separation strings in `src/core/config.js` strands every
  link in existence. `tests/unit/lock.mjs` holds golden vectors that will fail if you
  do; that failure is the feature. If a change there is genuinely intended, say
  so explicitly in the commit body.
- **Storage keys are compatibility too.** `STORAGE_PREFIX` changes orphan
  everyone's saved history and settings.

## Reporting a security problem

Not here — see [SECURITY.md](SECURITY.md). A working attack on someone's session
should not be a public issue.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

Contributions are accepted under the [MIT licence](LICENSE), the same terms the
project ships under.
