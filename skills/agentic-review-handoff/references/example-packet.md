# Example Packet (canonical reference)

This is a complete worked example of a packet that has gone through one full review-fix-re-review loop with one BLOCKED → fix round 2 cycle. Use it as a ground-truth reference for:

- What every H1 section actually looks like populated with real content (not just templates)
- How the Original Findings Snapshot is **strictly verbatim** copied from Fix Handoff (the first 8 columns)
- How an optional 9th `Notes` column is added by a fixer without touching the original 8
- How frontmatter `last_anchor` / `lifecycle_state` / `round` evolve across stages

This file is purely documentation. It is **not** loaded into runtime context for AI execution — refer to it manually when you need a concrete example, or have a reviewer diff your real packet against it.

---

```md
---
packet_id: feat-cart-patch/2026-05-14_08-00-cart-quantity
branch: feat/cart-patch
scope: cart-quantity
created: 2026-05-14T08:00:00Z
updated: 2026-05-15T06:18:01Z
last_anchor: re_review
lifecycle_state: archived
round: 2
---

# Review Intake

## Scope reviewed
- staged diff for apps/api/cart-handler.ts and apps/api/__tests__/cart-handler.test.ts
- branch feat/cart-patch
- repository: /home/user/example-repo

## Verification
- read apps/api/cart-handler.ts (lines 1-30) this session
- read apps/api/__tests__/cart-handler.test.ts (lines 1-25) this session
- ran `tsc --noEmit` (passed)

## Inferred Goal
- Add PATCH /api/cart endpoint to update item quantity. (inferred from diff)
- Validate input shapes (itemId required, quantity non-negative integer). (inferred from diff)


# Review Findings

## Scope reviewed
staged diff for apps/api/cart-handler.ts and tests, branch feat/cart-patch.

## Verification
- ran tsc --noEmit (passed)
- read source + tests this session

## Findings

- [P1] quantity=0 should delete the cart item, not store quantity=0
  File: apps/api/cart-handler.ts:18
  Evidence: handler updates the row with quantity=0 instead of deleting; tests don't cover this case
  Source: verified from code
  Impact: cart shows ghost items with quantity=0
  Suggested fix: branch on quantity===0 and call db.cartItem.delete

- [P3] Variable name `item` shadows
  File: apps/api/cart-handler.ts:14
  Evidence: import order shows naming collision
  Source: verified from code
  Impact: maintainability nit
  Suggested fix: rename to `cartItem`

- [P3] Comment-only test assertion
  File: apps/api/__tests__/cart-handler.test.ts:18
  Evidence: third test body is only a comment, no expect() call
  Source: verified from code
  Impact: test does nothing
  Suggested fix: implement the assertion

## Verdict
BLOCKED


# Fix Handoff

## Scope
- Repository: /home/user/example-repo
- Branch: feat/cart-patch
- Files affected: apps/api/cart-handler.ts, apps/api/__tests__/cart-handler.test.ts
- Non-goals: do not change PATCH route shape or response envelope

## Validated Findings To Fix

| ID | Severity | Verdict | Original finding | Evidence | Target files/lines | Required fix | Acceptance check |
|---|---|---|---|---|---|---|---|
| F1 | P1 | valid | quantity=0 should delete the cart item, not store quantity=0 | apps/api/cart-handler.ts:18 | apps/api/cart-handler.ts:18-22 | branch on quantity===0 and call db.cartItem.delete; otherwise keep update path | new test "quantity=0 deletes the item" passes |
| F2 | P3 | valid | Variable name `item` shadows | apps/api/cart-handler.ts:14 | apps/api/cart-handler.ts:14-22 | rename `item` → `cartItem` | tsc --noEmit still passes |
| F3 | P3 | valid | Comment-only test assertion | apps/api/__tests__/cart-handler.test.ts:18 | apps/api/__tests__/cart-handler.test.ts:14-20 | implement the missing expect() | test runs and asserts |

## Feedback Not To Fix

| Claim | Why rejected / downgraded | Evidence |
|---|---|---|

(no rejected feedback in this example)

## Constraints

- Fix only validated findings. Do not broaden scope.

## Verification Required

- Commands: vitest run apps/api
- Runtime checks: new "quantity=0 deletes the item" test passes
- Docs/tests to update: add the new test


# Fix Completion

## Fix Conclusion
- Overall status: 1/3 fixed (F1 fixed; F2, F3 deferred this round)
- Scope changed: apps/api/cart-handler.ts
- Verification: vitest run (new quantity=0 test passes)
- Re-review focus: F1; F2/F3 still open

## Fix Scope
- Repository: /home/user/example-repo
- Branch: feat/cart-patch
- Files changed: apps/api/cart-handler.ts
- Findings addressed: F1

## Original Findings Snapshot

(8 columns verbatim from Fix Handoff above. No 9th Notes column needed in round 1.)

| ID | Severity | Verdict | Original finding | Evidence | Target files/lines | Required fix | Acceptance check |
|---|---|---|---|---|---|---|---|
| F1 | P1 | valid | quantity=0 should delete the cart item, not store quantity=0 | apps/api/cart-handler.ts:18 | apps/api/cart-handler.ts:18-22 | branch on quantity===0 and call db.cartItem.delete; otherwise keep update path | new test "quantity=0 deletes the item" passes |
| F2 | P3 | valid | Variable name `item` shadows | apps/api/cart-handler.ts:14 | apps/api/cart-handler.ts:14-22 | rename `item` → `cartItem` | tsc --noEmit still passes |
| F3 | P3 | valid | Comment-only test assertion | apps/api/__tests__/cart-handler.test.ts:18 | apps/api/__tests__/cart-handler.test.ts:14-20 | implement the missing expect() | test runs and asserts |

## Finding Status

| Finding ID | Claimed status | Files changed | Verification |
|---|---|---|---|
| F1 | resolved | apps/api/cart-handler.ts | vitest pass |
| F2 | not changed | — | deferred this round |
| F3 | not changed | — | deferred this round |

## Changes Made

- apps/api/cart-handler.ts:18-22 added delete branch on quantity===0

## Verification

- Command: vitest run apps/api
- Result: pass
- Blocked checks: none

## Deferred Out-of-Scope

(none — F2/F3 are deferred-this-round, not out-of-scope)

## Re-review Instructions

- Reassess F1 against the snapshot row, not Claimed status
- F2/F3 remain open for round 2


# Re-review

## Scope
Scoped re-review of round 1 fix for F1.

## Verification
- read apps/api/cart-handler.ts this session
- ran vitest

## Prior Findings Reassessment

| Finding ID | Original finding (verbatim from snapshot) | Verdict | Evidence | Notes |
|---|---|---|---|---|
| F1 | quantity=0 should delete the cart item, not store quantity=0 | resolved | apps/api/cart-handler.ts:18-22 added delete branch | tested |
| F2 | Variable name `item` shadows | not resolved | unchanged | deferred |
| F3 | Comment-only test assertion | not resolved | unchanged | deferred |

## New Findings Introduced By Fix

(none)

## Regression Surface

- Checked: PATCH happy-path test, new delete-path test
- Not checked: integration with checkout flow

## Verdict
PASS_WITH_CONCERNS


# Fix Completion (round 2)

## Fix Conclusion
- Overall status: 2/2 remaining concerns fixed (F2, F3)
- Scope changed: apps/api/cart-handler.ts, apps/api/__tests__/cart-handler.test.ts
- Not changed: F1 was already resolved in round 1
- Verification: vitest run (all tests pass, no shadows)
- Re-review focus: F2 rename callers, F3 test now asserts

## Fix Scope
- Repository: /home/user/example-repo
- Branch: feat/cart-patch
- Files changed: apps/api/cart-handler.ts, apps/api/__tests__/cart-handler.test.ts
- Findings addressed: F2, F3

## Original Findings Snapshot

(8 columns strictly verbatim from the round-1 Fix Handoff. An optional 9th Notes column was appended by the fixer to record round-1 vs round-2 status — the original 8 columns diff to zero against the Fix Handoff above.)

| ID | Severity | Verdict | Original finding | Evidence | Target files/lines | Required fix | Acceptance check | Notes |
|---|---|---|---|---|---|---|---|---|
| F2 | P3 | valid | Variable name `item` shadows | apps/api/cart-handler.ts:14 | apps/api/cart-handler.ts:14-22 | rename `item` → `cartItem` | tsc --noEmit still passes | round 2 focus |
| F3 | P3 | valid | Comment-only test assertion | apps/api/__tests__/cart-handler.test.ts:18 | apps/api/__tests__/cart-handler.test.ts:14-20 | implement the missing expect() | test runs and asserts | round 2 focus |

## Finding Status

| Finding ID | Claimed status | Files changed | Verification |
|---|---|---|---|
| F2 | resolved | apps/api/cart-handler.ts | tsc passes, no shadow warning |
| F3 | resolved | apps/api/__tests__/cart-handler.test.ts | test now calls expect() |

## Changes Made

- apps/api/cart-handler.ts: renamed `item` → `cartItem` (3 callsites)
- apps/api/__tests__/cart-handler.test.ts: implemented missing happy-path assertion

## Verification

- Command: vitest run apps/api
- Result: pass
- Blocked checks: none

## Deferred Out-of-Scope
(none)


# Re-review (round 2)

## Scope
Scoped re-review of round 2 fix for F2, F3.

## Verification
- read apps/api/cart-handler.ts (renamed locals)
- read apps/api/__tests__/cart-handler.test.ts (new expect)
- ran vitest

## Prior Findings Reassessment

| Finding ID | Original finding (verbatim from snapshot) | Verdict | Evidence | Notes |
|---|---|---|---|---|
| F2 | Variable name `item` shadows | resolved | apps/api/cart-handler.ts:14-22 uses `cartItem` | clean rename |
| F3 | Comment-only test assertion | resolved | apps/api/__tests__/cart-handler.test.ts:14-20 has expect() | asserts shape and call |

## New Findings Introduced By Fix

(none)

## Regression Surface

- Checked: full test file
- Not checked: integration

## Verdict
PASS
```

