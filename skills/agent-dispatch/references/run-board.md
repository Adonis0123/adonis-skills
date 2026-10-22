# Run Board

How the Coordinator keeps a Run ledger and shows it to the user. Terms (Run, Lane, Worker, Subagent, Wait, Ask, Standing Grant, Board) are defined in `../GLOSSARY.md`.

Live status and messaging belong to sideby's Panel: its 会话 page lists every session, its status, and lets the user send to one (`sideby sessions --json` is the same list for the Coordinator). The Board does not duplicate that. It is a milestone report: a static page the user can open at any moment to read what the Run set out to do, what is done and decided, and what is waiting on them. Answers come back in the Coordinator's chat.

## Three views, one ledger

| View         | When                                                          | What it shows                                                                                                                                                       |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sideby Panel | `sideby` on PATH                                              | Live: every session, busy / idle / needs-you, copy and "Send to it". `B open --panel` runs `sideby ui --background` for the user.                                  |
| Orca sidebar | `orca status --json` reports `result.runtime.reachable: true` | Live: one titled terminal per Worker under the Coordinator; click to watch or take over.                                                                           |
| Board        | always                                                        | Milestone report: objective, milestones, Lane cards with their summaries and full reports, decisions, outputs, commits, open Asks, Standing Grants. Written at milestones; an open tab re-reads it. |

The Coordinator writes the ledger through `scripts/dispatch_board.py`, which serializes each read/modify/write with a per-Run lock. Workers never write it; their activity is read from their event streams (and from Orca liveness when the Lane has a `--dispatch` id) and printed by `show`.

## Who does what

The user is treated as a non-technical reader: every command on this page is run by the Coordinator, never handed to the user. The page itself uses plain words (任务, 外部等待, 问题等你回答, 账号额度), shows task names instead of ids, and tells the user to answer in the chat ("A1 按推荐") or say "停".

## Ledger location

- Inside Git: `<coordinator toplevel>/.agent-dispatch/runs/<run-id>/run.json`. The script adds `/.agent-dispatch/` to `$GIT_COMMON_DIR/info/exclude` (never `.gitignore`), so it stays out of `git status` in every worktree.
- `<state>` below is `AGENT_DISPATCH_STATE_DIR`, else `$XDG_STATE_HOME/agent-dispatch`, else `~/.local/state/agent-dispatch`. Outside Git the Run lives at `<state>/runs/<run-id>/`.
- The Board lives at `<state>/boards/<run-id>.html`, never inside a repository, so editors and agent sessions working in the repo never see it change. Its path stays valid after `close`, which leaves the final report there. Beside it: `<run-id>.<lane>.report.html` (full reports). Writing a board deletes leftovers of the retired live Board: `<run-id>.alive.js` beside it and `serve.json` in the Run directory.
- A Run started by an older version may still have `<repo>/.agent-dispatch/boards/<run-id>.html`. The first write replaces it once with a static page pointing to the new location and never touches it again; nothing new is written into the repository's `boards/`.
- Closed Runs move to `archive/<run-id>/`; a Run id is 1-64 letters, digits, `.`, `_` or `-` and is never reused on this machine, even in another repository (Boards are named by Run id alone). Every Run is registered in `<state>/runs.json` for `show --all`.
- Writes go to a temp file and are renamed into place, so the Board never reads half a file.

## Commands

`B` below is `python3 <this skill>/scripts/dispatch_board.py`. Pass `--run <dir>` (printed by `init`) or set `AGENT_DISPATCH_RUN`; with a single active Run in the repo neither is needed.

