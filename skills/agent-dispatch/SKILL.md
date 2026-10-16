---
name: agent-dispatch
description: "Decide how much agent machinery a coding task deserves before starting it: do it yourself (L0/L1), fan out to 2-3 workers with non-overlapping files across whatever Claude Code, Codex, Grok Build, Cursor or other CLIs this machine actually has (L2), or run a scoped architecture loop (L3); then pick a cross-model reviewer, test budget, time target and worker cleanup, degrading cleanly when only one AI product or one account is available. Use whenever a coordinating agent might delegate implementation, review or article drafting to other agents, or the user says dispatch, fan out, parallelize, run several agents or accounts, 派活, 并行, 多开, 分给 cc00x / codex / grok, 找另一个 AI 审, or complains that simple tasks drag on. Skip read-only questions, one-line edits, and requests already fully covered by a single named workflow skill."
metadata:
  author: adonis
  version: "1.0.0"
---

# Agent Dispatch

One coordinating agent decides how much machinery a task deserves. The scarce resource is the user's attention and the facts only they can confirm, not lines an agent can write. Extra workers speed up only the coding step; integration, review rounds, deploys and status reports grow with every worker. So default to the lightest tier, escalate only on evidence, and say why in one line.

## Step 0 — know what you can dispatch to

Run `python3 scripts/probe_agents.py` (relative to this skill) once per session before choosing a tier above L0. It reads `sideby list --json` when available, otherwise PATH, and prints:

- `code_products`: coding CLIs with a usable subscription login (API-key accounts are excluded because they bill per call; use them only when the user asks);
- `drafting_agents`: CLIs preferred for article drafting (currently Antigravity `agy`);
- `max_parallel_workers`: distinct quota pools minus the one the coordinator keeps;
- `fallback`: the degradations that apply on this machine.

Do not assume Codex, Grok, Antigravity or extra accounts exist because a plan, a prior session or this skill mentions them. If the probe cannot run, treat the machine as single-product with one pool.

Also confirm the review skills you plan to use are installed and callable; `open-code-review-*` additionally needs the `ocr` CLI on PATH.

## Tier card — decide in one pass

| Tier           | Pick when                                                             | Who writes                                                                                                                    | Review                                                                  | Tests                                                               | Target                               |
| -------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| **L0 Direct**  | read-only, copy, style, static asset, or one file, no behavior change | coordinator, current checkout, no worktree                                                                                    | none                                                                    | page evidence or none                                               | ~10 min (3-4 rounds)                 |
| **L1 Single**  | behavior change inside one module, about 5 files or fewer             | coordinator, or 1 worker                                                                                                      | one independent pass (see Reviewer choice)                              | affected files only                                                 | 30-45 min                            |
| **L2 Fan-out** | cross-package work that splits into file sets with no overlap         | up to `max_parallel_workers` workers, one worktree each; 0 means run the parts one after another                              | `open-code-review-loop`, round budget 2                                 | affected files per worker; one full run per batch, `--maxWorkers=2` | per batch                            |
| **L3 Arch**    | structure pain with a user-given scope                                | `architecture-hardening-loop` (implement), or `improve-codebase-architecture` (diagnose; user-invoked only)                   | built into the loop                                                     | as L2                                                               | own slot, not inside a feature batch |
| **Writing**    | article, proposal, weekly report, retrospective                       | the first of `drafting_agents`, else an idle code product, else the coordinator; start after the code it describes has landed | coordinator checks every fact, number, path and command against sources | the repo's doc check when the file lives in a repo                  | —                                    |

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

Prefer, in order: another product than the writer → a fresh session of the same product → the coordinator, when it did not write the code. When the coordinator is a different product from the worker, the coordinator running `open-code-review-delegate` already counts as cross-model review. The writer never reviews its own diff.

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

Before starting workers, list each worker's writable files and confirm no two sets overlap. Overlap means L1, not L2.

Write each worker prompt from `references/task-spec.md`. Workers do not commit, push, deploy or publish; they return an outcome line, the touched-file list and evidence. The coordinator integrates.

Headless launch shapes (use the account aliases the probe reported):

| Product     | One-shot                                                                    | Next round                                   |
| ----------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| Claude Code | `<claude-account> -p "$(cat <spec>)" --output-format json`                  | `<claude-account> --resume <session> -p ...` |
| Codex       | `<codex-account> exec -C <worktree> "$(cat <spec>)" --json`                 | `<codex-account> exec resume <session> ...`  |
| Grok Build  | `<grok-account> --cwd <worktree> --prompt-file <spec> --output-format json` | add `--resume <session>`                     |
| Antigravity | `agy -p "$(cat <spec>)" --output-format json --print-timeout 0s` (drafting) | add `--continue` in the same directory       |

For any other CLI, check its `--help` for a non-interactive mode before dispatching; if it has none, do not use it as a worker.

Round budget: at most 3 dispatch rounds per task. A fourth round means the spec was wrong; rewrite it or take the task back.

## Machine load

- Workers run only affected tests (`vitest run <files>` or `--related`).
- One full suite per batch, before delivery, at `--maxWorkers=2`, only when no other session is running one.
- Before ending, confirm no leftover test runners, type checkers or dev servers started by you or your workers.
- A reviewer or test run silent for 5 minutes: read its log first instead of waiting longer.

## Completion accounting

After a worker's result is integrated, immediately reuse that worker, keep it with a stated reason, or remove its worktree (with `worktree-tidy` if installed, otherwise `git worktree remove` after confirming its diff is on the remote). A finished worker never stays around by default.

Final report per task: tier, who wrote and who reviewed (including any fallback), outcome, evidence, decisions taken for the user, and what still waits on the user.
