# Plan: agent-dispatch Run Board

Status: implemented in the working tree (2026-10-19); Codex review: round 1 BLOCKED (18 findings), round 2 BLOCKED (8 should-fix, 2 nits), round 3 PASS_WITH_CONCERNS (3 should-fix, 1 nit); every finding fixed with a regression test, the round-3 fixes verified by tests only (review budget of 3 rounds used); not committed. Terms follow `skills/agent-dispatch/GLOSSARY.md`.

## Background

`agent-dispatch` starts background Workers (`claude -p`, `codex exec`, `grok --prompt-file`) that have no terminal of their own. Orca and `claude agents` (Agent View) show interactive sessions and Claude subagents, but not these headless Workers, Codex or Grok, and neither shows plan progress. The user sees only the Coordinator running `Bash: sleep` and must read long chat replies to learn what is happening.

## Goals

The user can open a Board at any time and see, for the current Run: each Lane, its Worker, state, current activity and round; what the Run is waiting on; and what is waiting on the user.

## Decisions so far

| #   | Decision                                                                                                                                                                                                                                         | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| D1  | Board covers only the Lanes of the current Run; global views stay with Orca and `claude agents`                                                                                                                                                  | agreed |
| D2  | Terms: Run, Lane, Worker, Subagent, Coordinator, Board (see GLOSSARY)                                                                                                                                                                            | agreed |
| D3  | Only the Coordinator writes the ledger; live activity is derived from Worker output files                                                                                                                                                        | agreed |
| D4  | Board is used for L2, L3, Research, and L1 when a Worker is dispatched                                                                                                                                                                           | agreed |
| D5  | Ledger at `<coordinator toplevel>/.agent-dispatch/runs/<run-id>/`, excluded via `$GIT_COMMON_DIR/info/exclude`, archived to `.agent-dispatch/archive/`; outside Git use `~/.local/state/agent-dispatch/` (pattern from `agentic-review-handoff`) | agreed |
| D6  | One `scripts/dispatch_board.py` prints a terminal table, `--watch` refreshes, `--html` writes a self-refreshing static page                                                                                                                      | agreed |
| D7  | Copy the agentic-review-handoff patterns (exclude line, active/archive, tmp+rename writes, STOP file); no cross-skill import                                                                                                                     | agreed |
| D8  | Lane states `queued / working / needs-you / done / failed / stopped`, plus derived `stale` after 5 min of silence                                                                                                                                | agreed |
| D9  | Worker launch shapes switch to streaming events written to `<lane>.jsonl` (Claude `stream-json --verbose`, Codex `exec --json` + `-o`, Grok `streaming-json`)                                                                                    | agreed |
| D10 | Coordinator records its own Subagents in the ledger; no hooks installed; Worker-internal Subagents counted from the event stream                                                                                                                 | agreed |
| D11 | Every background shell, deploy, CI run or build the Coordinator starts is registered as a Wait with stage and log path (P2, P3)                                                                                                                  | agreed |
| D12 | An Ask needs question, recommendation, evidence (file + diff or quote) and what it blocks; outward actions add recipient, channel and full draft (P5–P7)                                                                                         | agreed |
| D13 | Standing Grants are recorded with scope, the user's words and time; outward-action grants last for the current Run only; unclear scope is asked once (P5)                                                                                        | agreed |
| D14 | No foreground `sleep` polling: use host background waits that wake the Coordinator; hosts without them end the turn naming what is awaited and where on the Board (P1)                                                                           | agreed |
| D15 | While Lanes or Waits remain, the Coordinator's reply starts with `Run 进行中：N 个 Lane 在跑，M 个 Wait，K 个 Ask` plus the Board path (P2, P9)                                                                                                  | agreed |
| D16 | The Board shows account and quota pool per Worker, flags a reviewer on the writer's pool, and the Coordinator switches pools before review or states the fallback (P8)                                                                           | agreed |
| D17 | When `orca status` is reachable, Lanes start through Orca orchestration and show in the Orca sidebar                                                                                                                                             | agreed |
| D18 | The HTML Board is always available (portable); in Orca mode it also reads `orca orchestration worker-list --json`, so both views agree                                                                                                           | agreed |
| D19 | Inside Orca, after the user authorized dispatch, the Coordinator may open visible terminals on sideby accounts; outside Orca interactive sessions stay the user's to start                                                                       | agreed |
| D20 | Terminal titles `<Lane short name> · <role> · <account>`, about 20 characters, key facts first (e.g. `B9 卡片 · 写 · cc003`, `Wait · 部署 test`)                                                                                                 | agreed |
| D21 | Asks are numbered `A1`, `A2` and answered in the Coordinator's chat; mirrored as Orca decision gates if those surface in the UI                                                                                                                  | agreed |
| D22 | Notifications reuse the existing Feishu attention hook and Orca's own notifications                                                                                                                                                              | agreed |
| D23 | Several Runs: `orca orchestration run-list` in Orca, `dispatch_board.py show --all` over `~/.local/state/agent-dispatch/runs.json` otherwise                                                                                                     | agreed |
| D24 | A sideby handoff brief carries the run-id; the next Coordinator binds it (`orchestration run-use` or the ledger) instead of starting a new Run                                                                                                   | agreed |
| D25 | Pilot in a scratch setting before editing the skill: Orca terminals, sideby account takeover, `check --wait`, gate visibility                                                                                                                    | agreed |

