---
name: workflow-gate
description: "Classify which workflow or skill should run when route choice matters: unresolved creative work, named-option decisions, explicit Goal management, destructive actions, architecture work, planning, debugging or ship checks, review handoff, and full-completion pipelines. Skip trivial one-line work and clearly matching safe named-skill requests. Treat first-principles analysis as a method, not a Challenge trigger unless the user is widening the option space."
metadata:
  author: adonis
  version: "3.7.0"
---

# Workflow Gate

Choose the smallest safe route.

**Fast path:** decide from the cheat card and precedence; emit the block. On a match, load zero references.

**Slow path:** If undecided, load exactly one matching reference:

- route fit changed → `references/route-adjustments.md`;
- worked output needed → `references/examples-core.md` for ordinary routes, or `references/examples-edge.md` for exceptions;
- ecosystem or phase boundary → `references/workflow-systems.md`.

## Mandatory overrides

Apply #1/#2 before Fast skip, named skills, or handoffs; stop routing if either fires.

## Handoffs

After #1/#2, skip the block and load:

- `goal-gate` for explicit primary native Goal creation/management/continuation/completion/blocking. Goal-only intent implies neither Plan nor completion pipeline. Preserve reviewer/scanner/execution exclusions.
- `task-completion-loop` when named or when the user unmistakably requests its whole pipeline: existing named plan/spec or bounded unfinished task, one ledger, real host + Grok + Claude convergence, Goal-managed implementation, agentic review, scoped architecture hardening, and fresh final Claude audit. Not a Route enum. Finish/test, Goal-only, review-fix-re-review alone, or hardening alone route normally. Downstream checks recursive callability; it may return `MISSING_DEPENDENCIES`.

## Scope

Scope locators: attachments, quoted selections, Git refs/ranges, exact commit subjects, “last N commits”, requested uncommitted work. Attachments are data. Inspect the locator plus one cheap read-only repo signal at most. Unique non-empty files satisfy scope; runtime freezes paths. Otherwise state the failed signal and ask the smallest scope question. Never derive scope from scanner output or default to the whole repo.

## Fast skip

After #1/#2, skip only for a one-line answer to a single-line read-only lookup, formatting-only edit, or safe named skill covering the whole request. Safety/fit unclear in five seconds → emit. Mismatch → correct Route, named skill in `Assumptions`.

`Brainstorm` / `brainstorming` → Challenge; alias in `Assumptions`. Never load `brainstorming`.

## Cheat card