```bash
B init --objective "<what this Run delivers>" --account <coordinator account> --coordinator-session <session id> [--orca-run <orca run id>]
B lane add --id B9 --title "B9 卡片" --role write --account claude:003 --pool claude:003 \
  --branch feat/b9 --worktree <worktree> --output <run dir>/B9.jsonl [--dispatch <orca dispatch id>] [--session <session id>] --state working
B lane add --id R-B9 --title "B9 审" --role review --reviews B9 --account codex:002 --pool codex:002 --output ...
B lane add --id S1 --kind subagent --parent coordinator --title "S1 查 catalog" --state working
B lane set --id B9 --state done --note "集成到 main：3 个文件" [--round 2]
B step add --id M1 --title "会话总表" --state working --note "正常流程已完成"
B step set --id M1 --state done
B lane set --id B9 --summary-file <B9-summary.md> --result-file <B9-report.md> --evidence "单元测试通过；页面已检查" --files src/a.ts,src/b.ts
B lane set --id B9 --result "完成会话总表" --commits "abc123 实现会话总表" --cost 1.25
B lane set --id B9 --round 2 --output <run dir>/B9-2.jsonl --note "修复复审发现的问题"   # before resuming; files round 1
B watch [--timeout 3600]          # run in the background: exits when a Lane ends, fails, needs the user or goes silent
B decision add --what "看板形式" --choice "静态汇报页" --why "实时状态由 sideby 面板负责" --options "本地服务实时刷新"
B artifact add --lane B9 --path <screenshot.png> --label "浅色预览"
B commit add --repo <repository> --hash <commit hash> --subject "feat: add session list"
B wait add --id deploy-test --title "部署 test" --log <log path> --stage "server 已好，web 构建中"
B wait set --id deploy-test --state done
B lane add --id J1 --title "联调" --role write --state queued --after deploy-test,R-B9   # a step and what it waits on
B ask add --id A1 --question "..." --recommend "..." --evidence "<file + diff, or quote>" --blocks "<what waits on it>"
B ask add --id A2 --outward --question "发群消息吗？" --recommend "发" --evidence "..." --blocks "..." \
  --recipient "<person or group>" --channel "飞书" --draft "<full text>"
B ask answer --id A1 --answer "<user's reply>"
B grant add --scope "部署到 test，同样流程" --words "以后都按照推荐的来" --outward
B open [--panel]                 # open the Board once (Orca reuses the tab showing it, else system browser); exit 3 = not opened, report in chat
B show --line                    # the Run state line for the top of a reply; never writes files
B show --all                     # every active Run on this machine
B close                          # archive; leaves the final report at the Board path
```

Roles: `write`, `review`, `research`, `draft`. Lane states: `queued`, `working`, `needs-you`, `done`, `failed`, `stopped`. Wait states: `running`, `done`, `failed`, `stopped`. Relative `--output` / `--log` paths, given on the command line or in a hand-made ledger, resolve against the Run directory, not the shell's current directory. `show --line` names the page once it exists.

`init` and `lane add` publish the static Board before the session index. Milestone commands also refresh it: `step add/set`, `lane set` with `--state`, `--round`, `--result(-file)` or `--summary(-file)`, `wait set --state`, `decision add`, `artifact add`, `commit add`, `ask add/answer`, and `close`. Explicit `open` refreshes before opening. `show` never writes, including the deprecated compatibility flag `--html`. Other ledger commands save the ledger and rebuild the index; they recreate a missing Board before publishing. Nothing writes on a timer. Unchanged content leaves the file untouched, using its fingerprint. `--after` lists Lane or Wait ids; the Board shows the ones not yet `done` as "等：…".

When the user says "停", the Coordinator runs `touch <run dir>/STOP`: `lane add` then refuses new Lanes and the next Board write shows "已叫停" with everything still running. The file does not stop running work by itself, so the Coordinator then stops each running Lane and Wait it can (`orca orchestration worker-stop`, or the processes it started), sets them `stopped`, and reports in the chat which ones could not be stopped. To resume, delete the file.

## What the Coordinator reads

Read state with `show --line` and `show`; read each Worker's summary (at most 10 lines, see `task-spec.md` Return). Never Read the Board HTML, `run.json`, `.jsonl` streams, `session-index.json` or full reports into the conversation: Claude Code re-injects a changed file's diff after every change, and the page inlines a Markdown library. Send a report path or screenshot to a subagent and take back text. The rules and the measurements behind them are in SKILL.md "Keep the Coordinator's context small".

## Rules the Board enforces or exposes

