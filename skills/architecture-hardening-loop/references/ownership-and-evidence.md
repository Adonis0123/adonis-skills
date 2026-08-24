# Goal ownership and evidence freshness

Load this file only when you are about to create or continue a Goal, close a Goal, or reuse a review verdict. Classification, contract writing, and report-only scanning do not need it.

## Ownership evidence

Read from native Goal tools, product Goal status, or a caller-supplied parent contract that can be checked (objective, frozen scope, Done condition, completion owner). A native getter is not the only evidence source. Record one of `none` / `exact-same-goal` / `broader-compatible` / `conflicting/unclear`. If evidence is insufficient, classify `conflicting/unclear`.

This preflight read is ownership-only: do not create, replace, or terminally update a Goal. `conflicting/unclear` obeys `goal-gate` `Decision: defer` and returns `HUMAN_GATE` before the first scan.

Compatibility must be proven by objective, frozen scope, and Done condition. “A Goal already exists” is neither proof of compatibility nor a reason to pause a compatible parent.

## Goal 关系

`goal-gate` has two phases here: a read-only relation check before scan, then Goal creation only after at least one `Fix` is confirmed and the relation is `none`. `exact-same-goal` / `broader-compatible` continue the existing Goal. Never create a nested Goal.

| Goal 关系             | 行为                                                                                                                                             | 完成所有权                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `none`                | 安全闸门通过后创建覆盖本次范围、验证与 `NO_ACTIONABLE_FINDINGS` 的 Goal                                                                          | `created-by-loop`                   |
| `exact-same-goal`     | 用户明确继续同一 architecture-hardening 目标；`Next: continue active goal`，不创建或替换                                                         | 本 Loop 可在全部条件满足后完成      |
| `broader-compatible`  | 本 Loop 是 active parent Goal 冻结范围与 Done condition 中的一个 checkpoint；`Next: continue active goal`，不创建、不替换、不收窄 Done condition | 父编排器；本 Loop 只上报 checkpoint |
| `conflicting/unclear` | 服从 `goal-gate` 的 `Decision: defer`，返回 `HUMAN_GATE`，只问如何处理冲突或归属                                                                 | none                                |

## Codex / Grok 完成合同

Do not borrow one runtime's field names for the other.

**Codex (`get_goal` / `create_goal` / status-only `update_goal`):**

- Continue an exact-same Goal without calling terminal `update_goal` until Done condition is proven.
- Do not invent Grok `message` / `completed` / `blocked_reason`.
- When this Loop owns the full objective and `NO_ACTIONABLE_FINDINGS` + required verification + final review (if any Fix) are proven: `update_goal` with `status: complete`.
- Do not complete a `broader-compatible` parent.

**Grok (user-run `/goal`, then Grok-style `update_goal`):**

- Do not invent `create_goal` / `get_goal`, and do not ask the user to paste a second `/goal`.
- While a Fix remains: only a `message` checkpoint. Never `completed: true`.
- Do not use Codex `status: complete` / `status: blocked`.
- When this Loop owns the full objective and Done condition is proven: `update_goal` with `completed: true` (optional `message`).

Zero-Fix after a matching evidence identity does **not** create a new Goal. Close using the relation recorded at preflight:

- `none` → `Goal: not-created`
- `exact-same-goal` → after terminal consult, required verification, and the full Done condition, use that runtime's terminal schema
- `broader-compatible` → `Goal: active-checkpoint`; keep the parent Goal active
- `conflicting/unclear` already stopped at `HUMAN_GATE` and must not reach this branch

Only this Loop may mark a Goal completed, and only when it owns completion, `Result: NO_ACTIONABLE_FINDINGS`, required verification passed, and no open `Fix` remains. After a Fix, the final review must cover the same Evidence id in the report and be `PASS` / `NO_FINDINGS`, or a user Decision Closure that archived `PASS_WITH_CONCERNS`. No `awaiting_user_decision` packet may remain. A `broader-compatible` parent is always `active-checkpoint`; the parent orchestrator closes remaining Done conditions. The zero-Fix branch does not invent a review.

## `scanEvidence` identity

Every scanner pass owns its own `scanEvidence`. Evidence id is required on both the zero-Fix and Fix branches.

1. **E1 (first scan):** before the first scanner pass, run `review-loop evidence` on current `HEAD` + the frozen path filter. Record `{ baseSha, pathFilter, digest, coveredPaths, sourceRound }`.
2. **E2 (post-Fix rescan):** after a Fix, take `evidence` returned by `review-loop run` / `close`. Recompute current identity on the same `baseSha` + `pathFilter`. Only if it matches, select that identity as this pass's `scanEvidence` (E2).
3. **Terminal consult freshness:** after the terminal Grok consult, re-run `review-loop evidence` on this pass's `baseSha` / `pathFilter`. Enter `NO_ACTIONABLE_FINDINGS` only when digest equals the identity chosen **before this scanner pass**.
4. **E3 (drift):** if that recomputation differs (E3), scanner/consult evidence is stale. Rescan the same scope; if a rescan is impossible, report `UNVERIFIED`. Do not complete a Goal.

A post-Fix rescan compares only against the E2 selected before that rescan. Never fall back to first-scan E1.

Protocol artifacts (`.review-handoff/**`, `$GIT_COMMON_DIR/info/exclude`) are recorded separately and are not part of scanner scope.

## Digest equality and review reuse

Equality compares only `baseSha + pathFilter + digest`. `coveredPaths` is audit-only and never substitutes for digest. `Decision Closure` reuses `sourceRound`; it does not re-prove the current worktree.

Same `HEAD` and same path set are not enough: a content change that keeps SHA and paths but alters digest invalidates the old verdict.

If any required field is missing, current identity cannot be recomputed, or digest mismatches, the old review is not reusable. Re-run review, or report `UNVERIFIED`. Do not claim `NO_ACTIONABLE_FINDINGS` or complete a Goal on stale evidence.

After evidence matches, stop immediately. Do not run “one more scan for confidence.”