## Observed problems (acceptance scenarios)

Collected from real Coordinator sessions on 2026-10-19. The Board and the updated skill must make each one visible or impossible.

| #   | What happened                                                                                                                     | Why it hurts                                                                                                                | What the Board / skill must do                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | The Coordinator sat in `Bash: sleep ...` for 59 minutes while waiting                                                             | The session looks busy but does nothing; the user cannot tell whether work is moving                                        | Replace sleep polling with background waits that notify on finish; the Board shows what is being waited on                                                                   |
| P2  | Turn ended with `Worked for 28s · done` and `2 shells still running`                                                              | "done" reads as the Run being finished, while a deploy and a review are still in flight                                     | Run state is shown separately from the Coordinator's turn state; every background shell appears with what it is                                                              |
| P3  | Deploy progress (server built, web still building) lived only in chat text                                                        | Non-agent waits (deploy, CI, build) are invisible to Orca and Agent View                                                    | The Board lists external waits alongside Lanes, with their current stage                                                                                                     |
| P4  | "Next steps" 1–3 depended on the two waits, but the dependency was only in prose                                                  | The user cannot see what unblocks what                                                                                      | The Board shows pending steps and what each waits on                                                                                                                         |
| P5  | Question "可以按同样的流程直接部署吗？" had no recommendation; the user answered "以后都按照推荐的来改吧"                         | A question without a recommendation forces the user to guess; the answer became a standing rule nobody recorded             | Every needs-you item carries a recommendation; standing authorizations are recorded in the ledger with their exact scope (e.g. deploy to `test` only) and shown on the Board |
| P6  | "AGENTS.md 那 3 行改不改？" referred to lines the user could not see                                                              | The user must scroll back or ask to decide                                                                                  | A needs-you item links to or quotes the exact change (file and diff)                                                                                                         |
| P7  | "群里打招呼的消息由你来发" was listed as a question but was a statement, with no recipient or text; the user replied "发什么消息" | An external-message action without recipient and draft cannot be approved                                                   | A needs-you item for an outward action includes recipient, channel and the full draft text                                                                                   |
| P8  | "cc002 在审 M3b 的修复轮" while the Coordinator itself runs on `cc002`                                                            | Reviewer and Coordinator share one quota pool, and possibly the writer's account; this weakens review and speeds limit hits | The Board shows account and quota pool per Worker and flags a reviewer on the writer's account                                                                               |
| P9  | The status report mixed waits, next steps and questions in one reply                                                              | The user must parse prose to find what needs them                                                                           | The Board separates three blocks: Running, Waiting, Needs you                                                                                                                |

## Finding: Orca already has a supervised orchestration layer

Checked on this machine with Orca CLI `1.4.229` (`orca skills get orchestration`, `orca orchestration worker-start --help`):

- `orchestration run-create` / `worker-start` / `check --wait` / `reply` / `gate-create` / `worker-list` cover Run, Lane attempts, waiting without `sleep`, blocking questions, decision gates and liveness.
- `worker-start --agent` accepts Orca agent ids (`claude`, `codex`, `cursor`, `antigravity`, ...); Grok is not listed. `--terminal <handle>` reuses a terminal created by `orca terminal create --command <text>`, which could start a sideby account (`cc002`). UNVERIFIED: whether a sideby-launched TUI accepts the injected preamble.
- Workers started this way get a visible Orca terminal, so they appear in the sidebar the user already watches, unlike today's headless `-p` / `exec` Workers.
- Orca has no notion of quota pools, Standing Grants or deploy Waits; those remain agent-dispatch rules (Waits can be titled Orca terminals).

