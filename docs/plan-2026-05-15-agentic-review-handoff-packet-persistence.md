# Plan: agentic-review-handoff Packet Persistence

> 本轮迭代将 `agentic-review-handoff` skill 的 packet 从「纯文本输出模板」升级为「仓库内持久化 artifact 文件 + 跨 agent 自动接力」，消除 CC ↔ Codex 之间手动复制粘贴 packet 的痛点。

## 背景

### 当前 skill 的设计与痛点

当前 skill (`skills/agentic-review-handoff/`) 通过三份 reference 模板（`handoff-packet.md`、`review-loop-packets.md`、`review-contract.md`）规定 review→fix→re-review 各阶段的 markdown 输出契约。两个 agent（Claude Code 当 reviewer、Codex 当 implementer/fixer）都遵守同一份 SKILL.md。

实际工作流（飞书文档 `https://bcn0tgplxp2e.feishu.cn/docx/NF4edoQGXoaahVxhQhzcS6Srnvb` 描述的"双 AI 一写一审"）：
1. Codex 写完代码 → 用户切到 CC 终端粘贴 review 指令
2. CC review → 输出 Findings + Fix Handoff Packet → **用户手动 copy** → 切到 Codex 终端 **paste**
3. Codex 修完 → 输出 Fix Completion Packet → **用户手动 copy** → 切回 CC 终端 **paste**
4. CC re-review → 又一轮 packet → 又一轮 copy/paste
5. 循环到 0 issue

**核心痛点**：用户大脑变成跨 agent 的 message broker，每轮闭环 4-6 次手动复制粘贴。

### 已被否决的方案

| 方案 | 否决原因 |
|---|---|
| AI 输出时自动写剪切板 | 只省 ⌘C，没省 ⌘V；剪切板单槽，并行 review 互相覆盖；零审计 |
| AI 自动读对方 session 历史 (`.claude` / `.codex`) | 强耦合两个 CLI 的私有存储格式（升级一次就崩）；session 历史是全量上下文，吞进来 token 翻倍；session id 本身又要复制粘贴 |

### 第一性原理诊断

Packet 本质是一个 **Review Aggregate（DDD 聚合根）**：有身份（packet id）、有生命周期（created → handed_off → fixed → re-reviewed）、要在多个 agent 之间接力。当前 skill 把它当"文本格式"管，没给它**显式的、可寻址的、持久化的承载体**——所以才需要人脑搬运。

正解是经工业验证的成熟模式：**用文件系统当 message bus**（git index、unix Maildir、postfix queue dir、CI artifact、Anthropic superpowers 的 `docs/superpowers/specs/` 都是同一套思路）。两个 agent 不需要互相通信，只需要**读写同一个公共契约位置**。

## 目标

1. **消除手动 packet 搬运**：CC 进入 review 阶段时，自动从约定路径加载 Codex 留下的 Review Handoff；Codex 进入 fix 阶段时，自动加载 CC 留下的 Fix Handoff；以此类推。
2. **保留 packet 现有的协议价值**：所有现有契约（severity ladder、Source tag、Verdict 词表、Original Findings Snapshot 不可改写、severity/source 一致性规则等）原样保留——这些是 skill 真正的 IP，本轮只动「承载与寻址」一层。
3. **本地、轻量、可回放**：packet 文件在仓库本地（`.gitignore`），完成的闭环可归档；用户能 `cat` 看、能手编、能删除。
4. **跨 agent 对齐由"共享契约"保证**：CC 的 `.claude/skills/agentic-review-handoff/` 和 Codex 的 `agents/openai.yaml` 引用同一份 `SKILL.md`，所以"路径 + 命名 + 段落 anchor"三条规则同时约束两边。

## 范围

### In-scope

- 重写 `skills/agentic-review-handoff/SKILL.md`：增加"持久化 packet"工作流、寻址规则、anchor 契约、清理流程
- 重组 references：把现有 3 份 packet 模板线性串成一份 `references/packet-anatomy.md`（一个文件一条闭环）；保留 `review-contract.md`（severity / Source / Verdict 这些"协议"型规则没变）；按需保留旧 `review-loop-packets.md` 作为分模板的 fallback
- 新增 `references/packet-addressing.md`：寻址、命名、生命周期细节
- （可选）新增 `scripts/validate-packet.mjs`：检查 packet 文件 anchor 完整性、frontmatter 字段、是否符合规范——用户和 AI 都能调
- 项目 `.gitignore` 加 `.review-handoff/`（在落地实施时做，不在本 spec）
- 按 skill-creator 流程跑 evals 验证新 skill 至少不劣于旧 skill

