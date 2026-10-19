---
name: agent-dispatch
description: "Choose the lightest agent setup for a coding, review, drafting or design-research task: do it yourself, fan out to 2-3 workers with non-overlapping files across the Claude Code, Codex, Grok Build, Cursor or other CLIs and accounts on this machine, run a scoped architecture loop, or send one brief to independent researchers; pick a cross-model reviewer, test budget and cleanup; then track dispatched work, external waits and user decisions on a Run Board the user can open any time. Use when work may need delegation, or the user asks to dispatch, fan out, parallelize, run several agents or accounts, get another AI's review or independent design opinions, or asks how dispatched work is going. Chinese triggers: 派活、并行、多开、分给多个 Claude 账号 / codex / grok、找另一个 AI 审、对比优秀设计、多方意见、进度看板、派出的任务进行到哪了。Not for unrelated read-only questions, trivial edits, research with no delegation, or listing every session on the machine. If one named workflow owns the task, use this only to size workers inside it."
metadata:
  author: adonis
  version: "1.5.0"
---

# Agent Dispatch

One coordinating agent decides how much machinery a task deserves. The scarce resource is the user's attention and the facts only they can confirm, not lines an agent can write. Extra workers speed up only the coding step; integration, review rounds, deploys and status reports grow with every worker. So default to the lightest tier, escalate only on evidence, and say why in one line. The one exception is research before a product or design decision: there breadth is cheap and a correction from the user is expensive, so start at the Research tier.

## Composes with

Respect established authority boundaries in order:

- **Order of authority**: `workflow-gate` decides _what kind_ of work (debug / plan / challenge / architecture / review); `agent-dispatch` decides _how many agents and who reviews_; then the selected runtime skill runs.
- **Reviewer selection**: When `agentic-review-handoff` is installed, defer reviewer choice and timeout fallback to its saved Reviewer preference (`review-loop prefs`, `--host`); use agent-dispatch's own "Reviewer choice" only when it is absent.
- **Full pipelines**: When `task-completion-loop` owns the task, it already runs its own peers and reviews; agent-dispatch only sizes workers inside it and starts no second review loop.
- **Goals**: When a native Goal (via `goal-gate`) is active, dispatch and review as usual, report each batch as a checkpoint of that Goal, and never complete, replace or clear the Goal yourself.
- **Delivery**: Hand integrated work to the repository's own delivery/ship skill or documented flow; if none exists, stop at a local commit made only on explicit user request.

## Step 0 — know what you can dispatch to

Run `python3 scripts/probe_agents.py` (relative to this skill) once per session before choosing a tier above L0. It discovers accounts in order: accounts file (`~/.config/agent-dispatch/accounts.json` or `$AGENT_DISPATCH_ACCOUNTS`) → optional multi-account manager → PATH lookup, and prints:

- `products`: available products with distinct `quota_pools` and per-account `<command>`;
- `code_products`: coding CLIs with usable subscriptions (API-key accounts excluded from managers unless listed in the accounts file);
- `drafting_agents`: CLIs preferred for article drafting (e.g. Antigravity `agy`);
- `sessions_per_pool`: concurrent headless sessions allowed per pool (default 1);
- `max_parallel_workers`: pools × `sessions_per_pool`, minus the one session the coordinator keeps (capped at 3 while `sessions_per_pool` is 1);
- `allow` / `allow_unmatched`: the user's account allow-list and entries that matched nothing;
- `fallback`: degradations that apply on this machine.

Pools bound quota, not concurrency: one subscription account can run several headless sessions at once, and the coordinator's own pool may host workers too. Keep one session per pool unless the user asks for or authorizes 多开; then raise `sessions_per_pool` (`AGENT_DISPATCH_SESSIONS_PER_POOL=2` or the file field). Sessions on one pool share its rate limit, so extra sessions there trade wall time for earlier limit hits.

When the user restricts accounts ("只用 cc001 cc002 cc003 cc008"), pass those names via `AGENT_DISPATCH_ALLOW` or the file's `allow`; it overrides discovery. Entries may be probe ids (`claude:001`), short commands (`cc001`, resolved from `sideby config get aliases` or the file's `aliases`) or a product name for all its accounts; check `allow_unmatched` for typos. Read pools from the probe, never from account names: one login can sit behind two names (sideby reported `claude:main` and `claude:001` as one pool).

Optional accounts file shape (`pool` groups accounts sharing quota; missing `pool` gets its own pool; `id` defaults to `command`; optional `aliases` maps short names to ids; env vars override `allow` and `sessions_per_pool`):

