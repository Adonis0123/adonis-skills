---
name: goal-gate
description: "Gate whether a coding-agent task benefits from a durable, verifiable contract, then draft, validate, start, continue, or close it for Codex, Grok, Claude Code, Cursor CLI, or an unknown host. Use for explicit goal or /goal requests and autonomous multi-checkpoint coding work with one checkable end state. Native Goal creation or mutation requires an explicit user or system request. Do not use for quick one-shot work, unrelated backlogs, OKRs, reminders, or token-budget-only changes."
metadata:
  author: adonis
  version: "2.0.1"
---

# Goal Gate

`/goal-gate` writes and gates contracts. It does not turn the session into product Goal mode. Only a host with a verified goal facility can do that: Codex via `create_goal`, Grok via the user-run `/goal <objective>`, Claude Code via user `/goal` plus transcript evaluation. Cursor CLI has no verified product `/goal` or goal API; it soft-adopts the contract in the current chat and uses Cursor's native chat resume for continuity.

Independent from `workflow-gate`: consume a `Workflow Gate` block when one is present, but do not require one.

## Fast Path

Read **this file only** by default. Load **at most one** reference.

1. Detect runtime with the ordered rules below. Explicit Cursor CLI intent wins over the model-provider name.
2. Classify Goal Fit, then run the Safety Gate.
3. Determine whether the user or system explicitly requested a Goal action, then pick one Decision from the Auto-Set table and emit one `Goal Gate` block per selected runtime.
4. If `set-now`, execute the compact runtime action in the table. Load `references/runtime-actions.md` only when that row is not enough to act.
5. Load `references/copy-ready-goals.md` only when drafting a user-copyable prompt. Load `references/examples.md` only when a worked example is needed.

Do not load two references in the same turn. Do not invent goal APIs.

## Runtime Detection

Apply the first matching rule. This order resolves host names that overlap with available tools:

1. `cursor-cli`: the user names Cursor CLI, `cursor-agent`, or `cursor-cli`, or the host is Cursor CLI. This wins even when the selected model is Grok or Claude or ambient goal tools exist. Cursor has no verified `/goal` or goal API; chat resume restores conversation context only.
2. Prompt-only slash runtime: the user asks only for text to copy or review. Use `grok-slash`, `codex-slash`, or `claude-code-slash` from the named host. A Grok session exposing `update_goal` is still `grok-slash` for this prompt-only request because no product action was requested.
3. `codex-tooling`: `get_goal` or `create_goal` is available and the request is not prompt-only. A status-only Codex `update_goal` may also be present.
4. `grok-tooling`: Grok-style `update_goal` is available, neither `get_goal` nor `create_goal` is available, and the request is not prompt-only. Only a user-run `/goal` can activate it.
5. Named host without verified tooling: use that host's slash runtime for Grok, Codex, or Claude Code.
6. `unknown`: emit a portable contract, never an executable command.

Never borrow one runtime's fields for another. If the user explicitly requests both a slash prompt and a tooling action, or requests multiple runtimes, emit one independently usable block per requested runtime.

## Goal Fit

Prefer a goal when all are true: the task is larger than one normal turn; it has one durable end state; completion can be verified from evidence the agent can surface in the transcript; the agent can make useful progress without frequent human steering; stop or ask conditions can be stated before work starts.

Avoid a goal for single-step lookups, typo fixes, small edits, or commit-message work; open-ended exploration with no measurable stopping condition; product or architecture choices that still need `grilling` (Route: Challenge) or `discuss-before-plan`; destructive, irreversible, billing, auth, production-data, or schema-breaking work before explicit human approval; a loose backlog of unrelated tasks.

For vague but low-risk work, prefer a goal with safe defaults over a clarification loop. Ask only when the answer materially changes cost, risk, ownership, product direction, or write boundaries.

## Safety Gate

Before any automatic action, check for conditions that must keep a human in the loop. If any holds, do not auto-set: emit `Decision: suggest` or `Decision: defer` and ask first, even when goal fit is high.