### Out-of-scope（明确不做）

- 跨机器 / 多人协作能力（packet 文件出仓库就丢；未来若需要，把目录改到 `docs/reviews/` 取消 .gitignore 即可，不是本轮要做）
- MCP server 实现（用户场景没到这个量级）
- 自动剪切板写入（已否决）
- 自动读 .claude / .codex session 历史（已否决）
- 修改 review-contract.md 里的 severity ladder 或 Source tag（这是 skill 的 IP，不动）
- 接入 GitHub PR / Linear / TAPD 等外部系统作为 packet 载体

## 方案

### 收件箱目录结构

```
<repo-root>/
├── .gitignore           ← 加 ".review-handoff/" 一行
└── .review-handoff/
    ├── active/          ← 进行中的 packet。AI 默认在这里寻址
    │   └── <branch-slug>__<utc-stamp>__<scope-slug>.md
    └── archive/         ← Final Verdict = PASS 后 AI 自动 mv 过来。用户定期手动清
        └── <branch-slug>__<utc-stamp>__<scope-slug>.md
```

**为什么是这样**：

- **本地、不进 git**：用户场景就是同机器同仓库 CC + Codex 串行，不需要跨机器；不污染仓库 history
- **`active/` + `archive/` 两段**：日常视野里只看到进行中的，PASS 的自动归档；清理责任明确（archive 是用户的，active 是 AI 的）
- **不引入 `_index.json`**：状态全在文件里，AI 读最末 H1 + frontmatter `current_stage` 即可；不维护并行索引避免脱节

### 命名规则

格式：`<branch-slug>__<utc-stamp>__<scope-slug>.md`

- `branch-slug`：当前 git branch（`git rev-parse --abbrev-ref HEAD`），把 `/` `\\` 替换为 `-`，全小写
- `utc-stamp`：UTC ISO 紧凑形式 `20260515T143012Z`（按文件名字符串排序就是按时间排序）
- `scope-slug`：用户给的 scope 一两个词，kebab-case；不给则用首个 finding/feature 关键词；最多 24 字符

例：`feat-payment__20260515T143012Z__refactor-checkout.md`

**双下划线 `__` 是分隔符**：scope-slug 内部禁止 `__`，方便程序拆解。

### AI 寻址逻辑（CC 与 Codex 共用）

进入 review / feedback validation / fix / re-review 阶段时，AI 必须：

```
1. 取当前 git branch：git rev-parse --abbrev-ref HEAD
2. 列 .review-handoff/active/<branch-slug>__*.md，按文件名升序排序
3. 取最新一个（tail -1）：
   - 不存在 → 进入"创建新 packet"路径，从 # Review Handoff 段开始写
   - 存在 → 读完整文件，找最后一个 H1 anchor 判断当前阶段，决定输出哪个新段
4. 用户显式指定 packet 文件路径（如 `--packet=...`）时，优先用用户指定的
```

**只用当前 branch 寻址**，不跨 branch 接错。同 branch 同时多条闭环（少见）按 utc-stamp 取最新。

### 单文件追加：packet anatomy

一条闭环始终对应一个文件，所有阶段往同一文件追加新段（用 markdown H1 锚点分段），AI 永不 overwrite 已有段落。

**文件骨架**：

```md
---
packet_id: feat-payment__20260515T143012Z__refactor-checkout
branch: feat/payment
scope: refactor-checkout
created: 2026-05-15T14:30:12Z
updated: 2026-05-15T14:30:12Z
current_stage: review_handoff
round: 1
---

# Review Handoff
（implementer 写：Goal / Scope / Implementation Summary / Verification / Reviewer Focus / Open Questions）

# Review Findings
（reviewer 写：Scope reviewed / Verification / Findings P0/P1/P2 + Source tag / Verdict）

# Fix Handoff
（reviewer 紧接着写：Validated Findings To Fix 表格 / Feedback Not To Fix / Constraints / Verification Required）

# Fix Completion
（fixer 写：Fix Conclusion / Original Findings Snapshot 必须 verbatim / Finding Status / Changes Made / Verification / Deferred Out-of-Scope / Re-review Instructions）

# Re-review
（reviewer 复审写：Prior Findings Reassessment / New Findings / Regression Surface / Verdict）
```

**Verdict 在 Re-review 段内**，不再额外开 `# Final Verdict` 段——避免冗余和"什么时候写哪个"的歧义。归档由 Re-review 段最末的 Verdict 决定（见下文「生命周期」）。

**多轮迭代的 anchor 命名**：每多一轮 fix→re-review，新增段使用 `(round N)` 后缀，例如 `# Fix Completion (round 2)` / `# Re-review (round 2)`。frontmatter 的 `round` 字段同步递增。

