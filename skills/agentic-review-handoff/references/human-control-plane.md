> **LEGACY (deprecated).** Dual-window human control plane. Prefer auto loop in SKILL.md / auto-loop-contract.md.

# Human control plane（你只要看这里）

双 AI 聊天窗 **不是** 进度条。进度只认下面入口。

## 推荐启动（双窗可同时贴）

不要再「等 A bind 成功再贴 B」。人对齐一次 `open`：

```bash
RL="<skill>/scripts/review-loop.mjs"
REPO="$(git rev-parse --show-toplevel)"

node "$RL" open --repo "$REPO" --driver=fake \
  --product-reviewer=codex --product-fixer=codex
```

输出里的路径：

| 文件 | 用途 |
|---|---|
| `PROMPT_REVIEWER.txt` | 整段复制 → 窗 A（Reviewer） |
| `PROMPT_FIXER.txt` | 整段复制 → 窗 B（Fixer） |
| `PROMPTS.md` | 两段合订 + 人话步骤 |

两窗 **同时** 粘贴即可；prompt 里已写死同一 `--packet`，**没有先后依赖**。

若 board 显示 `wait_bind` / 缺某角色：不是故障——去贴/重贴缺的那一窗；或 `cat` 对应 PROMPT 文件。

## 日常命令

```bash
# 随时看进度（一行 + BOARD.txt）；wait_bind 时会写清「缺谁、贴哪份 prompt」
node "$RL" board --repo "$REPO"

# 可选：持续刷（Ctrl+C 停）
node "$RL" board --repo "$REPO" --watch --watch-ms=2000

# 全部完成后：在一个 agent 里展示终态总结
node "$RL" summary --repo "$REPO"
```

输出里最重要的字段：

| 字段 | 含义 |
|---|---|
| `line` | 一行摘要：`loop / stage / phase / claim / gate` |
| `human.action` | **你**现在要做什么（多数时候是「等」） |
| `human.resolveOnce` | 若为 true：**只 resolve 一次**，不要两边都问 |
| `allTasksComplete` | true 时循环已结束，应展示 `report.text` / `summary` |
| `boardFile` | 磁盘上的 `…/runtime/<packet_id>/BOARD.txt` |
| `SUMMARY.txt` | 终态简洁总结（与 `summary` 命令同文） |

## 终态（你要在一个 agent 里看到的）

循环结束（PASS 归档 / disarm stop）后，**任意一个**还活着的 agent 应执行：

```bash
node "$RL" summary --repo "$REPO"
```

并把返回的 `text` **原样贴进对用户可见的聊天**，例如：

```text
✅ 任务全部完成

packet_id: …
## 简洁总结
- 最终 Verdict: PASS
- Findings 记录: A1（共 1）
- Re-review 复评: 1/1 resolved
- 阶段链: review_findings → fix_handoff → fix_completion → re_review
- round=1 | last_anchor=re_review | lifecycle=archived
```

不要让用户在两个窗里翻历史找「到底结束没有」。

## Gate（人闸）

只会出现一次有效决策：

```bash
node "$RL" resolve --repo "$REPO" --decision continue   # 推荐：放行让 worker 修
# 或
node "$RL" resolve --repo "$REPO" --decision stop
```

- **任意一窗**执行成功即可；另一窗不要再点 continue。
- Worker 协议：撞到 gate 时 **停手、展示 board / human.action、禁止自行 resolve**（除非你明确让某一窗代点）。
- `complete` / `wait` 返回的 JSON 已带 `human.resolveOnce` 与 `recovery` —— 不要根据聊天历史再「两边都 continue」。

### Protocol Gate 常见原因（dogfood）

| 现象 | 原因 | 处理 |
|---|---|---|
| `last physical H1 … frontmatter last_anchor` | Worker 用编辑器在文件中间插入 H1 | 你 `resolve continue` 一次；worker 用 `append-eof` 重写阶段，禁止再 mid-file |
| 两边都问 continue | 把聊天窗当控制面 | 只看 `board`，只 resolve 一次 |

## Worker 写 packet

禁止用编辑器在历史 H1 中间插入章节。必须：

```bash
# 先 next/wait 拿到 claim
node "$RL" append-eof --role fixer --stage fix_completion --body-file /tmp/section.md --repo "$REPO"
node "$RL" complete --role fixer --repo "$REPO"
```

`append-eof` 保证 **只加在文件末尾**，并同步 frontmatter；这是 dogfood 里「Re-review 插到中间」的根治办法。

## 推荐日常节奏

```text
你：board
  → READY:fixer  → 等 Fixer 窗干活
  → WORKING:fixer → 等
  → GATE:protocol → 你 resolve continue（一次）
  → READY:reviewer → 等 Review 窗
  → DONE → 结束
```

聊天窗 = 日志；**board = 真相**。
