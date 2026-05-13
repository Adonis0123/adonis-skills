---
name: agentic-review-handoff
description: "Cross-agent code review handoff and review-fix-re-review loop. Use when the user asks for an independent, read-only 'second pair of eyes' pass on a diff/branch/PR another agent (Codex, Cursor) or a teammate implemented; asks to verify team/reviewer feedback before fixing; asks to hand verified findings to a fixer; says a fix is done and wants scoped re-review; or asks for first-principles, DDD, high-cohesion/low-coupling review. Do NOT use for ordinary implementation, generic staged-change review, polishing review-comment wording, generic perf/SQL/style questions unrelated to a recent implementation, or when the user names a different review skill."
metadata:
  author: adonis
---

# Agentic Review Handoff

## Workflow

1. State the stage and scope, then proceed.

   - Stage is one of: review, feedback validation, fix handoff, fix, or re-review.
   - Name the exact scope: staged diff, working tree diff, full branch diff, generated artifacts, docs-only, or specific files.
   - If scope is missing, reconstruct the minimum scope from the diff / file paths / prior findings the user gave you and proceed with explicit assumption labels. Asking a clarifying question is a last resort, only when no defensible scoped output is possible.

2. Use the right packet.

   - Use `references/handoff-packet.md` when preparing a reviewer to inspect a medium/large change.
   - Use `references/review-loop-packets.md` when handing validated findings to a fixer, or when handing a completed fix to a re-reviewer.
   - For tiny reviews, skip packet templates but still state the stage and scope.

3. Review and re-review are read-only by default. Do not edit files, commit, push, or rebase unless the user explicitly switches to fix stage. In fix stage, change only validated findings and still avoid commit/push/rebase unless explicitly requested. Prefer code-level evidence over intent summaries. If verification is blocked, name what was not verified and why.

4. Output findings using the review contract in `references/review-contract.md` — findings first, severity + file:line + Source tag + impact + fix per finding. If no issues, write `No findings` plus checks run and residual risk.

5. Handle review-fix-review loops.

   - Review stage: verify team/reviewer feedback as defect reports, not ground truth. Use a lightweight first-principles frame by default: goal, constraints, invariants, evidence, assumptions, and concrete failure modes. Escalate to the deeper DDD / high-cohesion / low-coupling lens only when architecture, domain rules, or module boundaries are involved. Use official or primary sources only when the claim depends on external API, framework, browser, security, payment, legal, or platform behavior.
   - Fix handoff stage: when the user wants to send the review result to the original implementer or another agent, output a Fix Handoff Packet. See `references/review-loop-packets.md`.
   - Fix stage: only fix findings already marked valid or partially valid. Do not broaden scope. Always end with a Fix Completion Packet for the next reviewer; do not replace it with a prose-only summary. If the user asks for a "fix conclusion", "修改结论", "修复结论", or "给出结论", satisfy that request in the packet's `Fix Conclusion` section while following the active system, developer, repository, and user language instructions. See `references/review-loop-packets.md`.
   - Re-review stage: after fixes, review the changed fix scope and nearby regression surface.
   - Do not restart a full review unless the user asks or the fix changes the architecture/scope.
   - If a prior reviewer claim is wrong, explain why with evidence instead of defending the implementation by default.
   - Output order is fixed so the user can scan it the same way every loop:
     1. Scope preamble naming this as a scoped re-review (not a restart).
     2. Prior findings reassessment table — one row per prior finding with verdict `resolved` / `partially resolved` / `not resolved` / `regressed`, plus file:line evidence.
     3. New findings introduced by the fix or surfaced by adjacency.
     4. Regression surface list — call sites or behaviors not changed but at risk because of the fix.
     5. Single verdict.

## Stage Defaults

If the user does not name the stage, infer it from the request:

| User signal | Stage | Required output |
|---|---|---|
| "review", "second pair of eyes", "audit this diff", or pasted team feedback | review / feedback validation | Findings or feedback validation, optionally followed by a Fix Handoff Packet |
| "give this back to the implementer", "send context to the fixing AI", or asks for a repair brief | fix handoff | Fix Handoff Packet |
| "fix according to this packet", "apply only these validated findings", "fix it", "apply the valid feedback", "修改吧", "改吧", "修一下", "按这个改", "按 review 意见修", "修改之后给出结论", "修完给结论", or "改完给我结论" | fix | Code/doc changes plus Fix Completion Packet with `Fix Conclusion` |
| "fixed, review again", "改好了再看", or provides a Fix Completion Packet | re-review | Prior findings reassessment, new fix-induced findings, regression surface, verdict |

### Mixed-stage requests

When one user message combines review/validation with a fix request (e.g. "review this then fix it", "validate this feedback and apply the valid parts"), execute stages sequentially in this order:

1. Finish review or feedback validation with findings, verdict, and a Fix Handoff Packet.
2. Only then enter fix stage for validated findings, and emit a Fix Completion Packet.

Do not merge review evidence and fix changes into one unstructured response. Merging stages destroys the portability the packet design depends on — a later re-reviewer cannot independently re-attest findings if there is no Fix Handoff Packet to anchor them. If the user pushes back on the sequencing, name the cost ("merging stages means a later re-reviewer can't independently re-attest findings") and let them decide. Free-form "rewrite this function" requests not tied to a validated finding are not a stage switch — defer them as a separate implementation task.

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

Enable the full deep-review lens only when the user explicitly asks for DDD, high cohesion/low coupling, industry comparison, source-backed research, or when the change is architectural, cross-module, or domain-rule heavy. A lightweight first-principles frame is allowed in normal review; do not turn every ordinary review into a full architecture review.

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
