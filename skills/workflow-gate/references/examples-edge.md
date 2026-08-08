# Worked examples (edge cases) — workflow-gate

These cover tiebreakers, mismatches, Rule #2 positive/negative variants, Thesis S1, Architecture diagnose vs harden, re-gating, contradictory-signal handling, and the "don't ask me" edge case. The core examples (one per Route) live in `examples-core.md` — load this file only when the core set doesn't cover the prompt.

## Light + systematic-debugging — failing CI test

User: "`login.test.ts` passes locally but fails on CI."

```
Workflow Gate
- Route: Light
- Runtime skill: systematic-debugging
- Fallback alias: none
- Execution path: systematic-debugging
- Thesis: n/a
- Goal: Find why login.test.ts passes locally but fails on CI.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=resolved; user-intent=debug
- Assumptions: none
- Next: Load systematic-debugging; reproduce CI conditions locally before patching.
```

## Light + direct verification — "ready to commit?"

User: "Dashboard refactor done, can I ship?"

```
Workflow Gate
- Route: Light
- Runtime skill: none
- Fallback alias: none
- Execution path: direct local work
- Thesis: n/a
- Goal: Verify the dashboard refactor is actually shippable.
- Signals: scope=multi-module; risk=medium; destructive=no; decisions=resolved; user-intent=ship
- Assumptions: Project's verification suite (test + typecheck + lint) is runnable.
- Next: Run the full relevant verification suite and read fresh output and exit status before any ship claim.
```

Ship checks use `direct local work` because verification is enforced by the global evidence rule rather than a separate runtime skill. Challenge / Discuss / Architecture / Review-Handoff still use `n/a` because their runtime skill is the workflow.

## Light + test-driven-development — referenced spec, direct few-file behavior change

User: "给 existing form 增加 Zod 校验，字段和错误文案都已经在 docs/forms/signup-validation-spec.md 里写好了，直接实现。"

The referenced spec means the creative/design decision has already been made. Rule #2's exception skips Challenge, but the implementation still changes behavior, so use TDD rather than plain direct local work.

```
Workflow Gate
- Route: Light
- Runtime skill: test-driven-development
- Fallback alias: superpowers:test-driven-development
- Execution path: test-driven-development
- Thesis: n/a
- Goal: Add Zod validation to the existing form per the referenced signup validation spec.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: docs/forms/signup-validation-spec.md is authoritative; Rule #2 exception skips Challenge, and direct few-file behavior implementation uses TDD.
- Next: Load test-driven-development; write valid and invalid input coverage before implementing the validation.
```

## Discuss — destructive op disguised as Direct

User: "Just drop the `users` table, it's unused."

```
Workflow Gate
- Route: Discuss
- Runtime skill: discuss-before-plan
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Decide whether and how to drop the `users` table safely.
- Signals: scope=multi-module; risk=high; destructive=yes; decisions=unresolved; user-intent=ship
- Assumptions: "Unused" is the user's unverified claim; no backup/migration plan stated.
- Next: Load discuss-before-plan; ask once for env + disuse evidence + safe-deprecation alternative before any DROP.
```

## Contradictory signals — "quick fix" on payment code

User: "Just a quick fix to the Stripe webhook handler — it's choking on refunds. Don't overthink it."

Rule #4 upgrades a high-risk payment bug to Discuss; Rule #10 surfaces the contradiction with the casual "quick fix" framing. The current request is diagnosis/repair, not an authorized irreversible payment mutation, so `destructive=no`.

```
Workflow Gate
- Route: Discuss
- Runtime skill: discuss-before-plan
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Decide the safe way to fix the Stripe webhook refund path.
- Signals: scope=few-files; risk=high; destructive=no; decisions=unresolved; user-intent=debug
- Assumptions: User framed this as "quick" but the surface area is payments; one wrong edit could lose money or refund the wrong customer.
- Next: Load discuss-before-plan; ask once for the failing payload + intended refund semantics before touching the handler.
```

## Re-gate trigger — destructive surfaces mid-Plan

You are implementing the OAuth integration plan (RFC-024) when you notice it calls for dropping the legacy `oauth_states` table to consolidate schema. That is a destructive signal that wasn't visible at gate time. **Re-run the gate before executing that task.**

