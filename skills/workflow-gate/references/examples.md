# Worked examples — workflow-gate

One full Workflow Gate block per Route. Mirror these when the prompt looks like the example; deviate when the Signals say otherwise. The block stays grep-friendly: same field order, same separators.

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

## Light + systematic-debugging — failing CI test

User: "`login.test.ts` passes locally but fails on CI."

```
Workflow Gate
- Route: Light
- Runtime skill: systematic-debugging
- Fallback alias: none
- Execution path: systematic-debugging
- Goal: Find why login.test.ts passes locally but fails on CI.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=resolved; user-intent=debug
- Assumptions: none
- Next: Load systematic-debugging; reproduce CI conditions locally before patching.
```

## Light + verification — "ready to commit?"

User: "Dashboard refactor done, can I ship?"

```
Workflow Gate
- Route: Light
- Runtime skill: verification-before-completion
- Fallback alias: superpowers:verification-before-completion
- Execution path: n/a
- Goal: Verify the dashboard refactor is actually shippable.
- Signals: scope=multi-module; risk=medium; destructive=no; decisions=resolved; user-intent=ship
- Assumptions: Project's verification suite (test + typecheck + lint) is runnable.
- Next: Load verification-before-completion; run the suite and read fresh output before any ship claim.
```

`Execution path` is `n/a` because the verification skill *is* the workflow — no implementation pattern needs to fire on top of it. The same pattern applies for Brainstorm / Discuss / Review-Handoff routes.

## Light + test-driven-development — referenced spec, direct few-file behavior change

User: "给 existing form 增加 Zod 校验，字段和错误文案都已经在 docs/forms/signup-validation-spec.md 里写好了，直接实现。"

The referenced spec means the creative/design decision has already been made. Rule #1.5's exception skips Brainstorm, but the implementation still changes behavior, so use TDD rather than plain direct local work.

```
Workflow Gate
- Route: Light
- Runtime skill: test-driven-development
- Fallback alias: superpowers:test-driven-development
- Execution path: test-driven-development
- Goal: Add Zod validation to the existing form per the referenced signup validation spec.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: docs/forms/signup-validation-spec.md is authoritative; Rule #1.5 exception skips Brainstorm, and direct few-file behavior implementation uses TDD.
- Next: Load test-driven-development; write valid and invalid input coverage before implementing the validation.
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

## Discuss — destructive op disguised as Direct

User: "Just drop the `users` table, it's unused."

```
Workflow Gate
- Route: Discuss
- Runtime skill: discuss-before-plan
- Fallback alias: none
- Execution path: n/a
- Goal: Decide whether and how to drop the `users` table safely.
- Signals: scope=multi-module; risk=high; destructive=yes; decisions=unresolved; user-intent=ship
- Assumptions: "Unused" is the user's unverified claim; no backup/migration plan stated.
- Next: Load discuss-before-plan; ask once for env + disuse evidence + safe-deprecation alternative before any DROP.
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

## Contradictory signals — "quick fix" on payment code

User: "Just a quick fix to the Stripe webhook handler — it's choking on refunds. Don't overthink it."

Rule #1 (destructive / risky) wins over the casual "quick fix" framing. Payment code + production webhook = high-or-destructive risk. Surface the contradiction.

```
Workflow Gate
- Route: Discuss
- Runtime skill: discuss-before-plan
- Fallback alias: none
- Execution path: n/a
- Goal: Decide the safe way to fix the Stripe webhook refund path.
- Signals: scope=few-files; risk=high; destructive=no; decisions=unresolved; user-intent=ship
- Assumptions: User framed this as "quick" but the surface area is payments; one wrong edit could lose money or refund the wrong customer.
- Next: Load discuss-before-plan; ask once for the failing payload + intended refund semantics before touching the handler.
```

## Re-gate trigger — destructive surfaces mid-Plan

You are mid-Plan executing the OAuth integration (RFC-024). While loading `executing-plans`, you notice the plan calls for dropping the legacy `oauth_states` table to consolidate schema. That is a destructive signal that wasn't visible at gate time. **Re-run the gate before executing that task.**

```
Workflow Gate (re-gate)
- Route: Discuss
- Runtime skill: discuss-before-plan
- Fallback alias: none
- Execution path: n/a
- Goal: Decide the safe path for the oauth_states drop introduced inside the OAuth plan.
- Signals: scope=multi-module; risk=high; destructive=yes; decisions=unresolved; user-intent=plan
- Assumptions: Other RFC-024 tasks remain on the original Plan route; only the destructive task is being re-gated.
- Next: Load discuss-before-plan; confirm migration vs deprecation strategy, then resume executing-plans for the remaining tasks.
```

## Rule #2 mismatch — user named a skill that doesn't fit

User: "Run brainstorming on this — there's a typo on line 42 of App.tsx."

The user named `brainstorming`, but the work is a one-character typo fix. That's a clear Brainstorm-vs-Direct mismatch. The gate flags the mismatch and asks one clarifying question (or, if "don't ask" was active, picks the most likely Route and records the user-named skill in `Assumptions`).

