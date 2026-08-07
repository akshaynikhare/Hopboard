# docs/

These record **decisions and their reasons** — what was settled, what was ruled out, and what will
go wrong if it is undone. They are the reason anyone can safely change this code later.

## Rules

- **A superseded decision is amended, not deleted.** `ARCHITECTURE.md` §1 chose no bundler, named
  the conditions to revisit, and then records what it cost when both fired. Keep that shape: the
  original text stands, and what changed is written underneath. Deleting it loses the only evidence
  of *why* the conditions were the right ones.
- **Paths named here are checked.** `tests/unit/static-check.mjs` fails if a `tests/…` or `tools/…`
  path in any doc no longer resolves. A stale command in a README is executed by nothing, so it
  fails silently and only on whoever trusts it. To name something deliberately historical, strike
  it through in backticks.
- **`PRD.md` is the argument, not the summary.** Anything that widens what the relay learns, or
  what leaves the browser unencrypted, belongs there before it is written in code.
- `OI-*` numbers are referenced from comments across `src/`. Renumbering them orphans those
  references.
- Scope: repo-wide rationale. Rules about editing one directory belong in that directory's
  `CLAUDE.md`, next to the code they govern.
