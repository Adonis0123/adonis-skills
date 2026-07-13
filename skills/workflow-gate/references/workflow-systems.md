# Workflow systems — integration boundaries

> Internal classifier reference, not part of the output contract. The output remains the same 8 fields. The phase mapping and ecosystem notes below help you decide the Route — they don't surface in the emitted block.

Three workflow ecosystems show up in the runtime: `obra/superpowers`, `adonis-skills` (this repo, including `discuss-before-plan` and `agentic-review-handoff`), and `addyosmani/agent-skills`. They overlap on intent but bind different gates.

## Ecosystem boundaries

### superpowers/brainstorming — the creative-work HARD-GATE

The strongest gate in the runtime: "You MUST use this before any creative work — creating features, building components, adding functionality, or modifying behavior."

A request to **replicate an existing UI**, **add a new screen**, **compose a page from a design system**, or **change product/UI behavior** counts as creative work even when the data contract is fully specified. Rule #2 closes that gap. Exact technical behavior specified in the prompt (for example a named exported function with a full signature and semantics) can still use Rule #2's Light + TDD exception.

Exception: when the user references an existing design doc or spec by path, brainstorming has already been paid. Route to Plan and record the spec path in `Assumptions`.

### discuss-before-plan — the decision gate, not a brainstorming substitute

Activates when **named options exist and the bottleneck is picking one**: Stripe vs Lemon Squeezy, monolith vs microservices, sync vs async. It surfaces tradeoffs, locks decisions in a Decision Summary, then asks whether to persist a spec.

It does not replace brainstorming. Brainstorming opens the option space; `discuss-before-plan` closes it. Tiebreaker: Brainstorm when widening, Discuss when narrowing.

### addyosmani/agent-skills — phase reference only

Partitions the lifecycle into phases (`idea-refine` / `spec-driven-development` / `planning-and-task-breakdown` / `incremental-implementation` / `code-review-and-quality` / `shipping-and-launch`) and exposes `/ship` as a parallel persona orchestrator. Useful as a mental map for where a request sits in its lifecycle — not as a `Runtime skill` source (the `agent-skills:` namespace is not resolved in the gate's single-bare-token contract today; emitting it would silently break the downstream load).

## Phase as an internal classifier

Tag the prompt's phase before committing to a Route. The Phase column is never part of the output block.

| Phase | Internal label | Best-fit Route | Runtime skill (bare slug) |
|---|---|---|---|
| Ideation, fuzzy intent | `define-idea` | Brainstorm | `brainstorming` |
| Concrete creative work (feature / screen / component / replicate / redesign / behavior change) | `define-design` | Brainstorm | `brainstorming` |
| Named options, pick one | `decide` | Discuss | `discuss-before-plan` |
| Spec or RFC exists, break into tasks | `plan` | Plan | `writing-plans` |
| Broad or multi-context task breakdown | `build-plan` | Plan | `writing-plans` |
| Sequential or context-heavy implementation | `build` | Light or Plan | direct local work after user approval |
| Symptom / bug / failing test | `verify-bug` | Light | `systematic-debugging` |
| Claim of done / ready-to-ship | `verify-ship` | Light | direct verification with fresh evidence |
| Cross-agent review / fix-then-re-review | `review` | Review-Handoff | `agentic-review-handoff` |
| Pre-launch checklist with persona fan-out | `ship` | Light (flag unsupported fan-out in `Assumptions`) | direct verification with available checks |

If the phase maps to a Route the gate supports, emit it. If it maps to a phase the gate does not yet model cleanly (today: persona-fan-out `ship`), route to the nearest existing Route and surface the gap in `Assumptions`.

## Invariants

- 8-field output, same order, same enums.
- `Runtime skill` is single bare token; `Fallback alias` is the only place plugin-namespaced strings appear.
- Rule #1 (destructive) overrides everything else.
- Brainstorm-vs-Discuss: widening → Brainstorm, narrowing → Discuss.
