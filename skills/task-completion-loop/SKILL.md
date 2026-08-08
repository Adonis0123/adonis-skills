---
name: task-completion-loop
description: "Orchestrate explicit full completion of an existing named plan/spec or clearly bounded unfinished non-trivial coding task through one work ledger, real host + Grok Build + Claude Code convergence, Goal Gate, implementation/runtime verification, agentic review, scoped architecture hardening, and a fresh read-only Claude audit on the final evidence. Use when the user explicitly requests task-completion-loop or that whole multi-agent finish pipeline. Do not use for ordinary implement-and-test, Goal-only execution, review-fix-re-review alone, architecture hardening alone, quick edits, one-shot tests, read-only review, open-ended design, or destructive work without approved scope."
metadata:
  author: adonis
  version: "1.4.0"
---

# Task Completion Loop

把已有 plan / spec / 半成品收敛为**同一份最终代码快照上的可验证终态**。

本 Skill 是薄编排：依赖 skill 拥有内部协议；本 Skill 只管理任务账本、调用顺序、证据新鲜度、授权边界和停止条件。

## 入口与授权

同时具备才启动：

1. Git 仓库，以及命名 plan/spec 或可从当前代码确定的明确范围。
2. 明确的完整闭环实现请求；不是普通实现、纯讨论、纯 review 或只读诊断。

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
| 真实 Claude Code 会话         | 独立立场与终局盲审         |

仅在用户显式要求 `grill-with-docs`，或预检发现仍有用户拥有的产品/领域决策时，要求并调用 `grill-with-docs`。

在讨论、Goal、源码修改前：

1. 解析每个 skill、传递硬依赖和 invocation policy。特别检查 `architecture-hardening-loop` 的 scanner、`codebase-design`、只读 delegation、真实 Grok adapter 等嵌套能力，以及其嵌套 review 是否把 `PASS_WITH_CONCERNS` 映射为 `HUMAN_GATE`；`disable-model-invocation` / `allow_implicit_invocation: false` 且用户未显式点名、合同不兼容或只能找到文件但无法加载，都视为缺少本轮可用能力。不要等实现后才发现缺失。
2. 为 Grok / Claude 解析真实产品身份、创建方式、可恢复句柄和消息交换能力；Claude 还要有可验证的只读审查方式。只有名字、catalog 条目或 CLI 文件存在不算可用。
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

禁止用通用 subagent 冒充 Grok/Claude、伪造会话、复制缺失 skill 逻辑或未经授权代装依赖。

## 状态机

```text
预检与任务账本
  -> 三方交叉质疑
  -> 条件式 grill-with-docs 用户决策门
  -> Goal Gate
  -> 实现全部 PENDING + 验证
  -> agentic-review-handoff
  -> architecture-hardening-loop = NO_ACTIONABLE_FINDINGS
  -> 全新只读 Claude 盲审
       -> Fix：修、验、重跑下游门禁、再盲审
       -> 仅 Backlog / Reject：完成 Goal
  -> COMPLETED
```

## Phase 0：任务账本与证据

1. 读取仓库指令、plan/spec、直接关联决策、当前代码与测试。
2. 记录仓库根、分支、HEAD、working tree；保留既有改动，不 reset / clean 无关内容。
3. 给原始计划的每项工作标记：

| 状态             | 证据                                           |
| ---------------- | ---------------------------------------------- |
| `VERIFIED_DONE`  | 当前代码与本轮可复现验证证明已交付             |
| `PENDING`        | 本次仍须实现或修复                             |
| `OBSOLETE`       | 被有效决策或新契约取代，并引用来源             |
| `EXCLUDED`       | 用户或有效文档明确排除                         |
| `HUMAN_DECISION` | 选择会改变产品行为、契约、数据归属、安全或范围 |

冻结范围包含本轮全部 `PENDING` 及必要测试/文档。可按依赖顺序拆成内聚批次，但不得只完成第一个容易批次就声称 plan 已完成。

原始 `PENDING` 不能被 reviewer 建议偷换成 `Backlog`；它只能完成、被有效决策取代、明确排除或进入 `HUMAN_DECISION`。

正式 evidence id 采用 `agentic-review-handoff` 的 `{ baseSha, pathFilter, digest, coveredPaths, sourceRound }`。相等性只比较 `baseSha + pathFilter + digest`；`coveredPaths` 仅供审计。优先复用依赖 skill 的冻结证据，但每道门禁前后必须用同一 base/filter 执行 `review-loop evidence` 重算；只拿到 verdict、packet path、相同 HEAD 或相同 `git status` 不足以证明快照相同。任何范围内代码或测试修改都会使旧快照的下游 test/review/audit 结论过期。

## Phase 1：三方收敛与决策门

### A. 独立立场

