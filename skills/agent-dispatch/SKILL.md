---
name: agent-dispatch
description: "Choose the lightest agent setup for a coding, review, drafting or design-research task: do it yourself, fan out to 2-3 workers with independent parts across the Claude Code, Codex, Grok Build, Cursor or other CLIs and accounts on this machine, run a scoped architecture loop, or send one brief to independent researchers; pick a cross-model reviewer, test budget and cleanup; track dispatched work, external waits and user decisions on a Run Board. Use when work may need delegation, or the user asks to dispatch, fan out, parallelize, run several agents or accounts, get another AI's review or independent design opinions, or asks how dispatched work is going. Chinese triggers: 派活、并行、多开、分给多个 Claude 账号 / codex / grok、找另一个 AI 审、对比优秀设计、多方意见、进度看板、派出的任务进行到哪了。Not for unrelated read-only questions, trivial edits, research with no delegation, a single review of an existing diff (agentic-review-handoff), or the machine-wide session list (sideby sessions). Inside another named workflow, only size its workers."
license: MIT
metadata:
  author: adonis
  version: "1.9.0"
---

# Agent Dispatch

One coordinating agent decides how much machinery a task deserves. The scarce resource is the user's attention and the facts only they can confirm, not lines an agent can write. Extra workers speed up only the coding step (an inference from one measured Run, n=1); integration, review rounds, deploys and status reports grow with every worker. So default to the lightest tier, escalate only on evidence, and say why in one line.

Two rules decide most splits:

- **Split by context, not by role.** A piece goes to another agent only when it needs little from the rest: an independent research path, a component behind a contract that is already fixed, or a black-box check of finished work. Splitting by role or problem type ("the API agent", "the docs agent") turns every handoff into a game of telephone. Claude Code's Agent Teams docs say the same: for sequential tasks, same-file edits, or work with many dependencies, one session is more effective.
- **Whoever writes the plan carries it out.** The Coordinator keeps the plan and does the work it can hold in its own context; a Worker gets a self-contained piece, not a share of the planning. Every handoff loses detail, so each one must buy something: parallel time, a clean context, another product's ability, or another quota pool.

Background: Anthropic, "Building agents: When to fold subagents into your main agent loop" (claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop, 2026-10-22).

## Where to read next

| Need                                                                               | Read                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Which accounts, pools and products exist; allow-lists; 多开                        | `references/accounts.md`                                  |
| Starting, messaging, resuming or stopping a headless Worker                        | `references/launch.md`                                    |
| Writing a Worker's task spec / a research brief                                    | `references/task-spec.md`, `references/research-brief.md` |
| Ledger commands, Board, the rules for every reply during a Run, Orca mode, handoff | `references/run-board.md`                                 |
| A second product, account, reviewer tool or drafting agent is missing              | `references/fallbacks.md`                                 |
| Why the Coordinator must stay small, and how                                       | `references/context-budget.md`                            |
| Whether dispatching paid off; comparing it with doing it yourself                  | `references/measure.md`                                   |
| Terms (Run, Lane, Worker, Ask, Standing Grant)                                     | `GLOSSARY.md`                                             |

## Composes with

Respect established authority boundaries in order:

- **Order of authority**: `workflow-gate` decides _what kind_ of work (debug / plan / challenge / architecture / review); `agent-dispatch` decides _how many agents and who reviews_; then the selected runtime skill runs.
- **Reviewer selection**: When `agentic-review-handoff` is installed, do not pick a reviewer yourself: run its review with `--host=<the Coordinator's product>` so its saved Reviewer preference picks the reviewer and timeout fallbacks, and state its `reviewerFrom` in the dispatch line; use this skill's "Reviewer choice" only when it is absent.
- **Full pipelines**: When `task-completion-loop` owns the task, it already runs its own peers and reviews; agent-dispatch only sizes workers inside it and starts no second review loop.
- **Goals**: When a native Goal (via `goal-gate`) is active, dispatch and review as usual, report each batch as a checkpoint of that Goal, and never complete, replace or clear the Goal yourself.
- **Sessions**: sideby `sessions` / `send` are the cross-account session layer; detect each at runtime, keep the per-product fallbacks (`references/launch.md`).
- **Delivery**: Hand integrated work to the repository's own delivery/ship skill or documented flow; if none exists, stop at a local commit made only on explicit user request.