| Rule                                                                                                                                                            | Why (observed problem)                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Register every background shell, deploy, CI run or build as a Wait, with a log path                                                                             | `2 shells still running` with no names; deploy progress lived only in chat                                                                    |
| An Ask needs question, recommendation, evidence and what it blocks; an outward Ask adds recipient, channel and full draft. The script refuses an incomplete Ask | "可以直接部署吗？" without a recommendation; "群里打招呼的消息由你来发" with no recipient or text; "AGENTS.md 那 3 行" the user could not see |
| Number Asks `A1`, `A2`; the user answers in the Coordinator's chat                                                                                              | Orca shows a Worker waiting on a question as still working                                                                                    |
| A Standing Grant records scope and the user's words; an outward grant (deploy, send, publish) lasts this Run only; ask once when the scope is unclear           | "以后都按照推荐的来改吧" became a rule nobody wrote down                                                                                      |
| A finished Lane wakes the Coordinator through `watch`, not the user's next reply                                                                                  | Four Lanes ended and sat for about an hour while the Coordinator waited on an unrelated Ask                                                   |
| A new round needs a new stream; the old round's result is filed into history                                                                                  | Resumed Lanes kept reading their ended round-1 stream: the card said both 进行中 and 做完了, and results listed rework as done                   |
| A Lane silent for 5 minutes while `working` is flagged by `show`; read its log before waiting longer                                                                     | The Coordinator sat in `Bash: sleep` for 59 minutes                                                                                           |
| A stream that ended while the Lane is still `working` is flagged "待主控 AI 汇总"                                                                               | Finished Workers were indistinguishable from busy ones                                                                                        |
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
   orca terminal create --worktree path:<worktree> --title "B9 卡片 · 写" --command "<probe command, e.g. sideby run claude:003 -->" --json
   orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
   orca orchestration worker-start --run <orca run> --worktree path:<worktree> --terminal <handle> --task-title "<title>" --spec "<task-spec text>" --json
   ```
   Then `B lane set --id <lane> --state working --dispatch <dispatchId from worker-list>`. Interactive Workers write no event file, so `show` prints Orca's activity and observation time for them. Always use a titled terminal: `worker-start --agent <id>` Workers show as `worker-task_<id>` in the sidebar because `--task-title` is not displayed. If `worker-start` fails, set the Lane `failed` with the receipt's `failedStage` as `--note`.
3. Wait with `orca orchestration check --run <orca run> --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json`. Process every message, then pass `--ack <result.deliveryId>` on the next `check`; an unacknowledged batch is replayed.
4. Relay a Worker `question` to the user as an Ask (`B ask add`), answer with `orca orchestration reply --id <message id> --body "<answer>"`.
5. After an accepted `worker_done`: integrate, `B lane set --state done`, then `orca orchestration worker-release --dispatch <id>`. Before ending, `worker-list --run <orca run> --terminal-state reclaimable` must return none.

Notes from the pilot:

- `orca status --json` showed `caller: null` inside an Orca terminal; detect Orca by `result.runtime.reachable`, not `caller`.
- `gate-create` refuses a task whose Dispatch is active. Use a gate only to hold a Lane that must not start until the user decides (for example a deploy Lane); in-flight questions are Asks.
- Grok is not an Orca agent id, and handing a Grok TUI to `worker-start --terminal` is untested. Run Grok Lanes headless with `streaming-json`; they appear in `show` and on the Board only.

## Without Orca, or without background waits

- Headless Workers run in the background with their `.jsonl` output, as in `launch.md`.
- Wait with `B watch` in the host's background mechanism (Claude Code `run_in_background`, or Monitor). It wakes only on a change, so a Lane that was already waiting on you when it started does not make it spin. Never a foreground `sleep`.
- A host with no background wait (some Codex or Grok sessions) ends its turn instead, with the Run state line, and resumes when the user returns.

## Handoff

A sideby handoff brief includes the Coordinator Session Reference from `sideby sessions copy <coordinator-session-id> --as reference --json` when available. Append `Run directory: <run dir>` to that reference so the receiving Coordinator can find the ledger. If unavailable, name the Coordinator account and session id explicitly. The brief names the Run directory and, in Orca mode, the Orca run id. The next Coordinator sets `AGENT_DISPATCH_RUN` (and `orca orchestration run-use <id>`) and continues the same Run; it does not start a new one.


## sideby sessions, messages and the session index

`sideby sessions --json` must exit 0 with `schemaVersion: 1`, a valid `sessions` array and `problems` array; each command looks it up at most once, with a 10-second timeout. Missing commands, timeouts and malformed responses fall back to stream/Orca behavior. A matched session supplies its Label and status for `show`; `needs-you` means "等你回答". `idle` plus a successful ended stream reads "待主控 AI 汇总"; it does not mark integration done or unblock dependencies. `busy` overrides an old ended stream. Silence warnings (`STALE_SECONDS`) apply only without a usable session status.

Register `lane add/set --session <id>`; a Claude `result.session_id` is also persisted by `show`. Session ids are the join key; never match a Worker by account alone. Orca terminal titles are `<Lane> · <role>`; sideby's accountTitle adds the account and id. Do not repeatedly reset the resulting Session Label.

Messages to a running Worker go through sideby from the Coordinator (`sideby send <session> "<text>" --json` after `sideby send --help` succeeds) or Orca `orchestration reply`; the user sends their own from the Panel's 会话 page. The ledger records no delivery receipts.

Record your own session at `init --coordinator-session <id>` (or later `run set --coordinator-session <id>`); without one, `init` tries once to find a non-guessed Live Session whose pid is a process ancestor, never a guess by account.

Every ledger command learns stream session ids under the ledger lock, atomically saves `run.json`, and rebuilds `<state>/session-index.json` from all active ledgers, under `<state>/index.lock`, so sideby can show which Run and task a session belongs to:

```json
{"schemaVersion": 1, "revision": 7, "generatedAt": "2026-10-20T08:00:00Z",
 "sessions": {"<session id>": {"entries": [{"run": "<run id>", "runTitle": "<objective>", "lane": "B9", "laneTitle": "B9 卡片",
   "role": "coordinator|write|review|research|draft|worker|subagent", "board": "<board path>", "url": "file://<board path>#lane-B9"}]}}}
