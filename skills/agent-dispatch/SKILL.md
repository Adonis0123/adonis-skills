---
name: agent-dispatch
description: "Decide how much agent machinery a coding task deserves before starting it: do it yourself (L0/L1), fan out to 2-3 workers with non-overlapping files across whatever Claude Code, Codex, Grok Build, Cursor or other CLIs this machine actually has (L2), or run a scoped architecture loop (L3), or run independent research across products before a design decision (Research); then pick a cross-model reviewer, test budget, time target and worker cleanup, degrading cleanly when only one AI product or one account is available. Use whenever a coordinating agent might delegate implementation, review or article drafting to other agents, or the user says dispatch, fan out, parallelize, run several agents or accounts, 派活, 并行, 多开, 分给多个 Claude 账号 / codex / grok, 找另一个 AI 审, 调研, research how good software does it, 对比优秀设计, 多方意见, 出设计稿, or complains that simple tasks drag on. Skip read-only questions, one-line edits, and requests already fully covered by a single named workflow skill."
metadata:
  author: adonis
  version: "1.4.0"
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

| Missing                                  | Do instead                                                                                                                                                                                                   | Why                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| A second AI product                      | Reviewer is a fresh session of the same product given only the spec, the diff and the acceptance checks, never the writer's conversation or reasoning                                                        | Independence comes mostly from not sharing the writer's context and assumptions |
| A second account or quota pool           | L2 runs the parts sequentially in their worktrees, or in parallel sessions on the one pool once the user authorizes 多开; in-session subagents are fine for read-only work but share the coordinator's quota | Parallel sessions on one pool share the same rate limit                         |
| `ocr` or the `open-code-review-*` skills | Reviewer reads `git diff <base>...` plus the task spec and returns findings as `file:line — problem — evidence`; the coordinator verifies each before fixing                                                 | Keeps a structured, checkable review without the tool                           |
| `architecture-hardening-loop`            | Treat L3 as L1/L2 on the named scope with an explicit list of structural changes the user approved                                                                                                           | Avoid unbounded refactors without the loop's guardrails                         |
| Writing skills in the drafting agent     | Paste the key writing rules into the drafting prompt, or let the coordinator write                                                                                                                           | A drafting agent without the rules produces text the coordinator must redo      |
| A drafting agent                         | Coordinator writes, loading the writing skills itself                                                                                                                                                        | —                                                                               |

## Reviewer choice

Clean-context verification catches blind spots the author cannot see. When `agentic-review-handoff` is installed, follow its saved preferences (`review-loop prefs`). Otherwise prefer, in order: another product than the writer → a fresh session of the same product → the coordinator, when it did not write the code. When the user restricts dispatch to one product (e.g. only Claude accounts), the reviewer is a fresh session on a different account of that product than the writer. When the coordinator is a different product from the worker, the coordinator running `open-code-review-delegate` already counts as cross-model review. The writer never reviews its own diff. Tell the reviewer to try inputs the request's examples skip (boundaries, NaN, halves, binary floating point): a reviewer that only replays the given examples passes code that is wrong one step off them.

A reviewer prompt (e.g. for `open-code-review-delegate`) names the range (`<base>..<head>`), a requirement summary, the focus list, 100% file coverage, and "also review the tests and docs OCR excludes". For a merge commit, review the conflict resolution with `git show --remerge-diff <merge>` plus the diff against each parent. A Codex reviewer under `exec -s read-only` cannot run Vitest (no temp dirs): it marks test execution `UNVERIFIED` and the coordinator re-runs the tests.

## Escalation and de-escalation

- Move up one tier only when work in progress proves it: a second package must change, file sets overlap, or a review finding changes behavior outside the original scope.
- Move down when a planned split collapses to one file set; release the extra worker instead of keeping it busy.
- L0/L1 never wait for a batch. Finish, verify and hand them to delivery on their own, so a 10-minute fix does not queue behind a 90-minute release.

## One coordinator

- Exactly one session dispatches, integrates, decides and reports. A second session relaying the same events doubles the user's reading and invites conflicting decisions.
- When the user has delegated decisions, decide reversible ones yourself and log each (what, options, choice, reason); show the list at milestones and at the end, e.g. `lane B base — shared base / lane A's branch — lane A's branch — B calls A's new API`. Destructive, production, billing, auth and external-message actions still need the user.
- Report at milestones only: tier chosen, batch integrated, blocked on the user, done.
- One integration line per batch: a shared package and its consumer change in the same batch and merge once.

## Dispatching workers

