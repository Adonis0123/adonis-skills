# Packet Anatomy

Full template of a single review→fix→re-review packet. One packet file per loop, lives at:

```
$repo_root/.review-handoff/active/<branch_slug>/<local_minute>-<scope_slug>.md
```

After PASS / NO_FINDINGS, it is moved (by the reviewer) to:

```
$repo_root/.review-handoff/archive/<branch_slug>/<local_minute>-<scope_slug>.md
```

This file replaces the old `handoff-packet.md` and `review-loop-packets.md`. The packet is one linear narrative — read top to bottom and you see the entire loop.

## Frontmatter (required, atomic-rewrite on every append)

```yaml
---
packet_id: feat-payment/2026-05-15_14-30-refactor-checkout
branch: feat/payment
scope: refactor-checkout
created: 2026-05-15T14:30:12Z
updated: 2026-05-15T14:35:02Z
last_anchor: review_findings
lifecycle_state: in_progress
round: 1
---
```

Field semantics: see `packet-addressing.md`. The two key invariants:

- `last_anchor` strictly equals the file's last H1 anchor, normalized (strip `# `, strip ` (round N)`, snake_case).
- `lifecycle_state` must be derivable from `last_anchor` + Verdict (read from `# Review Findings` when the packet hasn't reached `# Re-review` yet — i.e. the first-pass terminal path; or from `# Re-review` / `# Re-review (round N)` once a fix round has run) + file location per the lifecycle derivation table in `packet-addressing.md`.

## Body — one H1 anchor per stage, append-only

Anchors must appear in this order (any may be skipped if the stage didn't happen yet, but order never reverses):

1. `# Review Handoff` (implementer-initiated path) **OR** `# Review Intake` (reviewer-initiated path) — exactly one of these as the first H1.
2. `# Review Findings`
3. `# Fix Handoff`
4. `# Fix Completion`
5. `# Re-review`
6. (Multi-round) `# Fix Completion (round 2)`, `# Re-review (round 2)`, `# Fix Completion (round 3)`, ... — append round suffixes; never edit prior round content.

---

## Section: `# Review Handoff` (implementer path only)

Written by the implementer (typically Codex) after finishing code, when they want a reviewer to look at it. **Reviewers must not write this section.** Without first-hand implementer context, you cannot honestly fill `Implementation Summary` / `Open Questions` without fabricating intent.

```md
# Review Handoff

## Goal
- User request:
- Intended behavior:
- Non-goals:

## Review Scope
- Scope type: staged diff / working tree diff / full branch diff / docs only / specific files
- Repository:
- Branch:
- Files changed:

## Implementation Summary
- What changed:
- Main code paths:
- Data or API contracts affected:
- Feature flags, experiments, or environment assumptions:

## Verification
- Commands run:
- Passing results:
- Failing results:
- Pre-existing failures:
- Checks not run and why:

## Reviewer Focus
- Highest-risk areas:
- Boundary cases to inspect:
- Security/privacy/payment/data concerns:
- Compatibility or migration concerns:

## Open Questions
- Confirmed assumptions:
- Unverified assumptions:
- Decisions still needing human judgment:
```

---

## Section: `# Review Intake` (reviewer path only)

Written by the reviewer when the user pointed them at a diff with no implementer handoff in hand. Records only what the reviewer can verify directly from the diff and the repo, without claiming implementer intent.

```md
# Review Intake

## Scope reviewed
- Scope type: staged diff / working tree diff / full branch diff / docs only / specific files
- Repository:
- Branch:
- Files inspected:

## Verification
- Commands run this session:
- Tools used (grep, git log, file reads):

## Inferred Goal
- Best-effort summary of what the diff appears to do (mark each line `inferred from diff` or `inferred from commit message`).
- Do not write "the implementer intended X" without an explicit source.
```

---

## Section: `# Review Findings`

Written by the reviewer after inspecting the diff. Follows `references/review-contract.md` exactly.

```md
# Review Findings

## Scope reviewed
(One line: same as Review Handoff Scope or Review Intake Scope, restated so this section is self-contained.)

## Verification
(Commands run, skipped checks, or blocked checks.)

## Findings
- [P0|P1|P2|P3] Title
  File: path/to/file.ts:LINE
  Evidence: what the code/docs/test output shows
  Source: verified from code | verified from docs | verified from test output | inferred from prompt | HYPOTHESIS
  Impact: concrete failure mode
  Suggested fix: smallest safe change

(If no issues, write "No findings" plus checks run and residual risk.)

## Verdict
BLOCKED | PASS_WITH_CONCERNS | PASS | NO_FINDINGS
```

---

## Section: `# Fix Handoff`

Written by the reviewer immediately after `# Review Findings` (same writer, same session) to give the next agent (often Codex) a self-contained repair brief.

```md
# Fix Handoff

## Scope
- Repository:
- Branch / diff:
- Files affected:
- Non-goals:

## Validated Findings To Fix

| ID | Severity | Verdict | Original finding | Evidence | Target files/lines | Required fix | Acceptance check |
|---|---|---|---|---|---|---|---|
| F1 | P1 | valid | (verbatim from Review Findings) | path:line or command | concrete file:line | smallest required change | observable signal proving it (test name, response field, log line) |

Each row must be self-contained: a fixer who has only this packet plus repo access must be able to act without re-asking.

## Feedback Not To Fix

| Claim | Why rejected / downgraded | Evidence |
|---|---|---|
| ... | invalid / hypothesis / preference / out of scope | path:line or reason |

## Constraints

- Fix only validated findings.
- Do not broaden scope.
- Do not refactor unrelated code.
- Preserve existing behavior unless a finding explicitly requires changing it.
- New issues spotted during fix → record in Fix Completion's `Deferred Out-of-Scope`, do not silently fix.
- If a fix changes externally observable contract (new error code, new required field, new HTTP status, new response shape), call it out under `Scope > Non-goals` (allowed/disallowed) OR ask the reviewer to ratify it before merging.

## Verification Required

- Commands:
- Runtime checks:
- Docs/tests to update:

## Required Fix Agent Output

After fixing, append `# Fix Completion`. The first subsection must be `Fix Conclusion`.
```

---

## Section: `# Fix Completion`

Written by the fixer (typically Codex) after applying changes. The `Original Findings Snapshot` MUST be copied **strictly verbatim** from the Fix Handoff `Validated Findings To Fix` table — same 8 columns, same order, character-by-character cell contents. No rewording, no expansion, no clarification edits, no severity changes inside the original columns. If the fixer feels additional context is needed, either put it in `Fix Conclusion` (preferred) or append an optional **9th column** named `Notes` on the right — never modify the first 8 columns. A re-reviewer must be able to `diff` the first 8 columns of the snapshot row against the Fix Handoff row and get zero changes; this is what makes independent re-attestation possible.

```md
# Fix Completion

## Fix Conclusion
- Overall status: all validated findings fixed / partially fixed / blocked / not fixed
- Scope changed: files changed, one line
- Not changed: invalid / out-of-scope / blocked / intentionally deferred findings and why
- Verification: passed / failed / not run, with command or reason
- Re-review focus: exact finding IDs or nearby regression surface for the next reviewer

## Fix Scope
- Repository:
- Branch / diff:
- Files changed:
- Findings addressed:

## Original Findings Snapshot

(**Strictly verbatim** copy of the Fix Handoff `Validated Findings To Fix` table. The column structure **must match the Fix Handoff table identically** — same columns, same order — so that the fixer can `cp` rows wholesale without restructuring. Re-reviewer evaluates fixes by `diff`-ing the snapshot row against the original Fix Handoff row and expecting zero changes.

If the fixer wants to surface additional context (constraints, non-goals, fixer notes), append an optional `Notes` column to the right of the original columns. Never modify the original columns or remove any of them.)

| ID | Severity | Verdict | Original finding | Evidence | Target files/lines | Required fix | Acceptance check |
|---|---|---|---|---|---|---|---|

## Finding Status

| Finding ID | Claimed status | Files changed | Verification |
|---|---|---|---|
| F1 | resolved / partially resolved / not resolved / not changed (invalid or out of scope) / blocked | path list | command/result or "not run + why" |

## Changes Made

- ...

## Verification

- Command:
- Result:
- Blocked checks:

## Deferred Out-of-Scope

Issues spotted during fix that were NOT applied (because they're out of packet scope and not safety-critical). Each entry: short title, file:line where noticed, why deferred. Do not silently expand fix scope.

- ...

## Re-review Instructions

- Reassess each prior finding against the `Original Findings Snapshot` row, not the `Claimed status`.
- Check only nearby regression surface unless the fix changed architecture or scope.
- Report new issues introduced by the fix separately.
- If the fix introduced a contract change not flagged in the original packet's non-goals, raise it as a new finding (not a regression-surface note).
```

---

## Section: `# Re-review`

Written by the reviewer after the fix. Re-attests prior findings against the `Original Findings Snapshot`, not the fixer's claimed status.

```md
# Re-review

## Scope
Scoped re-review of fix for prior findings (not a restart).

## Verification
- Commands run this session:
- Skipped / blocked checks:

## Prior Findings Reassessment

| Finding ID | Original finding (verbatim from snapshot) | Verdict | Evidence | Notes |
|---|---|---|---|---|
| F1 | ... | resolved / partially resolved / not resolved / regressed | path:line or command output | ... |

## New Findings Introduced By Fix

- [P0|P1|P2|P3] Title
  File: path:line
  Evidence: ...
  Source: ...
  Impact: ...
  Suggested fix: ...

## Regression Surface

- Checked:
- Not checked:

## Verdict
BLOCKED | PASS_WITH_CONCERNS | PASS | NO_FINDINGS
```

After writing the Verdict, apply the lifecycle action from the Lifecycle and Archive table in `SKILL.md`:

- `PASS` / `NO_FINDINGS` → `mv` to `archive/`, set `lifecycle_state = archived`.
- `PASS_WITH_CONCERNS` → keep in `active/`, set `lifecycle_state = awaiting_user_decision`, tell the user it will auto-continue on next "fix it".
- `BLOCKED` → keep in `active/`, set `lifecycle_state = blocked`, await next fix round.

---

## Multi-round suffix

If Re-review verdict is `BLOCKED` or the user re-engages an `awaiting_user_decision` packet, the next stages get `(round N)` suffixes. Increment `round` in frontmatter.

```md
# Fix Completion (round 2)

## Fix Conclusion
- ...

(...same template as round 1...)


# Re-review (round 2)

## Scope
Scoped re-review of round 2 fix for prior unresolved / new findings.

(...same template as round 1...)
```

The `Original Findings Snapshot` in round 2's `# Fix Completion` may either restate only the still-open findings from round 1, or restate all original findings — pick one and be explicit. Restating only the still-open subset keeps the table short; either way the re-reviewer must be able to look up every claimed verdict against a verbatim row.

## Tiny review shortcut

For a one-file, one-finding review where a full packet is overkill, the minimum still-valid packet is:

```md
---
packet_id: <branch_slug>/<local_minute>-tiny-<thing>
branch: <branch>
scope: tiny-<thing>
created: <ts>
updated: <ts>
last_anchor: review_findings
lifecycle_state: in_progress
round: 1
---

# Review Intake
Scope reviewed: working-tree diff for path/to/file.ts
Verification: read file path/to/file.ts (lines 1-50)
Inferred Goal: <one line, marked inferred from diff>

# Review Findings
Scope reviewed: (same)
Verification: (same)
Findings: ... (or "No findings.")
Verdict: ...
```

You still create a real packet file — that's what makes the loop resumable. The shortcut is in section length, not in skipping addressing or frontmatter.
