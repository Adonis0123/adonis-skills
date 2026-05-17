---
name: workflow-gate
description: "Use BEFORE loading heavier workflow skills (brainstorming, discuss-before-plan, writing-plans, subagent-driven-development, agentic-review-handoff, executing-plans, finishing-a-development-branch) when the route is not already obvious. A 60-90 second advisory classifier that prevents over-escalation and under-escalation. Outputs one Route, one single-token Runtime skill to load next, one optional Fallback alias for Claude/Codex compatibility, and one Execution path. Creative work (new feature / UI replicate / redesign / intentional behavior change) without a referenced design doc or spec MUST route to Brainstorm, even when the user names writing-plans or asks which workflow to use. Skip the gate ONLY for single-line read-only lookups, pure-formatting edits with no behavior change, an explicitly named downstream skill that is already safe and non-destructive, or trivial one-line fixes such as a single-file debug log, a one-line type narrowing, or an isolated typo / micro-bug patch with no cross-file or public-interface impact."
metadata:
  author: adonis
  version: "1.9.0"
---

# Workflow Gate

A reflex-fast router. Over-escalating burns minutes on obvious work; under-escalating creates rework or outages.

**Fast path (default — meet the reflex budget):** read THIS file only and emit the block. The cheat card, 9 precedence rules, tiebreakers, output contract, and skill-name resolution table below are self-contained; for the vast majority of prompts you do NOT need to open any `references/*.md`. Target wall-clock ≤ 10s.

**Slow path (load references only if):** (a) you genuinely cannot pick a Route from the cheat card + precedence rules, or (b) the prompt mentions cross-ecosystem terms (superpowers vs addy/agent-skills) and you need the ecosystem boundary, or (c) you need a worked example whose closest match isn't obvious from the cheat card. Even then load at most ONE reference file. Loading all references for every prompt is the dominant speed regression — avoid it.

## Mandatory pre-routing overrides

Before the fast-skip checklist, cheat card, or user-named-skill rule, check Rule #1 and Rule #1.5 below. If either fires, stop there. The full destructive / creative gate definitions live only in the Precedence rules section to avoid drift.

## Fast-skip checklist

You may skip emitting the block **only** if all of these hold:

1. The request matches one narrow skip case:
   - single-line read-only lookup;
   - pure-formatting edit with no behavior change;
   - user named the exact downstream skill, and it is cheaply safe, non-destructive, and not mismatched.