宿主、真实 Grok Build、真实 Claude Code 分别读取同一组文档、代码和任务账本。每方写清范围、归属、假设、风险、排除项和可证伪验证。保留 Grok / Claude 可恢复句柄。

### B. 交叉质疑

- 把宿主 + Claude 立场交给 Grok；把宿主 + Grok 立场交给 Claude。
- 双方攻击对方最强论点，并允许依据证据改口。
- 宿主独立打开引用路径、核对当前行为，再综合证据。

三份平行评论不算收敛。

### C. 用户拥有的决策

- 权威文档已决定且代码证据一致：不要重新提问。
- 仍有 `HUMAN_DECISION`，或用户显式要求 `grill-with-docs`：加载它及委托的 skill；事实先查环境，遵循 `grilling` 的 design-tree frontier rounds——同一轮可询问所有前置条件已满足且彼此不依赖的问题，每题给推荐答案；不要用本 Skill 的偏好覆盖依赖协议。
- 调用前解析仓库认可的领域文档位置，把 `domain-modeling` 可能写入的 glossary / ADR 路径纳入冻结写边界；不能安全写入时返回 `HUMAN_GATE`。
- Agent 一致不能替用户决定。用户确认 shared understanding 前返回 `HUMAN_GATE`，不创建 Goal、不改源码。

每轮用户答复后由本 Skill 从实际对话和 working-tree diff 记录可消费的收敛产物；不要求第三方 wrapper 发明它没有定义的返回 schema：

```text
Human Decision Convergence
- Resolved decisions:
- Unresolved frontier:
- User confirmation: pending | confirmed
- Domain docs touched: <actual paths or none>
- Scope / exclusions changed: <details or none>
```

只有 `Unresolved frontier: none`、用户已确认，并且 glossary / ADR 实际 touched paths 都落在预检写边界内，才能进入 Goal Gate。

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
- 已有 Goal：从 native 工具、产品状态或调用方传入的可核对 parent contract 比较 objective、冻结范围、Done condition 与 completion owner；native getter 不是唯一证据源。按下表确定 ownership，冲突或证据不足才 `defer`。
- 可激活或采用时，Goal 覆盖任务账本、冻结范围、验证、三道终态门禁、协议写和外部写边界。

Done condition 要求：账本无 `PENDING` / `HUMAN_DECISION`；验证和三道门禁覆盖同一最终 evidence id。只有本 Skill 拥有完成权时，才在这些条件满足后完成 Goal。

| Goal relationship     | Behavior                                                                                             | Completion owner                     |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `none`                | Create this Loop's Goal after the safety gate clears                                                 | `created-by-loop`                    |
| `exact-same-goal`     | `Decision: set-now`, `Next: continue active goal`; do not ask again, create, or replace              | this Skill                           |
| `broader-compatible`  | The parent objective, scope, and Done condition explicitly contain this Loop checkpoint; continue it | parent orchestrator; checkpoint only |
| `conflicting/unclear` | `Decision: defer`; return `HUMAN_GATE`                                                               | none                                 |

只有 `created-by-loop` / `exact-same-goal` 由本 Skill 完成。`broader-compatible` 即使本 Loop 已完成，也保持父 Goal active，并报告 `Goal: active-checkpoint`。

## Phase 3：实现与验证

按依赖顺序处理全部 `PENDING`：

1. 转成可观察成功标准；行为变更可行时先展示失败复现。
2. 做最小内聚改动，不顺手做相邻 backlog 或投机抽象。
3. 先跑定向检查，再跑相关包/仓检查。
4. 对外可见行为使用浏览器、CLI、日志、渲染或请求/响应等真实 runtime 信号。
5. 证据通过后才标记 `VERIFIED_DONE`，并同步 plan / 现状文档。

未运行、失败或已过期的必需证据记 `UNVERIFIED`，不能算通过。

## Phase 4：依赖拥有的门禁

### 1. Agentic review

调用 `agentic-review-handoff` 自动闭环；默认 reviewer 为 Grok，用户另指定则从其。透传其原生终态，不复制 packet 状态机：

- `PASS` / `NO_FINDINGS`：核对返回的 `baseSha + pathFilter + digest`，并用 `review-loop evidence` 对当前 worktree 重算一致后才继续；缺字段或 mismatch 时重跑，不得仅凭 verdict 复用。
- `BLOCKED`：按依赖协议修复、验证、续同一 packet。
- `PASS_WITH_CONCERNS` 且 lifecycle 为 `awaiting_user_decision`：返回 `HUMAN_GATE`。只有用户能选择 `run --continue` 或 `close --reason accept-concerns`，本 Skill 不代关。前者按依赖协议续同一 packet；后者只有在用户 Decision Closure 已记录且 packet 归档后才算收口，继续时保留原始 verdict，不改写为 `PASS`。
- delivery/hash/deadlock/budget 异常：返回 `HUMAN_GATE`。

