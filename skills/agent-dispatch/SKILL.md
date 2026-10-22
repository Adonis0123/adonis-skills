---
name: agent-dispatch
description: "Choose the lightest agent setup for a coding, review, drafting or design-research task: do it yourself, fan out to 2-3 workers with non-overlapping files across the Claude Code, Codex, Grok Build, Cursor or other CLIs and accounts on this machine, run a scoped architecture loop, or send one brief to independent researchers; pick a cross-model reviewer, test budget and cleanup; then track dispatched work, external waits and user decisions on a Run Board the user can open any time. Use when work may need delegation, or the user asks to dispatch, fan out, parallelize, run several agents or accounts, get another AI's review or independent design opinions, or asks how dispatched work is going. Chinese triggers: 派活、并行、多开、分给多个 Claude 账号 / codex / grok、找另一个 AI 审、对比优秀设计、多方意见、进度看板、派出的任务进行到哪了。Not for unrelated read-only questions, trivial edits, research with no delegation, a single review of an existing diff (agentic-review-handoff), or the machine-wide session list (sideby sessions). If one named workflow owns the task, use this only to size workers inside it."
license: MIT
metadata:
  author: adonis
  version: "1.8.0"
---

# Agent Dispatch

One coordinating agent decides how much machinery a task deserves. The scarce resource is the user's attention and the facts only they can confirm, not lines an agent can write. Extra workers speed up only the coding step; integration, review rounds, deploys and status reports grow with every worker. So default to the lightest tier, escalate only on evidence, and say why in one line. The one exception is research before a product or design decision: there breadth is cheap and a correction from the user is expensive, so start at the Research tier.

## Where to read next

| Need                                                              | Read                             |
| ----------------------------------------------------------------- | -------------------------------- |
| Which accounts, pools and products exist; allow-lists; 多开        | `references/accounts.md`         |
| Starting, messaging, resuming or stopping a headless Worker        | `references/launch.md`           |
| Writing a Worker's task spec / a research brief                    | `references/task-spec.md`, `references/research-brief.md` |
| Ledger commands, Board, Orca mode, handoff                        | `references/run-board.md`        |
| Why the Coordinator must stay small, and how                       | `references/context-budget.md`   |
| Terms (Run, Lane, Worker, Ask, Standing Grant)                    | `GLOSSARY.md`                    |

## Composes with

Respect established authority boundaries in order:

- **Order of authority**: `workflow-gate` decides _what kind_ of work (debug / plan / challenge / architecture / review); `agent-dispatch` decides _how many agents and who reviews_; then the selected runtime skill runs.
- **Reviewer selection**: When `agentic-review-handoff` is installed, defer reviewer choice and timeout fallback to its saved Reviewer preference (`review-loop prefs`, `--host`); use this skill's "Reviewer choice" only when it is absent.
- **Full pipelines**: When `task-completion-loop` owns the task, it already runs its own peers and reviews; agent-dispatch only sizes workers inside it and starts no second review loop.
- **Goals**: When a native Goal (via `goal-gate`) is active, dispatch and review as usual, report each batch as a checkpoint of that Goal, and never complete, replace or clear the Goal yourself.
- **Sessions**: sideby `sessions` / `send` are the cross-account session layer; detect each at runtime, keep the per-product fallbacks (`references/launch.md`).
- **Delivery**: Hand integrated work to the repository's own delivery/ship skill or documented flow; if none exists, stop at a local commit made only on explicit user request.

## When the host's own tools are the lighter path

This skill earns its overhead when work crosses products (Codex, Grok, Antigravity) or accounts (quota pools), or when the user wants a Board and numbered Asks. When none of that applies, say so and use the host's native mechanism instead of a Run:

- **Claude Code, one account, all Lanes Claude**: subagents for side tasks whose only output is a summary; `claude agents` (agent view) to hand off independent background sessions the user checks on; Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, experimental) when teammates must share a task list and message each other. Its own docs give the same rule this skill does: check whether a lighter option does the job first, start with 3-5 teammates, partition files because teammates are not isolated in worktrees. Cross-session messaging between sessions you run yourself needs no Run either.
- **Orca is running** and the user already watches its sidebar: use its orchestration (`references/run-board.md` § Orca mode) for the live view and keep this skill's ledger only for Asks, Waits and the milestone report.

Pick a Run when a second product or pool is in play, when a Codex/Grok Worker must be reviewed by a different model, or when the user asked for the Board. State the reason in the dispatch line.

## Step 0 — know what you can dispatch to