- Destructive, irreversible, billing, auth, production-data, or schema-breaking work.
- A goal is already active **and** the new objective conflicts with it, or the user has not chosen how to handle it. Never replace or mutate that goal silently; ask whether to continue, complete, block, pause, clear, or replace it, and emit `Decision: defer`. Same-Goal management includes both an exact objective match and a contained checkpoint when the active Goal's objective, frozen scope, and Done condition explicitly include that checkpoint and the user already authorized the parent pipeline. Verify this relationship from evidence; compatible containment never permits scope expansion or narrowing the parent's Done condition.
- The objective still needs a design or scoping decision that `grilling` (Route: Challenge) or `discuss-before-plan` should resolve.
- Verification cannot run, so completion could never be proven from evidence.

The gate exists because an auto-started goal hands the agent a long leash. That leash is only safe when the end state is reversible-or-approved, unambiguous, and checkable. When in doubt, fall back to `suggest` — the cost of asking once is small next to a goal that runs off in the wrong direction.

High-risk work can still receive a goal draft, but the draft must be discovery-first or approval-first. Do not present a production write, destructive migration, auth rewrite, billing change, or regulated-domain decision as an immediately executable action.

## Goal authorization

Creating, replacing, completing, or blocking a native product Goal is a separate state change from doing the underlying task. Treat it as authorized only when the user or system explicitly asks to use, set, create, continue, complete, or block a Goal; invokes `$goal-gate` or `/goal-gate`; or invokes a parent workflow whose declared contract explicitly owns a Goal. A merely large, autonomous, or high-fit task does **not** authorize `create_goal`, `update_goal`, or a user-run `/goal` by itself.

When work is authorized but native Goal state is not, adopt the checkable contract in the current transcript and continue the work. Report `Decision: suggest` with `Next: adopt goal and continue`; do not stop for a redundant approval round and do not claim product Goal state became Active.

## Auto-Set

When the safety gate is clear and goal fit is `high`, start the authorized work under a transcript contract. This does not by itself authorize native Goal state. Hold auto-adoption for `medium` fit: the medium boundary is fuzzy enough that a quick nod is worth more than the saved round-trip. `low` fit is `none`.

Native `set-now` requires explicit Goal authorization or an already-authorized exact-same / compatible-contained continuation. A high-fit task without that authorization uses `suggest` plus `adopt goal and continue` on a native-capable runtime; transcript-only runtimes may use `set-now` because no product state is mutated. Both start the task without claiming a native Goal became Active. A contained checkpoint reports progress but leaves completion to the parent Goal owner. Same-goal complete/block uses `Next: report via update_goal` only after its terminal preconditions are proven. If an active goal conflicts with a new objective or the desired action is unclear, emit `Decision: defer` and ask; never call either runtime's completion action or tell the user to clear a goal merely to make replacement convenient.

| Situation                                                                                | Decision             | Next                                                      |
| ---------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| High fit, native-capable runtime, no explicit Goal action                                | `suggest`            | `adopt goal and continue`; no native Goal mutation        |
| High fit, transcript-only runtime, no explicit Goal action                               | `set-now`            | `adopt goal and continue`; no product Goal claim          |
| Explicit Goal action, high fit, safety clear                                             | `set-now`            | Runtime action below                                      |
| Medium fit, safety clear                                                                 | `suggest`            | `provide prompt` or `ask approval`                        |
| Safety tripped (auth, destructive, production-data, irreversible, billing, unverifiable) | `suggest` or `defer` | `ask approval` (or `route elsewhere`); do not auto-create |
| Conflicting or unchosen active goal                                                      | `defer`              | Ask continue / complete / block / pause / clear / replace |
| Exact-same or compatible-contained continuation                                          | `set-now`            | `continue active goal`                                    |
| Same-goal proven complete or 3-turn persistent block                                     | `set-now`            | `report via update_goal`                                  |
| User asked only for text to copy or review                                               | `suggest`            | `provide prompt`                                          |
| Low fit (typo, one-shot, no durable end state)                                           | `none`               | `continue without goal`; Prompt `none`                    |
| User is asking which workflow/route to use                                               | `defer`              | `route elsewhere`                                         |
| Unresolved `Route: Challenge`                                                            | `defer` (fit `low`)  | Finish the thesis/spec first                              |
| Diagnose-only `Route: Architecture` without a goal request                               | `none` (fit `low`)   | Preserve stop-after-report                                |
| Runtime `unknown`                                                                        | do not auto-execute  | `ask approval`                                            |

