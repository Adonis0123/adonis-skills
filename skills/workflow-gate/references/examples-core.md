# Worked examples (core) — workflow-gate

At least one example per Route (Direct / Light / Challenge / Discuss / Plan / Architecture / Review-Handoff). Mirror these when the prompt looks like the example; deviate when the Signals say otherwise. For edge cases (tiebreakers, mismatches, Rule #2 negatives, Thesis S1, Architecture diagnose vs harden, re-gating, contradictory signals), see `examples-edge.md`.

## Direct — read-only question

User: "Read me the line count of `App.tsx`."

```
Workflow Gate
- Route: Direct
- Runtime skill: none
- Fallback alias: none
- Execution path: direct local work
- Thesis: n/a
- Goal: Report the line count of apps/web/src/App.tsx.
- Signals: scope=single-file; risk=low; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: none
- Next: Count the file's lines with the local runtime's native command and return the number.
```

## Light + direct local work — typo / single-line edit

User: "Fix typo `recieve` → `receive` on apps/web/src/App.tsx:42."

```
Workflow Gate
- Route: Light
- Runtime skill: none
- Fallback alias: none
- Execution path: direct local work
- Thesis: n/a
- Goal: Apply the typo fix at apps/web/src/App.tsx:42.
- Signals: scope=single-file; risk=low; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: none
- Next: Edit the line; no further verification beyond a re-read of the diff.
```

## Challenge — open / stress a thesis (user-provided)

User: "Design the sharing model for dashboards — I want workspace-scoped invites by default; public links optional. Pressure-test that before code."

```
Workflow Gate
- Route: Challenge
- Runtime skill: grilling
- Fallback alias: none
- Execution path: n/a
- Thesis: user-provided
- Goal: Stress-test workspace-scoped-invite-default sharing thesis against link / RBAC / workspace alternatives.
- Signals: scope=multi-module; risk=medium; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: none
- Next: Load grilling; walk the decision tree against the stated thesis.
```

## Discuss — unresolved decisions

User: "Stripe or Lemon Squeezy for billing? Pricing tiers undecided too."

```
Workflow Gate
- Route: Discuss
- Runtime skill: discuss-before-plan
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Align on billing provider and pricing tiers before any implementation plan.
- Signals: scope=multi-module; risk=high; destructive=no; decisions=unresolved; user-intent=decide
- Assumptions: none
- Next: Load discuss-before-plan; surface provider tradeoffs and tier shape for a one-pass decision.
```

## Plan — RFC-driven feature

User: "Per RFC-024, wire Google OAuth into apps/web — 5-8 files."

```
Workflow Gate
- Route: Plan
- Runtime skill: writing-plans
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Wire Google OAuth into apps/web per RFC-024.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=resolved; user-intent=plan
- Assumptions: RFC-024 is authoritative and current.
- Next: Load writing-plans; produce a 5-8 task breakdown grounded in the RFC.
```

## Architecture — diagnose only

User: "Don't change code yet — diagnose module boundaries and dependency direction in `apps/web` and give an architecture candidate report."

```
Workflow Gate
- Route: Architecture
- Runtime skill: improve-codebase-architecture
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Produce an architecture candidate report for apps/web without implementing fixes.
- Signals: scope=multi-module; risk=medium; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: Scope is user-named apps/web; diagnose-only — do not enter hardening loop.
- Next: Load improve-codebase-architecture; explore + HTML report, then stop.
```

## Architecture — scoped harden loop

User: "Freeze scope to `apps/web/src/features/billing/**` and run the architecture harden loop until no actionable findings."

```
Workflow Gate
- Route: Architecture
- Runtime skill: architecture-hardening-loop
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Boundedly harden apps/web/src/features/billing until NO_ACTIONABLE_FINDINGS.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: Path is explicit and implement/harden intent is explicit.
- Next: Load architecture-hardening-loop with the frozen scope.
```

## Review-Handoff — fresh eyes

User: "Have a fresh agent code-review `feature/billing-redesign`, with re-review after I fix."

```
Workflow Gate
- Route: Review-Handoff
- Runtime skill: agentic-review-handoff
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Get an independent cross-agent review of feature/billing-redesign with re-review after fixes.
- Signals: scope=multi-module; risk=medium; destructive=no; decisions=resolved; user-intent=review
- Assumptions: Repo is a git repo (agentic-review-handoff requires it).
- Next: Load agentic-review-handoff; create a packet scoped to main…feature/billing-redesign.
```