**frontmatter 字段表**：

| 字段 | 类型 | 谁维护 | 说明 |
|---|---|---|---|
| `packet_id` | string | 创建者 | = 文件名（不含 `.md`） |
| `branch` | string | 创建者 | git branch 原值（含 `/`），用于追溯 |
| `scope` | string | 创建者 | 用户给的 scope 描述 |
| `created` | ISO datetime | 创建者 | 创建时间 |
| `updated` | ISO datetime | 任何写入者 | 每次追加段后更新 |
| `current_stage` | enum | 任何写入者 | `review_handoff` / `review_findings` / `fix_handoff` / `fix_completion` / `re_review` / `archived` |
| `round` | int | 写入 fix_completion / re_review 时 | 默认 1，每开新轮 +1 |

### 段落语义契约（每段 self-contained）

每个 H1 段必须在自己内部完整说清楚证据，不假设读者会回头读上面的段。

| Anchor | 谁写 | 何时写 | 必含子节 |
|---|---|---|---|
| `# Review Handoff` | implementer (通常 Codex) | 写完代码请求 review 时 | Goal / Scope / Implementation Summary / Verification / Reviewer Focus / Open Questions |
| `# Review Findings` | reviewer (通常 CC) | review 完成时 | Scope reviewed / Verification / Findings (P0/P1/P2 + Source) / Verdict |
| `# Fix Handoff` | reviewer | review 完成时紧贴 Findings | Validated Findings To Fix 表格 / Feedback Not To Fix / Constraints / Verification Required |
| `# Fix Completion` | fixer (通常 Codex) | 改完时 | Fix Conclusion / Original Findings Snapshot (verbatim) / Finding Status / Changes Made / Verification / Deferred / Re-review Instructions |
| `# Re-review` | reviewer | 复审完成时 | Prior Findings Reassessment / New Findings / Regression Surface / Verdict（PASS / PASS_WITH_CONCERNS / NO_FINDINGS / BLOCKED） |

子节的具体字段沿用现有 `references/handoff-packet.md`、`references/review-loop-packets.md` 的内容——本轮不动这些"协议"细节，只把它们串到一个文件里。

### 生命周期：active → archive

归档触发：reviewer 写完 `# Re-review`（或 `# Re-review (round N)`）后，看其 Verdict：

| Verdict | 行为 |
|---|---|
| `PASS` / `NO_FINDINGS` | AI 立刻 `mv` 到 archive/，frontmatter `current_stage` 置为 `archived` |
| `PASS_WITH_CONCERNS` | 默认归档（与 PASS 同处理），同时在终端提示用户"含 P2/P3 issues 未处理，文件已归档为 `<archive-path>`，如需继续修请把它 mv 回 active/" |
| `BLOCKED` | 不归档，等待 fixer 启动下一轮 fix → re-review |

**单点归档原则**：只有 reviewer 在 Re-review 之后才能归档；fixer 不归档；用户可以手动归档/反归档（mv 即可，AI 应尊重）。

清理策略：
- AI 责任：只管 PASS 自动归档
- 用户责任：定期 `rm -rf .review-handoff/archive/`（不需要专门脚本，简单到 unix 一行命令）
- 系统责任：`.gitignore` 隔离整个 `.review-handoff/`

### 共享契约的传播

CC 端：从 `skills/agentic-review-handoff/` 经 `pnpm skills:install:local` + `pnpm skills:sync:llm` 链路 → `.agents/skills/` → `.claude/skills/`。

Codex 端：通过 `skills/agentic-review-handoff/agents/openai.yaml` 的 `default_prompt: "Use $agentic-review-handoff for the current stage..."` 指向同一个 SKILL.md。

**同一份 SKILL.md 是单一真相**——两边读的都是它。本轮迭代只改这份 SKILL.md + references，传播链路不动。

### （可选）validate-packet 脚本

`scripts/validate-packet.mjs` 用法：`node scripts/validate-packet.mjs <packet-file>`

校验：
- frontmatter 必填字段齐全且 enum 合法
- H1 anchor 在白名单内、按预期顺序出现
- 同一段没被重复追加（防止 AI 漏读最末段就 append 新的 review 段）
- `current_stage` 与最末 H1 段一致

退出码非 0 时打印问题。AI 在写完 packet 后**可选**调用一次自校验；用户也能手动跑。

不强制 AI 跑（增加摩擦），但 SKILL.md 提示"如果你不确定 packet 是否合规，可以 `node scripts/validate-packet.mjs <file>` 自检"。

## 风险

