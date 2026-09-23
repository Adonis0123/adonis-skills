---
name: goal-gate
description: "Gate whether a coding-agent task benefits from a durable, verifiable contract, then draft, validate, start, continue, or close it for Codex, Grok, Claude Code, Cursor CLI, or an unknown host. Use for explicit goal or /goal requests and autonomous multi-checkpoint coding work with one checkable end state. Native Goal creation or mutation requires an explicit user or system request. Do not use for quick one-shot work, unrelated backlogs, OKRs, reminders, or token-budget-only changes."
metadata:
  author: adonis
  version: "2.1.0"
---

# Goal Gate

`/goal-gate` writes and gates contracts. It does not turn the session into product Goal mode. Only a host with a verified goal facility can do that: Codex via `create_goal`, Grok via the user-run `/goal <objective>`, Claude Code via user `/goal` plus transcript evaluation. Cursor CLI has no verified product `/goal` or goal API; it soft-adopts the contract in the current chat and uses Cursor's native chat resume for continuity.

The contract's value is that it makes "done" checkable against what the user asked for. Most real use is "the plan is agreed, start now and verify it yourself", so the hot path is: emit one honest block, start working, and close with evidence. Anything that does not serve that path is ceremony.

Independent from `workflow-gate`: consume a `Workflow Gate` block when one is present, but do not require one.

## Fast Path

Read **this file only** by default; if the host already injected it, do not re-read it. Load **at most one** reference, and only when needed:

1. Detect runtime with the ordered rules below. Explicit Cursor CLI intent wins over the model-provider name.
2. Classify Goal Fit, then run the Safety Gate.
3. Check Goal authorization, pick one Decision from the table, and emit one `Goal Gate` block per selected runtime.
4. If `set-now`, execute the runtime row. Load `references/runtime-actions.md` only when that row is not enough to act.
5. Load `references/copy-ready-goals.md` only when drafting a user-copyable prompt; `references/examples.md` only when a worked example is needed.

Do not invent goal APIs.

## Runtime Detection

Apply the first matching rule. This order resolves host names that overlap with available tools:

1. `cursor-cli`: the user names Cursor CLI, `cursor-agent`, or `cursor-cli`, or the host is Cursor CLI. This wins even when the selected model is Grok or Claude or ambient goal tools exist. Cursor has no verified `/goal` or goal API; chat resume restores conversation context only.
2. Prompt-only slash runtime: the user asks only for text to copy or review. Use `grok-slash`, `codex-slash`, or `claude-code-slash` from the named host. A Grok session exposing `update_goal` is still `grok-slash` for this prompt-only request because no product action was requested.
3. `codex-tooling`: `get_goal` or `create_goal` is available and the request is not prompt-only. A status-only Codex `update_goal` may also be present.
4. `grok-tooling`: Grok-style `update_goal` is available, neither `get_goal` nor `create_goal` is available, and the request is not prompt-only. Only a user-run `/goal` can activate it.
5. Named host without verified tooling: use that host's slash runtime for Grok, Codex, or Claude Code.
6. `unknown`: emit a portable contract, never an executable command.

Never borrow one runtime's fields for another. If the user explicitly requests both a slash prompt and a tooling action, or multiple runtimes, emit one independently usable block per requested runtime.

## Goal Fit

Prefer a goal when all are true: the task is larger than one normal turn; it has one durable end state; completion can be verified from evidence the agent can surface in the transcript; the agent can make useful progress without frequent steering; stop or ask conditions can be stated up front.

Avoid a goal for single-step lookups, typo fixes, small edits, or commit-message work; open-ended exploration with no stopping condition; product or architecture choices that still need `grilling` (Route: Challenge); destructive, irreversible, billing, auth, production-data, or schema-breaking work before explicit approval; a loose backlog of unrelated tasks.

For vague but low-risk work, prefer a goal with safe defaults over a clarification loop. Ask only when the answer materially changes cost, risk, ownership, product direction, or write boundaries.

## Safety Gate

Before any automatic action, check for conditions that must keep a human in the loop. If any holds, do not auto-set: emit `Decision: suggest` or `Decision: defer` and ask first, even when goal fit is high.

- Destructive, irreversible, billing, auth, production-data, or schema-breaking action whose concrete scope is not yet authorized. Check the action and existing approval, not domain keywords: read-only diagnosis and explicitly authorized isolated local tests can proceed. Prior approval covers only its stated paths, environment, and effects; a new production target, security change, or expanded effect needs its own gate.
- A goal is already active **and** the new objective conflicts with it, or the user has not chosen how to handle it. Never replace or mutate it silently; ask whether to continue, complete, block, pause, clear, or replace it (`Decision: defer`). Same-goal management covers an exact objective match and a contained checkpoint whose parent Goal's objective, frozen scope, and Done condition explicitly include it and whose parent pipeline the user already authorized. Verify containment from evidence; it never permits scope expansion or narrowing the parent's Done condition.
- The objective still needs a design or scoping decision that `grilling` (Route: Challenge) should resolve.
- Verification cannot run, so completion could never be proven.

