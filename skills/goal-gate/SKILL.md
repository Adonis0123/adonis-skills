---
name: goal-gate
description: "Use this skill when the user wants to decide, set, write, or use a durable coding-agent goal or /goal prompt that keeps Codex, Claude Code, or another agent working until a verifiable done condition is met. It gates autonomy, handles runtime differences, and writes copy-ready goal contracts with outcome, verification, constraints, write boundaries, delegation strategy, iteration policy, completion evidence, and pause/ask conditions. Trigger on requests like 'should I set a goal?', 'set up a durable goal', 'give me a /goal prompt', 'turn this vague app idea into a goal', 'keep refactoring until tests pass', 'I am stepping away, have the agent finish this', migrations, refactors, ports, spec implementations, eval loops, backlog cleanup, or multi-checkpoint work. Do not use for single quick edits, running tests once, OKR/scrum goal questions, recurring reminders, or token-budget settings."
metadata:
  author: adonis
---

# Goal Gate

## Overview

Use this skill to decide whether the current task deserves a durable goal and to write a copy-ready goal contract when it does. Keep two jobs separate:

- Gate autonomy: decide `none`, `suggest`, `set-now`, or `defer`.
- Draft the contract: produce a concrete `/goal` or portable prompt with verification, boundaries, delegation, iteration, and pause conditions.

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

| Runtime | Signal | Goal action |
|---|---|---|
| `codex-slash` | The user is in Codex and wants a slash-command prompt, or explicitly asks for Codex `/goal`. | Output a `/goal ...` prompt. |
| `claude-code-slash` | The user is in Claude Code, asks for Claude Code `/goal`, or asks for a Claude Code-compatible prompt. | Output a `/goal ...` prompt tuned for Claude Code evaluation. |
| `codex-tooling` | The session exposes tools such as `get_goal`, `create_goal`, or `update_goal`, and the user did not explicitly ask for a slash-command prompt. | Call goal tools only when the user explicitly asked to set or manage a goal. |
| `unknown` | The runtime cannot be inferred. | Output a portable contract, not an executable command. |

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
- Product or architecture choices that still need `brainstorming` or `discuss-before-plan`.
- Destructive, irreversible, billing, auth, production-data, or schema-breaking work before explicit human approval.
- A loose backlog of unrelated tasks.

For vague but low-risk work, prefer a goal with safe defaults over a clarification loop. Ask only when the answer materially changes cost, risk, ownership, product direction, or write boundaries.

## Safety Gate

Before any automatic action, check for conditions that must keep a human in the loop. If any holds, do not auto-set: emit `Decision: suggest` or `Decision: defer` and ask first, even when goal fit is high.

- Destructive, irreversible, billing, auth, production-data, or schema-breaking work.
- A goal is already active (for runtimes that expose goal status). Never replace or mutate it silently; ask whether to continue, complete, block, clear, or replace it, and emit `Decision: defer`.
- The objective still needs a design or scoping decision that `brainstorming` or `discuss-before-plan` should resolve.
- Verification cannot run, so completion could never be proven from evidence.

The gate exists because an auto-started goal hands the agent a long leash. That leash is only safe when the end state is reversible-or-approved, unambiguous, and checkable. When in doubt, fall back to `suggest` — the cost of asking once is small next to a goal that runs off in the wrong direction.

High-risk work can still receive a goal draft, but the draft must be discovery-first or approval-first. Do not present a production write, destructive migration, auth rewrite, billing change, or regulated-domain decision as an immediately executable action.

## Auto-Set

When the safety gate is clear and goal fit is `high`, treat the goal as authorized and start it now — do not stop to ask "should I set a goal?" The high-fit bar (one durable end state, verifiable from surfaced evidence, the agent can make progress without steering) is itself the signal that autonomy will help rather than hurt, so a confirmation round-trip mostly adds latency.

How `set-now` executes depends on the runtime:

- `codex-tooling`: call `get_goal` first when available; if no goal is active, call `create_goal` with the `Objective`. Do not set a token budget unless the user asked for one.
- `codex-slash` / `claude-code-slash`: there is no goal API to call, so adopt the goal contract yourself — keep working toward the done condition, reporting at the checkpoints, until it is met or a stop-or-ask condition fires. Still emit the `/goal` prompt so the user can re-run it as a durable goal in a fresh session.
- `unknown`: capabilities are uncertain, so do not auto-execute. Emit a portable contract with `Next: ask approval` and let the user start it.

Hold the auto-set for `medium` fit: stay on `suggest`, because the medium boundary is fuzzy enough that a quick nod from the user is worth more than the saved round-trip. `low` fit is `none`.

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

| Decision | Use when | Next behavior |
|---|---|---|
| `none` | Goal fit is low. | Continue without a goal. |
| `suggest` | Goal fit is medium and the safety gate is clear, or the user wants to review the contract before starting. | Provide the contract/prompt and ask for a nod. |
| `set-now` | Goal fit is high and the safety gate is clear, or the user explicitly asked and the goal is verifiable. | Auto-execute the runtime-specific action. |
| `defer` | Scope, decisions, evidence, or an already-active goal block a clean start. | Stop and ask, or route to the smallest prerequisite workflow. |

`set-now` is reached two ways: the user explicitly asks for a goal, or the task clears the safety gate at high goal fit. Do not silently mutate an active goal in `codex-tooling`; if `get_goal` shows one, emit `Decision: defer` and ask what to do with it.

## Output Contract

Emit this block:

```text
Goal Gate
- Decision: <none | suggest | set-now | defer>
- Runtime: <codex-tooling | codex-slash | claude-code-slash | unknown>
- Goal fit: <low | medium | high>
- Objective: <one durable objective or n/a>
- Done condition: <verifiable stopping condition or n/a>
- Verification: <commands/artifacts/evidence the agent must surface or n/a>
- Constraints: <scope/safety/must-not-change limits or n/a>
- Execution strategy: <how to assess single-agent vs delegated vs parallel execution, or n/a>
- Checkpoints: <progress reporting cadence or n/a>
- Stop or ask when: <blocked/risky/ambiguous/destructive/budget condition or n/a>
- Prompt: <runtime-specific goal prompt, "see Recommended /goal below", or none>
- Next: <create goal | adopt goal and continue | provide prompt | ask approval | continue without goal | route elsewhere>
```

Keep the block concise. If the prompt is longer than one short line, put `Prompt: see Recommended /goal below`, then emit the copy-ready prompt immediately below the block.

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

For Codex tooling, if `Decision: set-now`, call `get_goal` first when available. If no active goal exists, call `create_goal` with the `Objective`; do not set a token budget unless the user explicitly requested one. If a goal is active, do not replace it silently; ask the user what to do with the active goal before any goal mutation.

## Workflow-Gate Relationship

`workflow-gate` is optional. If a `Workflow Gate` block is available:

- Treat `Route: Plan`, `Route: Full`, long-running `Light + systematic-debugging`, and broad `verification-before-completion` as stronger goal-fit signals.
- Treat `Route: Direct`, small `Light`, and `Review-Handoff` as weaker goal-fit signals unless the user explicitly wants a goal.
- Preserve `workflow-gate` as the workflow router; do not rewrite its route.

If the user is actually asking which workflow to use, emit `Decision: defer` and `Next: route elsewhere`.

## References

Read `references/examples.md` when you need worked examples for Codex tooling, Codex slash, Claude Code slash, unknown runtime, or workflow-gate interactions.

Read `references/copy-ready-goals.md` when you need to write a polished, direct-copy `/goal` prompt, especially for vague Chinese requests, default-first MVP goals, unknown domains, option lists, and prompt linting.

Use `scripts/lint-goal-prompt.py` when a generated prompt exists as a file or needs deterministic linting.