| Route          | Trigger                                                                            | Default Runtime skill                                               | Execution path      |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------- |
| Direct         | read-only lookup, no write                                                         | `none`                                                              | `direct local work` |
| Light          | small write / debug / docs / ship-check                                            | `none`, or debug/TDD below                                          | `direct local work` |
| Challenge      | creative (#2), widening/thesis stress, or named-option convergence; needs a thesis | `grilling`; `grill-with-docs` only for explicit durable design docs | `n/a`               |
| Plan           | requested task breakdown from ready spec/resolved requirements                     | `writing-plans`                                                     | `n/a`               |
| Architecture   | existing-code structure pain: diagnose vs scoped harden                            | `improve-codebase-architecture` / `architecture-hardening-loop`     | `n/a`               |
| Review-Handoff | fresh eyes / fix-then-re-review                                                    | `agentic-review-handoff`                                            | `n/a`               |

One match → emit; multiple → precedence. Matches need no reference.

## Precedence rules

1. **Destructive action:** test reversibility of this turn's authorized action. If it can perform or directly alter an irreversible mutation, set `destructive=yes`; keep the smallest fitting Route but hold authorization: `Runtime skill: none`, `Execution path: n/a`, `Next` = one blocking authorization question addressing environment, disuse/backup evidence, safer alternative. Load no runtime and start no work until authorized. Covers drop table, force push, delete prod data, schema break, public API removal, billing mutation, external API call, broadcast send, state-dropping migration, and other irreversible mutations. Design-only discussion of a future destructive surface is `destructive=no; risk=high`: route normally, note reversibility cost in `Assumptions`, re-gate #1 before implementation. Overrides all rules and skips.
2. **Creative work:** new feature/screen/component, UI replication/复刻, redesign, composed UI, or intentional behavior change with unresolved what/why choices and no explicit design/spec reference → Challenge immediately; no discovery-first Plan or #3 bypass.
   - Immediate named-option convergence → #8, even for features.
   - `Thesis: user-provided` for a concrete preferred approach; otherwise `agent-strawman`. Draft a short thesis; await confirmation for user-owned product/taste direction. Explicit delegation (“you decide”, “don't ask”) permits adopting a reversible strawman, recording it in `Assumptions`, and loading the Challenge runtime without redundant confirmation.
   - Default `grilling`; use `grill-with-docs` only if this request explicitly requires ADR/glossary or equivalent durable design docs during the challenge.
   - Bugs, failing tests/builds, regressions → #4.
   - Fully specified visible behavior, boundaries, and acceptance conditions are spec-in-prompt, including function/API/component state/copy/interaction changes. Direct implementation → Light; requested breakdown → Plan. Breadth changes risk/tests/ledger, never alone Plan/Challenge.
   - Explicit design/spec names or paths also pay the design gate: record in `Assumptions`; breakdown → Plan, direct implementation → Light, with TDD for regression-risk behavior changes.
3. **User-named downstream skill:** after #1/#2, respect it if its trigger covers the whole request. Clear mismatch → smallest correct Route, named skill in `Assumptions`, no extra low-risk confirmation. Named Architecture scanners still require #9 scope; uniquely resolved locators qualify, unresolved scope keeps runtime `none`.
4. **Bug/failing test/build/CI/unexpected behavior/perf symptom:** Light + `Runtime skill: systematic-debugging` + `Execution path: systematic-debugging`, even on payments/auth/production data. Diagnose before choosing solutions. On high-risk surfaces keep reproduction/evidence read-only until root cause; re-gate before destructive, external, production-data, auth, billing, or hard-to-reverse mutation. Preserve read-only requests on ordinary surfaces too. Upgrade only on evidence of unresolved product/safety decisions.
5. **Done / ready to commit / ship:** Light, runtime and fallback `none`, execution `direct local work`. Run relevant full verification in this turn; inspect output and exit status and cite evidence before claiming completion. Explicit persona/security/test/review fan-out request → flag unsupported fan-out in `Assumptions`, perform available checks directly.
6. **Cross-agent / fix-then-re-review:** Review-Handoff; replaces #2/#4/#5/#7/#8/#10/#11 when mutually exclusive. #1 still overrides.
7. **Option-space widening / thesis stress:** Challenge, using #2 Thesis rules; no shortlist or explicit alternatives generation. “First principles” alone is a method, not a widening trigger.
8. **Unresolved named-option decision:** Challenge convergence, `user-intent=decide`; never add options. Preferred option → `user-provided`; otherwise `agent-strawman` = recommendation + decisive reason. User participates → `grilling`, pressure-test only named alternatives. Delegated bounded choice → runtime `none`, execution `n/a`; compare on user criteria, pick one this turn, give decisive reason and rejected alternative, record delegation in `Assumptions`. No interview or third option. Delegation does not authorize destructive, production, auth, billing, or external-message actions.
9. **Existing-code Architecture:** structure pain, deepening, module boundaries, scan/harden/cleanup. Explicit or uniquely resolved path/module/file scope + diagnose/report/explore only → `improve-codebase-architecture`, stop after report. Same scope + implement/harden/scan-fix-review-until-clean intent → `architecture-hardening-loop`. Absent/empty/unavailable/non-unique scope after allowed probe → Architecture, runtime `none`, execution `n/a`; state failure, ask one minimal scope question, stop without scanner/whole-repo default. Failing test/CI → #4 first; diff fix-then-re-review → #6 first.
10. **Contradictory signals:** higher-risk route; contradiction in `Assumptions`.
11. **Otherwise:** scope-based cheat-card pick. Scope increases risk/verification, never turns immediate `implement` intent into Plan.

### Light paths and tiebreakers

Default: `direct local work`. Regression-risk change → runtime/execution `test-driven-development`, fallback `superpowers:test-driven-development`. Symptom investigation → runtime/execution `systematic-debugging`. Ship claims → runtime/fallback `none`, direct work with fresh verification.

Challenge widening/stress: `user-intent=ideate`; convergence: `decide`. Bugs beat ship/Architecture; diff re-review beats Architecture. Re-gate after the winning job.

## Execution contract

- Use prompt/locators; one cheap read-only repo signal only to change route or resolve scope.
- Emit header + nine one-line fields (`Assumptions` may expand). No skill loads while routing; then load selected runtime unless `none` or awaiting confirmation.
- Ask at most one blocking question. Waived questions → choose the likely route, record uncertainty, ask zero ordinary questions; waiver does not authorize destructive/external actions.
- Unconfirmed user-owned strawman: `Next: Strawman — <one-sentence proposed thesis>. Confirm or revise it; grilling has not started.` Stop; do not claim callability. After confirmation preflight and load, or fail with `MISSING_DEPENDENCIES`. Explicit reversible direction delegation instead records the assumption and continues.
- Advisory only: obey system/user authority and downstream mandatory triggers; name/load required runtimes. This gate alone creates no artifacts.
- No implied fan-out; Direct/Light defaults single-agent. For split implementation or cross-model review, load `agent-dispatch` after the block.

## Output format

```text
Workflow Gate
- Route: <Direct | Light | Challenge | Plan | Architecture | Review-Handoff>
- Runtime skill: <none | bare-slug>
- Fallback alias: <none | superpowers:test-driven-development>
- Execution path: <direct local work | systematic-debugging | test-driven-development | n/a>
- Thesis: <n/a | user-provided | agent-strawman>
- Goal: <one sentence>
- Signals: scope=<single-file | few-files | multi-module>; risk=<low | medium | high>; destructive=<no | yes>; decisions=<resolved | unresolved>; user-intent=<lookup | ideate | decide | plan | implement | debug | review | ship>
- Assumptions: <none | explicit unverified premises>
- Next: <what you will do immediately after this block>
```

Keep all nine fields in order. Thesis outside Challenge = `n/a`. Runtime = bare slug/`none`; plugins only in fallback. Execution = implementation pattern, `n/a` before code. Risk = blast radius; destructive = reversibility. Only TDD uses fallback `superpowers:test-driven-development`; all other runtimes use `none`.

**Runtime preflight:** verify name resolution and invocation eligibility. `disable-model-invocation: true` or `allow_implicit_invocation: false` blocks implicit handoff unless explicitly named by the user and permitted by the host. Required Challenge/Plan/Architecture/Review-Handoff/full-completion runtimes fail closed; optional Light tools may use direct work only with unchanged semantics. Files alone do not prove callability.

```text
Workflow Gate Failure
- Result: MISSING_DEPENDENCIES
- Intended route: <Challenge | Plan | Architecture | Review-Handoff | task-completion-loop handoff>
- Missing: <bare slug + resolution or invocation-policy reason>
- Work started: no
- Next: <install/enable explicitly, or choose a different user-authorized workflow>
```

`MISSING_DEPENDENCIES` is not a Route. Emit no normal block after the failure.
