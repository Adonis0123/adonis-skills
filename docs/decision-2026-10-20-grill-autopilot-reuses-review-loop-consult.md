# grill-autopilot 复用 review-loop consult 决策记录

> 状态：accepted（2026-10-20，经 grill-with-docs 会话由用户确认）

## 背景

- `grill-autopilot` 需要让任意两个 AI（Claude Code、Codex、Grok、pi 的任意账号）一问一答，并且代答方在多轮之间保留上下文。
- `agentic-review-handoff` 的 `adapters.mjs` 已经实现了三种产品的 headless 只读调用：抓取 session id、resume、超时后切换到下一个产品、校验账号 launcher。`review-loop consult` 在它外面包了一层，但只能问一轮。
- GitHub 上已有同类项目，比如 `pengusto/let-him-grill`、`darshmahadevia/grill-yourself-skills`。它们主要面向 Codex，在 Claude Code 里能不能用没有验证；用户要求自己实现，复用本仓已有的能力。

## 决策

- 给 `review-loop consult` 加三个通用参数：
  - `--resume <consult record>`：同一个 peer session 续接多轮，每轮追加到同一份记录。
  - `--web`：只放开搜索和抓取工具，写入和 shell 仍硬性禁止。
  - `--raw`：提问文件原样发出，由调用方自带角色说明。
- adapter 新增 pi（`--session-id` 由调用方生成，`--tools read,grep,find,ls --no-mcp`）。
- `grill-autopilot` 运行时依赖 `agentic-review-handoff`，自己不带 adapter，只加一个确定性账本脚本 `grill-ledger.mjs`。

## 放弃的方案

- **复制一份 adapter 进新 skill**：两份只读控制会各自漂移，安全规则要改两处。
- **抽成独立 package**：本仓的 skill 按目录单独安装，没有共享包的安装路径，改动面最大。
- **用 `sideby send` 在两个会话间传话**：只有 Claude 能直接收到消息，Codex、Grok、pi 要靠剪贴板，在 headless 场景下不可用。

## 影响

- 安装 `grill-autopilot` 还需要安装 `agentic-review-handoff`；预检发现缺失时会给出安装命令。
- `consult` 不再只能问一轮。`--resume` 之后如果发生超时切换或降级成新 session，结果里返回 `contextLost: true`，由调用方补发上下文摘要。
- pi 没有联网工具，因此不能作为开启 `--web` 的 Proxy。