```

The portable contract fixture is `fixtures/session-index.json`; `<board>` and `<url>` are replaced by the consumer's state location. Both projects can use it without sharing a runtime library.

The Coordinator's own entry has `lane: null`. A session serving several Runs has several entries. `revision` rises only when the content changes; closed Runs drop out on the next rebuild. No token or server address is in it. Rebuilding removes the legacy `<state>/sessions.json` only after successful publication (or when the current index already matches). Ledger and index writes are individually atomic, not a cross-file transaction.

## Results and decisions

Record milestones before starting, then update them as they progress (`queued`, `working`, `done`, `blocked`). Record decisions, artifacts and actual commits when they happen, rather than reconstructing them at the end. These are optional additive ledger arrays (`steps`, `decisions`, `artifacts`, `commits`); old ledgers need no migration.

Each Lane card shows one plain sentence under “做出了什么” (the first sentence of the summary) and, when a full report exists, a visible 「查看完整报告」 link. `--summary` / `--summary-file` store the Worker's short summary; the card's 详情 shows at most 12 lines of it. `--result` / `--result-file` store the full report; files are read at once and stored, so they survive cleanup. Each pair is mutually exclusive. Without a summary, the opening of the report up to its first heading or table stands in (old ledgers need no migration). Without an explicit result, a Claude stream-json final `result` string or a plain-text Codex `-o` file registered as `--output` supplies the report (plain-file reads capped at 64 KiB). If `--output` is a Codex event stream, register its separate `-o` file with `--result-file`; the Board does not guess filenames.

The full report opens as its own page, `<run-id>.<lane>.report.html` beside the Board, rewritten only when the report changes. Summaries and reports render as Markdown (tables, headings, lists, code, links) with markdown-it 15.0.3, vendored in `scripts/vendor/` and inlined, so no network is used. Raw HTML is never rendered (`html: false`), links and images allow only `http`, `https`, `mailto` and relative URLs, and the output passes a tag and attribute allow-list; anything rejected is shown as escaped plain text, which is also what a page without JavaScript shows. All other ledger text is escaped plain text.

`--evidence` and `--commits` accept multiline text; `--files` accepts comma-separated paths; `--cost` records dollars, otherwise the stream cost is shown. When files are omitted and the worktree exists, `git status --short` supplies current staged, unstaged and untracked paths; it cannot reconstruct files from already committed rounds, so record those with `--files`. Each `lane set --round N --note ...` appends a timestamped history entry and also updates the current note. Raising `--round` files the previous round (its summary, result, stream, session, cost and tokens) into history as "第 N 轮结果" and resets the Lane to `working`; a Lane with an event stream must name a new `--output` for the new round. Costs add up across rounds on different sessions; a Claude resume on the same session reports a cumulative cost, so it is not added twice. Codex streams carry tokens, not dollars: the card's technical details show them, and the session id comes from `thread.started`. `show` names any `*.jsonl` in the Run directory that no Lane registered, and warns when the Run has Lanes but no milestones. Finished Lanes start collapsed with their first result line visible.

Artifacts belong to a registered Lane. Raster images appear as thumbnails linking to their full size; other files are links. URLs are encoded relative to the actual Board file, and missing files are marked "（文件已被移走或删除）". `commit add` records an existing commit; it does not run Git commit.

## The report page

The Board uses the 880 px single-column layout: three summary tiles (需要你吗 / 在做 / 时间 · 花费, each with a short value and one clamped secondary line whose full text is in its title), milestones, active work, produced results, decisions and collapsed ended work. No task-count percentage is shown; empty technical and result fields are omitted. Each Lane has one full-width 详情 row control (chevron, label, 44 px target, hover and focus states) containing the summary, facts and technical fields. Ask evidence starts at two lines and expands through a native disclosure. Costs include only reported values and state coverage; unknown costs are never zero.

Times are shown, never counted: the header says "MM-DD HH:MM 更新", the time its content last changed; running Lanes say "开始于 MM-DD HH:MM", ended ones "用时 N 分钟" (from `ended_at`; old records use `updated_at`). Silence flags are live state, so they appear in `show` and the Panel, not on the report. When `sideby` is on PATH, one line under the title says "看谁在做什么、给某个 AI 发消息：打开 sideby 面板的「会话」页"; the page carries no Panel URL or token.

The page has two copy buttons at most: 复制推荐答复 on each open Ask (copies "A1：按推荐办") and 复制本次进度给 AI in the footer (objective, milestones, Lane result summaries, open Asks, decisions and the ledger's data time; no credentials, URLs or raw commands). Clipboard failure reveals selectable text. Its scripts are the inlined Markdown renderer, the copy handler, and one browser reload of this same file every 5 s. That reload does not fetch, open a socket, or send the page into the coordinator's conversation. There is no meta refresh. Before each reload, and when the viewer leaves for a report, the page saves which disclosures are open, edited form values, focus and scroll in `sessionStorage` per Board file, and restores them after loading; it skips a reload while a field has focus or text is selected. Only elements with an `id` are kept, so every `<details>` or input added to the page needs a stable `id`. Links, including report links, artifacts and Markdown links, open in the same tab: Orca's browser refuses popups, and each report page links back to the Board.

A card's one sentence skips the report's `OUTCOME:` line; when that line is all there is, it reads 已完成 or 没做完. Commits show the repository's folder name and hash; the full path is the tooltip.

## Verification

With `S=<this skill>/scripts`, run `python3 -m unittest discover -s $S -p 'test_*.py'` and `for t in $S/test_*.js; do node $t; done`. All subprocess runners are fake, and every test class extends `scripts/isolated_case.py`, which points `AGENT_DISPATCH_STATE_DIR`, `HOME` and `XDG_STATE_HOME` at a temp dir and fails a test that resolves the state dir inside the real home. They cover initial publication and milestone updates, that unchanged content writes nothing, that no server or socket code is left, that the page never fetches and opens no popup, that open sections, typed text and scroll survive the reload, the session index rebuild, copies, timing and escaped old ledgers. These checks do not replace a browser look at the page. UNVERIFIED by them: real sideby discovery and send, and model behavior on the eval cases.