| 风险 | 严重度 | 缓解 |
|---|---|---|
| AI 不严格遵守 anchor 命名约定，packet 错乱 | 中 | (1) SKILL.md 用 anchor 表 + 例子明确规定；(2) 提供可选 validate-packet 脚本；(3) 用户 markdown 可读，肉眼能 spot；(4) evals 加 anchor 一致性断言 |
| 多轮闭环文件膨胀（10-20KB），AI 每次 review 都全量读 | 低 | 比读 session 历史小 1-2 个数量级；极端情况可让 AI 只 sample 最末两个 H1 段（在 SKILL 提示里加） |
| 用户切了 branch 但忘了告诉 AI | 低 | 寻址用 `git rev-parse` 实时拿当前 branch，不会跨 branch 接错；如果当前 branch 没 packet AI 会显式说"当前 branch 没找到 active packet" |
| `.review-handoff/` 在 `.gitignore` 里，用户换机器/新克隆仓库时 packet 丢失 | 已知 trade-off | 出 spec 时已与用户确认（本地临时收件箱）；未来要跨机器只需取消 .gitignore + mv 到 docs/reviews/ |
| 旧 skill 的现存模板被用户/团队当文档引用，重组 references 路径会有 broken link | 低 | 保留旧文件名，用 stub 转向新文件；commit 信息标注 |
| skill-creator evals 写不出来（packet 文件型输出难自动断言） | 中 | (1) 写脚本检查 packet 文件存在性 + anchor 出现 + frontmatter 字段；(2) 主观部分（review 质量）走人工 review viewer |

## 验收标准

实施完成后必须同时满足：

1. **行为验收**（典型场景跑通）
   - **场景 A：从零起 packet**。在干净 repo 当前分支上，用户对 CC 说"review 当前 staged diff"——CC 创建 `.review-handoff/active/<branch>__<stamp>__<scope>.md`，写入 Review Handoff + Review Findings + Fix Handoff 三段；用户切到 Codex 终端说"按 review 修一下"——Codex **自动找到该文件**（无须用户提供路径或粘贴 packet），追加 Fix Completion 段；切回 CC 说"复审"——CC 自动找到该文件，追加 Re-review 段；verdict PASS 时 CC 自动 mv 到 archive/。
   - **场景 B：多轮迭代**。Re-review verdict 是 BLOCKED 时，Codex 再次"修一下"应追加 `# Fix Completion (round 2)`；CC 复审追加 `# Re-review (round 2)`；frontmatter `round` 同步递增；archive 仅在 PASS 后发生。
   - **场景 C：寻址鲁棒性**。同机器、同 branch 同时存在两个 active packet 时，AI 取 utc-stamp 最新的；切换 branch 后再寻址，原 branch packet 不被 active 列出。

2. **协议验收**
   - 现有 severity ladder（P0~P3 + Preference）、Source tag 词表、Verdict 词表（BLOCKED/PASS_WITH_CONCERNS/PASS/NO_FINDINGS）、Original Findings Snapshot 不可改写规则**全部保留且生效**——通过对比新旧 SKILL.md 的协议章节确认
   - Mixed-stage 顺序规则、out-of-scope safety-critical 例外规则保留

3. **skill-creator evals 验收**
   - 至少 3 条 eval 用例（覆盖：场景 A 全闭环、场景 B 多轮、场景 C 寻址）
   - 量化断言：每条 eval 在 `with-skill`（新版）至少不劣于 baseline（旧版）；目标项是"packet 文件被自动定位/创建"且"段落 anchor 完整"
   - 主观部分（review 质量、findings 准确度）走 eval viewer 人工 review

4. **文档与 ruler 同步**
   - 修改的 SKILL.md / references 通过 `pnpm skills:validate`
   - `pnpm skills:index` 重新生成
   - 不需要改 .ruler/*.md（本轮纯 skill 内容迭代，与仓库 AI 规则无关）

5. **可逆性**
   - 旧 reference 文件保留或留 stub，旧用户/项目引用不破
   - `.review-handoff/` 整个目录可以一句 `rm -rf` 全清，不影响仓库其他状态

## 不在本 spec 决策的事

下面这些到实施阶段（writing-plans 或直接执行）再定，不阻塞 spec：

- 是否真的实现 `scripts/validate-packet.mjs`，还是先省略只靠 SKILL.md 自约束（建议先省略，evals 反馈说有必要再加）
- evals 的具体 prompt 措辞和断言脚本细节
- 旧 reference 文件用 stub 方式保留还是直接重组路径
- 是否给 skill description 跑一轮 description optimization（按 skill-creator 流程，迭代稳定后再做）
