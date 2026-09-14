---
name: task-completion-loop
description: "Finish an existing named plan/spec or clearly bounded unfinished non-trivial coding task through the explicit task-completion-loop: work ledger, Goal, implementation proof, agentic review, architecture hardening, and a fresh Claude audit. Use only for the whole requested pipeline, not ordinary implementation, planning, or review."
metadata:
  author: adonis
  version: "1.7.0"
---

# Task Completion Loop

把已有 plan / spec / 半成品收敛为**同一份最终代码快照上的可验证终态**。

本 Skill 是薄编排：依赖 skill 拥有内部协议；本 Skill 只管理任务账本、调用顺序、证据新鲜度、授权边界和停止条件。

## 入口与授权

同时具备才启动：

1. Git 仓库，以及命名 plan/spec 或可从当前代码确定的明确范围。
2. 明确的完整闭环实现请求。只要 Goal、只要 review-fix-re-review、只要架构加固、普通实现、纯讨论、纯 review 或只读诊断 → 不是本 Loop。

先从文档与代码解析范围。仍无法安全确定时，只问一个范围问题并停止。禁止默认全仓库。

实现请求授权修改冻结范围内的 working tree；除非用户明确要求只读或禁止编辑。它不授权：

- `git add`、commit、push、merge、rebase、branch/worktree 创建；
- PR、issue、评论、消息、任务、API 数据、部署、生产写；
- 排除路径或冻结范围外修改。

`agentic-review-handoff` 所需的 `.review-handoff/**` 与幂等 `$GIT_COMMON_DIR/info/exclude` 条目是本闭环的本地协议产物，不是交付动作；预检时披露，完成报告中记录。用户明确禁止 `.git/**` 写时，在源码修改前返回 `HUMAN_GATE`。

## 能力预检

始终要求：

| 能力                          | 用途                       |
| ----------------------------- | -------------------------- |
| `goal-gate`                   | Goal 决策与运行时激活      |
| `agentic-review-handoff`      | 独立 review-fix-re-review  |
| `architecture-hardening-loop` | 有界扫描、修复、复核、复扫 |
| 真实 Grok Build 会话          | 独立立场与交叉质疑         |
| 真实 Claude Code 会话         | 独立立场与盲审             |

仅在用户显式要求 `grill-with-docs`，或预检发现仍有用户拥有的产品/领域决策时，要求并调用 `grill-with-docs`（其 frontmatter 默认 `disable-model-invocation: true`；文件可读即按父会话路径加载）。

在讨论、Goal、源码修改前：

1. 解析每个 skill 及其传递硬依赖（特别是 `architecture-hardening-loop` 的 scanner、`codebase-design`、只读 delegation、真实 Grok adapter）。invocation policy 与父会话执行路径沿用 `architecture-hardening-loop`「硬依赖与 runtime 能力」的规则：用户点名本 Loop 即授权硬依赖按用途嵌套调用；文件可读即可由父会话执行；未安装/不可读、合同不兼容或 worker/工具无法执行才算缺失。细则见 [decision-and-terminal-gates.md](references/decision-and-terminal-gates.md) 的 Preflight policy。
2. 用 `agentic-review-handoff` 的 `review-loop consult --repo <root> --peer grok|claude --question-file <md>` 完成一次真实往返，并用 `review-loop sessions --repo <root> --product=grok|claude` 取回可恢复句柄；Phase 1 A 的首条成功往返即可充当此证据，不单独占一轮。Claude 还须能以 adapter 的只读控制启动。只有名字、catalog 条目或 CLI 文件存在不算可用。
3. 确认 review 协议产物可写，且不与用户的 `.git/**` 限制冲突。

缺少始终要求的能力，或缺少本轮实际需要的条件能力：

```text
Task Completion Result
- Result: MISSING_DEPENDENCIES
- Missing: <exact skill, dependency chain, or runtime capability>
- Stop point: before discussion, Goal activation, and source changes
- Substitution/install: none; no generic agent impersonation, copied skill logic, or automatic install
- Work started: no
```

禁止用通用 subagent 冒充 Grok/Claude、伪造会话或复制缺失 skill 逻辑：三方收敛的价值来自真正独立的模型立场，冒充会让交叉质疑退化为自我评论。代装依赖属于外部写，见「入口与授权」。

## 状态机

```text
预检与任务账本
  -> 三方交叉质疑
  -> 条件式 grill-with-docs（用户决策）
  -> Goal Gate
  -> 实现全部 PENDING + 验证
  -> agentic-review-handoff
  -> architecture-hardening-loop = NO_ACTIONABLE_FINDINGS
  -> 全新只读 Claude 盲审
       -> Fix：修、验、重跑下游门禁、再盲审
       -> 仅 Backlog / Reject：完成 Goal
  -> COMPLETED

任意阶段的出口：
  缺能力 -> MISSING_DEPENDENCIES
  用户决策 / 权限 / 范围扩张 -> HUMAN_GATE
  证据缺失、过期或外部会话超时 -> UNVERIFIED
```

