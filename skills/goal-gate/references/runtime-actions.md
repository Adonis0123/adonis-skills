# Runtime Actions

Load this file only when the compact runtime row in `SKILL.md` is not enough to execute `set-now` or a same-goal management action. Do not load it together with `copy-ready-goals.md` or `examples.md`.

`/goal-gate` drafts and gates contracts. Only a host with a verified goal facility can enter product goal mode. Never invent APIs that the runtime does not advertise.

## Grok tooling — goal not Active

Grok has no `create_goal` / `get_goal`. Only the user-run slash `/goal <objective>` can make the session Active; `update_goal` fails until then.

On `set-now`:

1. Emit the Goal Gate block **and** the full copy-ready `/goal <objective>` **before** any multi-step implementation.
2. Set `Next: wait for user /goal`. **Stop.** Do not start the implementation plan, do not call `update_goal` (`message`, `completed`, or `blocked_reason`), and do not claim durable goal mode is on.
3. One short line of truth: `/goal-gate` drafted the contract; the user must paste `/goal …` (or confirm the goal is already Active) to light product goal mode.
4. After the user pastes `/goal …`, says the goal is active, or `/goal status` shows Active — then work the contract and report with `update_goal` (`message` at checkpoints; `completed: true` only when verification proves the done condition; `blocked_reason` only when genuinely stuck).
5. Soft-adopt exception: if the user explicitly declines durable mode ("just do the work, no `/goal`", "soft only", "不要原生 goal"), set `Next: adopt goal and continue`, work without waiting, and still **never** call `update_goal` until Active.

Why Grok waits: Codex `create_goal` can activate from the agent. Grok cannot. Pretending `set-now` already activated Grok goal mode produces `Goal is not Active` failures and confuses `/goal-gate` with `/goal`. Stopping once for a paste is cheaper than a false durable session.

On Grok when `Next: wait for user /goal`, put the copy-ready `/goal` first in the user-visible reply (right under the block), then stop. Do not bury it after implementation notes or a completion summary.

If `update_goal` returns `Goal is not Active`, stop using it, re-emit the copy-ready `/goal`, and ask the user to activate — do not retry `completed: true` hoping it works.

## Grok tooling — goal already Active

If the user explicitly continues the exact objective or a demonstrably contained checkpoint, use `Decision: set-now`, `Next: continue active goal`, work the contract, and use Grok's progress `message` as above. Do not invent `create_goal` / `get_goal`. Do not silently clear or replace the active goal; a contained checkpoint leaves completion to the parent owner, and `completed: true` is allowed only after the full Goal done condition is proven.

After Active:

1. Work the contract toward the done condition.
2. Call `update_goal` with a short `message` at checkpoints.
3. Call `update_goal` with `completed: true` **only** after the done condition is proven by surfaced evidence — never mark complete on hope, partial work, or an inactive session. Include a concise evidence-bearing `message` when closing.
4. Call `update_goal` with `blocked_reason` when a stop-or-ask condition fires after genuine stuckness (credentials, approval, repeated failure), not for routine questions.
5. Do not invent `create_goal` / `get_goal`. Do not silently clear or replace an active goal.
6. Same-goal complete uses `Next: report via update_goal` only after the terminal preconditions are proven. Never send Codex `status: "complete"` / `status: "blocked"` fields to Grok.

## Grok slash `/goal`

User asked for a copyable Grok `/goal` (or only a slash prompt). Prefer `Decision: suggest` with `Next: provide prompt` when they only want text to copy. If they also authorized immediate execution without durable mode, soft-adopt is allowed; still never call `update_goal` until Active.

Prompt craft:

- Keep the executable prefix `/goal` (not `/目标`). Body may be Chinese for Chinese-first users.
- Put a concrete, verifiable objective in the first line after `/goal` — Grok stores that string as the autonomous objective across turns.
- Require the agent to surface verification evidence in the transcript (commands, exit codes, logs, screenshots, paths). Grok goal completion may be checked adversarially against the contract; unsourced "done" claims are weak.
- Include execution strategy, iteration bounds, and pause conditions like other runtimes.
- Optionally note management commands when the user is operating an existing goal: `/goal status`, `/goal pause`, `/goal resume`, `/goal clear`.
- Mention that `/goal` appears only when the goal feature is enabled and `update_goal` is in the toolset.

## Codex tooling

If `Decision: set-now`, call `get_goal` first when available. If no goal is active, call `create_goal` with the `Objective` (`Next: create goal`); do not set a token budget unless the user asked for one.

If the active Goal is the exact objective, or demonstrably contains the requested checkpoint in its frozen scope and Done condition, set `Next: continue active goal` and keep working without calling `create_goal` or a terminal `update_goal`. A contained checkpoint never owns parent completion. Work until the Goal owner's full done condition is proven; then call Codex `update_goal({status: "complete"})` when that tool/schema is exposed (`Next: report via update_goal`). Mark `blocked` only after the same blocking condition has persisted for at least three consecutive goal turns and no meaningful progress is possible; ordinary questions, incomplete work, or low remaining budget are not blockers.

If an active goal conflicts with a new objective, ask before mutation (`Decision: defer`). For an explicit exact-same or compatible-contained continuation, keep the Goal active and work with `Next: continue active goal`; Codex's status-only `update_goal` is terminal, not a progress channel.

Use only the advertised Codex schema: `status: "complete"` after evidence proves the full objective, or `status: "blocked"` only after the same blocker persists for at least three consecutive goal turns. Never send Grok's `message`, `completed`, or `blocked_reason` fields to Codex.

## Codex slash `/goal`

There is no create-goal API to call, so adopt the goal contract yourself — keep working toward the done condition, reporting at the checkpoints, until it is met or a stop-or-ask condition fires (`Next: adopt goal and continue`). Still emit the `/goal` prompt so the user can re-run it as a durable goal in a fresh session.

Include the same durable contract and validation loop. If goals may be disabled, tell the user to enable goals before running the prompt.

## Claude Code slash `/goal`

Same adopt-and-emit pattern as Codex slash: `Next: adopt goal and continue`, plus a reusable `/goal` prompt.

Ensure the verification evidence will appear in the conversation, because the evaluator judges from surfaced transcript evidence rather than independently reading files or running commands.

## Cursor CLI

There is no verified product goal API or `/goal` command. Cursor skills may be invoked from `/`, but that invokes the skill, not a product Goal.

- For a high-fit executable request in a mode that permits the work, use `Decision: set-now`, `Next: adopt goal and continue`, emit no `/goal`, and work the contract in the current chat. Report checkpoints and terminal evidence in the transcript only.
- If the same Cursor chat is resumed and its transcript contains the exact adopted contract, use `Next: continue adopted goal`; do not draft a second contract or claim a product Goal is Active.
- In a new chat, draft a fresh contract instead of claiming an old goal is Active.
- Cursor's advertised chat commands restore conversation context, not product goal state: `cursor-agent --resume [chatId]` selects a chat (the supplied ID selects a specific one), `cursor-agent --continue` or `cursor-agent resume` restores the most recent chat, and `cursor-agent ls` opens chat selection. Confirm installed help before promising any option. None creates, pauses, completes, or restores product goal state.
- If the user asks only for text to review or copy, use `Decision: suggest`, `Next: provide prompt`, and provide a plain Cursor prompt without a slash prefix.
- If Ask/Plan mode blocks required writes, surface that runtime constraint and do not claim execution started.

## Unknown

Capabilities are uncertain, so do not auto-execute. Emit a portable contract with `Next: ask approval` and let the user start it. Output a contract, not an executable command.