```json
{
  "allow": ["personal", "work"],
  "sessions_per_pool": 1,
  "accounts": [
    {
      "id": "personal",
      "product": "claude",
      "command": "claude",
      "pool": "personal"
    },
    {
      "id": "work",
      "product": "claude",
      "command": "CLAUDE_CONFIG_DIR=~/.claude-work claude",
      "pool": "work"
    }
  ]
}
```

Do not assume Codex, Grok, Antigravity or extra accounts exist because a plan, a prior session or this skill mentions them. If the probe cannot run, treat the machine as single-product with one pool.

Also confirm the review skills you plan to use are installed and callable; `open-code-review-*` additionally needs the `ocr` CLI on PATH.

## Tier card — decide in one pass

| Tier           | Pick when                                                                                                    | Who writes                                                                                                                    | Review                                                                            | Tests                                                                 | Target                               |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| **L0 Direct**  | read-only, copy, style, static asset, or one file, no behavior change                                        | coordinator, current checkout, no worktree                                                                                    | none                                                                              | page evidence or none                                                 | ~10 min (3-4 rounds)                 |
| **L1 Single**  | behavior change inside one module, about 5 files or fewer                                                    | coordinator, or 1 worker                                                                                                      | one independent pass (see Reviewer choice)                                        | affected files only                                                   | 30-45 min                            |
| **L2 Fan-out** | cross-package work that splits into file sets with no overlap                                                | up to `max_parallel_workers` workers, one worktree each; 0 means run the parts one after another                              | `agentic-review-handoff` (saved prefs) or `open-code-review-loop`, round budget 2 | affected files per worker; one full run per batch, concurrency capped | per batch                            |
| **L3 Arch**    | structure pain with a user-given scope                                                                       | `architecture-hardening-loop` (implement), or `improve-codebase-architecture` (diagnose; user-invoked only)                   | built into the loop                                                               | as L2                                                                 | own slot, not inside a feature batch |
| **Research**   | a design, UX or product-direction decision; the user asks how good software does it, or for several opinions | 3+ independent researchers on the same brief, from different products where available (see Research and design)               | the coordinator merges; only findings at least two agree on are acted on          | none; read-only                                                       | parallel, one round                  |
| **Writing**    | article, proposal, weekly report, retrospective                                                              | the first of `drafting_agents`, else an idle code product, else the coordinator; start after the code it describes has landed | coordinator checks every fact, number, path and command against sources           | the repo's doc check when the file lives in a repo                    | —                                    |

Before acting, output one line: `Dispatch: L<n> — <decisive reason>; workers <n>; reviewer <who>; target <time>`.

## Run Board

Use it for L2, L3 and Research, and for L1 once a Worker is dispatched. It covers only the Lanes this Coordinator dispatched; for every session on the machine, point the user to `claude agents` (Agent View) or the Orca sidebar instead of starting a Run. Read `references/run-board.md` before you `init` a Run or take one over: it has the commands, the ledger, the Orca loop and why each rule exists. Terms are in `GLOSSARY.md`.

The rules below shape every reply, so they live here:

1. **The user is not a technician.** They never run a command, edit a file, open a path or remember an id; you do it, and you map plain requests ("现在到哪了", "A1 按推荐", "停", "再打开看板") to the commands. Speak in plain words (任务, 外部等待, 问题, 账号额度), not Lane, Wait, Ask or quota pool, and say what each choice changes for them.
2. **Open the Board for them** with `open` at the start of a Run. If it reports failure, give the progress as text in the chat; never hand them a path to open.
3. **Register before you start**: every Lane, every Subagent you spawn and every Wait (deploy, CI, build, background shell) with its log; give a step that waits on others `--after`.
4. **Every question is a numbered Ask** with a recommendation, the evidence and what it blocks; an outward action (send, publish, deploy) also names recipient, channel and the full draft. When a fact is missing, such as which group to post to, the Ask asks for it; never invent it.
5. **Record "以后都这样" as a Standing Grant** with its exact scope and the user's words; grants for deploy, send or publish last this Run only.
6. **Lead with the state line** from `show --line` while anything runs, and never wait with a foreground `sleep`.
7. **"停" means stop, not only pause.** Create the `STOP` file (no new Lanes start), then stop each running Lane and Wait you can (Orca `worker-stop`, the processes you started), mark them `stopped`, and tell the user which ones could not be stopped and why.
8. **Close** the Run when everything is integrated; a sideby handoff brief carries the Run directory (and Orca run id) so the next Coordinator continues the same Run.

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
| `ocr` or the `open-code-review-*` skills | Reviewer reads `git diff <base>...` plus the task spec and returns findings as `file:line — problem — evidence`; the coordinator verifies each before fixing                                                 | Keeps a structured, checkable review without the tool                                |
| `architecture-hardening-loop`            | Treat L3 as L1/L2 on the named scope with an explicit list of structural changes the user approved                                                                                                           | Avoid unbounded refactors without the loop's guardrails                              |
| Writing skills in the drafting agent     | Paste the key writing rules into the drafting prompt, or let the coordinator write                                                                                                                           | A drafting agent without the rules produces text the coordinator must redo           |
| A drafting agent                         | Coordinator writes, loading the writing skills itself                                                                                                                                                        | —                                                                                    |
| Orca                                     | Headless Workers with `.jsonl` output; the HTML Board is the only view                                                                                                                                       | The Board works anywhere Python 3 runs                                               |
| A Grok Orca agent                        | Run Grok Lanes headless with `--output-format streaming-json`; they show on the HTML Board, not in the Orca sidebar                                                                                          | Grok is not an Orca agent id; a Grok TUI under `worker-start --terminal` is untested |
| A background wait in the host            | End the turn with the Run state line and the Board path instead of polling                                                                                                                                   | A foreground `sleep` blocks the session and hides progress                           |