### 2. Architecture hardening

对同一冻结范围与排除项调用 `architecture-hardening-loop`。只接受：

```text
Result: NO_ACTIONABLE_FINDINGS
```

若依赖发现 `Fix`，先核对它是否属于 parent Goal 已冻结的范围与 Done condition：

- **兼容且用户已显式要求完整闭环**：`goal-gate` 视为同一 active Goal 的继续，采用 `Decision: set-now`、`Next: continue active goal`。直接在同一 Goal 下完成 Fix；不创建嵌套 Goal，不暂停询问，也不由内层 architecture loop 完成父 Goal。
- **冲突或归属不明**：服从 `goal-gate` 的 `Decision: defer`，返回 `HUMAN_GATE`，只问如何处理冲突或 scope 归属；不把新工作静默塞进 parent Goal。

`architecture-hardening-loop` 成功时必须返回 `Goal: active-checkpoint` 和可重算的 `Evidence id`，把 `NO_ACTIONABLE_FINDINGS` 作为父 Goal 的一个 checkpoint。只有本 Skill 本身拥有当前 Goal 时，才在 fresh Claude audit 与全部最终 evidence 门禁完成后执行 completion；若本 Skill 也是更大 parent Goal 的 `broader-compatible` checkpoint，则继续由更外层 owner 完成。

若依赖实施过 Fix 或调用了自动 review，其完成报告的 Grok evidence 必须包含最终 review verdict、packet 和 lifecycle；零 Fix 分支应记录 review `not-run` 与终态 consult。lifecycle 仍为 `awaiting_user_decision`，或 `PASS_WITH_CONCERNS` 没有用户 Decision Closure 证据时，返回 `HUMAN_GATE`，仅把 `run --continue` 与 `close --reason accept-concerns` 交给用户；本 Skill 与依赖均不得代关。若用户 Decision Closure 已记录、packet 已归档且没有 open Fix，可保留原始 `PASS_WITH_CONCERNS` 并继续。需要 review 却缺少可核对的终态证据时返回 `UNVERIFIED`，不得仅凭 `NO_ACTIONABLE_FINDINGS` 继续。

若 loop 修改代码，旧 review 与验证随 evidence id 失效。只有它内部的 `agentic-review-handoff` 已覆盖最终 evidence id 时才能复用；否则重跑 Agentic review。刷新必要验证后再继续。

### 3. 全新 Claude Code 盲审

前两道门禁和验证均覆盖当前 evidence id 后，开启新的 Claude Code 会话；禁止 resume 前期讨论或 review 会话。

- 给原始目标、冻结范围、排除项和 evidence id；不给先前 reviewer 结论。
- 审当前 tracked diff、相关 untracked 文件与真实 `file:line`。
- 只允许仓库读取和非变更验证；禁止编辑、Git 控制面、部署和外部写。
- 每条 finding 给影响、最小修法、验证与实际命令。

记录 fresh session、实际命令和所审 evidence id。没有覆盖当前快照，等同未审。

宿主独立核对 finding：

| 分类      | 条件                                               |
| --------- | -------------------------------------------------- |
| `Fix`     | 真实、范围内、收益值得复杂度、可最小修、可验证     |
| `Backlog` | 真实但低价值、超范围、依赖未来或暂不可安全验证     |
| `Reject`  | 偏好、理论扩张、重复抽象、过期证据或被当前行为反证 |

严重度不单独决定分类。有证据的 P3 可以是 `Fix`；无当前证据的 P1 可以是 `Reject`。

终局 `Fix` 使旧门禁失效：保持 Goal active，补最近回归测试，最小修复，重跑验证、Agentic review、同范围 Architecture hardening，再对新 evidence id 开全新 Claude 盲审。

一次“盲审发现 Fix → 修复 → 重跑门禁 → 新盲审”算一轮。最多 2 轮；仍有范围内 `Fix` 时返回 `HUMAN_GATE`。

## 终态与报告

| Result                 | 使用条件                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPLETED`            | 账本无未决项；必需验证通过；三道门禁覆盖同一最终 evidence id；最终盲审无范围内 `Fix`；owned Goal 已完成，或 parent Goal 保持 active-checkpoint |
| `HUMAN_GATE`           | 等待决策、Goal 激活/续用、review concern 接受、权限、凭证、外部状态、范围扩张或预算                                                            |
| `MISSING_DEPENDENCIES` | 预检缺少始终要求或本轮实际需要的能力；源码尚未修改                                                                                             |
| `UNVERIFIED`           | 实现可能存在，但必需证据未运行、失败或已过期；Goal 不得完成                                                                                    |

时间或 token 见底不是完成理由。

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