## Phase 0：任务账本与证据

1. 读取仓库指令、plan/spec、直接关联决策、当前代码与测试。
2. 记录仓库根、分支、HEAD、working tree；保留既有改动，不 reset / clean 无关内容。
3. 给原始计划的每项工作标记：

| 状态             | 证据                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- |
| `VERIFIED_DONE`  | 当前代码与本轮可复现验证证明已交付                                                     |
| `PENDING`        | 本次仍须实现或修复                                                                     |
| `OBSOLETE`       | 被有效决策或新契约取代，并引用来源                                                     |
| `EXCLUDED`       | 用户或有效文档明确排除                                                                 |
| `HUMAN_DECISION` | 尚无权威答案，且选择会改变产品行为、公共契约、数据归属、安全、冻结范围或需新增外部授权 |

冻结范围包含本轮全部 `PENDING` 及必要测试/文档。可按依赖顺序拆成内聚批次，但不得只完成第一个容易批次就声称 plan 已完成。

原始 `PENDING` 不能被 reviewer 建议偷换成 `Backlog`：`Backlog` 是 reviewer 对新发现的分类，plan 承诺项的归属只属于用户或有效决策。它只能完成、被有效决策取代、明确排除或进入 `HUMAN_DECISION`。

可逆、范围内、不改变已决定行为的实现细节与测试选择仍属于对应 `PENDING`，不是 `HUMAN_DECISION`。按权威文档、当前代码、仓库惯例、最小改动和验证质量自行决定；agent 意见不一致本身不构成门禁。

正式 evidence id 采用 `agentic-review-handoff` 返回的 evidence 对象，相等性只比较 `baseSha + pathFilter + digest`。优先复用依赖 skill 的冻结证据，但每道门禁前后必须用同一 base/filter 执行 `review-loop evidence` 重算；相同 HEAD 或相同 `git status` 不等于相同快照。任何范围内代码或测试修改都会使旧快照的下游 test/review/audit 结论过期。

## Phase 1：三方收敛与用户决策

### A. 独立立场

宿主、真实 Grok Build、真实 Claude Code 分别读取同一组文档、代码和任务账本。每方写清范围、归属、假设、风险、排除项和可证伪验证。用 `review-loop sessions` 记录 Grok / Claude 可恢复句柄；本步首条成功往返同时完成预检第 2 项。

### 预算与并行

- A 的三方立场互不依赖：宿主写自己的立场时，并行发起 Grok 与 Claude。
- B 的两次交叉质疑互不依赖，并行发起。B 至多两轮；第二轮后仍存分歧，属技术默认值由宿主依证据裁定，属用户决策转入 C。
- 每次外部调用设 deadline（默认与 `agentic-review-handoff` 的 Reviewer timeout 一致，20 分钟；宿主可缩短并记录）。以后台进程 + 轮询方式发起，避免宿主前台工具超时截断真实会话。进程存活时不杀、不重发；超时按 `DELIVERY_UNKNOWN` 处理：仅当本地证据证明未提交才同参数重试一次，否则本阶段记 `UNVERIFIED`，保留句柄与已得立场，下一轮从缺失的一方继续。
- 快路径：账本无 `HUMAN_DECISION`、范围由 plan/代码唯一确定、A 三方在范围/归属/验证上无实质分歧时，B 只跑一轮，无新分歧即收敛。快路径不减少参与方，不省略 B。

### B. 交叉质疑

- 把宿主 + Claude 立场交给 Grok；把宿主 + Grok 立场交给 Claude。
- 双方攻击对方最强论点，并允许依据证据改口。
- 宿主独立打开引用路径、核对当前行为，再综合证据。

三份平行评论不算收敛：只有被对方攻击过仍成立的论点才是证据。

### C. 用户决策

- 权威文档和代码已经给出答案，或只剩普通技术默认值：自行收敛，不重新提问。
- 真正的 `HUMAN_DECISION`：用户说“不要问”也不扩大产品决策或外部写授权（见「入口与授权」）；Agent 一致不能代替用户。
- 出现真实用户决策或显式 `grill-with-docs` 时，先读 [decision-and-terminal-gates.md](references/decision-and-terminal-gates.md) 的 Human decision convergence，再决定是否返回 `HUMAN_GATE`。按 grilling 的 frontier round 提问：同轮可含全部互不依赖的问题，每个问题都附推荐答案，让用户只做取舍而不重新调研。

记录：

```text
Three-party Convergence
- Decision:
- Why:
- Work ledger:
- Frozen scope / exclusions:
- Ownership and dependency direction:
- Verification:
- Grok session:
- Claude session:
- Remaining decisions: none | <list>
```

## Phase 2：Goal Gate

