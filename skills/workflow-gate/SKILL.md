---
name: workflow-gate
description: "Use BEFORE heavier workflow skills when route choice matters. Route creative work without a design doc/spec to Brainstorm; destructive or hard-to-reverse work to Discuss; unresolved decisions, planning, ship checks, unclear bugs, and fresh-eyes fix-then-re-review need this gate. Skip single-line read-only lookups, pure typo/formatting edits, trivial safe one-line fixes, and clearly safe named-skill requests. Outputs Route, Runtime skill, Fallback alias, and Execution path."
metadata:
  author: adonis
  version: "2.0.1"
---

# Workflow Gate

A reflex-fast router. Over-escalating burns minutes on obvious work; under-escalating creates rework or outages. Budget: 60–90s.

> **Last measured (2026-05-17, v2.0.1):** 71/71 collected runs PASS across eval IDs 11, 13, and 19-24 from the 24-eval set (eval runner: `pnpm skills:eval-grade workflow-gate <outputs-dir>`); trigger-rate 16/16 on the negative+positive prompt set; fast-path wall-clock median 9.2s across 5 fast-tagged runs.

**Fast path (default — meet the reflex budget):** read THIS file only and emit the block. The cheat card, 10 precedence rules, tiebreakers, output contract, and skill-name resolution table below are self-contained; for the vast majority of prompts you do NOT need to open any `references/*.md`. Target wall-clock ≤ 10s.

**Slow path (load references only if):** (a) you genuinely cannot pick a Route from the cheat card + precedence rules, or (b) the prompt mentions cross-ecosystem terms (superpowers vs addy/agent-skills) and you need the ecosystem boundary, or (c) you need a worked example whose closest match isn't obvious from the cheat card. Even then load at most ONE reference file. Loading all references for every prompt is the dominant speed regression — avoid it.

## Mandatory pre-routing overrides

Before the fast-skip checklist, cheat card, or user-named-skill rule, check Rule #1 and Rule #2 below. If either fires, stop there. The full destructive / creative gate definitions live only in the Precedence rules section to avoid drift.

## Fast-skip checklist

You may skip emitting the block **only** if all of these hold:

1. The request matches one narrow skip case:
   - single-line read-only lookup;
   - pure-formatting edit with no behavior change;
   - user named the exact downstream skill, AND that skill is (i) non-destructive per Rule #1, (ii) not a Plan-class skill named for creative-without-spec work per Rule #2, AND (iii) the request fits the named skill's stated scope (e.g. `coco-commit` for committing already-staged reviewed work, not `coco-commit` for "fix this bug and commit"). If any of (i)/(ii)/(iii) is uncertain in under 5 seconds, do not skip — emit the block.
