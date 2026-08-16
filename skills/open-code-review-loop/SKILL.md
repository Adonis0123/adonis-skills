---
name: open-code-review-loop
description: "Run a bounded OCR delegation review-fix-re-review loop across Codex, Claude Code, Grok Build, or Cursor CLI. Use when the user wants a chosen AI reviewer and fixer to inspect an OCR-selected Git scope, apply verified fixes, refresh evidence after every edit, and continue until full coverage returns NO_FINDINGS. Fail closed on missing adapters, skipped files, malformed output, stale evidence, or exhausted rounds. Do not use for one-shot review, non-Git work, or destructive delivery."
metadata:
  author: adonis
  version: "1.3.0"
---

# Open Code Review Loop

Use OCR delegation for deterministic file selection and rule resolution, then
coordinate a selected AI reviewer and fixer until the reviewer finds no
remaining actionable issue on the current evidence.

OCR does not decide whether code is clean. `ocr delegate` is LLM-free: it
selects files and resolves rules. Only a validated reviewer result with full
OCR coverage may produce `NO_FINDINGS`.

## Trigger and exclusions

Use this Skill for an explicit review-fix-re-review request on a Git workspace
when the user wants one of these products involved:

- `codex`
- `claude-code`
- `grok-build`
- `cursor-cli`

Do not use it for a one-shot review, non-Git files, architecture scanning,
commit/push/deploy, or destructive work. In this version, a historical commit
or ref range is always a read-only review target. The builder has no composite
overlay mode that could prove fixes made in a different worktree against the
original base.

## Inputs and defaults

Resolve these before the first model call:

| Input               | Default                                                            | Rule                                                                                                           |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Repository          | current Git root                                                   | Never infer a broader repository                                                                               |
| Target              | workspace changes                                                  | Also supports OCR `--from/--to` and `--commit`                                                                 |
| Reviewer            | user-selected product                                              | Must be a real, read-only product session                                                                      |
| Fixer               | current visible host                                               | An external Fixer requires a user-authorized isolated checkout that becomes the loop repository before round 1 |
| Paths/excludes      | OCR preview result                                                 | Preserve user exclusions across every round                                                                    |
| Accepted exclusions | `user_exclude` plus reasons the user explicitly accepts one by one | OCR-internal exclusions do not prove coverage                                                                  |
| Round budget        | 3                                                                  | A ceiling, not permission to claim success                                                                     |
| Model-call deadline | 10 minutes                                                         | Applies separately to every Reviewer/Fixer call                                                                |
| Background          | user requirement or none                                           | Pass through OCR preview/rule and reviewer prompt                                                              |

If the user names one product without assigning roles, use it as Reviewer and
the current host as Fixer. If the same product fills both roles, create two
independent sessions and keep the Reviewer read-only.

## Capability preflight

Before editing:

1. Confirm the repository root, branch, `HEAD`, and existing worktree changes.
2. Run `which ocr` and `ocr --version`. Missing OCR returns
   `MISSING_DEPENDENCIES`; do not install it without authorization.
3. Resolve the exact Reviewer and Fixer product IDs from the table above.
4. Inspect the installed product help or host tool schema. A binary name alone
   does not prove read-only review, structured output, scoped writes, or
   session recovery.
5. Confirm the Reviewer can inspect the repository without editing it. For an
   external Fixer, require a user-authorized isolated writable checkout and
   freeze that checkout as `$REPO` for Reviewer, Fixer, Git evidence, and every
   round before round 1. Do not auto-create or silently copy a worktree.
6. Record the allowed source/test paths and prohibited Git/external actions.
7. Record which exclusions the user explicitly accepted. Treat
   `unsupported_ext` and every other unaccepted OCR exclusion as incomplete
   coverage, even when all `reviewable_files` were reviewed.
8. Partition session records by repository, loop ID, role, and canonical
   product ID. Never resume a Reviewer as a Fixer or reuse an ID across
   products.

If a requested adapter cannot satisfy its role, return `HUMAN_GATE` with the
missing capability. Do not silently substitute another AI or let the Reviewer
write the subject under review.

When an external Fixer is selected, verify before round 1 that the isolated
checkout contains the intended target snapshot and existing changes, then use
its Git root as the single authoritative repository for the whole loop. Never
review one worktree and fix another. If no such target exists, return
`HUMAN_GATE`; this version does not define a patch-transfer protocol.

Read [references/adapter-contracts.md](references/adapter-contracts.md) only
for products selected in the current request.

## Loop contract

Freeze one contract before round 1:

```text
OCR Review Contract
- Repository / target:
- Reviewer / session policy:
- Fixer / session policy:
- Scope / exclusions:
- Accepted exclusion reasons:
- Background / acceptance checks:
- Write boundary:
- Round budget:
- Per-call deadline:
- Git and external actions: none
```