收敛后调用 `goal-gate`，严格服从其 `Decision` / `Next`：

- `wait for user /goal`、`ask approval` 或 `defer`：返回 `HUMAN_GATE` 并停止。生成 prompt 不代表 Goal 已激活。
- `suggest` + `adopt goal and continue`：按 transcript contract 继续本 Loop，报告 `Goal: not-created`；`suggest` + `provide prompt` / `route elsewhere`：返回 `HUMAN_GATE`。
- 已有 Goal：从 native 工具、产品状态或调用方传入的可核对 parent contract 比较 objective、冻结范围、Done condition 与 completion owner；native getter 不是唯一证据源。ownership 关系与完成权见 [decision-and-terminal-gates.md](references/decision-and-terminal-gates.md) 的 Goal ownership；冲突或证据不足才 `defer`。
- 可激活或采用时，Goal 覆盖任务账本、冻结范围、验证、三道门禁、协议写和外部写边界。

Done condition 要求：账本无 `PENDING` / `HUMAN_DECISION`；验证和三道门禁覆盖同一最终 evidence id。只有 `created-by-loop` / `exact-same-goal` 由本 Skill 完成；`broader-compatible` 即使本 Loop 已完成，也保持父 Goal active，并报告 `Goal: active-checkpoint`。

## Phase 3：实现与验证

按依赖顺序处理全部 `PENDING`：

1. 转成可观察成功标准；行为变更可行时先展示失败复现。
2. 做最小内聚改动，不顺手做相邻 backlog 或投机抽象。
3. 先跑定向检查，再跑相关包/仓检查。
4. 对外可见行为使用浏览器、CLI、日志、渲染或请求/响应等真实 runtime 信号。
5. 证据通过后才标记 `VERIFIED_DONE`，并同步 plan / 现状文档。

未运行、失败或已过期的必需证据记 `UNVERIFIED`，不能算通过。

## Phase 4：三道门禁

开始或恢复本阶段前，读 [decision-and-terminal-gates.md](references/decision-and-terminal-gates.md) 的三份 terminal contract；依赖拥有内部状态机，本 Skill 只核对终态、evidence id 和父 Goal ownership。

1. `agentic-review-handoff`：默认 `completion=pass`；只在最终 `PASS` / `NO_FINDINGS` 覆盖当前 evidence id 时继续。`BLOCKED`、`concerns_require_fix`、review-only 与异常路径见 reference。
2. `architecture-hardening-loop`：同范围运行，只接受 `NO_ACTIONABLE_FINDINGS`；其 `HUMAN_GATE` / `MISSING_DEPENDENCIES` / `UNVERIFIED` 原样透传为本 Loop 的同名 Result。它修改文件会使旧 evidence id 失效；其内部 review 覆盖最终 evidence id 时可复用，不必重跑直接 review。Fix 与 ownership 路径见 reference。
3. 全新 Claude 盲审：使用新的可验证只读会话审最终 evidence id。范围内 `Fix` 触发最小修复和全部下游门禁重跑；最多 2 轮。

## 终态与报告

| Result                 | 使用条件                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPLETED`            | 账本无未决项；必需验证通过；三道门禁覆盖同一最终 evidence id；最终盲审无范围内 `Fix`；owned Goal 已完成，或 parent Goal 保持 active-checkpoint                    |
| `HUMAN_GATE`           | 等待用户拥有的产品/领域决策、Goal 激活/冲突、权限、凭证、外部状态、范围扩张，或显式 review-only 决策                                                              |
| `MISSING_DEPENDENCIES` | 预检缺少始终要求或本轮实际需要的能力；源码尚未修改                                                                                                                |
| `UNVERIFIED`           | 实现可能存在，但必需证据未运行、失败或已过期；或外部会话 `DELIVERY_UNKNOWN` / 超时导致本轮立场、复审或审计证据缺失（保留句柄，下一轮从缺失方继续）；Goal 不得完成 |

Phase 1 的 deadline、B 轮数与 Phase 4 的 2 轮盲审是本 Skill 的全部预算。预算见底既不是完成理由，也不是用户决策：它不改变代码是否正确，用户也无实质取舍可做。宿主可续跑时继续；必须交还控制时返回 `UNVERIFIED`、保持 Goal active，并从未完成证据继续，不要求用户重复授权。

```text
Task Completion Result
- Scope / exclusions:
- Work ledger:
- Three-party decision:
- Goal: <completed | active-checkpoint | not-created | deferred-conflict>
- Final evidence id:
- Implemented:
- Verification:
- Agentic review: <packet/session + evidence id>
- Architecture hardening: <result + evidence id>
- Final Claude audit: <fresh session + evidence id>
- Fixed / Backlog / Rejected:
- Protocol, Git, and external actions:
- Result: COMPLETED | HUMAN_GATE | MISSING_DEPENDENCIES | UNVERIFIED
```
