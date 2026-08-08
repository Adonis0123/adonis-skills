---
name: workflow-gate
description: "Use BEFORE heavier workflow skills when route choice matters. Route creative work without a design doc/spec to Challenge (grilling; Thesis confirm when agent-strawman); named-option convergence and destructive or hard-to-reverse work to Discuss; architecture diagnose/harden to Architecture; planning, ship checks, unclear bugs, and fresh-eyes fix-then-re-review also need this gate. Hand off an explicit whole task-completion pipeline directly to task-completion-loop after safety overrides. Skip single-line read-only lookups, pure formatting, trivial safe fixes, and clearly safe named-skill requests. Outputs Route, Runtime skill, Fallback alias, Execution path, and Thesis."
metadata:
  author: adonis
  version: "3.2.0"
---

# Workflow Gate

A reflex-fast router. Over-escalating burns minutes on obvious work; under-escalating creates rework or outages. Budget: 60–90s.

> **Measured (2026-08-08, v3 migration):** six curated route cases, one run per current/old configuration: current skill 100% vs v2.0.1 snapshot 44%. Timing and token data were unavailable, so this is routing evidence, not performance evidence. Re-run broader evals before making general trigger or latency claims.

**Fast path (default — meet the reflex budget):** read THIS file only and emit the block. The cheat card, precedence rules, tiebreakers, output contract, and skill-name resolution table below are self-contained; for the vast majority of prompts you do NOT need to open any `references/*.md`. Target wall-clock ≤ 10s.

**Slow path (load references only if):** (a) you genuinely cannot pick a Route from the cheat card + precedence rules, or (b) the prompt mentions cross-ecosystem terms (superpowers vs mattpocock vs addy/agent-skills) and you need the ecosystem boundary, or (c) you need a worked example whose closest match isn't obvious from the cheat card. Even then load at most ONE reference file. Loading all references for every prompt is the dominant speed regression — avoid it.

## Mandatory pre-routing overrides

Before the fast-skip checklist, cheat card, or user-named-skill rule, check Rule #1 and Rule #2 below. If either fires, stop there. The full destructive / creative gate definitions live only in the Precedence rules section to avoid drift.

## Full-completion downstream handoff

After Rules #1 and #2 clear, skip this gate's Route block and load `task-completion-loop` directly when the request either names it or unmistakably asks for its **whole** pipeline: an existing named plan/spec or bounded unfinished task, one work ledger, real host + Grok + Claude convergence, Goal-managed implementation, agentic review, scoped architecture hardening, and a fresh final Claude audit. This is a downstream `MUST` handoff, not a new Route enum.

Do not use this handoff for ordinary "finish and test it", Goal-only execution, review-fix-re-review alone, or architecture hardening alone; route those normally. `task-completion-loop` owns its recursive capability preflight and may return `MISSING_DEPENDENCIES`. A skill file on disk is not sufficient: invocation policy and real host capabilities must also permit every nested dependency.

## Fast-skip checklist

You may skip emitting the block **only** if all of these hold:

1. The request matches one narrow skip case:
   - single-line read-only lookup;
   - pure-formatting edit with no behavior change;
   - user named the exact downstream skill, AND that skill is (i) non-destructive per Rule #1, (ii) not a Plan-class skill named for creative-without-spec work per Rule #2, AND (iii) the request fits the named skill's stated scope (e.g. `coco-commit` for committing already-staged reviewed work, not `coco-commit` for "fix this bug and commit"). If any of (i)/(ii)/(iii) is uncertain in under 5 seconds, do not skip — emit the block.
