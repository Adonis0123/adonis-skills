# Worker task spec

Copy this template into one file per worker. Every field is required; write `none` rather than deleting a field.

```markdown
# <task title>

## Target

Repository, worktree path, the lane's short branch and base (shared base, or the branch of the lane it depends on), and the files or component in scope.

## Change

The concrete result to produce, in observable terms.

## Constraints

Invariants, compatibility rules, repository instructions to read first (nearest AGENTS.md / CLAUDE.md), and environment entry points such as dev URLs.

## Ownership

- May edit: <exact files or globs>
- Must not edit: <files other workers own, shared packages, generated files>
- Pick one, delete the other: "No commit" (the default) or "Local commits on <short-branch> only, hooks must pass" (only when the user authorized commits for this Run; a worktree alone is not that authorization).
- No push, merge into other branches, deploy, publish, or messages to other sessions.

## Acceptance

The tests, commands, or page evidence that prove completion. Run only affected tests; no full suite unless listed here. Examples in the request are a floor, not the spec: also test boundaries the examples skip (empty, zero, negative, NaN, rounding of halves, binary floating point).

## Return

Write the full report to <run dir>/<lane>-report.md and a summary of at most 10 lines to <run dir>/<lane>-summary.md. Write the summary in the user's language (Chinese for a Chinese-speaking user), for a reader who does not code: one item per line. Its first sentence says in plain words what now works or what was found (e.g. "导出按钮改成了 Export video，中英文都已更新。"); the Board card shows only that sentence to a non-technical reader, so no `OUTCOME:`, ids or file paths there. Your final message is that summary plus both paths, nothing else.

The full report has:

1. `OUTCOME: succeeded` or `OUTCOME: failed` on its own line.
2. Touched-file list and `git diff --stat`.
3. Evidence: each command run and its result.
4. Open questions or decisions you made, one line each.
5. Confirmation that no test runner, type checker, or server you started is still running.
```

Keep the spec self-contained: the worker cannot see the coordinator's conversation. For a follow-up round, resume the writer's session and send only the delta (review findings, the coordinator's decisions, what to change) plus the original spec path.

Register both files with `lane set --summary-file <lane>-summary.md --result-file <lane>-report.md`. The Coordinator reads only the summary; the full report goes to the Board's report page, or to a subagent when a detail must be checked (see `context-budget.md`).
