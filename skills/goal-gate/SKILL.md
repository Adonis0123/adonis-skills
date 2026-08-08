---
name: goal-gate
description: "Use when the user wants to decide, set, draft, or run a durable coding-agent goal or /goal until a verifiable done condition. Gates autonomy across Grok, Codex, Claude Code, and compatible agents: Codex get_goal/create_goal plus status closure; Grok user-run /goal plus progress after Active. Drafts copy-ready contracts with outcome, verification, constraints, write boundaries, delegation, iteration, and pause conditions. On Grok, /goal-gate is not product /goal: emit a copy-ready /goal and wait for activation. Trigger on 'should I set a goal?', durable goal setup, Grok/Codex/Claude /goal prompts, multi-checkpoint work, migrations, refactors, ports, spec implementations, eval loops, bounded backlog cleanup with one verifiable end state, or stepping-away finish-it tasks. Do not use for quick edits, one-shot tests, loose unrelated backlogs, OKR/scrum goals, reminders, or token-budget-only settings."
metadata:
  author: adonis
---

# Goal Gate

## Overview

Use this skill to decide whether the current task deserves a durable goal and to write a copy-ready goal contract when it does. Keep two jobs separate:

- Gate autonomy: decide `none`, `suggest`, `set-now`, or `defer`.
- Draft the contract: produce a concrete `/goal` or portable prompt with verification, boundaries, delegation, iteration, and pause conditions.

**`/goal-gate` is not product `/goal`.** This skill writes and gates contracts. Only the host product can put a session into durable goal mode: Codex via `create_goal`, Grok via the user-run slash command `/goal <objective>`, Claude Code via user `/goal` plus transcript evaluation. Never imply that loading this skill alone activated Grok goal mode.

This skill is independent from `workflow-gate`: consume a `Workflow Gate` block when one is already present, but do not require one.

## Workflow

1. Identify the runtime.
2. Check whether an active goal exists if the runtime exposes goal status tools.
3. Classify goal fit, then run the safety gate.
4. Draft the smallest useful goal contract. For low-risk vague requests, choose conservative defaults instead of asking a form-like questionnaire.
5. Pick the decision: `high` fit through a clear safety gate is `set-now`; `medium` is `suggest`; a tripped safety gate is `suggest` or `defer`; `low` is `none`.
6. Emit one `Goal Gate` block per selected runtime, then carry out the runtime-specific action when the decision is `set-now`.

## Runtime Detection

Use explicit user intent before ambient tool availability:

| Runtime             | Signal                                                                                                                                                                          | Goal action                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grok-slash`        | The user is in Grok Build / Grok TUI, asks for a Grok `/goal`, or wants a Grok-compatible slash prompt.                                                                         | Output a `/goal ...` prompt (Grok args: objective, `status`, `pause`, `resume`, `clear`).                                                                                                                                                                            |
| `grok-tooling`      | The session exposes Grok-style `update_goal` progress/completion fields but no `get_goal` / `create_goal`, and the user did not explicitly ask only for a slash-command prompt. | Durable mode starts only when the user runs `/goal <objective>`. Until then: emit the contract + copy-ready `/goal`, `Next: wait for user /goal`, and stop. After Active: work and report with Grok's `update_goal` schema. Never invent `create_goal` / `get_goal`. |
| `codex-slash`       | The user is in Codex and wants a slash-command prompt, or explicitly asks for Codex `/goal`.                                                                                    | Output a `/goal ...` prompt.                                                                                                                                                                                                                                         |
| `claude-code-slash` | The user is in Claude Code, asks for Claude Code `/goal`, or asks for a Claude Code-compatible prompt.                                                                          | Output a `/goal ...` prompt tuned for Claude Code evaluation.                                                                                                                                                                                                        |
| `codex-tooling`     | The session exposes Codex goal tools such as `get_goal` or `create_goal`, and the user did not explicitly ask for a slash-command prompt.                                       | Use `get_goal` / `create_goal` to activate; when exposed, use Codex's status-only `update_goal` to close a verified goal or report a persistent blocker.                                                                                                             |
| `unknown`           | The runtime cannot be inferred.                                                                                                                                                 | Output a portable contract, not an executable command.                                                                                                                                                                                                               |

Disambiguation: `get_goal` / `create_goal` identify the Codex family even when a status-only `update_goal` is also present. `update_goal` without those tools is Grok only when its advertised schema supports Grok progress/completion fields. Never borrow one runtime's field names for the other. If both a slash prompt and tooling are requested, emit one block per runtime.

If multiple runtimes are requested, emit one `Goal Gate` block per runtime. Keep each block executable or copyable on its own.

## Goal Fit

Prefer a goal when all are true:

- The task is larger than one normal turn.
- The objective has one durable end state.
- Completion can be verified from evidence the agent can surface in the transcript.
- The agent can make useful progress without frequent human steering.
- Stop or ask conditions can be stated before work starts.

Avoid a goal for:

- Single-step lookups, typo fixes, small edits, or commit-message work.
- Open-ended exploration with no measurable stopping condition.
- Product or architecture choices that still need `grilling` (Route: Challenge) or `discuss-before-plan`.
- Destructive, irreversible, billing, auth, production-data, or schema-breaking work before explicit human approval.
- A loose backlog of unrelated tasks.

For vague but low-risk work, prefer a goal with safe defaults over a clarification loop. Ask only when the answer materially changes cost, risk, ownership, product direction, or write boundaries.

## Safety Gate

Before any automatic action, check for conditions that must keep a human in the loop. If any holds, do not auto-set: emit `Decision: suggest` or `Decision: defer` and ask first, even when goal fit is high.

- Destructive, irreversible, billing, auth, production-data, or schema-breaking work.
- A goal is already active **and** the new objective conflicts with it, or the user has not chosen how to handle it. Never replace or mutate that goal silently; ask whether to continue, complete, block, clear, or replace it, and emit `Decision: defer`. Same-Goal management includes both an exact objective match and a contained checkpoint when the active Goal's objective, frozen scope, and Done condition explicitly include that checkpoint and the user already authorized the parent pipeline. Verify this relationship from evidence; compatible containment never permits scope expansion or narrowing the parent's Done condition.
- The objective still needs a design or scoping decision that `grilling` (Route: Challenge) or `discuss-before-plan` should resolve.
- Verification cannot run, so completion could never be proven from evidence.

The gate exists because an auto-started goal hands the agent a long leash. That leash is only safe when the end state is reversible-or-approved, unambiguous, and checkable. When in doubt, fall back to `suggest` — the cost of asking once is small next to a goal that runs off in the wrong direction.

High-risk work can still receive a goal draft, but the draft must be discovery-first or approval-first. Do not present a production write, destructive migration, auth rewrite, billing change, or regulated-domain decision as an immediately executable action.

## Auto-Set

When the safety gate is clear and goal fit is `high`, treat the goal as authorized and start it now — do not stop to ask "should I set a goal?" The high-fit bar (one durable end state, verifiable from surfaced evidence, the agent can make progress without steering) is itself the signal that autonomy will help rather than hurt, so a confirmation round-trip mostly adds latency.

How `set-now` executes depends on the runtime:

- `codex-tooling`: call `get_goal` first when available. If no goal is active, call `create_goal` with the `Objective`; do not set a token budget unless the user asked for one. If the active Goal is the exact objective, or demonstrably contains the requested checkpoint in its frozen scope and Done condition, set `Next: continue active goal` and keep working without calling `create_goal` or a terminal `update_goal`. A contained checkpoint never owns parent completion. Work until the Goal owner's full done condition is proven; then call Codex `update_goal({status: "complete"})` when that tool/schema is exposed. Mark `blocked` only after the same blocking condition has persisted for at least three consecutive goal turns and no meaningful progress is possible; ordinary questions, incomplete work, or low remaining budget are not blockers.
- `grok-tooling` (goal not Active yet): Grok has no `create_goal` / `get_goal`. Only the user-run slash `/goal <objective>` can make the session Active; `update_goal` fails until then. On `set-now`:
  1. Emit the Goal Gate block **and** the full copy-ready `/goal <objective>` **before** any multi-step implementation.
  2. Set `Next: wait for user /goal`. **Stop.** Do not start the implementation plan, do not call `update_goal` (`message`, `completed`, or `blocked_reason`), and do not claim durable goal mode is on.
  3. One short line of truth: `/goal-gate` drafted the contract; the user must paste `/goal …` (or confirm goal is already Active) to light product goal mode.
  4. After the user pastes `/goal …`, says the goal is active, or `/goal status` shows Active — then work the contract and report with `update_goal` (`message` at checkpoints; `completed: true` only when verification proves the done condition; `blocked_reason` only when genuinely stuck).
  5. Soft-adopt exception: if the user explicitly declines durable mode ("just do the work, no `/goal`", "soft only", "不要原生 goal"), set `Next: adopt goal and continue`, work without waiting, and still **never** call `update_goal` until Active.
- `grok-tooling` (goal already Active): if the user explicitly continues the exact objective or a demonstrably contained checkpoint, use `Decision: set-now`, `Next: continue active goal`, work the contract, and use Grok's progress `message` as above. Do not invent `create_goal` / `get_goal`. Do not silently clear or replace the active goal; a contained checkpoint leaves completion to the parent owner, and `completed: true` is allowed only after the full Goal done condition is proven.
- `claude-code-slash` / `codex-slash`: there is no create-goal API to call, so adopt the goal contract yourself — keep working toward the done condition, reporting at the checkpoints, until it is met or a stop-or-ask condition fires. Still emit the `/goal` prompt so the user can re-run it as a durable goal in a fresh session.
- `grok-slash`: user asked for a copyable Grok `/goal` (or only a slash prompt). Prefer `Decision: suggest` with `Next: provide prompt` when they only want text to copy. If they also authorized immediate execution without durable mode, soft-adopt is allowed; still never call `update_goal` until Active. Mention that `/goal` appears only when the goal feature is enabled and `update_goal` is in the toolset; management args are `status` / `pause` / `resume` / `clear`.
- `unknown`: capabilities are uncertain, so do not auto-execute. Emit a portable contract with `Next: ask approval` and let the user start it.

Hold the auto-set for `medium` fit: stay on `suggest`, because the medium boundary is fuzzy enough that a quick nod from the user is worth more than the saved round-trip. `low` fit is `none`.

Why Grok waits: Codex `create_goal` can activate from the agent. Grok cannot. Pretending `set-now` already activated Grok goal mode is what produces `Goal is not Active` failures and confuses `/goal-gate` with `/goal`. Stopping once for a paste is cheaper than a false durable session.

## Goal Drafting

For any prompt or contract that a user may copy, make the first executable draft complete. Do not leave placeholders such as `[path]`, `TODO`, or `TBD` unless the user explicitly asked for a template.

A strong goal includes:

- one concrete outcome;
- concrete verification evidence such as commands, logs, screenshots, files, URLs, API checks, or artifact paths;
- constraints that protect unrelated behavior, data, secrets, default branches, and public contracts;
- write boundaries and forbidden paths when the task touches a repo or machine;
- an execution strategy that assesses whether subagents improve the task without weakening ownership or verification;
- bounded iteration policy after failures;
- a done condition that proves completion;
- pause conditions for credentials, payments, production data, destructive actions, legal/medical/financial judgment, copyrighted assets, unclear ownership, or repeated blockers.

For Chinese-first users, write the primary copy-ready prompt in Chinese while keeping the executable command prefix `/goal`. Include a concise default reason when you made assumptions. Add numbered options only when a choice would materially change scope, risk, or direction. Include an English-compatible mirror only when the user asks for portability, English, Claude/Codex cross-use, or a complete bilingual draft.

For unfamiliar or specialized domains, do not invent domain rules. Write a discovery-first goal that makes the agent inspect project docs, sample data, official references, and runtime evidence before implementation.

## Delegation Policy

For every executable goal, require the main agent to assess the execution strategy before implementation. Judge task complexity together with dependency order, shared context or state, write overlap, output volume, independently verifiable subtasks, coordination cost, and runtime support. Do not delegate merely because a task is large.

- Prefer one agent for quick targeted changes, tightly coupled work, sequential dependencies, or work that needs frequent shared-context refinement.
- Consider subagents for bounded self-contained tasks, high-volume read-only research or test/log analysis, or two or more independent problem domains.
- Parallelize only when tasks have no sequential dependency, shared mutable state, or conflicting write surface.
- Prefer an installed orchestration skill when one fits, such as `subagent-driven-development` for independent tasks in an implementation plan or `dispatching-parallel-agents` for independent problem domains. Treat these as optional capabilities, not hard dependencies.
- Keep the main agent accountable for the aggregate goal: pass down relevant constraints, review returned work and diffs, resolve conflicts, and run final integration verification. Subagents must not broaden scope or declare the whole goal complete.
- Fall back to single-agent execution when subagents are unavailable or their coordination cost exceeds the expected benefit.

Read `references/copy-ready-goals.md` when generating a user-copyable `/goal`, when the user gives a vague app/site/tool/game request, or when you need Chinese default output, per-field drafting craft, a question bank for the rare case you must ask, option lists, unknown-domain handling, or prompt quality checks.

If a copy-ready goal is saved to a file or the user asks for validation, run `scripts/lint-goal-prompt.py <file>` and fix any missing labels, placeholders, unsafe vague wording, or thin verification.

## Decision Values

| Decision  | Use when                                                                                                   | Next behavior                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `none`    | Goal fit is low.                                                                                           | Continue without a goal.                                      |
| `suggest` | Goal fit is medium and the safety gate is clear, or the user wants to review the contract before starting. | Provide the contract/prompt and ask for a nod.                |
| `set-now` | Goal fit is high and the safety gate is clear, or the user explicitly asked and the goal is verifiable.    | Auto-execute the runtime-specific action.                     |
| `defer`   | Scope, decisions, evidence, or an already-active goal block a clean start.                                 | Stop and ask, or route to the smallest prerequisite workflow. |

`set-now` is reached two ways: the user explicitly asks for a goal action, or the task clears the safety gate at high goal fit. An explicit exact-same or compatible-contained continuation uses `set-now` with `Next: continue active goal`; it does not create, replace, narrow, or terminally update the Goal. A contained checkpoint reports progress but leaves completion to the parent Goal owner. Same-goal complete/block uses `Next: report via update_goal` only after its terminal preconditions are proven. If an active goal conflicts with a new objective or the desired action is unclear, emit `Decision: defer` and ask; never call either runtime's completion action or tell the user to clear a goal merely to make replacement convenient.

## Output Contract

Emit this block:

```text
Goal Gate
- Decision: <none | suggest | set-now | defer>
- Runtime: <grok-tooling | grok-slash | codex-tooling | codex-slash | claude-code-slash | unknown>
- Goal fit: <low | medium | high>
- Objective: <one durable objective or n/a>
- Done condition: <verifiable stopping condition or n/a>
- Verification: <commands/artifacts/evidence the agent must surface or n/a>
- Constraints: <scope/safety/must-not-change limits or n/a>
- Execution strategy: <how to assess single-agent vs delegated vs parallel execution, or n/a>
- Checkpoints: <progress reporting cadence or n/a>
- Stop or ask when: <blocked/risky/ambiguous/destructive/budget condition or n/a>
- Prompt: <runtime-specific goal prompt, "see Recommended /goal below", or none>
- Next: <create goal | continue active goal | wait for user /goal | adopt goal and continue | report via update_goal | provide prompt | ask approval | continue without goal | route elsewhere>
```

Keep the block concise. If the prompt is longer than one short line, put `Prompt: see Recommended /goal below`, then emit the copy-ready prompt immediately below the block.

On Grok when `Next: wait for user /goal`, put the copy-ready `/goal` **first in the user-visible reply** (right under the block), then stop. Do not bury it after implementation notes or a completion summary.

When emitting a copy-ready prompt for a Chinese-first user, use this order as needed:

1. `推荐执行版（中文，可直接复制）`
2. `默认选择理由`
3. `可选调整`
4. `你可以直接回复`
5. `Goal Draft (English-compatible)` when requested or useful for portability

Every executable copy-ready prompt must include an `执行编排：` or `Execution strategy:` line that carries the Delegation Policy. Keep it shorter than the task-specific outcome and verification unless delegation is the main risk.

## Prompt Rules

For Claude Code `/goal`, ensure the verification evidence will appear in the conversation, because the evaluator judges from surfaced transcript evidence rather than independently reading files or running commands.

For Codex slash `/goal`, include the same durable contract and validation loop. If goals may be disabled, tell the user to enable goals before running the prompt.

For Grok `/goal` (`grok-slash` or the copy-ready prompt under `grok-tooling`):

- Keep the executable prefix `/goal` (not `/目标`). Body may be Chinese for Chinese-first users.
- Put a concrete, verifiable objective in the first line after `/goal` — Grok stores that string as the autonomous objective across turns.
- Require the agent to surface verification evidence in the transcript (commands, exit codes, logs, screenshots, paths). Grok goal completion may be checked adversarially against the contract; unsourced "done" claims are weak.
- Include execution strategy, iteration bounds, and pause conditions like other runtimes.
- Optionally note management commands when the user is operating an existing goal: `/goal status`, `/goal pause`, `/goal resume`, `/goal clear`.
- If the goal feature might be off, tell the user `/goal` appears only when goals are enabled and `update_goal` is in the session toolset.

For Grok tooling (`update_goal`), if `Decision: set-now` and the goal is **not** Active:

1. Emit the Goal Gate block with `Next: wait for user /goal`.
2. Emit a copy-ready `/goal <objective>` immediately below (full contract, no placeholders).
3. State that `/goal-gate` ≠ `/goal` and that Grok has no agent-side create API (unlike Codex `create_goal`).
4. **Stop.** Do not implement the plan yet. Do not call `update_goal` in any form.
5. Soft-adopt only if the user explicitly opted out of durable mode; still no `update_goal` until Active.

For Grok tooling, after the goal is **Active** (user pasted `/goal`, confirmed Active, or prior Active goal continues):

1. Work the contract toward the done condition.
2. Call `update_goal` with a short `message` at checkpoints.
3. Call `update_goal` with `completed: true` **only** after the done condition is proven by surfaced evidence — never mark complete on hope, partial work, or an inactive session.
4. Call `update_goal` with `blocked_reason` when a stop-or-ask condition fires after genuine stuckness (credentials, approval, repeated failure), not for routine questions.
5. Do not invent `create_goal` / `get_goal`. Do not silently clear or replace an active goal.
6. If `update_goal` returns `Goal is not Active`, stop using it, re-emit the copy-ready `/goal`, and ask the user to activate — do not retry `completed: true` hoping it works.

For Codex tooling, if `Decision: set-now`, call `get_goal` first when available. If no active goal exists, call `create_goal` with the `Objective`; do not set a token budget unless the user explicitly requested one. If an active goal conflicts with a new objective, ask before mutation. For an explicit exact-same or compatible-contained continuation, keep the Goal active and work with `Next: continue active goal`; Codex's status-only `update_goal` is terminal, not a progress channel. A contained checkpoint cannot complete the parent Goal. For a terminal action owned by the same Goal, use only the advertised Codex schema: `status: "complete"` after evidence proves the full objective, or `status: "blocked"` only after the same blocker persists for at least three consecutive goal turns. Never send Grok's `message`, `completed`, or `blocked_reason` fields to Codex.

## Workflow-Gate Relationship

`workflow-gate` is optional. If a `Workflow Gate` block is available:

- Treat `Route: Plan`, `Route: Architecture` with `architecture-hardening-loop` plus explicit implement/harden intent, long-running `Light + systematic-debugging`, and broad `verification-before-completion` as stronger goal-fit signals.
- Treat unresolved `Route: Challenge` as `Decision: defer`, `Goal fit: low`, and finish the thesis/spec decision first. Treat diagnose-only `Architecture` without an explicit goal request as `Decision: none`, `Goal fit: low`, and preserve stop-after-report. Re-evaluate after Challenge resolves or an architecture report becomes a scoped implementation. `Route: Direct`, small `Light`, and `Review-Handoff` are otherwise weaker signals unless the user explicitly wants a compatible goal.
- Preserve `workflow-gate` as the workflow router; do not rewrite its route.

If the user is actually asking which workflow to use, emit `Decision: defer` and `Next: route elsewhere`.

## References

Read `references/examples.md` when you need worked examples for Grok tooling, Grok slash, Codex tooling, Codex slash, Claude Code slash, unknown runtime, or workflow-gate interactions.

Read `references/copy-ready-goals.md` when you need to write a polished, direct-copy `/goal` prompt, especially for vague Chinese requests, default-first MVP goals, unknown domains, option lists, and prompt linting. The same `/goal` shape is valid for Grok, Codex, and Claude Code; only the runtime action after the prompt differs.

Use `scripts/lint-goal-prompt.py` when a generated prompt exists as a file or needs deterministic linting.
