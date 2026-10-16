# Worker task spec

Copy this template into one file per worker. Every field is required; write `none` rather than deleting a field.

```markdown
# <task title>

## Target

Repository, worktree path, base commit, and the files or component in scope.

## Change

The concrete result to produce, in observable terms.

## Constraints

Invariants, compatibility rules, repository instructions to read first (nearest AGENTS.md / CLAUDE.md), and environment entry points such as dev URLs.

## Ownership

- May edit: <exact files or globs>
- Must not edit: <files other workers own, shared packages, generated files>
- No commit, push, deploy, publish, or messages to other sessions.

## Acceptance

The tests, commands, or page evidence that prove completion. Run only affected tests; no full suite unless listed here. Examples in the request are a floor, not the spec: also test boundaries the examples skip (empty, zero, negative, NaN, rounding of halves, binary floating point).

## Return

1. `OUTCOME: succeeded` or `OUTCOME: failed` on its own line.
2. Touched-file list and `git diff --stat`.
3. Evidence: each command run and its result.
4. Open questions or decisions you made, one line each.
5. Confirmation that no test runner, type checker, or server you started is still running.
```

Keep the spec self-contained: the worker cannot see the coordinator's conversation. For a follow-up round, send only the delta (what failed, what to change) plus the original spec path.