```
Workflow Gate (re-gate)
- Route: Discuss
- Runtime skill: discuss-before-plan
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Decide the safe path for the oauth_states drop introduced inside the OAuth plan.
- Signals: scope=multi-module; risk=high; destructive=yes; decisions=unresolved; user-intent=plan
- Assumptions: Other RFC-024 tasks remain on the original Plan route; only the destructive task is being re-gated.
- Next: Load discuss-before-plan; confirm migration vs deprecation strategy, then resume the remaining plan tasks through the normal implementation workflow.
```

## Rule #3 mismatch — user named a skill that doesn't fit

User: "Run grilling on this — there's a typo on line 42 of App.tsx."

The user named `grilling`, but the work is a one-character typo fix. That's a clear Challenge-vs-Light mismatch. The gate flags the mismatch and asks one clarifying question (or, if "don't ask" was active, picks the most likely Route and records the user-named skill in `Assumptions`).

```
Workflow Gate
- Route: Light
- Runtime skill: none
- Fallback alias: none
- Execution path: direct local work
- Thesis: n/a
- Goal: Apply the typo fix on apps/web/src/App.tsx:42 (mismatch flag: user named `grilling`).
- Signals: scope=single-file; risk=low; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: User-named `grilling` doesn't fit a single-character fix; defaulting to Light and surfacing the mismatch before applying.
- Next: Confirm with one sentence ("This is a one-char fix; running grilling on it would be over-escalation — want me to just apply it?") and then edit.
```

Legacy mismatch: user says "use brainstorming for this typo" → same Light route; Assumptions note deprecated alias `brainstorming` mapped away (never load it).

## Challenge — replicate an existing UI (Creative-work HARD-GATE positive)

User: "结合 /Users/me/duiyun/.../pollo.ai/p/[slug] 的数据契约，把 https://youmind.com/zh-CN/video-prompts/japanese-classroom-romance-1402 这页按 Pollo 风格 1:1 复刻一下，适合走哪个流程？"

Even though the data contract exists and the visual target is concrete, this is creative UI work. Rule #2 fires: Challenge, not Plan. No thesis yet → agent-strawman + confirm before grilling.

```
Workflow Gate
- Route: Challenge
- Runtime skill: grilling
- Fallback alias: none
- Execution path: n/a
- Thesis: agent-strawman
- Goal: Design how to map the YouMind prompt-detail information architecture into a Pollo-styled detail page before writing code.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: Data contract exists, but the UI composition is creative work — Rule #2 requires Challenge before Plan. No design doc referenced.
- Next: Draft a short strawman thesis (layout / hierarchy / CTA / empty-state); wait for user confirmation; only then load grilling.
```

## Challenge — intentional behavior change (user thesis present)

User: "Dashboard 上加一个 Share 按钮，点击弹 modal；默认只给 workspace 成员，公开 link 先不做。"

```
Workflow Gate
- Route: Challenge
- Runtime skill: grilling
- Fallback alias: none
- Execution path: n/a
- Thesis: user-provided
- Goal: Stress-test workspace-only share modal thesis before implementation.
- Signals: scope=few-files; risk=low; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: Intentional new behavior on an existing screen counts as creative work under Rule #2.
- Next: Load grilling against the stated thesis.
```

## Challenge — user named writing-plans but no design doc (Rule #2 mismatch)

User: "Use writing-plans: redesign the existing homepage in an Airbnb style, but there is no design doc yet."

```
Workflow Gate
- Route: Challenge
- Runtime skill: grilling
- Fallback alias: none
- Execution path: n/a
- Thesis: agent-strawman
- Goal: Establish and stress-test homepage redesign direction before creating an implementation plan.
- Signals: scope=few-files; risk=medium; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: User named `writing-plans`, but this is creative redesign work and no design doc/spec is referenced; treating the named Plan-class skill as a mismatch under Rule #2.
- Next: Draft strawman thesis; confirm with user; then load grilling before any writing-plans handoff.
```

## Challenge vs Discuss — named options converge to Discuss

User: "计费要上：Stripe 和 Lemon Squeezy 两个选项都列出来了，定价档也有草案；直接出方案前先把该选哪个拍板。"