After writing the `PASS` verdict in the round-2 Re-review, the reviewer would `mv` this file from `active/` to `archive/` and set frontmatter `lifecycle_state: archived`.

---

**What this example demonstrates**:

1. **`# Review Intake`** (reviewer-initiated path) records only what the reviewer can verify directly; no fabricated implementer summary.
2. **`# Review Findings` + Verdict = BLOCKED** → continues to `# Fix Handoff` (this is **not** the first-pass terminal path; that one would skip Fix Handoff and archive immediately).
3. **`Validated Findings To Fix` table = 8 columns** (`ID | Severity | Verdict | Original finding | Evidence | Target files/lines | Required fix | Acceptance check`).
4. **Round-1 `Original Findings Snapshot` = same 8 columns, character-for-character match** against the Fix Handoff rows. Diff is zero.
5. **Round-2 `Original Findings Snapshot` adds an optional 9th `Notes` column** to track round-1→round-2 status. The original 8 columns are still byte-equivalent to the Fix Handoff. This is the **only** allowed way to add fixer context — never modify the first 8 columns.
6. **Multi-round suffix** `(round N)` lets all rounds coexist in one file; `round` field in frontmatter is incremented.
7. **PASS in round-2 Re-review** triggers archive — file moves to `archive/`, `lifecycle_state` becomes `archived`.
