---
name: agentic-review-handoff
description: "Cross-agent code review handoff. Use when the user asks for an independent, read-only 'second pair of eyes' pass on a diff/branch/PR another agent (Codex, Cursor) or a teammate just implemented. Covers four modes: reviewing a staged/working-tree/pasted diff as second/independent/final reviewer; validating another reviewer's findings claim-by-claim against the code; scoped review-fix-review loop after a fix; cross-module deep review using first-principles, DDD, or cohesion-coupling reasoning. Do NOT use for refactoring or writing code yourself, polishing review-comment wording, generic perf/SQL/style questions unrelated to a recent implementation, or when the user names a different review skill (e.g. staged-changes-review, code-review-business)."
metadata:
  author: adonis
---

# Agentic Review Handoff

## Workflow

1. State the scope, then proceed.

   - Name the exact scope: staged diff, working tree diff, full branch diff, generated artifacts, docs-only, or specific files.
   - If scope is missing, reconstruct the minimum scope from the diff / file paths / prior findings the user gave you and proceed with explicit assumption labels. Asking a clarifying question is a last resort, only when no defensible scoped output is possible.

2. Use a handoff packet when the change is medium/large or the user asks for final review. See `references/handoff-packet.md`. For tiny reviews, skip the packet but still state the scope.

3. Review is read-only by default. Do not edit files, commit, push, or rebase unless the user explicitly switches to fix mode. Prefer code-level evidence over intent summaries. If verification is blocked, name what was not verified and why.

4. Output findings using the review contract in `references/review-contract.md` — findings first, severity + file:line + Source tag + impact + fix per finding. If no issues, write `No findings` plus checks run and residual risk.

5. Handle review-fix-review loops.

   - After fixes, review the changed fix scope and nearby regression surface.
   - Do not restart a full review unless the user asks or the fix changes the architecture/scope.
   - If a prior reviewer claim is wrong, explain why with evidence instead of defending the implementation by default.
   - Output order is fixed so the user can scan it the same way every loop:
     1. Scope preamble naming this as a scoped re-review (not a restart).
     2. Prior findings reassessment table — one row per prior finding with verdict `resolved` / `partially resolved` / `not resolved` / `regressed`, plus file:line evidence.
     3. New findings introduced by the fix or surfaced by adjacency.
     4. Regression surface list — call sites or behaviors not changed but at risk because of the fix.
     5. Single verdict.

## Review Modes

### Standard Review

Use for normal staged, working-tree, or final implementation review.

Check:

- Scope correctness: reviewer is looking at the intended diff.
- Functional correctness: behavior matches the request/spec.
- Regression risk: unchanged contracts remain true.
- Error handling and boundary cases.
- Test coverage and verification evidence.
- Security/privacy concerns when data, auth, payment, file, or network boundaries are touched.

### Feedback Validation

Use when the user pastes feedback from another reviewer or team.

Treat the feedback as a defect report, not as ground truth.

For each claim:

- Verify against code, docs, diff, tests, or runtime evidence.
- Classify as `valid`, `partially valid`, `invalid`, or `hypothesis`.
- Explain the minimum fix only for valid or partially valid issues.
- If the claim confuses final file state with execution timeline, call that out explicitly.

Scope discipline: do not add new findings beyond the claims the user pasted. The user came to validate a specific list, not to receive an expanded review. Two exceptions are allowed:

- Safety-critical issues you happened to see in the same snippet — meaning P0 or P1 severity in the domains of security, data loss, payment, auth, or privacy. Maintainability, style, missing returns on dead code paths, and "while we're here" P2/P3 ideas do NOT qualify, however tempting. Surface real safety-critical findings in a clearly separated section labelled "Out-of-scope findings" so the user can route them deliberately.
- The user explicitly asked to "also look for other issues" or equivalent.

If you find yourself adding a P2 or P3 to the out-of-scope section, delete it — that is the exact failure mode this rule exists to prevent. Everything else stays out: comment quality, style preferences, refactor ideas, control-flow nits with no observable impact. If unsure, omit.

### Deep Review

Enable only when the user explicitly asks for first principles, DDD, high cohesion/low coupling, industry comparison, source-backed research, or when the change is architectural, cross-module, or domain-rule heavy.

Do not use these labels as slogans. Convert them into evidence-backed checks:

- First principles: goal, constraints, invariants, evidence, assumptions, concrete failure modes.
- DDD: core domain, ubiquitous language, bounded context, rule ownership, explicit cross-context mapping.
- Cohesion/coupling: change locality, dependency direction, duplicated rules, hidden coupling, interface size.
- Source-driven check: use official or primary sources for version-sensitive APIs, libraries, security, payments, browser behavior, or external platform claims; distinguish code evidence from docs evidence and inference.

## Guardrails

- Reviewer suggests, never rewrites by default. Implementer or user decides fixes.
- Style preferences are marked `Preference` or omitted — never reported as bugs.
- Never write "looks good" without listing what was checked.
- Never claim a command passed unless it actually ran in this session.
- When paths or branches matter, verify `pwd`, branch, and `git status` before quoting them.
