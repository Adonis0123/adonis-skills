---
name: agent-dispatch
description: "Decide how much agent machinery a coding task deserves before starting it: do it yourself (L0/L1), fan out to 2-3 workers with non-overlapping files across whatever Claude Code, Codex, Grok Build, Cursor or other CLIs this machine actually has (L2), or run a scoped architecture loop (L3); then pick a cross-model reviewer, test budget, time target and worker cleanup, degrading cleanly when only one AI product or one account is available. Use whenever a coordinating agent might delegate implementation, review or article drafting to other agents, or the user says dispatch, fan out, parallelize, run several agents or accounts, 派活, 并行, 多开, 分给多个 Claude 账号 / codex / grok, 找另一个 AI 审, or complains that simple tasks drag on. Skip read-only questions, one-line edits, and requests already fully covered by a single named workflow skill."
metadata:
  author: adonis
  version: "1.2.0"
---

# Agent Dispatch

One coordinating agent decides how much machinery a task deserves. The scarce resource is the user's attention and the facts only they can confirm, not lines an agent can write. Extra workers speed up only the coding step; integration, review rounds, deploys and status reports grow with every worker. So default to the lightest tier, escalate only on evidence, and say why in one line.

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
- `max_parallel_workers`: distinct quota pools minus the one the coordinator keeps;
- `fallback`: degradations that apply on this machine.

Optional accounts file shape (`pool` groups accounts sharing quota; missing `pool` gets its own pool):