2. The destructive override (Rule #1, canonical below) does not fire. If you cannot cheaply rule out destructive impact, do not skip the gate.
3. The answer fits in one line of prose.

For anything else, emit the block. If the user named a skill that clearly mismatches the request (e.g. "use grilling for this typo fix" or legacy "use brainstorming for this typo fix"), do NOT take the skip path — emit the block, set the appropriate Route, and flag the mismatch in `Assumptions`.

**Deprecated input alias:** if the user says `Brainstorm` / `brainstorming`, treat that as a request for **Challenge** (not as a Runtime skill to load). Record the alias in `Assumptions`. Never load `brainstorming` — it is not part of this gate's runtime.

## Cheat card — scan first, exit early

| Route              | Trigger keyword                                                                                                                                                                          | Default Runtime skill                                                                                       | Default Execution path |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Direct**         | read-only lookup, no write                                                                                                                                                               | `none`                                                                                                      | `direct local work`    |
| **Light**          | small write / debug / docs / ship-check                                                                                                                                                  | `none` _(or `systematic-debugging` / `test-driven-development` via the rules below)_                        | `direct local work`    |
| **Challenge**      | creative work — full trigger list in Rule #2; also "options / tradeoffs / first principles" widening. Requires a thesis (user-provided or agent-strawman + user confirm) before grilling | `grilling` _(or `grill-with-docs` when ADR/glossary persistence is needed)_                                 | `n/a`                  |
| **Discuss**        | "Stripe vs X / decide before plan" — named options, bottleneck is converging                                                                                                             | `discuss-before-plan`                                                                                       | `n/a`                  |
| **Plan**           | RFC/spec ready or broad resolved scope                                                                                                                                                   | `writing-plans`                                                                                             | `n/a`                  |
| **Architecture**   | existing-code structure pain; diagnose vs bounded harden loop                                                                                                                            | `improve-codebase-architecture` _(diagnose)_ or `architecture-hardening-loop` _(scoped + implement intent)_ | `n/a`                  |
| **Review-Handoff** | "fresh eyes / fix-then-re-review"                                                                                                                                                        | `agentic-review-handoff`                                                                                    | `n/a`                  |

One row fits → emit the block. Multiple fire → use precedence below. Route adjustments live in `references/route-adjustments.md`. Use `references/workflow-systems.md` for ecosystem / phase boundaries among grilling (mattpocock), `discuss-before-plan`, obra debug/TDD/plan skills, and addyosmani/agent-skills.

## Precedence rules — earlier overrides later

1. **`destructive=yes`** — **reversibility test for this turn's authorized action**: if work in the current turn can perform or directly alter an irreversible mutation, set `destructive=yes` and route to minimum **Discuss**. Covers the literal list (drop table, force push, delete prod data, schema break, public API removal) AND irreversible mutations not in the keyword list (billing mutation, external API call, broadcast send, migration that drops state). A purely non-executing design request about a future destructive surface is `destructive=no; risk=high`; route it normally and require a Rule #1 re-gate before implementation. Flag the reversibility cost in `Assumptions`. `destructive=yes` overrides every rule below, including a user-named skill and Fast-skip.
2. **Creative-work HARD-GATE** — new feature / screen / component, UI replication / 复刻, redesign, composed UI, or intentional behavior change.
   - Classify the user's **immediate job**, not the eventual feature. If the current request is to converge among already named options, continue to Rule #8 and route **Discuss**; feature context alone does not turn option selection into Challenge.
   - No explicit design doc / spec reference → **Challenge** immediately. Do not continue to Rule #3, do not respect Plan-class skill names, and do not produce a discovery-first Plan.
   - Set `Thesis:`:
     - `user-provided` when the user already stated a concrete thesis / preferred approach;
     - `agent-strawman` when no thesis exists — Next must draft a short strawman and **wait for user confirmation before loading grilling / grill-with-docs** (S1). Do not self-grill an unconfirmed strawman.
   - Runtime: default `grilling`. Use `grill-with-docs` when the user wants ADRs, glossary, or other durable design docs written during the challenge.
   - Bug repair / failing test / build error / regression on existing behavior is not creative work; let Rule #4 handle it.
   - **Not creative work either:** a new exported function, util, endpoint, or API whose name + full signature + behavior are already specified in the prompt. The design decision is paid by the spec-in-prompt. Route **Light** + `test-driven-development` (behavior change with regression risk). Only escalate to Challenge if the signature is vague, the API surface affects 3+ consumers, or naming is contested.
   - Spec/design references that skip Challenge: `docs/superpowers/specs/*-design.md`, `docs/ideas/*.md`, `docs/rfcs/*.md`, `docs/forms/*-spec.md`, `designs/**/*.md`, or an explicit spec/design name or path. Note the reference in `Assumptions`.
   - After a spec/design reference, route by requested next action: **Plan** for task breakdown (including broad multi-context work), or **Light** + `test-driven-development` for direct few-file implementation.
3. **User named a downstream skill** (and Rules #1 / #2 didn't fire) → respect it; only flag a clear mismatch. Naming an Architecture scanner does not bypass Rule #9's explicit-scope gate: without a user-named path/module, keep `Runtime skill: none`, ask for scope, and stop. Legacy name `brainstorming` maps to Challenge per the deprecated-alias rule above — do not load that skill.
4. **Bug / failing test / build / CI failure / unexpected behavior / perf symptom** → **Light** + `Runtime skill: systematic-debugging` + `Execution path: systematic-debugging`. Upgrade to **Discuss** if scope is multi-module OR `risk=high` (payments / auth / production data).
5. **"Done? / ready to commit / ship this"** → **Light** + `Runtime skill: none` + `Fallback alias: none` + `Execution path: direct local work`. Run the relevant full verification command in the current turn, read its output and exit status, and cite that evidence before any completion claim. If the user explicitly asks for persona fan-out / security + test + review coverage, flag the unsupported fan-out in `Assumptions` and perform the available checks directly.
6. **Cross-agent / fix-then-re-review** → **Review-Handoff**. Mutually exclusive with #2/#4/#5/#7/#8/#10/#11 — replaces any of them. Rule #1 (destructive) still overrides per the tiebreaker.
7. **"Options / tradeoffs / first principles" widening** (option space not yet shortlisted) → **Challenge** (same Thesis rules as Rule #2).
8. **Decisions unresolved with named options** (provider / architecture choice / data model / API — bottleneck is converging) → **Discuss**.
9. **Architecture on existing code** — structure pain, deepening, module boundaries, "scan then harden", architecture cleanup in a named path/module.
   - User gave an explicit path / directory / module set **and** asked only to diagnose / report / explore → **Architecture** + `improve-codebase-architecture` (stop after report; do not enter fix loop).
   - User gave an explicit path / directory / module set **and** asked to implement / harden / scan-fix-review until clean → **Architecture** + `architecture-hardening-loop`.
   - Scope missing or not a user-named path/module → emit **Architecture** + `Runtime skill: none` + `Execution path: n/a`, ask one scope question, and stop; do not default to whole-repo or load either scanner.
   - Has a failing test / CI symptom → Rule #4 wins (debug first). Has fix-then-re-review of a diff → Rule #6 wins.
10. **Contradictory signals** (e.g. "quick fix" + "production payments") → higher-risk route; record contradiction in `Assumptions`.
11. **Otherwise** → scope-based pick from the cheat card.

### Execution-path upgrades inside Light (hot path — inline here, not in references)

Light's default Execution path is `direct local work`. Upgrade the Execution path (not the Route) when:

- **Regression risk on a behavior change** → `Runtime skill: test-driven-development`, `Fallback alias: superpowers:test-driven-development`, `Execution path: test-driven-development`.
- **Symptom-first investigation (bug / failing test / build error)** → `Runtime skill: systematic-debugging`, `Execution path: systematic-debugging`.
- **"Done / ready to ship" claim** → `Runtime skill: none`, `Fallback alias: none`, `Execution path: direct local work`; fresh command output is still mandatory before any completion claim.

### Tiebreakers — only the non-obvious pairs

Rule #1 (destructive) is the canonical override and wins against every other rule when in conflict; the rows below cover the remaining non-obvious pairs.

| When both fire                                                            | Pick                                                                                                                                                                                                                                                                                 | Why                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Future destructive surface and Rule #2 creative work                      | For a provably non-executing design turn, set `destructive=no; risk=high`, pick **Challenge**, and require an explicit Rule #1 re-gate before implementation. If this turn can execute or directly alter irreversible behavior, set `destructive=yes` and Rule #1 picks **Discuss**. | `destructive` describes the current authorized action; future blast radius stays visible through `risk` and re-gating. |
| Rule #4 (bug) and Rule #5 (ship)                                          | Rule #4 first; ship re-fires after the bug closes.                                                                                                                                                                                                                                   | Don't ship a known-failing change.                                                                                     |
| Rule #7 (Challenge widening) and Rule #8 (Discuss)                        | Challenge if options unknown / space still open; Discuss if named options exist and decisions are the bottleneck.                                                                                                                                                                    | Widening vs narrowing the space.                                                                                       |
| Rule #3 (user named `writing-plans`) and Rule #2 (creative work, no spec) | Challenge. Record the named skill as a mismatch in `Assumptions`.                                                                                                                                                                                                                    | A Plan-class skill cannot substitute for the missing design gate.                                                      |
| Rule #2 exception (spec referenced) and Light's behavior-risk upgrade     | Light + `test-driven-development` when the user says "directly implement" and the change is a few files.                                                                                                                                                                             | The spec only skips Challenge; it does not force a planning ceremony for a small implementation.                       |
| Rule #1 (destructive) and any of #3 / #6 (user-named, Review-Handoff)     | Rule #1 always. Record the user's named skill or review intent in `Assumptions`; the review or named load happens after the destructive issue is resolved through Discuss.                                                                                                           | Outage / data loss can't be undone by reviewing or naming around it.                                                   |
| Rule #9 (Architecture) and Rule #4 (bug)                                  | Rule #4 first.                                                                                                                                                                                                                                                                       | Fix the symptom before architecture loops.                                                                             |
| Rule #9 (Architecture) and Rule #6 (Review-Handoff)                       | Rule #6 when the ask is fix-then-re-review of a diff; otherwise Architecture.                                                                                                                                                                                                        | Review packets are not architecture scanners.                                                                          |
| Rule #9 diagnose vs harden                                                | After path/module scope is explicit, harden only when the user asked to implement/harden/loop-until-clean; otherwise diagnose. With missing scope, use Rule #9's `Architecture + Runtime skill: none` stop.                                                                          | Prevents accidental heavy loops and whole-repo scans.                                                                  |

**Authority boundary:** this gate is advisory, not a runtime permission override. Higher-priority system/user instructions and downstream skills with true `MUST` triggers still apply. If a downstream `MUST` skill is required by the selected Route or by runtime trigger rules, name it as the Runtime skill and load it next instead of treating the gate result as permission to bypass it.

## Budget

- Reading this doc once should take ≤ 30 seconds; producing the block another ≤ 60. The gate must feel like a reflex.
- Decide from the prompt alone; glance at one cheap repo signal only if it would flip the Route.
- Do not load another skill while deciding the Route; after emitting the block, load the selected Runtime skill if it is not `none` **and** Thesis gates allow it (`agent-strawman` waits for confirm first).
- Output cap: ≤ 10 lines for Direct, ≤ 14 lines otherwise.
- Ask at most one blocking question. If the user said "don't ask", commit to the most likely Route and put the unverified premise in `Assumptions` — but still do not load grilling on an unconfirmed `agent-strawman` Thesis; put the strawman in `Next` and stop for confirm unless the user already waived thesis review explicitly.

## Output format

```text
Workflow Gate
- Route: <Direct | Light | Challenge | Discuss | Plan | Architecture | Review-Handoff>
- Runtime skill: <none | bare-slug>
- Fallback alias: <none | superpowers:bare-slug>
- Execution path: <direct local work | systematic-debugging | test-driven-development | n/a>
- Thesis: <n/a | user-provided | agent-strawman>
- Goal: <one sentence>
- Signals: scope=<single-file | few-files | multi-module>; risk=<low | medium | high>; destructive=<no | yes>; decisions=<resolved | unresolved>; user-intent=<ideate | decide | plan | implement | debug | review | ship>
- Assumptions: <none | explicit unverified premises>
- Next: <what you will do immediately after this block>
```

`Thesis` is `n/a` except on **Challenge** (required) and optionally noted when a Challenge re-gate is pending. `Route` and `Runtime skill` lead because every downstream reader acts on them. `Runtime skill` is the single skill to load next and must stay one bare token (`none` or one slug); `Fallback alias` is metadata for runtimes that cannot resolve that bare token. `Execution path` is the implementation pattern once code is being written (`n/a` when no code yet). They may match for skills that are both the workflow and the implementation pattern, such as `systematic-debugging` and `test-driven-development`. `risk` and `destructive` are separate enums because they answer different questions: blast-radius vs reversibility.

**Skill name resolution.** Most skills resolve as bare slugs in both Codex (`~/.agents/skills/`) and Claude Code (`~/.claude/skills/` + project mirror). One skill is intentionally not mirrored to `~/.claude/skills/` because it lives under the `superpowers:` plugin namespace. For that, keep `Runtime skill` as the bare slug and put the plugin name in `Fallback alias`. Codex should load `Runtime skill`; Claude Code should try `Runtime skill` first and, if it is unavailable, load `Fallback alias`.

**Resolution / invocation failure.** Before loading the selected runtime, confirm both name resolution and invocation eligibility. `disable-model-invocation: true` or `allow_implicit_invocation: false` means unavailable for an implicit handoff unless the user explicitly named that dependency and the host permits it. If the Route's semantics depend on that skill (Challenge, Discuss, Plan, Architecture, Review-Handoff, or the full-completion handoff), emit the failure block below and stop; never silently imitate or downgrade the workflow to direct work. Only a Route already classified as optional Light tooling may re-gate to direct local work when doing so preserves the user's requested semantics.

```text
Workflow Gate Failure
- Result: MISSING_DEPENDENCIES
- Intended route: <Challenge | Discuss | Plan | Architecture | Review-Handoff | task-completion-loop handoff>
- Missing: <bare slug + resolution or invocation-policy reason>
- Work started: no
- Next: <install/enable explicitly, or choose a different user-authorized workflow>
```

`MISSING_DEPENDENCIES` is never a `Route` value. Do not emit a normal Route block after this failure block.

| Bare slug                 | Plugin alias                          | Emit fields                                                                                      |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `test-driven-development` | `superpowers:test-driven-development` | `Runtime skill: test-driven-development` + `Fallback alias: superpowers:test-driven-development` |

All other skills (`grilling`, `grill-with-docs`, `discuss-before-plan`, `agentic-review-handoff`, `writing-plans`, `systematic-debugging`, `improve-codebase-architecture`, `architecture-hardening-loop`) are emitted as bare slugs with `Fallback alias: none` when the current host exposes them. Installation alone does not override invocation policy.

## Guardrails

- Smallest Route that still protects correctness.
- Route first, then load only the one Runtime skill you picked; use Fallback alias only if the current runtime cannot resolve that bare slug.
- At most one blocking question (plus the Thesis confirm stop for `agent-strawman`).
- Never create scripts, evals, references, or persistent artifacts from this skill alone — that belongs to the workflow that runs next.
- Never load `brainstorming`.

Worked output blocks live in two reference files: `references/examples-core.md` has one example per Route (Direct / Light / Challenge / Discuss / Plan / Architecture / Review-Handoff) and is the default lookup. `references/examples-edge.md` covers tiebreakers, mismatches, Rule #2 negatives, Thesis S1, Architecture diagnose vs harden, re-gating, contradictory-signal handling, and "don't ask me" — load it only when core doesn't cover the prompt.