## When the host's own tools are the lighter path

This skill earns its overhead when work crosses products (Codex, Grok, Antigravity) or accounts (quota pools), or when the user wants a Board and numbered Asks. When none of that applies, say so and use the host's native mechanism instead of a Run:

- **Claude Code, one account, all Lanes Claude**: subagents for side tasks whose only output is a summary; `claude agents` (agent view) to hand off independent background sessions the user checks on; Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, experimental) when teammates must share a task list and message each other. Its docs (code.claude.com/docs/en/agent-teams) also say to check whether a lighter option does the job first, to start with 3-5 teammates, and to give each teammate its own set of files. This skill caps cross-product writers at 3 because every extra writer adds an integration and a review. Cross-session messaging between sessions you run yourself needs no Run either.
- **Orca is running** and the user already watches its sidebar: use its orchestration (`references/run-board.md` § Orca mode) for the live view and keep this skill's ledger only for Asks, Waits and the milestone report.

Pick a Run when the task needs a second product or quota pool, when the user wants a writer reviewed by a different model, or when the user asked for the Board. State the reason in the dispatch line.

## Step 0 — know what you can dispatch to

Run `python3 scripts/probe_agents.py` (relative to this skill) once per session before choosing a tier above L0, and read `references/accounts.md` for what its fields mean. Two rules that decide tiers: `max_parallel_workers` is the ceiling for L2 (0 means run the parts one after another), and pools come from the probe, never from account names. Do not assume Codex, Grok, Antigravity or extra accounts exist because a plan or a prior session mentioned them; if the probe cannot run, treat the machine as single-product with one pool. When the user names the accounts to use or authorizes 多开, apply both before the probe: the allow-list (`AGENT_DISPATCH_ALLOW`) and, for 多开, a raised `AGENT_DISPATCH_SESSIONS_PER_POOL` (`references/accounts.md`). When the probe disagrees with what the user said (three accounts named, four found; a product they mentioned is missing), say so in one line and plan from the probe: the user may have forgotten a login, or the machine may not be the one they meant.

## Tier card — decide in one pass

| Tier           | Pick when                                                                                                                                                          | Who writes                                                                                                                                                                                                                             | Review                                                                                                                       | Tests                                                                 | Target                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| **L0 Direct**  | read-only, copy, style, static asset, or one file, no behavior change                                                                                              | coordinator, current checkout, no worktree                                                                                                                                                                                             | none                                                                                                                         | page evidence or none                                                 | ~10 min (3-4 rounds)                 |
| **L1 Single**  | behavior change inside one module, about 5 files or fewer; or parts that share a contract still being decided                                                      | the coordinator itself. One Worker only when the coordinator's context is already crowded with other work, the piece needs another product's ability, or the coordinator's quota pool is nearly spent; name which in the dispatch line | one independent pass (see Reviewer choice)                                                                                   | affected files only                                                   | 30-45 min                            |
| **L2 Fan-out** | parts that need little of each other's context: disjoint file sets **and** no shared type, schema, API or config they would both change or rely on before it lands | up to `max_parallel_workers` workers, one worktree each; 0 means run the parts one after another                                                                                                                                       | `agentic-review-handoff` (saved prefs) or `open-code-review-loop`; up to 2 fix rounds                                        | affected files per worker; one full run per batch, concurrency capped | per batch                            |
| **L3 Arch**    | structure pain with a user-given scope                                                                                                                             | `architecture-hardening-loop` (implement), or `improve-codebase-architecture` if installed (diagnose; user-invoked only)                                                                                                               | built into the loop                                                                                                          | as L2                                                                 | own slot, not inside a feature batch |
| **Research**   | an open product, design or UX direction with no settled answer, or the user asks how good software does it or for several opinions                                 | 2-3 independent researchers on the same brief, from different products where available (see Research and design)                                                                                                                       | the coordinator merges; act on findings two researchers share, or one backs with first-hand evidence the coordinator checked | none; read-only                                                       | parallel, one round                  |
| **Writing**    | article, proposal, weekly report, retrospective                                                                                                                    | the coordinator, which holds the implementation context; the first of `drafting_agents` only when the user asks for it or the coordinator's context is already crowded; start after the code it describes has landed                   | coordinator checks every fact, number, path and command against sources                                                      | the repo's doc check when the file lives in a repo                    | —                                    |