2. The destructive override (Rule #1, canonical below) does not fire. If you cannot cheaply rule out destructive impact, do not skip the gate.
3. The answer fits in one line of prose.

For anything else, emit the block. If the user named a skill that clearly mismatches the request (e.g. "use brainstorming for this typo fix"), do NOT take the skip path — emit the block, set the appropriate Route, and flag the mismatch in `Assumptions`.

## Cheat card — scan first, exit early

| Route | Trigger keyword | Default Runtime skill | Default Execution path |
|---|---|---|---|
| **Direct** | read-only lookup, no write | `none` | `direct local work` |
| **Light** | small write / debug / docs / ship-check | `none` *(or `systematic-debugging` / `test-driven-development` via the rules below)* | `direct local work` |
| **Brainstorm** | creative work — full trigger list in Rule #2; fires even when scope=few-files and decisions=resolved. Also "options / tradeoffs / first principles" framing. | `brainstorming` | `n/a` |
| **Discuss** | "Stripe vs X / decide before plan" | `discuss-before-plan` | `n/a` |
| **Plan** | RFC/spec ready or broad resolved scope | `writing-plans` | `n/a` |
| **Review-Handoff** | "fresh eyes / fix-then-re-review" | `agentic-review-handoff` | `n/a` |

One row fits → emit the block. Multiple fire → use precedence below. Route adjustments (Upgrade / Downgrade / Re-gate / Light's Execution-path upgrades) live in `references/route-adjustments.md` — consult when the cheat card doesn't fit, or before emitting a Light route with debug / ship / behavior-regression signals. Use `references/workflow-systems.md` when you need the ecosystem / phase boundary between superpowers, `discuss-before-plan`, and addyosmani/agent-skills.

## Precedence rules — earlier overrides later

1. **`destructive=yes`** — **reversibility test**: if the action is hard to undo, set `destructive=yes` and route to minimum **Discuss**. Covers the literal list (drop table, force push, delete prod data, schema break, public API removal) AND any irreversible mutation not in the keyword list (billing mutation, irreversible external API call, broadcast send, migration that drops state). Flag the reversibility cost in `Assumptions`. Overrides every rule below, including a user-named skill and Fast-skip.
2. **Creative-work HARD-GATE** — new feature / screen / component, UI replication / 复刻, redesign, composed UI, or intentional behavior change.
   - No explicit design doc / spec reference → **Brainstorm** immediately. Do not continue to Rule #3, do not respect Plan-class skill names, and do not produce a discovery-first Plan.
   - Bug repair / failing test / build error / regression on existing behavior is not creative work; let Rule #4 handle it.
   - **Not creative work either:** a new exported function, util, endpoint, or API whose name + full signature + behavior are already specified in the prompt. The design decision is paid by the spec-in-prompt. Route **Light** + `test-driven-development` (behavior change with regression risk). Only escalate to Brainstorm if the signature is vague, the API surface affects 3+ consumers, or naming is contested.
   - Spec/design references that skip Brainstorm: `docs/superpowers/specs/*-design.md`, `docs/ideas/*.md`, `docs/rfcs/*.md`, `docs/forms/*-spec.md`, `designs/**/*.md`, or an explicit spec/design name or path. Note the reference in `Assumptions`.
   - After a spec/design reference, route by requested next action: **Plan** for task breakdown (including broad multi-context work), or **Light** + `test-driven-development` for direct few-file implementation.
3. **User named a downstream skill** (and Rules #1 / #2 didn't fire) → respect it; only flag a clear mismatch.
4. **Bug / failing test / build / CI failure / unexpected behavior / perf symptom** → **Light** + `Runtime skill: systematic-debugging` + `Execution path: systematic-debugging`. Upgrade to **Discuss** if scope is multi-module OR `risk=high` (payments / auth / production data).
5. **"Done? / ready to commit / ship this"** → **Light** + `Runtime skill: none` + `Fallback alias: none` + `Execution path: direct local work`. Run the relevant full verification command in the current turn, read its output and exit status, and cite that evidence before any completion claim. If the user explicitly asks for persona fan-out / security + test + review coverage, flag the unsupported fan-out in `Assumptions` and perform the available checks directly.
6. **Cross-agent / fix-then-re-review** → **Review-Handoff**. Mutually exclusive with #2/#4/#5/#7/#8/#10 — replaces any of them. Rule #1 (destructive) still overrides per the tiebreaker.
7. **"Options / tradeoffs / first principles"** → **Brainstorm**.
8. **Decisions unresolved (provider / architecture / data model / API)** → **Discuss**.
9. **Contradictory signals** (e.g. "quick fix" + "production payments") → higher-risk route; record contradiction in `Assumptions`.
10. **Otherwise** → scope-based pick from the cheat card.

### Execution-path upgrades inside Light (hot path — inline here, not in references)

Light's default Execution path is `direct local work`. Upgrade the Execution path (not the Route) when:

- **Regression risk on a behavior change** → `Runtime skill: test-driven-development`, `Fallback alias: superpowers:test-driven-development`, `Execution path: test-driven-development`.
- **Symptom-first investigation (bug / failing test / build error)** → `Runtime skill: systematic-debugging`, `Execution path: systematic-debugging`.
- **"Done / ready to ship" claim** → `Runtime skill: none`, `Fallback alias: none`, `Execution path: direct local work`; fresh command output is still mandatory before any completion claim.


### Tiebreakers — only the non-obvious pairs

Rule #1 (destructive) is the canonical override and wins against every other rule when in conflict; the rows below cover the remaining non-obvious pairs.

| When both fire | Pick | Why |
|---|---|---|
| Rule #1 (destructive) and Rule #2 (creative work) | **Discuss** if the design step itself touches the destructive surface (any keystroke in this turn could trigger irreversible action — typed-confirm flows, account-export, billing modal logic). **Brainstorm + explicit re-gate** if the design phase is provably non-executing (pure UI sketching, no API/data calls planned in this turn) — Assumptions MUST mark the destructive surface and note re-gating against Rule #1 at implementation time. | Design-only work doesn't trigger destruction, but the discussion must converge before any executing step ships. |
| Rule #4 (bug) and Rule #5 (ship) | Rule #4 first; ship re-fires after the bug closes. | Don't ship a known-failing change. |
| Rule #7 (Brainstorm) and Rule #8 (Discuss) | Brainstorm if options unknown; Discuss if options exist and decisions are the bottleneck. | Widening vs narrowing the space. |
| Rule #3 (user named `writing-plans`) and Rule #2 (creative work, no spec) | Brainstorm. Record the named skill as a mismatch in `Assumptions`. | A Plan-class skill cannot substitute for the missing design gate. |
| Rule #2 exception (spec referenced) and Light's behavior-risk upgrade | Light + `test-driven-development` when the user says "directly implement" and the change is a few files. | The spec only skips Brainstorm; it does not force a planning ceremony for a small implementation. |
| Rule #1 (destructive) and any of #3 / #6 (user-named, Review-Handoff) | Rule #1 always. Record the user's named skill or review intent in `Assumptions`; the review or named load happens after the destructive issue is resolved through Discuss. | Outage / data loss can't be undone by reviewing or naming around it. |

**Authority boundary:** this gate is advisory, not a runtime permission override. Higher-priority system/user instructions and downstream skills with true `MUST` triggers still apply. If a downstream `MUST` skill is required by the selected Route or by runtime trigger rules, name it as the Runtime skill and load it next instead of treating the gate result as permission to bypass it.

## Budget

- Reading this doc once should take ≤ 30 seconds; producing the block another ≤ 60. The gate must feel like a reflex.
- Decide from the prompt alone; glance at one cheap repo signal only if it would flip the Route.
- Do not load another skill while deciding the Route; after emitting the block, load the selected Runtime skill if it is not `none`.
- Output cap: ≤ 9 lines for Direct, ≤ 13 lines otherwise.
- Ask at most one blocking question. If the user said "don't ask", commit to the most likely Route and put the unverified premise in `Assumptions`.

## Output format

```text
Workflow Gate
- Route: <Direct | Light | Brainstorm | Discuss | Plan | Review-Handoff>
- Runtime skill: <none | bare-slug>
- Fallback alias: <none | superpowers:bare-slug>
- Execution path: <direct local work | systematic-debugging | test-driven-development | n/a>
- Goal: <one sentence>
- Signals: scope=<single-file | few-files | multi-module>; risk=<low | medium | high>; destructive=<no | yes>; decisions=<resolved | unresolved>; user-intent=<ideate | decide | plan | implement | debug | review | ship>
- Assumptions: <none | explicit unverified premises>
- Next: <what you will do immediately after this block>
```

`Route` and `Runtime skill` lead because every downstream reader acts on them. `Runtime skill` is the single skill to load next and must stay one bare token (`none` or one slug); `Fallback alias` is metadata for runtimes that cannot resolve that bare token. `Execution path` is the implementation pattern once code is being written (`n/a` when no code yet). They may match for skills that are both the workflow and the implementation pattern, such as `systematic-debugging` and `test-driven-development`. `risk` and `destructive` are separate enums because they answer different questions: blast-radius vs reversibility.

**Skill name resolution.** Most skills resolve as bare slugs in both Codex (`~/.agents/skills/`) and Claude Code (`~/.claude/skills/` + project mirror). Two skills are intentionally not mirrored to `~/.claude/skills/` because they live under the `superpowers:` plugin namespace. For those, keep `Runtime skill` as the bare slug and put the plugin name in `Fallback alias`. Codex should load `Runtime skill`; Claude Code should try `Runtime skill` first and, if it is unavailable, load `Fallback alias`.

**Resolution-failure fallback.** If neither `Runtime skill` nor `Fallback alias` resolves in the current runtime, do NOT proceed with the emitted Route. Surface the load error to the user with the attempted slug, then re-gate by downgrading to the smallest safe Route that doesn't require the missing skill (typically Light + `direct local work`, or Discuss if the original task was non-trivial) and emit a fresh block. Stale routing into a non-existent skill silently breaks the downstream workflow.

| Bare slug | Plugin alias | Emit fields |
|---|---|---|
| `brainstorming` | `superpowers:brainstorming` | `Runtime skill: brainstorming` + `Fallback alias: superpowers:brainstorming` |
| `test-driven-development` | `superpowers:test-driven-development` | `Runtime skill: test-driven-development` + `Fallback alias: superpowers:test-driven-development` |

All other skills (`discuss-before-plan`, `agentic-review-handoff`, `writing-plans`, `systematic-debugging`) are emitted as bare slugs with `Fallback alias: none` — they exist as bare entries in both runtimes.

## Guardrails

- Smallest Route that still protects correctness.
- Route first, then load only the one Runtime skill you picked; use Fallback alias only if the current runtime cannot resolve that bare slug.
- At most one blocking question.
- Never create scripts, evals, references, or persistent artifacts from this skill alone — that belongs to the workflow that runs next.

Worked output blocks live in two reference files: `references/examples-core.md` has one example per Route (Direct / Light / Brainstorm / Discuss / Plan / Review-Handoff) and is the default lookup. `references/examples-edge.md` covers tiebreakers, mismatches, Rule #2 negatives, re-gating, contradictory-signal handling, and "don't ask me" — load it only when core doesn't cover the prompt.