## Reviewer choice

Clean-context verification catches blind spots the author cannot see. When `agentic-review-handoff` is installed, follow its saved preferences (`review-loop prefs`). Otherwise prefer, in order: another product than the writer → a fresh session of the same product → the coordinator, when it did not write the code. When the user restricts dispatch to one product (e.g. only Claude accounts), the reviewer is a fresh session on a different account of that product than the writer. When the coordinator is a different product from the worker, the coordinator running `open-code-review-delegate` already counts as cross-model review. The writer never reviews its own diff, and the reviewer runs on a different quota pool from the writer when the probe has one; otherwise state the fallback in the dispatch line (the Board flags a reviewer on the writer's pool). Tell the reviewer to try inputs the request's examples skip (boundaries, NaN, halves, binary floating point): a reviewer that only replays the given examples passes code that is wrong one step off them.

A reviewer prompt (e.g. for `open-code-review-delegate`) names the range (`<base>..<head>`), a requirement summary, the focus list, 100% file coverage, and "also review the tests and docs OCR excludes". For a merge commit, review the conflict resolution with `git show --remerge-diff <merge>` plus the diff against each parent. A Codex reviewer under `exec -s read-only` cannot run Vitest (no temp dirs): it marks test execution `UNVERIFIED` and the coordinator re-runs the tests.

## Escalation and de-escalation

- Move up one tier only when work in progress proves it: a second package must change, file sets overlap, or a review finding changes behavior outside the original scope.
- Move down when a planned split collapses to one file set; release the extra worker instead of keeping it busy.
- L0/L1 never wait for a batch. Finish, verify and hand them to delivery on their own, so a 10-minute fix does not queue behind a 90-minute release.

## One coordinator

- Exactly one session dispatches, integrates, decides and reports. A second session relaying the same events doubles the user's reading and invites conflicting decisions.
- When the user has delegated decisions, decide reversible ones yourself and log each (what, options, choice, reason); show the list at milestones and at the end, e.g. `lane B base — shared base / lane A's branch — lane A's branch — B calls A's new API`. Destructive, production, billing, auth and external-message actions still need the user.
- Report at milestones only: tier chosen, batch integrated, blocked on the user, done. Between milestones the Board answers "what is happening"; a report separates what is running, what is waited on, and the numbered Asks.
- One integration line per batch: a shared package and its consumer change in the same batch and merge once.

## Dispatching workers

Parallel writers making uncoordinated implicit decisions create merge conflicts and incoherent architecture. Before starting workers, strictly verify each worker's writable files are disjoint. Overlap means collapse to L1 immediately rather than risking integration failure.

Write each worker prompt from `references/task-spec.md` (research briefs from `references/research-brief.md`). Look at every input you attach before sending it. Workers never push, merge into other branches, deploy or publish; they return an outcome line, the touched-file list and evidence. The coordinator integrates.

Each lane gets its own worktree on its own short branch (one branch cannot be checked out in two worktrees). A lane that needs another lane's commits branches from that lane's branch, not from the shared base. Workers either leave changes uncommitted, or, when the spec says so, make local commits on their own short branch with hooks passing.

Headless launch shapes (use `<command>` reported per account by the probe):

| Product     | One-shot                                                                                                                                          | Next round                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Claude Code | `cd <worktree> && <command> -p "$(cat <spec>)" --output-format stream-json --verbose --allowedTools <list> < /dev/null > <lane>.jsonl 2> err.log` | `<command> --resume <session_id> -p "<delta>" ...` |
| Codex       | `<command> exec --json -C <worktree> -s workspace-write -o <out.md> - < <spec> > <lane>.jsonl`                                                    | `<command> exec resume <session> ...`              |
| Grok Build  | `<command> --cwd <worktree> --prompt-file <spec> --output-format streaming-json --allow <rule> ... > <lane>.jsonl`                                | add `--resume <session>`                           |
| Antigravity | `<command> -p "$(cat <spec>)" --output-format json --print-timeout 0s` (drafting)                                                                 | add `--continue` in the same worktree              |

Notes on these shapes:

- Write each Worker's event stream into the Run directory and register it with `lane add --output`; the Board reads the current activity from it.
- In Orca, prefer a titled Orca terminal handed to `orchestration worker-start --terminal` over a hidden headless run, so the Worker shows in the sidebar the user already watches (`references/run-board.md` § Orca mode). Grok has no Orca agent id: keep Grok Lanes headless.

- Through a multi-account launcher such as sideby, the product's own arguments follow `--` (`sideby run codex:main -- exec ...`); the probe's sideby `<command>` already ends in `--`, a hand-written accounts-file command may not.
- Codex: pass the prompt on stdin (`-`). `-i <image>` takes several values and swallows a prompt written after it, so a prompt given as an argument after `-i` is lost. `-o <file>` writes the final message, which is easier than reading the JSONL stream; add `-c tools.web_search=true` for research and `-s read-only` when nothing may change.

Headless runs must never wait on a TTY: close stdin, run them in the background, and grant the edit/run permissions the worktree needs, or a worker hangs silently. For Claude, `--permission-mode acceptEdits` is not enough: Bash (`pnpm install`, git, tests) is denied under `-p` and the lane stalls. Give the narrowest explicit allow list the Lane needs (Claude `--allowedTools "Edit Write Read Bash(pnpm:*) Bash(git:*)"`, Grok `--allow <rule>`). Blanket modes (Claude `--permission-mode bypassPermissions`, Grok `--always-approve`) need the user's explicit authorization for this Run: a worktree only separates Git working files, it does not stop a command from reaching other paths, and the spec's Ownership is an instruction, not a sandbox. Claude's final `result` event carries `session_id`, `result`, `total_cost_usd` and `num_turns`. Output shapes differ: Claude streams JSON events ending in `result`, Codex a JSONL stream whose `item.completed` events carry the messages (the final message is also in `-o`), Grok `streaming-json` events with `text` deltas ending in `end`; read the task-spec Return block from that text. Headless sessions also load the user's full skills and global instructions, which can dwarf a small task's cost, so give trivial reviews to the cheapest available product.

For any other CLI, check its `--help` for a non-interactive mode before dispatching; if it has none, do not use it as a worker.

A fix round resumes the writer's session and sends only the review findings and the coordinator's decisions, not the whole spec again.

With a multi-account manager such as sideby, interactive sessions stay the user's to start, with one exception: inside Orca, once the user has authorized dispatch, you may open visible Orca terminals on sideby accounts for Workers, titled `<Lane short name> · <role> · <account>` (about 20 characters, e.g. `B9 卡片 · 写 · cc003`). Non-interactive `-p` / `exec` worker runs (`sideby run <ref> -- -p ...`) are fine when the user has authorized dispatch.

Round budget: at most 3 dispatch rounds per task. A fourth round means the spec was wrong; rewrite it or take the task back.

## Machine load

- Workers run only affected tests (`vitest run <files>` or `--related`).
- One full suite per batch, before delivery, with test concurrency capped (e.g. Vitest/Jest `--maxWorkers=2`, Node `--test-concurrency=2`, pytest `-n 2`), only when no other session is running one.
- Before ending, confirm no leftover test runners, type checkers or dev servers started by you or your workers.
- A reviewer or test run silent for 5 minutes: read its log first instead of waiting longer (the Board flags these).
- The Board watcher counts as a process you started. Leave it running across turns while the Run is active, including while dispatch is paused by `STOP`, so the page stays current; it exits only when the Run is closed.

## Completion accounting

After a worker's result is integrated and committed by the coordinator, immediately reuse that worker, keep it with a stated reason, or remove its worktree with `git worktree remove --force <path>` (or `worktree-tidy` if installed), then delete its merged short branch with `git branch -d`. `--force` is expected for uncommitted lanes: their worktree holds copies of what the coordinator already integrated; confirm the integrated commit contains those changes first.

Final report per task: tier, who wrote and who reviewed (including any fallback), outcome, evidence, decisions taken for the user, Standing Grants recorded, and what still waits on the user as numbered Asks.