Run `python3 scripts/probe_agents.py` (relative to this skill) once per session before choosing a tier above L0, and read `references/accounts.md` for what its fields mean. Two rules that decide tiers: `max_parallel_workers` is the ceiling for L2 (0 means run the parts one after another), and pools come from the probe, never from account names. Do not assume Codex, Grok, Antigravity or extra accounts exist because a plan or a prior session mentioned them; if the probe cannot run, treat the machine as single-product with one pool. When the probe disagrees with what the user said (three accounts named, four found; a product they mentioned is missing), say so in one line and plan from the probe: the user may have forgotten a login, or the machine may not be the one they meant.

## Tier card — decide in one pass

| Tier           | Pick when                                                                                                    | Who writes                                                                                                                    | Review                                                                            | Tests                                                                 | Target                               |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| **L0 Direct**  | read-only, copy, style, static asset, or one file, no behavior change                                        | coordinator, current checkout, no worktree                                                                                    | none                                                                              | page evidence or none                                                 | ~10 min (3-4 rounds)                 |
| **L1 Single**  | behavior change inside one module, about 5 files or fewer                                                    | coordinator, or 1 worker                                                                                                      | one independent pass (see Reviewer choice)                                        | affected files only                                                   | 30-45 min                            |
| **L2 Fan-out** | cross-package work that splits into file sets with no overlap                                                | up to `max_parallel_workers` workers, one worktree each; 0 means run the parts one after another                              | `agentic-review-handoff` (saved prefs) or `open-code-review-loop`, round budget 2 | affected files per worker; one full run per batch, concurrency capped | per batch                            |
| **L3 Arch**    | structure pain with a user-given scope                                                                       | `architecture-hardening-loop` (implement), or `improve-codebase-architecture` if installed (diagnose; user-invoked only)                   | built into the loop                                                               | as L2                                                                 | own slot, not inside a feature batch |
| **Research**   | a design, UX or product-direction decision; the user asks how good software does it, or for several opinions | 3+ independent researchers on the same brief, from different products where available (see Research and design)               | the coordinator merges; only findings at least two agree on are acted on          | none; read-only                                                       | parallel, one round                  |
| **Writing**    | article, proposal, weekly report, retrospective                                                              | the first of `drafting_agents`, else an idle code product, else the coordinator; start after the code it describes has landed | coordinator checks every fact, number, path and command against sources           | the repo's doc check when the file lives in a repo                    | —                                    |

Before acting, output one line: `Dispatch: L<n> — <decisive reason>; workers <n>; reviewer <who>; target <time>`. Name any fallback from the table below in the same line.

## Run Board

Use it for L2, L3 and Research, and for L1 once a Worker is dispatched. The Board is a milestone report of the Lanes this Coordinator dispatched, written only at milestones (an open tab re-reads it by itself). Live status and messaging are sideby's Panel (会话 page) and `sideby sessions`, not the Board; `claude agents` / Orca sidebar when sideby is absent. Read `references/run-board.md` before you `init` a Run or take one over.

The rules below shape every reply, so they live here:

1. **The user is not a technician.** They never run a command, edit a file, open a path or remember an id; you do it, and you map plain requests ("现在到哪了", "A1 按推荐", "停", "再打开看板") to the commands. Speak in plain words (任务, 外部等待, 问题, 账号额度), not Lane, Wait, Ask or quota pool, and say what each choice changes for them.
2. **Open the Board for them once** with `open` (add `--panel` to also start sideby's Panel). Record your own session with `init --coordinator-session <id>`. If opening fails, report progress in chat; never hand the user a path.
3. **Record deliverables as they happen**: milestones with `step add/set`, choices with `decision add`, results and verification with `lane set --summary-file/--result-file/--evidence`, files with `artifact add`, commits with `commit add`; each round with `lane set --round N --note`.
4. **Register before you start**: every Lane, every Subagent you spawn and every Wait (deploy, CI, build, background shell) with its log; a step that waits on others gets `--after`. A fix round or resume is `lane set --round N --output <new stream>` before it starts: the old round's result moves to history, and the script refuses to reuse the ended stream, which would keep showing the old result as current.
5. **Every question is a numbered Ask** with a recommendation, the evidence and what it blocks. A message to a local session this Coordinator dispatched or the user named needs no per-message approval; messages to people or external channels are outward actions and also name recipient, channel and the full draft. When a fact is missing, the Ask asks for it; never invent it.
6. **Answers come in your chat**; record them with `ask answer`. A message the user sends from the sideby Panel arrives as a cross-session message.
7. **Record "以后都这样" as a Standing Grant** with its exact scope and the user's words; grants for deploy, external send or publish last this Run only.
8. **Keep a `watch` running in the background** after you dispatch or ask (Claude Code: `run_in_background`); it exits when a Lane ends, fails, needs the user or goes silent, so finished work does not sit idle while you wait for the user's reply. Lead each reply with the state line from `show --line`; never wait with a foreground `sleep`.
9. **"停" means stop, not only pause.** Create the `STOP` file, stop each running Lane and Wait you can, mark them `stopped`, and say which ones could not be stopped and why.
10. **Close** the Run when everything is integrated; a handoff brief carries the Coordinator Session Reference, the Run directory and the Orca run id so the next Coordinator continues the same Run.

## Keep the Coordinator's context small

Every token the Coordinator reads is re-read on every later turn; on the measured Run the Coordinator was half of all spend. The ledger is the only state (`show --line`, `show`); never Read the Board HTML, `run.json`, `.jsonl` streams or full reports; Workers return at most 10 lines plus paths and you read only the summary; screenshots and report details go to a subagent that returns text; reviews get at most 2 rounds. The measurements and the full list are in `references/context-budget.md`.

## Research and design

Independent opinions only count when they do not share context. Run the Research tier like this:

1. Write one brief from `references/research-brief.md` and give the same file to every researcher. Never pass your own conclusions or another researcher's answer.
2. Use different products when the probe has them (for example Codex, Grok Build and a fresh Claude), else fresh sessions of one product. In-session subagents are fine: research is read-only.
3. Check every input you hand over first (screenshots, logs, demo data). A screenshot hidden behind a dialog quietly weakens every answer built on it.
4. Merge in a table: finding, fix, which researchers support it. Act on findings at least two support; put taste questions among the rest to the user with your recommendation.
5. For visual work, have a product that can generate images draw mockups from the agreed findings before implementing, and implement from the mockup.
6. Escalate to implementation tiers (L1/L2) only after the merge; say which findings changed your earlier plan.

## Fallbacks when tools are missing

The tiers stay the same; only who fills each role changes. Say which fallback applied in the dispatch line or final report so the user knows the review was weaker or the batch slower than ideal.

| Missing                                  | Do instead                                                                                                                                                                                                   | Why                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| A second AI product                      | Reviewer is a fresh session of the same product given only the spec, the diff and the acceptance checks, never the writer's conversation or reasoning                                                        | Independence comes mostly from not sharing the writer's context and assumptions      |
| A second account or quota pool           | L2 runs the parts sequentially in their worktrees, or in parallel sessions on the one pool once the user authorizes 多开; in-session subagents are fine for read-only work but share the coordinator's quota | Parallel sessions on one pool share the same rate limit                              |
| Both of the above (one Claude, one account) | Prefer Claude Code's own subagents, agent view or Agent Teams (see "When the host's own tools are the lighter path"); a Run adds a ledger without adding independence                                      | The Board's value is cross-product, cross-account tracking                           |
| `ocr` or the `open-code-review-*` skills | Reviewer reads `git diff <base>...` plus the task spec and returns findings as `file:line — problem — evidence`; the coordinator verifies each before fixing                                                 | Keeps a structured, checkable review without the tool                                |
| `architecture-hardening-loop`            | Treat L3 as L1/L2 on the named scope with an explicit list of structural changes the user approved                                                                                                           | Avoid unbounded refactors without the loop's guardrails                              |
| Writing skills in the drafting agent     | Paste the key writing rules into the drafting prompt, or let the coordinator write                                                                                                                           | A drafting agent without the rules produces text the coordinator must redo           |
| A drafting agent                         | Coordinator writes, loading the writing skills itself                                                                                                                                                        | —                                                                                    |
| Orca                                     | Headless Workers with `.jsonl` output; the HTML Board is the only view                                                                                                                                       | The Board works anywhere Python 3 runs                                               |
| A Grok Orca agent                        | Run Grok Lanes headless with `--output-format streaming-json`; they show on the HTML Board, not in the Orca sidebar                                                                                          | Grok is not an Orca agent id; a Grok TUI under `worker-start --terminal` is untested |
| A background wait in the host            | End the turn with the `show --line` state line instead of polling                                                                                                                                   | A foreground `sleep` blocks the session and hides progress                           |

## Reviewer choice

Clean-context verification catches blind spots the author cannot see. When `agentic-review-handoff` is installed, follow its saved preferences (`review-loop prefs`). Otherwise prefer, in order: another product than the writer → a fresh session of the same product → the coordinator, when it did not write the code. When the user restricts dispatch to one product (e.g. only Claude accounts), the reviewer is a fresh session on a different account of that product than the writer. When the coordinator is a different product from the worker, the coordinator running `open-code-review-delegate` already counts as cross-model review. The writer never reviews its own diff, and the reviewer runs on a different quota pool from the writer when the probe has one; otherwise state the fallback in the dispatch line (the Board flags a reviewer on the writer's pool when both Lanes carry `--pool` and the review Lane `--reviews`). Tell the reviewer to try inputs the request's examples skip (boundaries, NaN, halves, binary floating point): a reviewer that only replays the given examples passes code that is wrong one step off them.

Reviewer prompts, merge-commit review and sandbox limits: `references/launch.md` § Reviewer prompts.

## Escalation and de-escalation

- Move up one tier only when work in progress proves it: a second package must change, file sets overlap, or a review finding changes behavior outside the original scope.
- Move down when a planned split collapses to one file set; release the extra worker instead of keeping it busy.
- L0/L1 never wait for a batch. Finish, verify and hand them to delivery on their own, so a 10-minute fix does not queue behind a 90-minute release.

## One coordinator

- Exactly one session dispatches, integrates, decides and reports. A second session relaying the same events doubles the user's reading and invites conflicting decisions.
- When the user has delegated decisions, decide reversible ones yourself and log each (what, options, choice, reason); show the list at milestones and at the end, e.g. `lane B base — shared base / lane A's branch — lane A's branch — B calls A's new API`. Destructive, production, billing, auth and external-message actions still need the user.
- Report at milestones only: tier chosen, batch integrated, blocked on the user, done. Between milestones the Board answers "what is happening"; a report separates what is running, what is waited on, and the numbered Asks.
- One integration line per batch: a shared package and its consumer change in the same batch and merge once.
- Integration is not delivery. Merging Lanes into the batch branch or the Coordinator's checkout and running the batch's tests is the Coordinator's job; a commit on, or merge into, the repository's main branch, a push, a tag or a deploy is delivery and happens only through the repository's ship flow or on the user's explicit request (see Composes with → Delivery). Plans that end with "merge to main" without that request overstep.

## Dispatching workers

Parallel writers making uncoordinated implicit decisions create merge conflicts and incoherent architecture. Before starting workers, strictly verify each worker's writable files are disjoint. Overlap means collapse to L1 immediately rather than risking integration failure.

- Write each worker prompt from `references/task-spec.md` (research briefs from `references/research-brief.md`). Look at every input you attach before sending it.
- Workers never push, merge into other branches, deploy or publish; they return an outcome line, the touched-file list and evidence. The coordinator integrates.
- Each lane gets its own worktree on its own short branch (one branch cannot be checked out in two worktrees). A lane that needs another lane's commits branches from that lane's branch, not from the shared base. Workers either leave changes uncommitted, or, when the spec says so, make local commits on their own short branch with hooks passing.
- Launch, permissions, messaging and resume shapes per product are in `references/launch.md`; read it before the first headless start. The two rules that bite most: a headless run must never wait on a TTY, and blanket permission modes need the user's explicit authorization for this Run (a worktree is not a permission boundary).
- Round budget: at most 3 dispatch rounds per Lane: the first run plus up to 2 review-fix rounds (the tier card's "round budget 2"). A fourth round means the spec was wrong; rewrite it or take the task back.

## Machine load

- Workers run only affected tests (`vitest run <files>` or `--related`).
- One full suite per batch, before delivery, with test concurrency capped (e.g. Vitest/Jest `--maxWorkers=2`, Node `--test-concurrency=2`, pytest `-n 2`), only when no other session is running one.
- Before ending, confirm no leftover test runners, type checkers or dev servers started by you or your workers.
- A reviewer or test run silent for 5 minutes: read its log first instead of waiting longer. `show` flags this only for registered Lanes and Waits, and only when sideby gives no live status, so register long test runs as Waits.

## Completion accounting

After a worker's result is integrated into the Coordinator's checkout (committed or not), immediately reuse that worker, keep it with a stated reason, or remove its worktree with `git worktree remove --force <path>` (or `worktree-tidy` if installed), then delete its merged short branch with `git branch -d`. `--force` is expected for uncommitted lanes: their worktree holds copies of what the coordinator already integrated; first confirm the Coordinator's checkout contains them (`git diff --stat` over the lane's files).

Final report per task: tier, who wrote and who reviewed (including any fallback), outcome, evidence, decisions taken for the user, Standing Grants recorded, and what still waits on the user as numbered Asks.