```
Workflow Gate
- Route: Discuss
- Runtime skill: discuss-before-plan
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Converge billing provider and pricing-tier decisions before planning.
- Signals: scope=multi-module; risk=high; destructive=no; decisions=unresolved; user-intent=decide
- Assumptions: Options are already named — bottleneck is converging, not widening.
- Next: Load discuss-before-plan.
```

## Challenge vs Discuss — still widening stays Challenge

User: "计费还没短名单：有哪些计费提供商/模式值得考虑？先从第一性原理把空间撑开，别急着拍板。"

```
Workflow Gate
- Route: Challenge
- Runtime skill: grilling
- Fallback alias: none
- Execution path: n/a
- Thesis: agent-strawman
- Goal: Widen the billing-provider and pricing-model space before shortlisting.
- Signals: scope=multi-module; risk=high; destructive=no; decisions=unresolved; user-intent=ideate
- Assumptions: No named shortlist yet — Challenge (widening), not Discuss.
- Next: Draft a short strawman framing of candidate dimensions; confirm; then load grilling.
```

## Plan — existing spec referenced (Rule #2 exception)

User: "按 docs/superpowers/specs/2026-05-12-share-modal-design.md 把 share modal 接到 apps/web。"

```
Workflow Gate
- Route: Plan
- Runtime skill: writing-plans
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Wire the share modal into apps/web per the referenced design doc.
- Signals: scope=few-files; risk=low; destructive=no; decisions=resolved; user-intent=plan
- Assumptions: docs/superpowers/specs/2026-05-12-share-modal-design.md is authoritative; Rule #2 exception fires (existing spec referenced) → skip Challenge.
- Next: Load writing-plans; produce a task breakdown grounded in the design doc.
```

## Light + test-driven-development — new utility function with spec-in-prompt (Rule #2 negative)

User: "在 utils.ts 加一个新的 export function calculateTotalPrice(items: Item[]): number that sums item.price \* item.qty"

```
Workflow Gate
- Route: Light
- Runtime skill: test-driven-development
- Fallback alias: superpowers:test-driven-development
- Execution path: test-driven-development
- Thesis: n/a
- Goal: Add calculateTotalPrice to utils.ts per the in-prompt signature and summing semantics.
- Signals: scope=single-file; risk=low; destructive=no; decisions=resolved; user-intent=implement
- Assumptions: Signature + summing semantics are spec-in-prompt → not Rule #2 creative work; TDD because new exported function has regression risk on future call sites.
- Next: Load test-driven-development; write a small table of (items, expected total) cases before coding.
```

## Light — typo fix is not creative work (Rule #2 negative)

User: "把 apps/web/src/App.tsx 第 42 行的 'recieve' 改成 'receive'。"

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
- Next: Edit the line; re-read the diff for verification.
```

## Architecture — missing scope asks one question

User: "帮我把架构问题扫一遍修干净。"

```
Workflow Gate
- Route: Architecture
- Runtime skill: none
- Fallback alias: none
- Execution path: n/a
- Thesis: n/a
- Goal: Determine a frozen path/module scope before any architecture diagnose or harden loop.
- Signals: scope=multi-module; risk=medium; destructive=no; decisions=unresolved; user-intent=implement
- Assumptions: No user-named path/module; cannot default to whole-repo.
- Next: Ask one scope question (which directories/modules, and diagnose-only vs harden-until-clean); do not load improve-codebase-architecture or architecture-hardening-loop yet.
```

## Light + "don't ask me" edge case

User: "Implement X, don't ask me, just go." (Two reasonable interpretations exist.)

```
Workflow Gate
- Route: Light
- Runtime skill: none
- Fallback alias: none
- Execution path: direct local work
- Thesis: n/a
- Goal: Implement X as the most natural reading of the request.
- Signals: scope=few-files; risk=low; destructive=no; decisions=unresolved; user-intent=implement
- Assumptions: Interpreting X as <chosen reading>; alternative <other reading> deferred — user opted out of confirmation.
- Next: Implement chosen reading; show the diff and flag the alternative so the user can redirect cheaply.
```

Note: "don't ask" does **not** waive Thesis confirm for Challenge `agent-strawman` unless the user explicitly waived thesis review. Put the strawman in Next and stop.
