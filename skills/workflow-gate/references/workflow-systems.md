# Workflow systems — integration boundaries

> **Disclaimer.** This file is an internal classifier reference, not part of the output contract. The Workflow Gate's output remains the same 8 fields (`Route` / `Runtime skill` / `Fallback alias` / `Execution path` / `Goal` / `Signals` / `Assumptions` / `Next`). The phase mapping and ecosystem notes below help you *decide* the Route — they do not surface in the emitted block.

Three workflow ecosystems show up in the runtime: `obra/superpowers`, `adonis-skills` (this repo, including `discuss-before-plan` and `agentic-review-handoff`), and `addyosmani/agent-skills`. They overlap on intent but bind different gates. Knowing which gate is *normative* for which phase is what keeps routing honest.

## Ecosystem boundaries

### superpowers/brainstorming — the creative-work HARD-GATE

The strongest gate in the runtime. Its own description is unambiguous: "You MUST use this before **any creative work** — creating features, building components, adding functionality, or modifying behavior." Its body adds: "A todo list, a single-function utility, a config change — all of them."

That means a request to **replicate an existing UI**, **add a new screen**, **compose a page from a design system**, or **change behavior** counts as creative work even when the data contract is fully specified. The previous version of the Workflow Gate read "Brainstorm" as "options / tradeoffs", which is a strictly weaker condition — it under-triggered on exactly the cases the HARD-GATE was built to catch. Rule #1.5 closes that gap.

The exception is narrow and concrete: when the user references an existing design doc or spec by path, the brainstorming step has already been paid. Then the gate routes to Plan and records the spec path in `Assumptions`.

### discuss-before-plan — the decision gate, not a brainstorming substitute

`discuss-before-plan` enforces "decide then plan" — it activates when **named options exist and the bottleneck is picking one**: Stripe vs Lemon Squeezy, monolith vs microservices, sync vs async, etc. Its job is to surface tradeoffs, lock decisions in a Decision Summary, then ask whether to persist a spec.

It does **not** replace brainstorming. Brainstorming opens the option space; `discuss-before-plan` closes it. If both could plausibly apply, fall back to the tiebreaker from the precedence rules: Brainstorm when the option space is open (widening); Discuss when the options are already named (narrowing).

### addyosmani/agent-skills — phase reference only, not a Runtime-skill source

`addy/agent-skills` partitions the lifecycle into phases (`idea-refine` / `spec-driven-development` / `planning-and-task-breakdown` / `incremental-implementation` / `source-driven-development` / `code-review-and-quality` / `shipping-and-launch` etc.) and exposes `/ship` as a parallel persona orchestrator. These are useful as a **mental map** for where a request sits in its lifecycle.

What this gate does **not** do today:

- Emit `agent-skills:*` tokens in `Runtime skill`. The gate's single-bare-token contract requires that the named slug resolve in the current runtime (`~/.agents/skills/` for Codex, `~/.claude/skills/` for Claude Code). The `agent-skills:` namespace is not yet present in that contract; emitting it would silently break the downstream load.
- Add a `Ship-Fanout` Route. Until a local bridge skill exists that wraps the fan-out behavior under a bare slug we own, the gate stays with the existing 7 Routes.

If a future bridge skill lands, the gate can promote `Ship-Fanout` to a real Route with a real Runtime slug. Until then, ship-class requests route to `Light` + `verification-before-completion`, and any "I want three personas in parallel" framing should be flagged in `Assumptions` rather than emitted as a Route.

## Phase as an internal classifier

Use the table below to *check your own thinking* before committing to a Route. The Phase column is **never** part of the output block; it just makes routing decisions easier to audit.

| Phase | Internal label | Best-fit Route | Runtime skill (bare slug) |
|---|---|---|---|
| Ideation, fuzzy intent | `define-idea` | Brainstorm | `brainstorming` |
| Concrete creative work (feature / screen / component / replicate / redesign / behavior change) | `define-design` | Brainstorm | `brainstorming` |
| Named options, pick one | `decide` | Discuss | `discuss-before-plan` |
| Spec or RFC exists, break into tasks | `plan` | Plan or Full | `writing-plans` |
| Independent tasks, fan out in same session | `build` (fan-out) | Full | `writing-plans` (+ `subagent-driven-development` as Execution path) |
| Sequential or context-heavy tasks | `build` (inline) | Plan | `writing-plans` (+ `executing-plans` as Execution path) |
| Symptom / bug / failing test | `verify-bug` | Light | `systematic-debugging` |
| Claim of done / ready-to-ship | `verify-ship` | Light | `verification-before-completion` |
| Cross-agent review / fix-then-re-review | `review` | Review-Handoff | `agentic-review-handoff` |
| Pre-launch checklist, persona fan-out (future) | `ship` | (no Route yet — flag in Assumptions) | n/a |

**How to use this table.** When the prompt arrives, mentally tag the phase. If the phase maps to a Route the gate already supports, emit that Route. If it maps to a phase the gate does not yet support (today: only the persona-fan-out `ship` phase), route to the nearest existing Route and surface the gap in `Assumptions` so the user can override.

## What stays invariant

- The output block is still 8 fields, same order, same enums.
- `Runtime skill` is still a single bare token; `Fallback alias` is still the only place plugin-namespaced strings appear, and only for the four mirrored slugs listed in SKILL.md.
- Rule #1 (destructive) still overrides everything else.
- The Brainstorm-vs-Discuss tiebreaker still reads: Brainstorm when widening, Discuss when narrowing.
- `route-adjustments.md` is unchanged — its Upgrade/Downgrade guidance still applies, and the "Brainstorm → Direct/Light: user already chose the approach" downgrade is the natural complement to Rule #1.5's exception clause.
