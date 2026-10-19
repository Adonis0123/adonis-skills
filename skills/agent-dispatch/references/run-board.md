# Run Board

How the Coordinator keeps a Run ledger and shows it to the user. Terms (Run, Lane, Worker, Subagent, Wait, Ask, Standing Grant, Board) are defined in `../GLOSSARY.md`.

The user should be able to open the Board at any moment and see, without reading the chat: what each Lane is doing and on which account, what the Run is waiting on, and what is waiting on them.

## Two views, one ledger

| View         | When                                                          | What it shows                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orca sidebar | `orca status --json` reports `result.runtime.reachable: true` | One titled terminal per Worker under the Coordinator; click to watch or take over. Rows show the last tool call only.                                                                                 |
| HTML Board   | always                                                        | Running Lanes (activity, round, elapsed, silence, pool, Subagents), Waits with their last log line, open Asks with recommendation and evidence, Standing Grants, finished Lanes. Refreshes every 5 s. |

Only the Coordinator writes the ledger, through `scripts/dispatch_board.py`. Workers never write it; their activity is read from their event streams (and from Orca liveness when the Lane has a `--dispatch` id).

## Who does what

The user is treated as a non-technical reader: every command on this page is run by the Coordinator, never handed to the user. The page itself uses plain words (任务, 外部等待, 问题等你回答, 账号额度), shows task names instead of ids, and tells the user to answer in the chat ("A1 按推荐") or say "停". `open` was verified on 2026-10-19 with `orca tab create --url file://…` (the page loaded in Orca's browser) and with macOS `open`.

## Ledger location

- Inside Git: `<coordinator toplevel>/.agent-dispatch/runs/<run-id>/run.json`. The script adds `/.agent-dispatch/` to `$GIT_COMMON_DIR/info/exclude` (never `.gitignore`), so it stays out of `git status` in every worktree.
- Outside Git: `~/.local/state/agent-dispatch/runs/<run-id>/` (override with `AGENT_DISPATCH_STATE_DIR`).
- The HTML Board lives at `<base>/boards/<run-id>.html`, outside the Run directory, so its path stays valid after `close` (which leaves a final "Run 已关闭" page there).
- Closed Runs move to `archive/<run-id>/`; a Run id is 1-64 letters, digits, `.`, `_` or `-` and is never reused. Every Run is registered in `~/.local/state/agent-dispatch/runs.json` for `show --all`.
- Writes go to a temp file and are renamed into place, so the Board never reads half a file.

## Commands

`B` below is `python3 <this skill>/scripts/dispatch_board.py`. Pass `--run <dir>` (printed by `init`) or set `AGENT_DISPATCH_RUN`; with a single active Run in the repo neither is needed.

```bash
B init --objective "<what this Run delivers>" --account <coordinator account> [--orca-run <orca run id>]
B show --watch 5 --html &        # start once, in the background; exits when the Run closes
B lane add --id B9 --title "B9 卡片" --role write --account claude:003 --pool claude:003 \
  --branch feat/b9 --output <run dir>/B9.jsonl [--dispatch <orca dispatch id>] --state working
B lane add --id R-B9 --title "B9 审" --role review --reviews B9 --account codex:002 --pool codex:002 --output ...
B lane add --id S1 --kind subagent --parent coordinator --title "S1 查 catalog" --state working
B lane set --id B9 --state done --note "集成到 main：3 个文件" [--round 2]
B wait add --id deploy-test --title "部署 test" --log <log path> --stage "server 已好，web 构建中"
B wait set --id deploy-test --state done
B lane add --id J1 --title "联调" --role write --state queued --after deploy-test,R-B9   # P4: a step and what it waits on
B ask add --id A1 --question "..." --recommend "..." --evidence "<file + diff, or quote>" --blocks "<what waits on it>"
B ask add --id A2 --outward --question "发群消息吗？" --recommend "发" --evidence "..." --blocks "..." \
  --recipient "<person or group>" --channel "飞书" --draft "<full text>"
B ask answer --id A1 --answer "<user's reply>"
B grant add --scope "部署到 test，同样流程" --words "以后都按照推荐的来" --outward
B open                           # open the Board for the user: Orca tab, else system browser; exit 3 = not opened, report in chat
B show --line                    # the Run state line for the top of a reply
B show --all                     # every active Run on this machine
B close                          # archive; the background watcher exits by itself
```

Roles: `write`, `review`, `research`, `draft`. Lane states: `queued`, `working`, `needs-you`, `done`, `failed`, `stopped`. Wait states: `running`, `done`, `failed`, `stopped`. Relative `--output` / `--log` paths in a hand-made ledger resolve against the Run directory. Every mutation rewrites an existing Board page at once, and `show --line` names the page once it exists. `--after` lists Lane or Wait ids; the Board shows the ones not yet `done` as "等：…".

When the user says "停", the Coordinator runs `touch <run dir>/STOP`: `lane add` then refuses new Lanes and the Board shows "已暂停派新任务" with everything still running. The file does not stop running work by itself, so the Coordinator then stops each running Lane and Wait it can (`orca orchestration worker-stop`, or the processes it started), sets them `stopped`, and reports in the chat which ones could not be stopped. The watcher keeps refreshing throughout. To resume, delete the file.

## Rules the Board enforces or exposes

| Rule                                                                                                                                                            | Why (observed problem)                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Register every background shell, deploy, CI run or build as a Wait, with a log path                                                                             | `2 shells still running` with no names; deploy progress lived only in chat                                                                    |
| An Ask needs question, recommendation, evidence and what it blocks; an outward Ask adds recipient, channel and full draft. The script refuses an incomplete Ask | "可以直接部署吗？" without a recommendation; "群里打招呼的消息由你来发" with no recipient or text; "AGENTS.md 那 3 行" the user could not see |
| Number Asks `A1`, `A2`; the user answers in the Coordinator's chat                                                                                              | Orca shows a Worker waiting on a question as still working                                                                                    |
| A Standing Grant records scope and the user's words; an outward grant (deploy, send, publish) lasts this Run only; ask once when the scope is unclear           | "以后都按照推荐的来改吧" became a rule nobody wrote down                                                                                      |
| A Lane silent for 5 minutes while `working` is flagged; read its log before waiting longer                                                                      | The Coordinator sat in `Bash: sleep` for 59 minutes                                                                                           |
| A stream that ended while the Lane is still `working` is flagged "待协调者集成"                                                                                 | Finished Workers were indistinguishable from busy ones                                                                                        |
| A reviewer on the same quota pool as the Lane it reviews is flagged                                                                                             | A reviewer on the writer's account weakens review and burns one pool                                                                          |

## Worker event streams

Write each headless Worker's stdout to `<run dir>/<lane>.jsonl` and pass it as `--output`:

| Product     | Flags                                          | What the Board reads                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code | `-p ... --output-format stream-json --verbose` | `assistant` tool_use / text; `Task`/`Agent` tool_use as Subagents; `result` (cost, `is_error`)                                                                                                                                 |
| Codex       | `exec --json -o <final.md>`                    | `item.*` with `command_execution`, `agent_message`, `file_change`; `turn.completed` / `turn.failed`. An item of type `error` is a warning, not a failure. Older versions used `item_type` / `assistant_message`; both are read |
| Grok Build  | `--output-format streaming-json`               | `tool_call` (`toolName`, `rawInput`), `text` deltas, `spawn_subagent`, `end` (`stopReason`)                                                                                                                                    |

Shapes verified on 2026-10-19 with Claude Code 2.1.301, codex-cli 0.163.0 and Grok Build; re-check after a CLI upgrade if activity shows `-`.

## Orca mode

Verified with Orca CLI 1.4.229. Use the executable that `orca skills get orchestration` came from for the whole Run.

1. `orca orchestration run-create --objective "<objective>" --json` → pass its `run.id` to `B init --orca-run`.
2. Per Lane, register it first (`B lane add ... --state queued --output <run dir>/<lane>.jsonl`), so a failed start is still visible. Then open a titled terminal on the chosen account and hand it to Orca:
   ```bash
   orca terminal create --worktree path:<worktree> --title "B9 卡片 · 写 · cc003" --command "<probe command, e.g. sideby run claude:003 -->" --json
   orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
   orca orchestration worker-start --run <orca run> --worktree path:<worktree> --terminal <handle> --task-title "<title>" --spec "<task-spec text>" --json
   ```
   Then `B lane set --id <lane> --state working --dispatch <dispatchId from worker-list>`. Interactive Workers write no event file, so the Board shows Orca's activity and observation time for them. Always use a titled terminal: `worker-start --agent <id>` Workers show as `worker-task_<id>` in the sidebar because `--task-title` is not displayed. If `worker-start` fails, set the Lane `failed` with the receipt's `failedStage` as `--note`.
3. Wait with `orca orchestration check --run <orca run> --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json`. Process every message, then pass `--ack <result.deliveryId>` on the next `check`; an unacknowledged batch is replayed.
4. Relay a Worker `question` to the user as an Ask (`B ask add`), answer with `orca orchestration reply --id <message id> --body "<answer>"`.
5. After an accepted `worker_done`: integrate, `B lane set --state done`, then `orca orchestration worker-release --dispatch <id>`. Before ending, `worker-list --run <orca run> --terminal-state reclaimable` must return none.

Notes from the pilot:

- `orca status --json` showed `caller: null` inside an Orca terminal; detect Orca by `result.runtime.reachable`, not `caller`.
- `gate-create` refuses a task whose Dispatch is active. Use a gate only to hold a Lane that must not start until the user decides (for example a deploy Lane); in-flight questions are Asks.
- Grok is not an Orca agent id, and handing a Grok TUI to `worker-start --terminal` is untested. Run Grok Lanes headless with `streaming-json`; they appear on the HTML Board only.

## Without Orca, or without background waits

- Headless Workers run in the background with their `.jsonl` output, as in the SKILL launch table.
- Wait with the host's background mechanism: Claude Code `run_in_background` Bash with an `until` loop, or Monitor. Never a foreground `sleep`.
- A host with no background wait (some Codex or Grok sessions) ends its turn instead, with the Run state line and the Board path, and resumes when the user returns.

## Handoff

A sideby handoff brief names the Run directory and, in Orca mode, the Orca run id. The next Coordinator sets `AGENT_DISPATCH_RUN` (and `orca orchestration run-use <id>`) and continues the same Run; it does not start a new one.