The Reviewer owns findings and the clean verdict. The Fixer owns source edits
and verification. The visible host owns OCR evidence, schema validation,
finding triage, round accounting, and the final result.

### Phase 1: Build current evidence

Create a deterministic bundle:

```bash
ROUND_DIR="$(mktemp -d)"
python3 <skill-dir>/scripts/build_review_bundle.py \
  --repo "$REPO" \
  --output "$ROUND_DIR/bundle.json" \
  [--from-ref <ref> --to-ref <ref>] \
  [--commit <hash>] \
  [--exclude <patterns>]... \
  [--allow-excluded-reason <reason>] \
  [--rule <rule.json>] \
  [--background <text> | --background-file <path>]
```

The script runs `ocr delegate preview`, resolves grouped rules with
`ocr delegate rule`, captures the correct Git diff or untracked file content,
and computes `evidence_id` from `HEAD`, OCR version, reviewable and excluded
entries, rules, refs, background, and content. Treat the bundle as sensitive
local review material; do not commit it.

The builder validates the complete OCR preview and grouped-rule response before
hashing. `validate_round.py` independently recomputes that canonical digest, so
editing bundle content or rules while retaining an old `evidence_id` fails
closed.

The builder also fingerprints `HEAD`, the binary tracked diff, and every
non-ignored untracked path/content before and after selection and capture. It
aborts if the repository changes mid-build. Range and commit refs are resolved
to immutable commit IDs before rule resolution and Git capture; a fatal Git
status query is never downgraded to an untracked file.

Prefer `--background-file` for non-trivial or sensitive background. The helper
redacts inline `--background` values from rendered argv and suppresses child
failure output whenever either background flag is present. It reads a
background file once before OCR selection, writes the content to a private
`0600` snapshot used by preview and rule resolution, hashes that same content,
and removes the snapshot before returning. This also avoids exposing long
content in the process list.

Commit mode follows OCR's first-parent selection, including for merge commits.
The builder fails closed when a reviewable entry produces missing captured
content. A real zero-byte untracked file is represented explicitly with
`empty_file: true`, so it cannot be confused with a missing Git diff.

Keep `ROUND_DIR` outside the repository. The script refuses an in-repository
output because the bundle could select itself in the next OCR preview and
create permanent evidence drift.

`--exclude` may be repeated; the script combines all values into OCR's
comma-separated pattern list and preserves the combined selection in every
round. Pass `--allow-excluded-reason` only after recording the user's explicit
acceptance of that exact reason. The CLI flag itself is not authority to accept
an exclusion.

If OCR returns zero reviewable files and no unaccepted exclusions, report
`CLEAN` with `0/0` coverage and the exclusion summary. If any target file was
excluded for an unaccepted reason such as `unsupported_ext`, return
`UNVERIFIED: INCOMPLETE_COVERAGE`. Do not invoke an AI merely to manufacture a
verdict.

### Phase 2: Invoke the Reviewer

Give the Reviewer:

- the frozen contract and business background;
- the whole `bundle.json`, including `evidence_id`;
- permission to read nearby repository context and run non-mutating checks;
- the exact JSON contract in
  [references/review-contract.md](references/review-contract.md), using
  [references/review-schema.json](references/review-schema.json) when the
  adapter supports an output schema.

Require every `(path, status)` entry from `reviewable_files` to appear exactly
once as `reviewed` or `skipped`. The Reviewer should emit only evidence-backed,
actionable findings. Style preferences and speculative improvements are not
findings.

Each Reviewer invocation for a fresh `evidence_id` consumes one round. The one
allowed schema correction on that same evidence does not consume another
round. Evidence drift creates a new evidence ID, so its next Reviewer call
consumes another round. Enforce the frozen per-call deadline; a read-only
Reviewer timeout is `UNVERIFIED` and is not retried.

First extract the product's final structured object. Do not search arbitrary
prose for braces or parse Grok's human-readable `text` field:

```bash
python3 <skill-dir>/scripts/extract_product_output.py \
  --product "$REVIEWER_PRODUCT" \
  --input "$ROUND_DIR/raw-review.json" \
  --output "$ROUND_DIR/review.json" \
  [--session-id "$RECORDED_SESSION_ID"]
```

The extractor replaces Reviewer identity with host-observed product/session
data. Then validate the response:

```bash
python3 <skill-dir>/scripts/validate_round.py \
  --bundle "$ROUND_DIR/bundle.json" \
  --review "$ROUND_DIR/review.json" \
  --output "$ROUND_DIR/validation.json"
```