2. The destructive override (Rule #1, canonical below) does not fire. If you cannot cheaply rule out destructive impact, do not skip the gate.
3. The answer fits in one line of prose.

For anything else, emit the block. If the user named a skill that clearly mismatches the request (e.g. "use brainstorming for this typo fix"), do NOT take the skip path — emit the block, set the appropriate Route, and flag the mismatch in `Assumptions`.

## Cheat card — scan first, exit early

| Route | Trigger keyword | Default Runtime skill | Default Execution path |
|---|---|---|---|
| **Direct** | read-only lookup, no write | `none` | `direct local work` |
| **Light** | small write / debug / docs / ship-check | `none` *(or `systematic-debugging` / `test-driven-development` / `verification-before-completion` via the rules below)* | `direct local work` |
| **Brainstorm** | creative work — full trigger list in Rule #1.5; fires even when scope=few-files and decisions=resolved. Also "options / tradeoffs / first principles" framing. | `brainstorming` | `n/a` |
| **Discuss** | "Stripe vs X / decide before plan" | `discuss-before-plan` | `n/a` |
| **Plan** | RFC ready, ≤ 2 bounded contexts | `writing-plans` | `executing-plans` |
| **Full** | ≥ 3 bounded contexts AND parallelizable | `writing-plans` | `subagent-driven-development` |
| **Review-Handoff** | "fresh eyes / fix-then-re-review" | `agentic-review-handoff` | `n/a` |

One row fits → emit the block. Multiple fire → use precedence below. Route adjustments (Upgrade / Downgrade / Re-gate / Light's Execution-path upgrades) live in `references/route-adjustments.md` — consult when the cheat card doesn't fit, or before emitting a Light route with debug / ship / behavior-regression signals. Use `references/workflow-systems.md` when you need the ecosystem / phase boundary between superpowers, `discuss-before-plan`, and addyosmani/agent-skills.

## Precedence rules — earlier overrides later

1. **`destructive=yes`** (drop table, force push, delete prod data, schema break, public API removal) → minimum **Discuss**. Overrides every rule below, including a user-named skill and Fast-skip. The literal trigger list is the *reversibility* test: if the action is hard to undo (billing mutation, irreversible external API call, broadcast send, migration that drops state), treat as destructive even if it isn't on the keyword list — set `destructive=yes` and flag the reversibility cost in `Assumptions`.
1.5. **Creative-work HARD-GATE** — new feature / screen / component, UI replication / 复刻, redesign, composed UI, or intentional behavior change.
   - No explicit design doc / spec reference → **Brainstorm** immediately. Do not continue to Rule #2, do not respect Plan-class skill names, and do not produce a discovery-first Plan.
   - Bug repair / failing test / build error / regression on existing behavior is not creative work; let Rule #3 handle it.
   - Spec/design references that skip Brainstorm: `docs/superpowers/specs/*-design.md`, `docs/ideas/*.md`, `docs/rfcs/*.md`, `docs/forms/*-spec.md`, `designs/**/*.md`, or an explicit spec/design name or path. Note the reference in `Assumptions`.
   - After a spec/design reference, route by requested next action: **Plan** for task breakdown, **Light** + `test-driven-development` for direct few-file implementation, **Full** for 3+ parallel bounded contexts.
2. **User named a downstream skill** (and Rules #1 / #1.5 didn't fire) → respect it; only flag a clear mismatch.
3. **Bug / failing test / build / CI failure / unexpected behavior / perf symptom** → **Light** + `Runtime skill: systematic-debugging` + `Execution path: systematic-debugging`. Upgrade to **Discuss** if scope is multi-module OR `risk=high` (payments / auth / production data).
4. **"Done? / ready to commit / ship this"** → **Light** + `Runtime skill: verification-before-completion` + `Fallback alias: superpowers:verification-before-completion` + `Execution path: n/a` (then `finishing-a-development-branch` if branch integration). If the user explicitly asks for persona fan-out / security + test + review coverage, still use this route for now but flag the missing fan-out bridge in `Assumptions` (see `references/workflow-systems.md`).
5. **Cross-agent / fix-then-re-review** → **Review-Handoff**. Mutually exclusive with #1.5/#3/#4/#6/#7/#9 — replaces any of them. Rule #1 (destructive) still overrides per the tiebreaker.
6. **"Options / tradeoffs / first principles"** → **Brainstorm**.
7. **Decisions unresolved (provider / architecture / data model / API)** → **Discuss**.
8. **Contradictory signals** (e.g. "quick fix" + "production payments") → higher-risk route; record contradiction in `Assumptions`.
9. **Otherwise** → scope-based pick from the cheat card.

### Execution-path upgrades inside Light (hot path — inline here, not in references)

Light's default Execution path is `direct local work`. Upgrade the Execution path (not the Route) when:

- **Regression risk on a behavior change** → `Runtime skill: test-driven-development`, `Fallback alias: superpowers:test-driven-development`, `Execution path: test-driven-development`.
- **Symptom-first investigation (bug / failing test / build error)** → `Runtime skill: systematic-debugging`, `Execution path: systematic-debugging`.
- **"Done / ready to ship" claim** → `Runtime skill: verification-before-completion`, `Fallback alias: superpowers:verification-before-completion`, `Execution path: n/a` (the verification skill is the workflow).

These three live on the hot path because evals 2, 8, 9, 14, 18 all depend on them — they used to be in `references/route-adjustments.md` but were promoted in v1.9.0 after that file got flagged as cold-path-labelled hot-path content.

### Tiebreakers — only the non-obvious pairs

Rule #1 (destructive) is the canonical override and wins against every other rule when in conflict; the rows below cover the remaining non-obvious pairs.

| When both fire | Pick | Why |
|---|---|---|
| Rule #1 (destructive) and Rule #1.5 (creative work) | Rule #1. Route to **Discuss**; record the creative-work flag in `Assumptions` so the design conversation resumes after the destructive issue is resolved. | Outage / data loss can't be undone by a design brainstorm; pause creative scoping until reversibility is secured. |
| Rule #3 (bug) and Rule #4 (ship) | Rule #3 first; ship re-fires after the bug closes. | Don't ship a known-failing change. |
| Rule #6 (Brainstorm) and Rule #7 (Discuss) | Brainstorm if options unknown; Discuss if options exist and decisions are the bottleneck. | Widening vs narrowing the space. |
| Rule #2 (user named `writing-plans`) and Rule #1.5 (creative work, no spec) | Brainstorm. Record the named skill as a mismatch in `Assumptions`. | A Plan-class skill cannot substitute for the missing design gate. |
| Rule #1.5 exception (spec referenced) and Light's behavior-risk upgrade | Light + `test-driven-development` when the user says "directly implement" and the change is a few files. | The spec only skips Brainstorm; it does not force a planning ceremony for a small implementation. |
| Rule #1 (destructive) and any of #2 / #5 (user-named, Review-Handoff) | Rule #1 always. Record the user's named skill or review intent in `Assumptions`; the review or named load happens after the destructive issue is resolved through Discuss. | Outage / data loss can't be undone by reviewing or naming around it. |

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
- Route: <Direct | Light | Brainstorm | Discuss | Plan | Full | Review-Handoff>
- Runtime skill: <none | bare-slug>
- Fallback alias: <none | superpowers:bare-slug>
- Execution path: <direct local work | systematic-debugging | test-driven-development | executing-plans | subagent-driven-development | n/a>
- Goal: <one sentence>
- Signals: scope=<single-file | few-files | multi-module>; risk=<low | medium | high>; destructive=<no | yes>; decisions=<resolved | unresolved>; user-intent=<ideate | decide | plan | implement | debug | review | ship>
- Assumptions: <none | explicit unverified premises>
- Next: <what you will do immediately after this block>
```

`Route` and `Runtime skill` lead because every downstream reader acts on them. `Runtime skill` is the single skill to load next and must stay one bare token (`none` or one slug); `Fallback alias` is metadata for runtimes that cannot resolve that bare token. `Execution path` is the implementation pattern once code is being written (`n/a` when no code yet). They may match for skills that are both the workflow and the implementation pattern, such as `systematic-debugging` and `test-driven-development`. `risk` and `destructive` are separate enums because they answer different questions: blast-radius vs reversibility.

**Skill name resolution.** Most skills resolve as bare slugs in both Codex (`~/.agents/skills/`) and Claude Code (`~/.claude/skills/` + project mirror). Four skills are intentionally not mirrored to `~/.claude/skills/` because they live under the `superpowers:` plugin namespace. For those, keep `Runtime skill` as the bare slug and put the plugin name in `Fallback alias`. Codex should load `Runtime skill`; Claude Code should try `Runtime skill` first and, if it is unavailable, load `Fallback alias`.

**Resolution-failure fallback.** If neither `Runtime skill` nor `Fallback alias` resolves in the current runtime, do NOT proceed with the emitted Route. Surface the load error to the user with the attempted slug, then re-gate by downgrading to the smallest safe Route that doesn't require the missing skill (typically Light + `direct local work`, or Discuss if the original task was non-trivial) and emit a fresh block. Stale routing into a non-existent skill silently breaks the downstream workflow.

| Bare slug | Plugin alias | Emit fields |
|---|---|---|
| `brainstorming` | `superpowers:brainstorming` | `Runtime skill: brainstorming` + `Fallback alias: superpowers:brainstorming` |
| `verification-before-completion` | `superpowers:verification-before-completion` | `Runtime skill: verification-before-completion` + `Fallback alias: superpowers:verification-before-completion` |
| `test-driven-development` | `superpowers:test-driven-development` | `Runtime skill: test-driven-development` + `Fallback alias: superpowers:test-driven-development` |
| `receiving-code-review` | `superpowers:receiving-code-review` | `Runtime skill: receiving-code-review` + `Fallback alias: superpowers:receiving-code-review` |

All other skills (`discuss-before-plan`, `agentic-review-handoff`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `systematic-debugging`, `finishing-a-development-branch`) are emitted as bare slugs with `Fallback alias: none` — they exist as bare entries in both runtimes.

## Guardrails

- Smallest Route that still protects correctness.
- Route first, then load only the one Runtime skill you picked; use Fallback alias only if the current runtime cannot resolve that bare slug.
- At most one blocking question.
- Never create scripts, evals, references, or persistent artifacts from this skill alone — that belongs to the workflow that runs next.

Worked output blocks (one per Route + destructive, contradictory-signals, re-gate, user-named-mismatch, "don't ask") live in `references/examples.md`. Mirror the closest match.
