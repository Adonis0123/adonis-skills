# Workflow systems — integration boundaries

> Internal classifier reference, not part of the output contract. The output remains the same 9 fields (including `Thesis`). The phase mapping and ecosystem notes below help you decide the Route — they don't surface in the emitted block except via Route / Runtime skill / Thesis.

Three workflow ecosystems show up in the runtime: `mattpocock` (grilling / architecture scan skills), `obra/superpowers` (debug / TDD / writing-plans), and `adonis-skills` (this repo: `discuss-before-plan`, `agentic-review-handoff`, `architecture-hardening-loop`, `task-completion-loop`, `goal-gate`). `addyosmani/agent-skills` remains a phase reference only.

## Ecosystem boundaries

### Challenge + grilling — the creative-work HARD-GATE

Creative work with unresolved product/design choices and no paid design/spec routes to **Challenge**, not to a deleted `brainstorming` skill. Runtime is `grilling` (or `grill-with-docs` when the same request explicitly requires durable ADR/glossary writes).

Challenge requires a thesis:

- `Thesis: user-provided` — user already stated the preferred approach; load grilling next.
- `Thesis: agent-strawman` — draft a short strawman. Confirm when product/taste direction remains user-owned; when the user explicitly delegates the reversible direction, adopt it, record the assumption, and load grilling without another confirmation.

A request to **replicate an existing UI**, **add a new screen**, **compose a page from a design system**, or **change product/UI behavior** counts as creative work when visible behavior or product direction still has unresolved what/why choices. A fully specified component state, copy change, interaction, function, or API contract is spec-in-prompt and can use Rule #2's Light exception.

Exception: when the user references an existing design doc or spec by path, the design gate has already been paid. Route by the immediate request: **Plan** only for task breakdown, or **Light** for direct implementation regardless of scope. Add TDD when behavior has regression risk, and record the spec path in `Assumptions`.

### discuss-before-plan — the decision gate, not a Challenge substitute

Activates when **named options exist and the bottleneck is picking one**: Stripe vs Lemon Squeezy, monolith vs microservices, sync vs async. It surfaces tradeoffs and locks decisions in a Decision Summary. Persistence is optional and requested only when the user, repository rules, or cross-session handoff needs it.

It does not replace Challenge. Challenge pressure-tests a thesis / opens a still-wide space; `discuss-before-plan` closes among named options. Tiebreaker: Challenge when widening or thesis-stressing; Discuss when narrowing.

### Architecture — diagnose vs harden

- `improve-codebase-architecture` (mattpocock): explore + HTML candidate report; stop after report when the user only wants diagnosis.
- `architecture-hardening-loop` (adonis): bounded scan → evidence triage → fix → Grok review → rescan. Requires an explicit user path/module **and** implement/harden intent.

Do not vendor mattpocock logic into this gate; only route to installed bare slugs.

### task-completion-loop — whole-pipeline downstream owner

`task-completion-loop` is not a Route enum. After destructive and creative safety overrides clear, hand off directly only when the user requests the whole named-plan/spec completion pipeline: work ledger, human-decision convergence, Goal ownership, implementation, agentic review, architecture hardening, and a fresh final Claude audit. Ordinary finish/test, Goal-only, review-only, and architecture-only requests stay in the normal routes.

The downstream skill owns recursive capability checks. Installed files do not prove callability: invocation-disabled dependencies, missing `codebase-design`, unavailable read-only delegation, or an unavailable real Grok/Claude session must fail closed before work starts.

### obra debug / TDD / plans — keep for Light and Plan

`systematic-debugging`, `test-driven-development`, and `writing-plans` remain the Light/Plan runtimes. Do not replace them with mattpocock skills.

### addyosmani/agent-skills — phase reference only

Partitions the lifecycle into phases (`idea-refine` / `spec-driven-development` / `planning-and-task-breakdown` / `incremental-implementation` / `code-review-and-quality` / `shipping-and-launch`) and exposes `/ship` as a parallel persona orchestrator. Useful as a mental map for where a request sits in its lifecycle — not as a `Runtime skill` source (the `agent-skills:` namespace is not resolved in the gate's single-bare-token contract today; emitting it would silently break the downstream load).

## Phase as an internal classifier

Tag the prompt's phase before committing to a Route. The Phase column is never part of the output block.

| Phase                                             | Internal label  | Best-fit Route                                    | Runtime skill (bare slug)                 |
| ------------------------------------------------- | --------------- | ------------------------------------------------- | ----------------------------------------- |
| Read-only lookup                                  | `lookup`        | Direct                                            | `none`                                    |
| Ideation / thesis stress / creative without spec  | `define-design` | Challenge                                         | `grilling` or `grill-with-docs`           |
| Named options, pick one                           | `decide`        | Discuss                                           | `discuss-before-plan`                     |
| Spec or RFC exists, break into tasks              | `plan`          | Plan                                              | `writing-plans`                           |
| Broad or multi-context task breakdown             | `build-plan`    | Plan                                              | `writing-plans`                           |
| Existing-code structure diagnose                  | `arch-diagnose` | Architecture                                      | `improve-codebase-architecture`           |
| Scoped architecture harden loop                   | `arch-harden`   | Architecture                                      | `architecture-hardening-loop`             |
| Sequential or context-heavy direct implementation | `build`         | Light                                             | direct local work or TDD                  |
| Symptom / bug / failing test                      | `verify-bug`    | Light                                             | `systematic-debugging`                    |
| Claim of done / ready-to-ship                     | `verify-ship`   | Light                                             | direct verification with fresh evidence   |
| Cross-agent review / fix-then-re-review           | `review`        | Review-Handoff                                    | `agentic-review-handoff`                  |
| Explicit whole named-plan completion pipeline     | `full-complete` | direct downstream handoff (no Route enum)         | `task-completion-loop`                    |
| Pre-launch checklist with persona fan-out         | `ship`          | Light (flag unsupported fan-out in `Assumptions`) | direct verification with available checks |

If the phase maps to a Route the gate supports, emit it. If it maps to a phase the gate does not yet model cleanly (today: persona-fan-out `ship`), route to the nearest existing Route and surface the gap in `Assumptions`.

## Invariants

- 9-field output, same order, same enums (`Thesis` included; `n/a` when not Challenge).
- `Runtime skill` is single bare token; `Fallback alias` is the only place plugin-namespaced strings appear.
- Never emit or load `brainstorming`.
- Rule #1 (destructive) overrides everything else.
- Challenge-vs-Discuss: widening / thesis stress → Challenge; named-options converging → Discuss.
- Architecture harden requires explicit path **and** implement intent.