### Runtime action on `set-now`

| Runtime                                      | Next                                                                  | Do now                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cursor-cli`                                 | `adopt goal and continue`; same-chat resume → `continue adopted goal` | No `/goal`. No `get_goal` / `create_goal` / `update_goal`. Work in this chat; report evidence in the transcript. Resume commands restore chat context only (see Runtime Detection). Prompt-only → `suggest` / `provide prompt` with a plain prompt. Ask/Plan are read-only — surface the mode constraint instead of claiming writes started. |
| `grok-tooling` (not Active, explicit Goal)   | `wait for user /goal`                                                 | Emit the block and a full copy-ready `/goal` first, then **stop**. No implementation. No `update_goal`. `/goal-gate` ≠ `/goal`. Without explicit Goal authorization → `suggest` / `adopt goal and continue`, still no `update_goal` until Active.                                                                                            |
| `grok-tooling` (Active, same/contained)      | `continue active goal`                                                | Work the contract. Checkpoint with Grok `message`. Do not emit a second `/goal`. Do not invent `create_goal` / `get_goal`. `completed: true` only after the full parent Done condition is proven.                                                                                                                                            |
| `grok-tooling` (Active, Done proven)         | `report via update_goal`                                              | Grok `completed: true` plus a concise evidence `message`. Never Codex `status`.                                                                                                                                                                                                                                                              |
| `grok-slash`                                 | usually `provide prompt`                                              | Copy-ready `/goal`. Soft-adopt only if the user also authorized execution without durable mode.                                                                                                                                                                                                                                              |
| `codex-tooling` (no active, explicit Goal)   | `create goal`                                                         | `get_goal` then `create_goal` with the `Objective`. No token budget unless the user asked. Without explicit Goal authorization → `suggest` / `adopt goal and continue`; do not call `create_goal`.                                                                                                                                           |
| `codex-tooling` (same/contained, not done)   | `continue active goal`                                                | Keep working. No `create_goal`, no replacement, no terminal `update_goal`. A contained checkpoint cannot complete the parent.                                                                                                                                                                                                                |
| `codex-tooling` (Done proven / 3-turn block) | `report via update_goal`                                              | Codex `status: "complete"` after evidence, or `status: "blocked"` only after the same blocker persists ≥3 consecutive goal turns. Never Grok `message` / `completed` / `blocked_reason`.                                                                                                                                                     |
| `claude-code-slash` / `codex-slash`          | `adopt goal and continue`                                             | Self-adopt and keep working. Still emit `/goal` for reuse. Claude: surface verification in the transcript — the evaluator does not independently read files or run commands.                                                                                                                                                                 |
| `unknown`                                    | `ask approval`                                                        | Portable contract only.                                                                                                                                                                                                                                                                                                                      |

Why an explicitly requested Grok Goal waits: Codex `create_goal` can activate from the agent; Grok cannot. A false Active session is what produces `Goal is not Active` failures.

## Goal Drafting

For any prompt or contract that a user may copy, make the first executable draft complete. Do not leave placeholders such as `[path]`, `TODO`, or `TBD` unless the user explicitly asked for a template.

A strong goal includes: one concrete outcome; verification evidence (commands, logs, screenshots, files, URLs, API checks, artifact paths); constraints that protect unrelated behavior, data, secrets, default branches, and public contracts; write boundaries and forbidden paths; an execution strategy that assesses whether subagents help without weakening ownership or verification; bounded iteration; a done condition that proves completion; pause conditions for credentials, payments, production data, destructive actions, legal/medical/financial judgment, copyrighted assets, unclear ownership, or repeated blockers.

For Chinese-first users, write the primary copy-ready prompt in Chinese. Keep the executable command prefix `/goal` only for verified slash runtimes; for Cursor CLI, provide a plain prompt without `/goal`. Include a concise default reason when you made assumptions. Add numbered options only when a choice would materially change scope, risk, or direction. Include an English-compatible mirror only when the user asks for portability, English, Claude/Codex cross-use, or a complete bilingual draft.

For unfamiliar or specialized domains, do not invent domain rules. Write a discovery-first goal that makes the agent inspect project docs, sample data, official references, and runtime evidence before implementation.

## Delegation Policy

For every executable goal, require the main agent to assess the execution strategy before implementation. Judge task complexity together with dependency order, shared context or state, write overlap, output volume, independently verifiable subtasks, coordination cost, and runtime support. Do not delegate merely because a task is large.

- Prefer one agent for quick targeted changes, tightly coupled work, sequential dependencies, or work that needs frequent shared-context refinement.
- Consider subagents for bounded self-contained tasks, high-volume read-only research or test/log analysis, or two or more independent problem domains.
- Parallelize only when tasks have no sequential dependency, shared mutable state, or conflicting write surface.
- Prefer an installed orchestration skill when one fits, such as `subagent-driven-development` for independent tasks in an implementation plan or `dispatching-parallel-agents` for independent problem domains. Treat these as optional capabilities, not hard dependencies.
- Keep the main agent accountable for the aggregate goal: pass down relevant constraints, review returned work and diffs, resolve conflicts, and run final integration verification. Subagents must not broaden scope or declare the whole goal complete.
- Fall back to single-agent execution when subagents are unavailable or their coordination cost exceeds the expected benefit.

If a slash-runtime `/goal` is saved to a file or the user asks to validate one, run `scripts/lint-goal-prompt.py <file>` and fix any missing labels, placeholders, unsafe vague wording, or thin verification. The linter is not for Cursor CLI's plain prompt: apply `references/copy-ready-goals.md` § Quality Checks directly, and never add `/goal` merely to satisfy the script.

## Output Contract

Emit this block:

```text
Goal Gate
- Decision: <none | suggest | set-now | defer>
- Runtime: <grok-tooling | grok-slash | codex-tooling | codex-slash | claude-code-slash | cursor-cli | unknown>
- Goal fit: <low | medium | high>
- Objective: <one durable objective or n/a>
- Done condition: <verifiable stopping condition or n/a>
- Verification: <commands/artifacts/evidence the agent must surface or n/a>
- Constraints: <scope/safety/must-not-change limits or n/a>
- Execution strategy: <how to assess single-agent vs delegated vs parallel execution, or n/a>
- Checkpoints: <progress reporting cadence or n/a>
- Stop or ask when: <blocked/risky/ambiguous/destructive/budget condition or n/a>
- Prompt: <runtime-specific goal prompt, "see Recommended /goal below", or none>
- Next: <create goal | continue active goal | wait for user /goal | adopt goal and continue | continue adopted goal | report via update_goal | provide prompt | ask approval | continue without goal | route elsewhere>
```

Keep the block concise. If the prompt is longer than one short line, put `Prompt: see Recommended /goal below`, then emit the copy-ready prompt immediately below the block.

On Grok when `Next: wait for user /goal`, put the copy-ready `/goal` first in the user-visible reply (right under the block), then stop.

When emitting a copy-ready prompt for a Chinese-first user, use this order as needed:

1. `推荐执行版（中文，可直接复制）`
2. `默认选择理由`
3. `可选调整`
4. `你可以直接回复`
5. `Goal Draft (English-compatible)` when requested or useful for portability

Every executable copy-ready prompt must include an `执行编排：` or `Execution strategy:` line that carries the Delegation Policy. Keep it shorter than the task-specific outcome and verification unless delegation is the main risk.

## Workflow-Gate Relationship

`workflow-gate` is optional. If a `Workflow Gate` block is available:

- Treat `Route: Plan`, `Route: Architecture` with `architecture-hardening-loop` plus explicit implement/harden intent, long-running `Light + systematic-debugging`, and broad `verification-before-completion` as stronger goal-fit signals.
- Treat unresolved `Route: Challenge` as `Decision: defer`, `Goal fit: low`, and finish the thesis/spec decision first. Treat diagnose-only `Architecture` without an explicit goal request as `Decision: none`, `Goal fit: low`, and preserve stop-after-report. Re-evaluate after Challenge resolves or an architecture report becomes a scoped implementation. `Route: Direct`, small `Light`, and `Review-Handoff` are otherwise weaker signals unless the user explicitly wants a compatible goal.
- Preserve `workflow-gate` as the workflow router; do not rewrite its route.

If the user is actually asking which workflow to use, emit `Decision: defer` and `Next: route elsewhere`.