This conflicts with the current skill rule "interactive sessions stay the user's to start" under sideby; round 4 asks the user.

## Pilot results (2026-10-19, Orca 1.4.229, Run `run_5b3a58471197`)

Two read-only Lanes from this repo's main checkout: A via `worker-start --agent codex`, B via `orca terminal create --title "Pilot B · 读 · cc003" --command "sideby run claude:003 --"` then `worker-start --terminal <handle>`. Both reported correct results and were released; `worker-list --terminal-state reclaimable` returned 0; `git status` showed no changes from the workers.

| Check                                    | Result                                                                                                              | Consequence                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| sideby account takeover via `--terminal` | works (cc003 received the preamble, asked, replied, sent `worker_done`)                                             | D19 holds; one launch path for every account                                 |
| Sidebar naming                           | `--agent` workers show as `worker-task_<id>`; `--task-title` is not displayed; a titled terminal shows its title    | D20: always `terminal create --title` first, then `worker-start --terminal`  |
| `check --wait`                           | wakes on `question` and `worker_done`; the batch replays until `--ack <result.deliveryId>`                          | D14: in Orca mode use `check --wait`, always ack                             |
| Asks in the UI                           | a worker waiting on a question still shows a working spinner and `Bash: orca orchestration ...`; no Needs You state | D21: Asks live in the Coordinator chat and the HTML Board                    |
| Decision gates                           | `gate-create` refuses a task with an active Dispatch (`task_not_startable`)                                         | Gates only for "do not start this Lane until the user decides"               |
| Sidebar progress                         | rows show the last tool call, not Lane progress or round                                                            | The HTML Board stays the place for progress, Waits, Asks and Standing Grants |
| `orca status --json` `caller`            | `null` even though this session runs in an Orca terminal; `run-create` still bound a coordinator handle             | Detect Orca with `orca status` `runtimeReachable`, not `caller`              |

Not verified: Grok in an Orca terminal (`worker-start --terminal` on a Grok TUI); Orca absent (HTML-only path); a Coordinator in a plain terminal outside Orca.

## Review round 1 (Codex, 2026-10-19)

Verdict BLOCKED with 18 findings; all accepted. Round 2 found five of the fixes incomplete (registry race across Coordinators, archived event paths, a close race branch, very long final events, Subagents split from their parent by section) plus Lane/Wait id clashes; those were fixed with interleaving tests. Notable design changes: Run ids are validated and never reused; the HTML Board moved to `<base>/boards/<run-id>.html` so its path survives `close`; Lanes and Waits gained `--after` for step dependencies (P4); in Orca mode the Board falls back to Orca activity because interactive Workers write no event file (D18); a `STOP` file stops the watcher and refuses new Lanes (D7; ledgers need no lock because one Coordinator writes each, but the shared registry takes an flock); notifications reuse the host's existing attention hooks and Orca notifications, stated in SKILL.md (D22).

## skill-creator review (Codex, 2026-10-19)

Three read-only rounds against skill-creator's guidance (no `run_loop`, no `claude -p`): NEEDS_WORK (10 findings), NEEDS_WORK (6 should-fix, 2 nice-to-have), NEEDS_WORK (2 should-fix, 1 nice-to-have). All fixed; the last round's three were verified by tests only. Main changes: eval fixtures generated by the probe in an empty environment; "停" pauses dispatch and the Coordinator then stops what it can; blanket permission modes need explicit authorization (a worktree is not a permission boundary); `open` reports failure and the Coordinator falls back to chat; plain-language rules for a non-technical user; a 6+6 trigger eval set; description rewritten (994 characters). Trigger rates remain UNVERIFIED.

## Open questions

None in design.

## Risks

- Codex `--json` field names differ across versions; the parser must accept both shapes and be checked against the installed version.
- A Board process left running after the Run ends; the skill's cleanup rule must cover it.

## Acceptance criteria

- Each of P1–P9 is either shown on the Board or prevented by a skill rule, checked against a replayed Run.
- `scripts/dispatch_board.py` has tests for state derivation (`stale`, `needs-you`, finished) and for both Codex event shapes.
- `pnpm skills:validate` and `pnpm skills:index` pass.
