# Review Loop Packets

Use these packets to keep the review -> fix -> re-review loop portable across agents or sessions. The goal is to pass only the context the next agent needs, not the whole chat history.

## Fix Handoff Packet

Use after review or feedback validation when another agent should make the changes.

```md
# Fix Handoff Packet

## Scope

- Repository:
- Branch / diff:
- Files affected:
- Non-goals:

## Validated Findings To Fix

Each finding must be self-contained: a fixer who has only this packet and repo access must know the defect, target file/line, required behavior change, and verification signal. Vague entries like "handle the edge case" in `Required fix` are a packet bug.

| ID | Severity | Verdict | Original finding | Evidence | Target files/lines | Required fix | Acceptance check |
|---|---|---|---|---|---|---|---|
| F1 | P1/P2/P3 | valid / partially valid | what the original reviewer wrote, verbatim or near-verbatim | path:line or command/doc evidence | concrete file:line the fixer should change | smallest required change | observable signal that proves the fix worked (test name, runtime assertion, log line, response field, etc.) |

## Feedback Not To Fix

| Claim | Why rejected / downgraded | Evidence |
|---|---|---|
| ... | invalid / hypothesis / preference / out of scope | path:line or reason |

## Constraints

- Fix only validated findings.
- Do not broaden scope.
- Do not refactor unrelated code.
- Preserve existing behavior unless a finding explicitly requires changing it.
- If new issues or user "while you're here" requests appear during fix stage, do not implement them. Record them in the Fix Completion Packet's `Deferred Out-of-Scope` section unless they are P0/P1 safety-critical (security / data loss / payment / auth / privacy).
- If a fix changes externally observable contract — new error code, new required request field, new HTTP status path, new response shape — call it out explicitly here under `Scope > Non-goals` (as allowed/disallowed) OR ask the reviewer to ratify the contract change before merging. Silent contract changes break downstream callers and are the most common scope-creep failure.

## Verification Required

- Commands:
- Runtime checks:
- Docs/tests to update:

## Required Fix Agent Output

After fixing, output a Fix Completion Packet with changed files, finding status, verification results, and remaining risk.
```

## Fix Completion Packet

Use after implementing fixes so a different reviewer can re-review without inheriting the fixer's full context.

```md
# Fix Completion Packet

## Fix Scope

- Repository:
- Branch / diff:
- Files changed:
- Findings addressed:

## Original Findings Snapshot

Copied verbatim from the Fix Handoff Packet. The fixer MUST NOT summarize, paraphrase, or rewrite these — the re-reviewer evaluates the fix against this snapshot, not against the fixer's claimed status. Without the snapshot, an isolated re-reviewer would have to trust the fixer for what each finding even meant; that breaks the protocol's portability claim.

| ID | Severity | Original finding | Original evidence | Required fix | Acceptance check | Non-goals (per packet) |
|---|---|---|---|---|---|---|
| F1 | ... | ... | ... | ... | ... | ... |

## Finding Status

| Finding ID | Claimed status | Files changed | Verification |
|---|---|---|---|
| F1 | resolved / partially resolved / not fixed | path list | command/result or not run + why |

## Changes Made

- ...

## Verification

- Command:
- Result:
- Blocked checks:

## Deferred Out-of-Scope

Issues the fixer noticed during fix stage but did not implement. Surface here so the next reviewer can route them deliberately; do not silently expand fix scope. Each entry: short title, where it was noticed (file:line), why it was deferred (out of packet scope / not safety-critical / different change set).

- ...

## Re-review Instructions

- Reassess each prior finding against the `Original Findings Snapshot` row, not the `Claimed status`.
- Check only nearby regression surface unless the fix changed architecture or scope.
- Report new issues introduced by the fix separately.
- If the fix introduced a contract change not flagged in the original packet's non-goals, raise it as a new finding (do not treat it as a regression-surface note).
```

## Re-review Output Contract

```md
Scope reviewed: scoped re-review of fix for prior findings.
Verification: commands run, skipped checks, or blocked checks.

## Prior Findings Reassessment

Re-attest each prior finding against the `Original Findings Snapshot` row from the Fix Completion Packet, not the fixer's `Claimed status`. This is what makes the re-review independent — without the verbatim original finding text, the re-reviewer would just be rubber-stamping the fixer's narrative.

| Finding ID | Original finding (from snapshot) | Verdict | Evidence | Notes |
|---|---|---|---|---|
| F1 | verbatim from Original Findings Snapshot | resolved / partially resolved / not resolved / regressed | path:line or command output | ... |

## New Findings Introduced By Fix

- [P1/P2/P3] ...

## Regression Surface

- Checked:
- Not checked:

Verdict: BLOCKED / PASS_WITH_CONCERNS / PASS / NO_FINDINGS
```