A contract several parts depend on (a shared type, schema, API shape or config key) is decided and landed by one agent first; only then may the parts that consume it fan out. Two parts that would both edit or invent it are one part. A small UX or copy tweak where the answer is a matter of taste is L0/L1 with your recommendation, not Research.

Before acting, output one line: `Dispatch: L<n> — <decisive reason>; workers <n>; reviewer <who>; target <time>`. Name any fallback from `references/fallbacks.md` in the same line.

## Run Board

Use it for L2, L3 and Research, and for L1 once a Worker is dispatched. The Board is a milestone report of the Lanes this Coordinator dispatched, written only at milestones (an open tab re-reads it by itself). Live status and messaging are sideby's Panel (会话 page) and `sideby sessions`, not the Board; `claude agents` / Orca sidebar when sideby is absent.

Before you `init` a Run or take one over, read `references/run-board.md` § Rules for every reply while a Run is open. The three that bite most: the user is not a technician, so you run every command and speak plain words (任务, 外部等待, 问题, 账号额度); every question is a numbered Ask with a recommendation, evidence and what it blocks; keep a `watch` in the background after you dispatch or ask, and lead each reply with `show --line`; say a message was sent only when the send command's own result says so.

## Keep the Coordinator's context small

Every token the Coordinator reads is re-read on every later turn; on one measured Run (n=1) the Coordinator was about half of all spend. The ledger is the only state (`show --line`, `show`); never Read the Board HTML, `run.json` or `.jsonl` streams; Workers return a summary of at most 10 lines plus paths, and you read the whole summary, including its technical lines (decisions, deviations from the spec, UNVERIFIED items), before you integrate. Screenshots and report details go to a subagent that returns text. The measurements and the full list are in `references/context-budget.md`.

## Research and design

Independent opinions only count when they do not share context. Run the Research tier like this:

1. Write one brief from `references/research-brief.md` and give the same file to every researcher. Never pass your own conclusions or another researcher's answer.
2. Use 2-3 researchers from different products when the probe has them (for example Codex, Grok Build and a fresh Claude), else fresh sessions of one product. In-session subagents are fine: research is read-only. Headless sessions load the user's full skills, so a third researcher is worth it only for a decision that is expensive to reverse.
3. Check every input you hand over first (screenshots, logs, demo data). A screenshot hidden behind a dialog quietly weakens every answer built on it.
4. Merge in a table: finding, fix, which researchers support it, and the evidence. Act on findings two researchers share, and on a single researcher's finding when it carries first-hand evidence you checked yourself (a source you opened, a reproduction you ran). Put taste questions among the rest to the user with your recommendation.
5. For visual work, have a product that can generate images draw mockups from the agreed findings before implementing, and implement from the mockup.
6. Escalate to implementation tiers (L1/L2) only after the merge; say which findings changed your earlier plan.

## Fallbacks when tools are missing

The tiers stay the same; only who fills each role changes. Read `references/fallbacks.md` when a second product, account, reviewer tool, Orca or a drafting agent is missing, and say which fallback applied in the dispatch line or final report.

## Reviewer choice