An auto-started goal hands the agent a long leash; that is only safe when the end state is reversible-or-approved, unambiguous, and checkable. When in doubt, `suggest`. High-risk work can still get a discovery-first or approval-first draft, but never present a production write, destructive migration, auth rewrite, billing change, or regulated-domain decision as immediately executable.

## Goal Authorization and Decision

Creating, replacing, completing, or blocking a native product Goal is a state change separate from doing the task. It is authorized only when the user or system explicitly asks to use, set, create, continue, complete, or block a Goal; invokes `$goal-gate` or `/goal-gate`; or invokes a parent workflow whose declared contract owns a Goal. A large, autonomous, or high-fit task does **not** by itself authorize `create_goal`, `update_goal`, or a user-run `/goal`.

When the work is authorized but native Goal state is not, adopt the contract in the transcript and keep working: native-capable runtimes report `Decision: suggest` / `Next: adopt goal and continue`; transcript-only runtimes may report `set-now` because no product state changes. Neither claims a native Goal became Active, and neither stops for a redundant approval round. Goal fit is not a second permission gate for already authorized work.

| Situation                                                                                | Decision             | Next                                                      |
| ---------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| High fit, native-capable runtime, no explicit Goal action                                | `suggest`            | `adopt goal and continue`; no native Goal mutation        |
| High fit, transcript-only runtime, no explicit Goal action                               | `set-now`            | `adopt goal and continue`; no product Goal claim          |
| Explicit Goal action, high fit, safety clear                                             | `set-now`            | Runtime row below                                         |
| Medium fit, safety clear                                                                 | `suggest`            | `provide prompt`; continue authorized task work           |
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

A contained checkpoint reports progress but leaves completion to the parent Goal owner. Never call a completion action, or tell the user to clear a goal, merely to make replacement convenient.

### Runtime action on `set-now`