```json
{
  "accounts": [
    { "product": "claude", "command": "claude", "pool": "personal" },
    {
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

| Tier           | Pick when                                                             | Who writes                                                                                                                    | Review                                                                            | Tests                                                                 | Target                               |
| -------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| **L0 Direct**  | read-only, copy, style, static asset, or one file, no behavior change | coordinator, current checkout, no worktree                                                                                    | none                                                                              | page evidence or none                                                 | ~10 min (3-4 rounds)                 |
| **L1 Single**  | behavior change inside one module, about 5 files or fewer             | coordinator, or 1 worker                                                                                                      | one independent pass (see Reviewer choice)                                        | affected files only                                                   | 30-45 min                            |
| **L2 Fan-out** | cross-package work that splits into file sets with no overlap         | up to `max_parallel_workers` workers, one worktree each; 0 means run the parts one after another                              | `agentic-review-handoff` (saved prefs) or `open-code-review-loop`, round budget 2 | affected files per worker; one full run per batch, concurrency capped | per batch                            |
| **L3 Arch**    | structure pain with a user-given scope                                | `architecture-hardening-loop` (implement), or `improve-codebase-architecture` (diagnose; user-invoked only)                   | built into the loop                                                               | as L2                                                                 | own slot, not inside a feature batch |
| **Writing**    | article, proposal, weekly report, retrospective                       | the first of `drafting_agents`, else an idle code product, else the coordinator; start after the code it describes has landed | coordinator checks every fact, number, path and command against sources           | the repo's doc check when the file lives in a repo                    | —                                    |

Before acting, output one line: `Dispatch: L<n> — <decisive reason>; workers <n>; reviewer <who>; target <time>`.

## Fallbacks when tools are missing

The tiers stay the same; only who fills each role changes. Say which fallback applied in the dispatch line or final report so the user knows the review was weaker or the batch slower than ideal.

| Missing                                  | Do instead                                                                                                                                                   | Why                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| A second AI product                      | Reviewer is a fresh session of the same product given only the spec, the diff and the acceptance checks, never the writer's conversation or reasoning        | Independence comes mostly from not sharing the writer's context and assumptions |
| A second account or quota pool           | L2 runs the parts sequentially in their worktrees; in-session subagents are fine for read-only work but share the coordinator's quota                        | Parallel sessions on one pool just queue on the same rate limit                 |
| `ocr` or the `open-code-review-*` skills | Reviewer reads `git diff <base>...` plus the task spec and returns findings as `file:line — problem — evidence`; the coordinator verifies each before fixing | Keeps a structured, checkable review without the tool                           |
| `architecture-hardening-loop`            | Treat L3 as L1/L2 on the named scope with an explicit list of structural changes the user approved                                                           | Avoid unbounded refactors without the loop's guardrails                         |
| Writing skills in the drafting agent     | Paste the key writing rules into the drafting prompt, or let the coordinator write                                                                           | A drafting agent without the rules produces text the coordinator must redo      |
| A drafting agent                         | Coordinator writes, loading the writing skills itself                                                                                                        | —                                                                               |

## Reviewer choice

Clean-context verification catches blind spots the author cannot see. When `agentic-review-handoff` is installed, follow its saved preferences (`review-loop prefs`). Otherwise prefer, in order: another product than the writer → a fresh session of the same product → the coordinator, when it did not write the code. When the coordinator is a different product from the worker, the coordinator running `open-code-review-delegate` already counts as cross-model review. The writer never reviews its own diff. Tell the reviewer to try inputs the request's examples skip (boundaries, NaN, halves, binary floating point): a reviewer that only replays the given examples passes code that is wrong one step off them.

## Escalation and de-escalation

- Move up one tier only when work in progress proves it: a second package must change, file sets overlap, or a review finding changes behavior outside the original scope.
- Move down when a planned split collapses to one file set; release the extra worker instead of keeping it busy.
- L0/L1 never wait for a batch. Finish, verify and hand them to delivery on their own, so a 10-minute fix does not queue behind a 90-minute release.

## One coordinator

- Exactly one session dispatches, integrates, decides and reports. A second session relaying the same events doubles the user's reading and invites conflicting decisions.
- When the user has delegated decisions, decide reversible ones yourself and log each (what, options, choice, reason); show the list at milestones and at the end. Destructive, production, billing, auth and external-message actions still need the user.
- Report at milestones only: tier chosen, batch integrated, blocked on the user, done.
- One integration line per batch: a shared package and its consumer change in the same batch and merge once.

## Dispatching workers

Parallel writers making uncoordinated implicit decisions create merge conflicts and incoherent architecture. Before starting workers, strictly verify each worker's writable files are disjoint. Overlap means collapse to L1 immediately rather than risking integration failure.

Write each worker prompt from `references/task-spec.md`. Workers do not commit, push, deploy or publish; they return an outcome line, the touched-file list and evidence. The coordinator integrates.

Headless launch shapes (use `<command>` reported per account by the probe):

| Product     | One-shot                                                                                | Next round                            |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------- |
| Claude Code | `<command> -p "$(cat <spec>)" --output-format json --permission-mode acceptEdits`       | `<command> --resume <session> -p ...` |
| Codex       | `<command> exec -C <worktree> -s workspace-write --json "$(cat <spec>)" < /dev/null`    | `<command> exec resume <session> ...` |
| Grok Build  | `<command> --cwd <worktree> --prompt-file <spec> --output-format json --always-approve` | add `--resume <session>`              |
| Antigravity | `<command> -p "$(cat <spec>)" --output-format json --print-timeout 0s` (drafting)       | add `--continue` in the same worktree |

Headless runs must never wait on a TTY: close stdin and grant only the edit/run permissions the worktree needs, or a worker hangs silently. Output shapes differ: Claude returns one JSON object with `.result`, Grok one object with `.text`, Codex a JSONL stream whose `item.completed` events carry the messages; read the task-spec Return block from that text. Headless sessions also load the user's full skills and global instructions, which can dwarf a small task's cost, so give trivial reviews to the cheapest available product.

For any other CLI, check its `--help` for a non-interactive mode before dispatching; if it has none, do not use it as a worker.

Round budget: at most 3 dispatch rounds per task. A fourth round means the spec was wrong; rewrite it or take the task back.

## Machine load

- Workers run only affected tests (`vitest run <files>` or `--related`).
- One full suite per batch, before delivery, with test concurrency capped (e.g. Vitest/Jest `--maxWorkers=2`, Node `--test-concurrency=2`, pytest `-n 2`), only when no other session is running one.
- Before ending, confirm no leftover test runners, type checkers or dev servers started by you or your workers.
- A reviewer or test run silent for 5 minutes: read its log first instead of waiting longer.

## Completion accounting

After a worker's result is integrated and committed by the coordinator, immediately reuse that worker, keep it with a stated reason, or remove its worktree with `git worktree remove --force <path>` (or `worktree-tidy` if installed). `--force` is expected: workers never commit, so their worktree always holds uncommitted copies of what the coordinator already integrated; confirm the integrated commit contains those changes first.

Final report per task: tier, who wrote and who reviewed (including any fallback), outcome, evidence, decisions taken for the user, and what still waits on the user.
