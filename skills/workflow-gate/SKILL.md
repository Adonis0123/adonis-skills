---
name: workflow-gate
description: "Use BEFORE loading heavier workflow skills (brainstorming, discuss-before-plan, writing-plans, subagent-driven-development, agentic-review-handoff, executing-plans, finishing-a-development-branch) when the route is not already obvious. A 60-90 second advisory classifier that prevents over-escalation and under-escalation. Outputs one Route, one single-token Runtime skill to load next, one optional Fallback alias for Claude/Codex compatibility, and one Execution path. Skip the gate ONLY for single-line read-only lookups, pure-formatting edits with no behavior change, or an explicitly named downstream skill that is already safe and non-destructive."
metadata:
  author: adonis
  version: "1.7.0"
---

# Workflow Gate

A reflex-fast router. Over-escalating burns minutes on obvious work; under-escalating creates rework or outages.

## Fast-skip checklist

You may skip emitting the block **only** if all of these hold:

1. The work is a single-line read-only lookup, a pure-formatting edit, or the user has already named the exact downstream skill **and the prompt is cheaply classifiable as safe, non-destructive, and not mismatched with that skill**.
2. The destructive override (Rule #1, canonical below) does not fire. If you cannot cheaply rule out destructive impact, do not skip the gate.
3. The answer fits in one line of prose.

For anything else, emit the block. If the user named a skill that clearly mismatches the request (e.g. "use brainstorming for this typo fix"), do NOT take the skip path — emit the block, set the appropriate Route, and flag the mismatch in `Assumptions`.

## Cheat card — scan first, exit early

| Route | Trigger keyword | Default Runtime skill | Default Execution path |
|---|---|---|---|
| **Direct** | read-only lookup, no write | `none` | `direct local work` |
| **Light** | small write / debug / docs / ship-check | `none` *(or `verification-before-completion` on ship claims)* | `direct local work` |
| **Brainstorm** | "options / tradeoffs / first principles" | `brainstorming` | `n/a` |
| **Discuss** | "Stripe vs X / decide before plan" | `discuss-before-plan` | `n/a` |
| **Plan** | RFC ready, ≤ 2 bounded contexts | `writing-plans` | `executing-plans` |
| **Full** | ≥ 3 bounded contexts AND parallelizable | `writing-plans` | `subagent-driven-development` |
| **Review-Handoff** | "fresh eyes / fix-then-re-review" | `agentic-review-handoff` | `n/a` |

One row fits → emit the block. Multiple fire → use precedence below. Route adjustments (Upgrade / Downgrade / Re-gate / Light's Execution-path upgrades) live in `references/route-adjustments.md` — consult only when the cheat card doesn't fit.

## Precedence rules — earlier overrides later

1. **`destructive=yes`** (drop table, force push, delete prod data, schema break, public API removal) → minimum **Discuss**. Overrides every rule below, including a user-named skill and Fast-skip.
2. **User named a downstream skill** (and Rule #1 didn't fire) → respect it; only flag a clear mismatch.
3. **Bug / failing test / build / CI failure / unexpected behavior / perf symptom** → **Light** + `Runtime skill: systematic-debugging` + `Execution path: systematic-debugging`. Upgrade to **Discuss** if scope is multi-module OR `risk=high` (payments / auth / production data).
4. **"Done? / ready to commit / ship this"** → **Light** + `Runtime skill: verification-before-completion` + `Fallback alias: superpowers:verification-before-completion` (then `finishing-a-development-branch` if branch integration).
5. **Cross-agent / fix-then-re-review** → **Review-Handoff**. Mutually exclusive with #3/#4/#6/#7/#9 — replaces any of them. Rule #1 (destructive) still overrides per the tiebreaker.
6. **"Options / tradeoffs / first principles"** → **Brainstorm**.
7. **Decisions unresolved (provider / architecture / data model / API)** → **Discuss**.
8. **Contradictory signals** (e.g. "quick fix" + "production payments") → higher-risk route; record contradiction in `Assumptions`.
9. **Otherwise** → scope-based pick from the cheat card.

### Tiebreakers — only the non-obvious pairs

Rule #1 (destructive) is the canonical override and wins against every other rule when in conflict; the rows below cover the remaining non-obvious pairs.

| When both fire | Pick | Why |
|---|---|---|
| Rule #3 (bug) and Rule #4 (ship) | Rule #3 first; ship re-fires after the bug closes. | Don't ship a known-failing change. |
| Rule #6 (Brainstorm) and Rule #7 (Discuss) | Brainstorm if options unknown; Discuss if options exist and decisions are the bottleneck. | Widening vs narrowing the space. |
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
