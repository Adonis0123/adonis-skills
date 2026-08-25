# Decision and Terminal Gates

Read this reference only when either condition is true:

- Phase 1 finds an unresolved `HUMAN_DECISION` or the user explicitly requests `grill-with-docs`.
- Phase 4 is about to start, resume, or interpret a non-happy-path dependency result.

## Human decision convergence

Implementation authorization covers reversible, in-scope technical choices that preserve decided behavior and external-action boundaries. Examples include an existing helper versus equivalent inline code, test placement within the necessary-test scope, and an already accepted repository default. Resolve these from authoritative docs, current code, repository conventions, minimality, and verification quality. Agent disagreement alone does not create a user decision.

Keep `HUMAN_DECISION` for an unresolved choice that changes product behavior, a public contract, data ownership/truth, security posture, frozen scope, or an external/destructive action requiring new authorization. A user instruction such as “do not ask” or “decide for me” does not waive these boundaries.

For a real `HUMAN_DECISION`:

1. Load `grill-with-docs` and its delegated skills. Follow `grilling`'s design-tree frontier rounds: one round may contain every independent question whose prerequisites are satisfied, each with a recommendation.
2. Resolve the repository-approved domain-document locations before invocation. Add any glossary or ADR paths that `domain-modeling` may write to the frozen write boundary. If they cannot be included safely, return `HUMAN_GATE`.
3. Agent consensus cannot replace the user. Before confirmation, return `HUMAN_GATE`; do not create a Goal or modify source.
4. After each answer, derive the convergence record from the actual conversation and working-tree diff. Do not require a wrapper-specific schema.

```text
Human Decision Convergence
- Resolved decisions:
- Unresolved frontier:
- User confirmation: pending | confirmed
- Domain docs touched: <actual paths or none>
- Scope / exclusions changed: <details or none>
```

Proceed only when the frontier is empty, the user has confirmed, and every touched domain path is inside the approved write boundary.

## Agentic review terminal contract

Invoke `agentic-review-handoff` and preserve its packet lifecycle:

- `PASS` / `NO_FINDINGS`: verify the returned `baseSha + pathFilter + digest`, then recompute with `review-loop evidence`. Missing or mismatched identity requires a rerun.
- `BLOCKED`: fix and verify under the dependency protocol, then continue the same packet.
- `PASS_WITH_CONCERNS` with `awaiting_user_decision`: return `HUMAN_GATE`. Only the user chooses `run --continue` or `close --reason accept-concerns`; neither the outer nor a nested loop may close it.
- `run --continue` may later end in an archived `PASS`; this path needs no Decision Closure.
- `close --reason accept-concerns` may resume only after the user's Decision Closure is recorded, the packet is archived, and no open `Fix` remains. Preserve the original verdict; never rewrite it to `PASS`.
- Delivery, evidence-hash, deadlock, or required-capability failures stop under the dependency's native result. Do not invent a successful terminal state.

## Architecture hardening terminal contract

Run `architecture-hardening-loop` on the same frozen scope and exclusions. Accept only:

```text
Result: NO_ACTIONABLE_FINDINGS
```

When it finds a `Fix`:

- If the Fix is already inside the parent Goal's scope and Done condition, `goal-gate` uses `Decision: set-now` and `Next: continue active goal`. Complete it under the same Goal without asking, nesting a Goal, or letting the architecture loop complete its parent.
- If scope or ownership conflicts or is unclear, use `Decision: defer`, return `HUMAN_GATE`, and ask only about that conflict.

The completion report must include `Goal: active-checkpoint` and a recomputable evidence id. If the loop changed source or tests, all earlier evidence for the old digest expires. Reuse its internal agentic review only when that review covers the final evidence; otherwise rerun the direct review and affected verification.

If architecture invoked automated review, require final verdict, packet, lifecycle, and evidence identity. A zero-Fix path records review `not-run` plus its terminal consult. A nested `awaiting_user_decision` remains a user-only gate even when the concern is not a Fix. After a valid user continue-to-PASS or accept-concerns Decision Closure, resume the original-scope rescan; do not gate forever on a historical verdict string.

## Fresh Claude audit

After verification plus the first two gates cover the current evidence, create a new Claude Code session. Never resume a discussion or earlier review session.

- Give it the original objective, frozen scope, exclusions, and evidence id, but not previous reviewer conclusions.
- Review tracked diff, related untracked files, and actual `file:line` evidence.
- Enforce a verifiable read-only boundary: repository reads and non-mutating checks only; no editing, Git control plane, deployment, or external writes.
- Require each finding to include impact, minimum fix, verification, and actual command.

The host independently classifies each finding:

| Class     | Rule                                                                    |
| --------- | ----------------------------------------------------------------------- |
| `Fix`     | Real, in scope, worth its complexity, minimally fixable, and verifiable |
| `Backlog` | Real but low-value, out of scope, future-dependent, or unsafe to verify |
| `Reject`  | Preference, theoretical expansion, duplicate abstraction, or stale      |

Severity alone does not decide the class. A real P3 may be a `Fix`; an unsupported P1 may be `Reject`.

A `Fix` keeps the Goal active and expires old gates: add the nearest regression, implement the minimum repair, rerun verification, direct review, same-scope architecture hardening, and a new blind audit on the new evidence. One such cycle is one round; after two rounds, remaining in-scope Fixes return `HUMAN_GATE`.