```
Workflow Gate
- Route: Light
- Runtime skill: none
- Fallback alias: none
- Execution path: direct local work
- Goal: Apply the typo fix on apps/web/src/App.tsx:42 (mismatch flag: user named `brainstorming`).
- Signals: scope=single-file; risk=low; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: User-named `brainstorming` doesn't fit a single-character fix; defaulting to Light and surfacing the mismatch before applying.
- Next: Confirm with one sentence ("This is a one-char fix; running brainstorming on it would be over-escalation — want me to just apply it?") and then edit.
```

## Brainstorm — replicate an existing UI (Creative-work HARD-GATE positive)

User: "结合 /Users/me/duiyun/.../pollo.ai/p/[slug] 的数据契约，把 https://youmind.com/zh-CN/video-prompts/japanese-classroom-romance-1402 这页按 Pollo 风格 1:1 复刻一下，适合走哪个流程？"

Even though the data contract exists and the visual target is concrete, this is creative UI work — composing a screen from a design system, choosing information density, picking a CTA shape, mapping fields. Rule #1.5 fires: Brainstorm, not Plan.

```
Workflow Gate
- Route: Brainstorm
- Runtime skill: brainstorming
- Fallback alias: superpowers:brainstorming
- Execution path: n/a
- Goal: Design how to map the YouMind prompt-detail information architecture into a Pollo-styled detail page before writing code.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: Data contract exists, but the UI composition is creative work — Rule #1.5 (Creative-work HARD-GATE) requires Brainstorm before Plan. No `docs/superpowers/specs/*-design.md` referenced.
- Next: Load brainstorming; offer the visual companion, then converge on layout / hierarchy / CTA / empty-state decisions one question at a time.
```

## Brainstorm — intentional behavior change on existing screen (Creative-work HARD-GATE positive)

User: "Dashboard 上加一个 Share 按钮，点击弹一个 modal 让用户选 link / email / team。"

Adding intentional new behavior to an existing screen is creative work even though the screen already exists. Rule #1.5 fires.

```
Workflow Gate
- Route: Brainstorm
- Runtime skill: brainstorming
- Fallback alias: superpowers:brainstorming
- Execution path: n/a
- Goal: Design the share-modal interaction (entry point, sharing channels, default state, permissions surface) before implementation.
- Signals: scope=few-files; risk=low; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: Intentional new behavior on an existing screen counts as creative work under Rule #1.5; no prior design doc referenced.
- Next: Load brainstorming; clarify which channels matter first, default audience, and permission model.
```

## Brainstorm — user named writing-plans but no design doc (Rule #1.5 mismatch)

User: "Use writing-plans: redesign the existing homepage in an Airbnb style, but there is no design doc yet."

Do not turn `writing-plans` into a discovery-first design workflow. The missing design doc is exactly why Rule #1.5 fires: Brainstorm first, then writing-plans after the design is approved.

```
Workflow Gate
- Route: Brainstorm
- Runtime skill: brainstorming
- Fallback alias: superpowers:brainstorming
- Execution path: n/a
- Goal: Design the homepage redesign direction before creating an implementation plan.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: User named `writing-plans`, but this is creative redesign work and no design doc/spec is referenced; treating the named Plan-class skill as a mismatch under Rule #1.5.
- Next: Load brainstorming; clarify design goals, reference boundaries, brand constraints, and success criteria before any writing-plans handoff.
```

## Plan — existing spec referenced (Rule #1.5 exception)

User: "按 docs/superpowers/specs/2026-05-12-share-modal-design.md 把 share modal 接到 apps/web。"

The user has explicitly pointed at an existing design doc, so brainstorming has already been paid. Rule #1.5's exception applies: route to Plan and record the spec path in `Assumptions`.

```
Workflow Gate
- Route: Plan
- Runtime skill: writing-plans
- Fallback alias: none
- Execution path: executing-plans
- Goal: Wire the share modal into apps/web per the referenced design doc.
- Signals: scope=few-files; risk=low; destructive=no; decisions=resolved; user-intent=plan
- Assumptions: docs/superpowers/specs/2026-05-12-share-modal-design.md is authoritative; Rule #1.5 exception fires (existing spec referenced) → skip brainstorming.
- Next: Load writing-plans; produce a task breakdown grounded in the design doc.
```

## Light — typo fix is not creative work (Rule #1.5 negative)

User: "把 apps/web/src/App.tsx 第 42 行的 'recieve' 改成 'receive'。"

A single-character typo is neither a new feature, a new component, nor a behavior change. Rule #1.5 does not fire. Stay on the existing Light row.

```
Workflow Gate
- Route: Light
- Runtime skill: none
- Fallback alias: none
- Execution path: direct local work
- Goal: Apply the typo fix at apps/web/src/App.tsx:42.
- Signals: scope=single-file; risk=low; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: none
- Next: Edit the line; re-read the diff for verification.
```

## Light + "don't ask me" edge case

User: "Implement X, don't ask me, just go." (Two reasonable interpretations exist.)

Take the most likely interpretation, surface the alternative under `Assumptions`, ship the diff.

```
Workflow Gate
- Route: Light
- Runtime skill: none
- Fallback alias: none
- Execution path: direct local work
- Goal: Implement X as the most natural reading of the request.
- Signals: scope=few-files; risk=low; destructive=no; decisions=unresolved; user-intent=implement
- Assumptions: Interpreting X as <chosen reading>; alternative <other reading> deferred — user opted out of confirmation.
- Next: Implement chosen reading; show the diff and flag the alternative so the user can redirect cheaply.
```