A malformed response gets one correction in the same Reviewer session. If the
correction is still invalid, return `UNVERIFIED`; do not reinterpret prose as a
verdict.

### Phase 3: Detect evidence drift

Immediately rebuild the bundle with the same target and exclusions after the
Reviewer returns. Compare `evidence_id` values.

- Equal: the result covers the current snapshot.
- Different: discard the verdict, record `evidence-drift`, and review the new
  bundle. Never carry findings or `NO_FINDINGS` across snapshots.

### Phase 4: Triage and fix findings

For a valid `FINDINGS` result:

1. Independently open each cited path and verify the evidence.
2. Classify each item as `Fix`, `Reject`, or `Human decision`.
3. Give the Fixer only verified `Fix` rows, their target paths, required fix,
   acceptance check, current evidence ID, and the frozen write boundary.
   Load [references/fix-contract.md](references/fix-contract.md) and use
   [references/fix-schema.json](references/fix-schema.json) when supported.
4. Extract the product output with `extract_product_output.py`, then run
   `validate_fix_result.py`. A malformed result gets at most one same-session
   correction; a valid result is still only a claim.
5. The Fixer re-reads current code and applies the smallest coherent change.
6. The visible host recomputes Git status/diff, derives the actual changed
   paths, rejects out-of-scope writes, and runs the listed checks. Never trust
   the Fixer's claimed `FIXED`, `changed_paths`, or test summary as evidence.
7. Record rejected findings with concrete counter-evidence. Never edit code to
   satisfy a known false positive.

The Fixer must not commit, push, merge, rebase, deploy, send messages, or edit
outside the frozen boundary. An external Fixer writes only the authorized
isolated `$REPO` established before round 1. Direct external writes to the
user's original worktree require an adapter that proves path-scoped
enforcement, not merely a later diff check; the four documented CLI adapters
do not currently meet that bar.

A range/commit review always returns `HUMAN_GATE` before fixing in this
version. Supplying another writable branch is insufficient because rebuilding
the original immutable target would not include those edits.

Any source or test edit invalidates the prior bundle, validation, tests, and
verdict. Return to Phase 1 and build a new bundle.

If a Fixer times out or loses delivery after it could have written, recompute
the real Git diff and return `UNVERIFIED: DELIVERY_UNKNOWN_WITH_MUTATION`.
Never retry blindly and never reset user changes.

If the Fixer returns `FIXED` but Git/evidence is unchanged and the verified
finding still reproduces, record `FIXER_NO_MUTATION`. Because delivery is
known, allow one correction in that same Fixer session. A repeated no-mutation
result is `UNVERIFIED`, not another retry and never `CLEAN`.

### Phase 5: Re-review and stop

Resume the Reviewer when the product supports reliable session recovery;
otherwise create a fresh read-only Reviewer session and provide the prior
finding ledger plus the new bundle. The Fixer never supplies the terminal
verdict.

Stop only at one of these states:

| Result                 | Condition                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLEAN`                | Either current evidence validates as `NO_FINDINGS` with 100% coverage, zero skipped files, zero unaccepted exclusions, and no evidence drift; or the current bundle itself proves `reviewable_files` and `unaccepted_excluded_files` are both empty, so no Reviewer is invoked |
| `HUMAN_GATE`           | Product decision, writable-target choice, permission, repeated reviewer/fixer disagreement, or round extension is needed                                                                                                                                                       |
| `MISSING_DEPENDENCIES` | OCR or an explicitly required product capability is unavailable before edits                                                                                                                                                                                                   |
| `UNVERIFIED`           | Delivery is ambiguous, output is malformed after one correction, checks fail, evidence drifts repeatedly, or required evidence is stale                                                                                                                                        |

Reaching the round budget is never `CLEAN`. Report the remaining finding
ledger and ask whether to authorize another bounded set of rounds. Do not run
an infinite loop or hide a deadlock behind retries.

## Output contract

```text
OCR Review Loop Result
- Result: CLEAN | HUMAN_GATE | MISSING_DEPENDENCIES | UNVERIFIED
- Repository / target:
- Scope / exclusions:
- Reviewer / Fixer:
- Rounds used / budget:
- Final evidence id:
- Coverage: <reviewed>/<reviewable>; skipped: <count>; unaccepted excluded: <count>
- Fixed / Rejected / Open findings:
- Verification:
- Sessions / recovery:
- Git and external actions: none
```

For a Reviewer-backed `CLEAN`, include the final `validate_round.py` result and
the same-evidence comparison. For a zero-file `CLEAN`, include the bundle
summary proving `reviewable_files` and `unaccepted_excluded_files` are both
empty; no review response or validation result exists in that path. For every
other state, name the exact stop point and do not claim that OCR or the AI
approved the current code.
