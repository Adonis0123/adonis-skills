# Worked examples (core) — workflow-gate

One example per Route (Direct / Light / Brainstorm / Discuss / Plan / Full / Review-Handoff). Mirror these when the prompt looks like the example; deviate when the Signals say otherwise. For edge cases (tiebreakers, mismatches, Rule #2 negatives, re-gating, contradictory signals), see `examples-edge.md`.

## Direct — read-only question

User: "Read me the line count of `App.tsx`."

```
Workflow Gate
- Route: Direct
- Runtime skill: none
- Fallback alias: none
- Execution path: direct local work
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
- Goal: Apply the typo fix at apps/web/src/App.tsx:42.
- Signals: scope=single-file; risk=low; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: none
- Next: Edit the line; no further verification beyond a re-read of the diff.
```

## Brainstorm — open solution space

User: "Design the sharing model for dashboards — link / invite / RBAC / workspace, what are the tradeoffs?"

```
Workflow Gate
- Route: Brainstorm
- Runtime skill: brainstorming
- Fallback alias: superpowers:brainstorming
- Execution path: n/a
- Goal: Map the dashboard-sharing design space with tradeoffs across 4 candidate models.
- Signals: scope=multi-module; risk=medium; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: none
- Next: Load brainstorming; generate 3-5 candidate models with first-principles tradeoffs.
```

## Discuss — unresolved decisions

User: "Stripe or Lemon Squeezy for billing? Pricing tiers undecided too."

```
Workflow Gate
- Route: Discuss
- Runtime skill: discuss-before-plan
- Fallback alias: none
- Execution path: n/a
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
- Execution path: executing-plans
- Goal: Wire Google OAuth into apps/web per RFC-024.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=resolved; user-intent=plan
- Assumptions: RFC-024 is authoritative and current.
- Next: Load writing-plans; produce a 5-8 task breakdown grounded in the RFC.
```

## Full — multi-bounded-context migration

User: "Migrate auth across api+web+mobile from session cookies to JWT, 30+ files."

```
Workflow Gate
- Route: Full
- Runtime skill: writing-plans
- Fallback alias: none
- Execution path: subagent-driven-development
- Goal: Migrate auth from session cookies to JWT across api, web, and mobile.
- Signals: scope=multi-module; risk=high; destructive=no; decisions=resolved; user-intent=plan
- Assumptions: JWT signing strategy already chosen; rollout phases to be detailed in the plan.
- Next: Load writing-plans; structure per-app tasks so subagent-driven-development can fan out.
```

## Review-Handoff — fresh eyes

User: "Have a fresh agent code-review `feature/billing-redesign`, with re-review after I fix."

```
Workflow Gate
- Route: Review-Handoff
- Runtime skill: agentic-review-handoff
- Fallback alias: none
- Execution path: n/a
- Goal: Get an independent cross-agent review of feature/billing-redesign with re-review after fixes.
- Signals: scope=multi-module; risk=medium; destructive=no; decisions=resolved; user-intent=review
- Assumptions: Repo is a git repo (agentic-review-handoff requires it).
- Next: Load agentic-review-handoff; create a packet scoped to main…feature/billing-redesign.
```