| Runtime                                      | Next                                                                  | Do now                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cursor-cli`                                 | `adopt goal and continue`; same-chat resume → `continue adopted goal` | No `/goal`. No `get_goal` / `create_goal` / `update_goal`. Work in this chat; report evidence in the transcript. Resume restores chat context only. Prompt-only → `suggest` / `provide prompt` with a plain prompt. Ask/Plan modes are read-only — say so instead of claiming writes started. |
| `grok-tooling` (not Active, explicit Goal)   | `wait for user /goal`                                                 | Emit the block and a full copy-ready `/goal` first, then **stop**. No implementation. No `update_goal`. `/goal-gate` ≠ `/goal`. Without explicit Goal authorization → `suggest` / `adopt goal and continue`, still no `update_goal` until Active.                                             |
| `grok-tooling` (Active, same/contained)      | `continue active goal`                                                | Work the contract. Checkpoint with Grok `message`. No second `/goal`. No `create_goal` / `get_goal`. `completed: true` only after the full parent Done condition is proven.                                                                                                                   |
| `grok-tooling` (Active, Done proven)         | `report via update_goal`                                              | Grok `completed: true` plus a concise evidence `message`. Never Codex `status`.                                                                                                                                                                                                               |
| `grok-slash`                                 | usually `provide prompt`                                              | Copy-ready `/goal`. Soft-adopt only if the user also authorized execution without durable mode.                                                                                                                                                                                               |
| `codex-tooling` (no active, explicit Goal)   | `create goal`                                                         | `get_goal` then `create_goal` with the `Objective`. No token budget unless asked. Without explicit Goal authorization → `suggest` / `adopt goal and continue`; no `create_goal`.                                                                                                              |
| `codex-tooling` (same/contained, not done)   | `continue active goal`                                                | Keep working. No `create_goal`, no replacement, no terminal `update_goal`. A contained checkpoint cannot complete the parent.                                                                                                                                                                 |
| `codex-tooling` (Done proven / 3-turn block) | `report via update_goal`                                              | Codex `status: "complete"` after evidence, or `status: "blocked"` only after the same blocker persists ≥3 consecutive goal turns. Never Grok `message` / `completed` / `blocked_reason`.                                                                                                      |
| `claude-code-slash` / `codex-slash`          | `adopt goal and continue`                                             | Self-adopt and start working in the same reply. `Prompt: none` unless the user asked for a reusable prompt or a fresh-session handoff — the block already is the contract. Claude: surface verification in the transcript; the evaluator does not read files or run commands.                 |
| `unknown`                                    | `ask approval`                                                        | Portable contract only.                                                                                                                                                                                                                                                                       |

Why an explicitly requested Grok Goal waits: Codex `create_goal` can activate from the agent; Grok cannot. A false Active session produces `Goal is not Active` failures.

## Goal Drafting

A contract is only as good as its Done condition. Write it so the user could check it without asking you what you meant.

- **Anchor on the user's source.** When the request names a plan, spec, PRD, TAPD item, Figma node, or earlier agreed summary, the Objective and Done condition point at that source and its acceptance items (e.g. "spec 验收 1–11", "Figma 126981-1056780"). If you exclude, defer, or reinterpret any source item, name it on a `Stop or ask when` / Constraints line as your own call to confirm. Silent narrowing is what later turns "done" into "你没按文档做".
- **Verify on the user's acceptance path.** If the user will judge the result in a page, device, design, or command, Verification must exercise that path for each acceptance item (real interaction in the named browser tool, Figma comparison of the named nodes, the actual command) — unit tests and typecheck are necessary, not sufficient. When the user adds `/chrome-dev-mcp`, `/ego-browser`, or "做完要自己验收", that browser check is part of Done.
- **Add no unrequested delivery.** Do not put commit, push, MR, deploy, message sending, or external writes into Done or Checkpoints unless the user asked. Default: changes stay in the working tree.
- Include concrete outcome, verification evidence, constraints protecting unrelated behavior/data/secrets/default branches/public contracts, write boundaries, an execution strategy, bounded iteration, and pause conditions (credentials, payments, production data, destructive actions, legal/medical/financial judgment, copyrighted assets, unclear ownership, repeated blockers).
- No placeholders (`[path]`, `TODO`, `TBD`) in a copyable draft unless the user asked for a template. For unfamiliar or specialized domains, write a discovery-first goal (project docs, sample data, official references, runtime evidence) instead of inventing domain rules.

For Chinese-first users, write the copy-ready prompt in Chinese. Keep the `/goal` prefix only for verified slash runtimes; Cursor CLI gets a plain prompt. Add numbered options only when a choice materially changes scope, risk, or direction; add an English mirror only when asked or needed for portability.

**Execution strategy.** Decide single-agent vs delegated vs parallel from dependency order, shared context or state, write overlap, output volume, independently verifiable subtasks, coordination cost, and runtime support — never from size alone. One agent for tightly coupled or sequential work; subagents for bounded self-contained tasks or high-volume read-only research; parallel only without shared mutable state or conflicting writes. An installed orchestration skill (e.g. `subagent-driven-development`, `dispatching-parallel-agents`) is optional. The main agent passes constraints down, reviews returned work, resolves conflicts, and runs final integration verification; subagents never declare the whole goal complete. Fall back to one agent when subagents are unavailable or not worth the coordination.

If a slash-runtime `/goal` is saved to a file or the user asks to validate one, run `scripts/lint-goal-prompt.py <file>` and fix what it reports. Not for Cursor CLI's plain prompt: apply `references/copy-ready-goals.md` § Quality Checks directly, and never add `/goal` merely to satisfy the script.

## Output Contract

Emit this block once, then act:

```text
Goal Gate
- Decision: <none | suggest | set-now | defer>
- Runtime: <grok-tooling | grok-slash | codex-tooling | codex-slash | claude-code-slash | cursor-cli | unknown>
- Goal fit: <low | medium | high>
- Objective: <one durable objective or n/a>
- Done condition: <verifiable stopping condition or n/a>
- Verification: <commands/artifacts/evidence the agent must surface or n/a>
- Constraints: <scope/safety/must-not-change limits or n/a>
- Execution strategy: <single-agent vs delegated vs parallel and why, or n/a>
- Checkpoints: <progress reporting cadence or n/a>
- Stop or ask when: <blocked/risky/ambiguous/destructive/budget condition or n/a>
- Prompt: <runtime-specific goal prompt, "see Recommended /goal below", or none>
- Next: <create goal | continue active goal | wait for user /goal | adopt goal and continue | continue adopted goal | report via update_goal | provide prompt | ask approval | continue without goal | route elsewhere>
```

Keep it concise. If the prompt is longer than one short line, write `Prompt: see Recommended /goal below` and put the copy-ready prompt right under the block. On Grok with `Next: wait for user /goal`, the copy-ready `/goal` comes first under the block, then stop.

For a Chinese-first copy-ready prompt, use as needed: `推荐执行版（中文，可直接复制）`, `默认选择理由` (required whenever you filled a gap with a default, so the user can see and override the assumption), `可选调整`, `你可以直接回复`, and `Goal Draft (English-compatible)` when requested. Every executable copy-ready prompt carries an `执行编排：` or `Execution strategy:` line, shorter than the outcome and verification unless delegation is the main risk.

## Closing an adopted contract

The final report is where false completion happens. Map each Done item to the evidence you surfaced (command + result, screenshot or page state, Figma comparison), and mark anything not exercised on the acceptance path as `UNVERIFIED` with the reason. Say "done" only when every Done item has evidence; otherwise report what is proven, what is `UNVERIFIED`, and what remains. A native Goal is completed only through its runtime row after this mapping holds.

## Workflow-Gate Relationship

If a `Workflow Gate` block is available: `Route: Plan`, implement/harden `Route: Architecture` with `architecture-hardening-loop`, long-running `Light + systematic-debugging`, and broad `verification-before-completion` are stronger goal-fit signals. `Route: Direct`, small `Light`, and `Review-Handoff` are weaker unless the user explicitly wants a goal. Unresolved `Route: Challenge` and diagnose-only `Architecture` follow the Decision table; re-evaluate after Challenge resolves or the report becomes a scoped implementation. Do not rewrite the workflow-gate route. If the user is asking which workflow to use, emit `Decision: defer`, `Next: route elsewhere`.