Clean-context verification catches blind spots the author cannot see. When `agentic-review-handoff` is installed, follow its saved preferences (`review-loop prefs`). Otherwise prefer, in order: another product than the writer → a fresh session of the same product → the coordinator, when it did not write the code. When the user restricts dispatch to one product (e.g. only Claude accounts), the reviewer is a fresh session on a different account of that product than the writer, never the Coordinator, even for a Lane it did not write. When the coordinator is a different product from the worker, the coordinator running `open-code-review-delegate` already counts as cross-model review. The writer never reviews its own diff, and the reviewer runs on a different quota pool from the writer when the probe has one; otherwise state the fallback in the dispatch line (the Board flags a reviewer on the writer's pool when both Lanes carry `--pool` and the review Lane `--reviews`). Tell the reviewer to try inputs the request's examples skip (boundaries, NaN, halves, binary floating point): a reviewer that only replays the given examples passes code that is wrong one step off them.

Reviewer prompts, merge-commit review and sandbox limits: `references/launch.md` § Reviewer prompts.

## Escalation and de-escalation

- Move up one tier only when work in progress proves it: a second package must change, file sets overlap, or a review finding changes behavior outside the original scope.
- Move down when a planned split collapses to one file set or turns out to share a contract; release the extra worker instead of keeping it busy.
- L0/L1 never wait for a batch. Finish, verify and hand them to delivery on their own, so a 10-minute fix does not queue behind a 90-minute release.

## One coordinator

- Exactly one session dispatches, integrates, decides and reports. A second session relaying the same events doubles the user's reading and invites conflicting decisions.
- When the user has delegated decisions, decide reversible ones yourself and log each (what, options, choice, reason); show the list at milestones and at the end, e.g. `lane B base — shared base / lane A's branch — lane A's branch — B calls A's new API`. Destructive, production, billing, auth and external-message actions still need the user.
- Report at milestones only: tier chosen, batch integrated, blocked on the user, done. Between milestones the Board answers "what is happening"; a report separates what is running, what is waited on, and the numbered Asks.
- One integration line per batch: a shared package and its consumer change in the same batch and merge once.
- Integration is not delivery. Merging Lanes into the batch branch or the Coordinator's checkout and running the batch's tests is the Coordinator's job; a commit on, or merge into, the repository's main branch, a push, a tag or a deploy is delivery and happens only through the repository's ship flow or on the user's explicit request (see Composes with → Delivery). Plans that end with "merge to main" without that request overstep.

## Dispatching workers

Parallel writers making uncoordinated implicit decisions create merge conflicts and incoherent architecture. Before starting workers, verify each worker's writable files are disjoint and that no worker would change or invent a contract another worker relies on. Overlap of either kind means collapse to L1, or land the contract first and fan out after.

- Write each worker prompt from `references/task-spec.md` (research briefs from `references/research-brief.md`). Look at every input you attach before sending it. The spec carries the plan for that piece; the worker does not re-plan the batch.
- Workers never push, merge into other branches, deploy or publish; they return an outcome line, the touched-file list and evidence. The coordinator integrates.
- Each lane gets its own worktree on its own short branch (one branch cannot be checked out in two worktrees). A lane that needs another lane's commits branches from that lane's branch, not from the shared base. Workers either leave changes uncommitted, or, when the spec says so, make local commits on their own short branch with hooks passing.
- Launch, permissions, messaging and resume shapes per product are in `references/launch.md`; read it before the first headless start. The two rules that bite most: a headless run must never wait on a TTY, and blanket permission modes need the user's explicit authorization for this Run (a worktree is not a permission boundary).
- Round budget, the one rule for every Lane: at most 3 dispatch rounds, the first run plus up to 2 fix rounds. Each fix round's review checks only the previous round's findings. A fourth round means the spec was wrong; rewrite it or take the task back.

## Machine load

- Workers run only affected tests (`vitest run <files>` or `--related`).
- One full suite per batch, before delivery, with test concurrency capped (e.g. Vitest/Jest `--maxWorkers=2`, Node `--test-concurrency=2`, pytest `-n 2`), only when no other session is running one.
- Before ending, confirm no leftover test runners, type checkers or dev servers started by you or your workers.
- A reviewer or test run silent for 5 minutes: read its log first instead of waiting longer. `show` flags this only for registered Lanes and Waits, and only when sideby gives no live status, so register long test runs as Waits.

## Completion accounting

After a worker's result is integrated into the Coordinator's checkout (committed or not), immediately reuse that worker, keep it with a stated reason, or remove its worktree with `git worktree remove --force <path>` (or `worktree-tidy` if installed), then delete its merged short branch with `git branch -d`. `--force` is expected for uncommitted lanes: their worktree holds copies of what the coordinator already integrated; first confirm the Coordinator's checkout contains them (`git diff --stat` over the lane's files).

Final report per task: tier, who wrote and who reviewed (including any fallback), outcome, evidence, decisions taken for the user, Standing Grants recorded, whether dispatching paid off (`references/measure.md` § After every Run), and what still waits on the user as numbered Asks.
