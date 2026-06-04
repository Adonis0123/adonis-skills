---
name: goal-gate
description: "Use this skill when the user wants to set, write, or use a goal or /goal that makes a coding agent keep working until a verifiable done condition is met. This skill configures the autonomy and stopping contract for Codex, Claude Code, or portable agent prompts; it does not perform the underlying task. Trigger on requests like 'should I set a goal?', 'set up a durable goal', 'give me a /goal prompt', 'keep refactoring until tests pass', 'I am stepping away, have the agent finish this', or goal prompts for migrations, refactors, ports, spec implementations, eval loops, backlog cleanup, or multi-checkpoint work. Do not use for single quick edits, running tests once, OKR/scrum goal questions, recurring reminders, or token-budget settings."
metadata:
  author: adonis
---

# Goal Gate

## Overview

Use this skill to decide whether the current task deserves a durable goal and to write the goal prompt or contract. This skill is independent from `workflow-gate`: consume a `Workflow Gate` block when one is already present, but do not require one.

## Workflow

1. Identify the runtime.
2. Check whether an active goal exists if the runtime exposes goal status tools.
3. Classify goal fit, then run the safety gate.
4. Pick the decision: `high` fit through a clear safety gate is `set-now` (auto-execute); `medium` is `suggest`; a tripped safety gate is `suggest` or `defer`; `low` is `none`.
5. Emit one `Goal Gate` block per selected runtime, then carry out the runtime-specific action when the decision is `set-now`.

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

## Safety Gate

Before any automatic action, check for conditions that must keep a human in the loop. If any holds, do not auto-set: emit `Decision: suggest` or `Decision: defer` and ask first, even when goal fit is high.

- Destructive, irreversible, billing, auth, production-data, or schema-breaking work.
- A goal is already active (for runtimes that expose goal status). Never replace or mutate it silently; ask whether to continue, complete, block, clear, or replace it, and emit `Decision: defer`.
- The objective still needs a design or scoping decision that `brainstorming` or `discuss-before-plan` should resolve.
- Verification cannot run, so completion could never be proven from evidence.

The gate exists because an auto-started goal hands the agent a long leash. That leash is only safe when the end state is reversible-or-approved, unambiguous, and checkable. When in doubt, fall back to `suggest` — the cost of asking once is small next to a goal that runs off in the wrong direction.

## Auto-Set

When the safety gate is clear and goal fit is `high`, treat the goal as authorized and start it now — do not stop to ask "should I set a goal?" The high-fit bar (one durable end state, verifiable from surfaced evidence, the agent can make progress without steering) is itself the signal that autonomy will help rather than hurt, so a confirmation round-trip mostly adds latency.

How `set-now` executes depends on the runtime:

- `codex-tooling`: call `get_goal` first when available; if no goal is active, call `create_goal` with the `Objective`. Do not set a token budget unless the user asked for one.
- `codex-slash` / `claude-code-slash`: there is no goal API to call, so adopt the goal contract yourself — keep working toward the done condition, reporting at the checkpoints, until it is met or a stop-or-ask condition fires. Still emit the `/goal` prompt so the user can re-run it as a durable goal in a fresh session.
- `unknown`: capabilities are uncertain, so do not auto-execute. Emit a portable contract with `Next: ask approval` and let the user start it.

Hold the auto-set for `medium` fit: stay on `suggest`, because the medium boundary is fuzzy enough that a quick nod from the user is worth more than the saved round-trip. `low` fit is `none`.

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
- Checkpoints: <progress reporting cadence or n/a>
- Stop or ask when: <blocked/risky/ambiguous/destructive/budget condition or n/a>
- Prompt: <runtime-specific goal prompt or none>
- Next: <create goal | adopt goal and continue | provide prompt | ask approval | continue without goal | route elsewhere>
```

Keep the block concise. Put long examples, if needed, below the block.

## Prompt Rules

A good goal prompt states:

- one objective;
- one done condition;
- the exact evidence or commands that prove completion;
- constraints that must not be violated;
- checkpoint reporting expectations;
- when to stop or ask instead of continuing.

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