Parallel writers making uncoordinated implicit decisions create merge conflicts and incoherent architecture. Before starting workers, strictly verify each worker's writable files are disjoint. Overlap means collapse to L1 immediately rather than risking integration failure.

Write each worker prompt from `references/task-spec.md` (research briefs from `references/research-brief.md`). Look at every input you attach before sending it. Workers never push, merge into other branches, deploy or publish; they return an outcome line, the touched-file list and evidence. The coordinator integrates.

Each lane gets its own worktree on its own short branch (one branch cannot be checked out in two worktrees). A lane that needs another lane's commits branches from that lane's branch, not from the shared base. Workers either leave changes uncommitted, or, when the spec says so, make local commits on their own short branch with hooks passing.

Headless launch shapes (use `<command>` reported per account by the probe):

| Product     | One-shot                                                                                                                     | Next round                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Claude Code | `cd <worktree> && <command> -p "$(cat <spec>)" --output-format json --allowedTools <list> < /dev/null > out.json 2> err.log` | `<command> --resume <session_id> -p "<delta>" ...` |
| Codex       | `<command> exec -C <worktree> -s workspace-write -o <out.md> - < <spec>`                                                     | `<command> exec resume <session> ...`              |
| Grok Build  | `<command> --cwd <worktree> --prompt-file <spec> --output-format json --always-approve`                                      | add `--resume <session>`                           |
| Antigravity | `<command> -p "$(cat <spec>)" --output-format json --print-timeout 0s` (drafting)                                            | add `--continue` in the same worktree              |

Notes on these shapes:

- Through a multi-account launcher such as sideby, the product's own arguments follow `--` (`sideby run codex:main -- exec ...`); the probe's sideby `<command>` already ends in `--`, a hand-written accounts-file command may not.
- Codex: pass the prompt on stdin (`-`). `-i <image>` takes several values and swallows a prompt written after it, so a prompt given as an argument after `-i` is lost. `-o <file>` writes the final message, which is easier than reading the JSONL stream; add `-c tools.web_search=true` for research and `-s read-only` when nothing may change.

Headless runs must never wait on a TTY: close stdin, run them in the background, and grant the edit/run permissions the worktree needs, or a worker hangs silently. For Claude, `--permission-mode acceptEdits` is not enough: Bash (`pnpm install`, git, tests) is denied under `-p` and the lane stalls. Prefer an explicit `--allowedTools` list (e.g. `"Edit Write Read Bash(pnpm:*) Bash(git:*)"`); otherwise use `--permission-mode bypassPermissions` only inside a dedicated worktree with strict Ownership in the spec. Claude's JSON carries `session_id`, `result`, `total_cost_usd` and `num_turns`. Output shapes differ: Claude returns one JSON object with `.result`, Grok one object with `.text`, Codex a JSONL stream whose `item.completed` events carry the messages; read the task-spec Return block from that text. Headless sessions also load the user's full skills and global instructions, which can dwarf a small task's cost, so give trivial reviews to the cheapest available product.

For any other CLI, check its `--help` for a non-interactive mode before dispatching; if it has none, do not use it as a worker.

A fix round resumes the writer's session and sends only the review findings and the coordinator's decisions, not the whole spec again.

With a multi-account manager such as sideby, interactive sessions stay the user's to start. Non-interactive `-p` / `exec` worker runs (`sideby run <ref> -- -p ...`) are fine when the user has authorized dispatch.

Round budget: at most 3 dispatch rounds per task. A fourth round means the spec was wrong; rewrite it or take the task back.

## Machine load

- Workers run only affected tests (`vitest run <files>` or `--related`).
- One full suite per batch, before delivery, with test concurrency capped (e.g. Vitest/Jest `--maxWorkers=2`, Node `--test-concurrency=2`, pytest `-n 2`), only when no other session is running one.
- Before ending, confirm no leftover test runners, type checkers or dev servers started by you or your workers.
- A reviewer or test run silent for 5 minutes: read its log first instead of waiting longer.

## Completion accounting

After a worker's result is integrated and committed by the coordinator, immediately reuse that worker, keep it with a stated reason, or remove its worktree with `git worktree remove --force <path>` (or `worktree-tidy` if installed), then delete its merged short branch with `git branch -d`. `--force` is expected for uncommitted lanes: their worktree holds copies of what the coordinator already integrated; confirm the integrated commit contains those changes first.

Final report per task: tier, who wrote and who reviewed (including any fallback), outcome, evidence, decisions taken for the user, and what still waits on the user.
