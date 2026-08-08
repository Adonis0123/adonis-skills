---
name: architecture-hardening-loop
description: "Orchestrate a bounded architecture hardening loop when the user names a code scope and wants an independent scan, evidence-based triage, minimal fixes, tests, Grok review, and same-scope rescan until no actionable findings remain. Use for scoped architecture cleanup, DDD or high-cohesion hardening with implementation, scan-fix-review-rescan-until-clean, or autonomous architecture improvement cycles. Do not use for diagnose-only architecture reports, ordinary feature work, pure design discussion, one-shot diff review or review-fix-re-review without a rescan, full plan/spec completion that needs task-completion-loop, or requests without an explicit path/module scope."
metadata:
  author: adonis
  version: "1.4.0"
---

# Architecture Hardening Loop

把一次调用编排成可停止的架构加固闭环。目标不是让扫描报告再提不出建议，而是在用户指定范围内消除**现在值得修**的问题。

常见触发说法（含中文）：架构加固、把架构问题修干净、scan-fix-review 直到没有可修项、review 完再扫、在指定模块里自主加固。

扫描器几乎总会再吐出候选项；若不加门槛，循环永远不会结束。本 Skill 的价值是：**证据门槛 + 固定顺序 + 独立 Grok 复核 + 明确终态**。

## 必需输入

调用必须给出明确审查范围（目录、模块、包或文件集合），并尽量带上排除项，例如“只看 `packages/core`，不看 React bridge”。

- 范围缺失或无法判断：只问一个范围问题并停止。不要默认全仓库，也不要根据扫描结果自行扩大范围。
- 一次调用 = 用户预授权：在范围内选择、修改、验证，无需为普通工程判断反复请示。

`agentic-review-handoff` 会写入被 Git 忽略的 `.review-handoff/**`，首次使用还可能幂等更新 `$GIT_COMMON_DIR/info/exclude`。这些是协议产物，不属于代码扫描范围，也不是交付动作；开始前必须披露并纳入写边界。用户禁止 `.git/**` 写且 exclude 尚未配置时，在扫描前返回 `HUMAN_GATE`。

## 硬依赖与 runtime 能力

本 Skill 是薄编排，**不复制**底层逻辑。硬依赖**不要求**都在本仓库 catalog 里，但必须已安装、可解析、当前 invocation policy 允许，并且所需 delegation / 产品 runtime 能力可实际调用；文件或 slug 存在不构成充分条件。

| 依赖                            | 用途                                 | 本机检查方式                       | 缺失时的安装提示（仅提示，不代装）                                               |
| ------------------------------- | ------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| `improve-codebase-architecture` | 扫描 + 候选 HTML 报告                | 已安装且当前 host 允许本次嵌套调用 | 第三方：`npx skills add mattpocock/skills --skill improve-codebase-architecture` |
| `codebase-design`               | scanner Explore 阶段的强制词汇与门槛 | 已安装且 scanner 可调用            | 第三方 scanner 的 companion；按其来源安装                                        |
| `agentic-review-handoff`        | Grok consult 与 review-fix-re-review | 已安装且真实 Grok adapter 可调用   | 本仓：`npx skills add adonis0123/adonis-skills --skill agentic-review-handoff`   |
| `goal-gate`                     | 有 Fix 时创建/沿用 Goal              | 已安装且当前 runtime 可解析        | 本仓：`npx skills add adonis0123/adonis-skills --skill goal-gate`                |

本 Skill 自身：

```bash
npx skills add adonis0123/adonis-skills --skill architecture-hardening-loop
```

扫描阶段只调用 `improve-codebase-architecture` 的 **Explore + HTML 报告**，并在报告后停止（不进候选选择 / grilling / 领域文档写入）。`codebase-design` 是当前 scanner 在 Explore 阶段明确要求的传递硬依赖；`grilling` / `domain-modeling` 属于报告后的交互阶段，本 Loop 不调用。scanner 还要求独立 exploration worker，因此 host 必须有可用的只读 delegation 能力。本编排不代装、不复制这些能力。

## 前置检查

开始扫描前：

1. 确认当前目录属于 Git 仓库；记录仓库根与现有工作区状态。
2. **解析可调用能力，不只查文件存在**：确认当前 host 的 skill policy 允许本轮调用；`disable-model-invocation` / `allow_implicit_invocation: false` 且用户没有显式点名时，必须视为不可调用。检查：
   - `improve-codebase-architecture`
   - `codebase-design`
   - `agentic-review-handoff`
   - `goal-gate`
3. 确认 host 能启动 scanner 要求的独立只读 exploration worker；确认 `agentic-review-handoff` 能创建或恢复真实 Grok consult/review，会话可返回可核对结果。只有 CLI 文件或 skill 名存在不算可用。
4. 任一 skill、invocation permission、delegation 或 Grok capability 缺失 → 输出 `MISSING_DEPENDENCIES` 与准确依赖链，然后停止。不要静默降级、复制逻辑、冒充产品或代装依赖。
5. 检查 `.review-handoff/**` 与 `$GIT_COMMON_DIR/info/exclude` 协议写是否允许；若用户禁止且当前状态需要写，返回 `HUMAN_GATE`。
6. 冻结调用时的代码范围；后续每轮复用同一范围。**每一次 scanner pass 前**都为本轮建立或选定 `scanEvidence`。初扫用当前 `HEAD` 与该 path filter 执行 `review-loop evidence`，记录 E1；实施过 `Fix` 时，先确认当前 identity 与最终 review evidence 一致，再把该 identity（如 E2）作为下一次复扫的 `scanEvidence`。协议产物单独记录，不混入 scanner scope。
7. 从 native Goal 工具、产品状态，或调用方显式传入且可核对的 parent contract（objective、冻结范围、Done condition、completion owner）读取 ownership evidence，记录 `none` / `exact-same-goal` / `broader-compatible` / `conflicting/unclear`。native getter 不是唯一证据源；没有足够证据时归为 `conflicting/unclear`。这是只读 ownership 检查，不创建 Goal；冲突或不明立即服从 `goal-gate` 的 `defer` 并在扫描前返回 `HUMAN_GATE`。
8. 保留用户已有改动；不重置、不覆盖、不整理范围外内容。

## 闭环

```text
明确范围
  → 扫描候选项（仅扫描+报告）
  → Fix / Backlog / Reject
  → 零 Fix？→ Grok consult 复核终态 → NO_ACTIONABLE_FINDINGS
  → 有 Fix → Grok 事前 consult
  → Goal Gate
  → 最小修改与测试
  → Grok review-fix-re-review
  → 原范围重新扫描
  → （有 Fix 则下一轮；否则终态 consult）→ NO_ACTIONABLE_FINDINGS
```

### 1. 扫描候选项

调用本机已解析的 `improve-codebase-architecture`，**只执行探索 + 候选 HTML 报告**：

- 把用户范围直接传给扫描器；禁止走“根据 Git 热点推断范围”的默认分支。
- 允许写临时 HTML 报告。
- **停在报告之后**：这是父编排器明确选择的 report-only 阶段；抑制 scanner 报告后的候选选择问题，不进入 `grilling` 或领域文档写入。后续判断由本 Skill 负责。
- 报告里的 `Strong` / `Worth exploring` / `Speculative` 只是候选强度，不是修改命令。
- 不因扫描器 companion 缺失而在本 Skill 内复制扫描逻辑；若扫描器本身无法跑完报告阶段，记原因并 `HUMAN_GATE` 或停在可复现失败信息上。

扫描器发现机会；**它不决定循环是否结束**。

### 2. 证据门槛分类

对每个候选项独立分类：

| 分类      | 条件                                                                 | 后续                   |
| --------- | -------------------------------------------------------------------- | ---------------------- |
| `Fix`     | 问题真实存在；在范围内；收益大于新增复杂度；有最小方案；结果可验证   | 本轮可改               |
| `Backlog` | 问题真实，但收益低、超出范围、依赖未来需求、或暂时无法安全验证       | 记录理由，不阻塞完成   |
| `Reject`  | 纯风格、重复抽象、推测性扩展、缺证据、违反有效决策、或只追求理论优雅 | 记录反证，不再循环提出 |

每个 `Fix` 必须写齐四项，缺一不可：

- `Evidence`：代码路径、测试、运行结果或变更传播路径
- `Impact`：当前错误、理解成本或修改成本
- `Minimal change`：最小可行修改（不顺手重构）
- `Verification`：改后跑什么测试或观察什么信号

不要因为报告更长、Reviewer 更强势、或同一建议重复出现就抬高优先级。单实现却强加接口、为“未来多租户/多存储”加总线、纯六边形洁癖——默认 `Reject` 或 `Backlog`，除非有可复现的当前伤害。

同一轮只处理一个最小内聚批次：共享同一根因的 `Fix` 可合并；无关问题分轮。

### 3. 分支：零 Fix vs 有 Fix

**零 Fix（首轮或复扫后）：**

1. 调用 Grok `consult`，只复核终态分类（范围冻结、`Backlog`/`Reject` 理由、是否漏掉真实 `Fix`）。
2. Grok 若提出新问题，仍须通过同一证据门槛；不得绕过门槛直接扩大修改。
3. 仍无通过门槛的 `Fix` 时，按**本轮** `scanEvidence` 的 `baseSha` / `pathFilter` 再执行 `review-loop evidence`。只有 digest 与本轮 scanner pass 前的 identity 一致，才进入 `NO_ACTIONABLE_FINDINGS`；mismatch 说明 scanner/consult 证据已过期，必须重新扫描同一范围，无法重扫则报告 `UNVERIFIED`。Fix 后复扫只与复扫前选定的 E2 比较，绝不回退到初扫 E1。证据匹配后**不创建新 Goal**，按前置检查已记录的 Goal 关系收口：
   - `none` → `Goal: not-created`；
   - `exact-same-goal` → 终态 consult、必要验证和完整 Done condition 都有证据后，按该 runtime 的 terminal schema 完成；
   - `broader-compatible` → `Goal: active-checkpoint`，保留父 Goal active；
   - `conflicting/unclear` 已在扫描前 `HUMAN_GATE`，不得到达本分支。

**有 Fix：** 进入步骤 4–7。

### 4. Grok 事前 consult

修改前调用 `agentic-review-handoff` 的 DecisionConsult / `review-loop consult`，peer/Reviewer 固定为 **Grok**。提供：

- 冻结的审查范围
- 候选项与代码证据
- `Fix / Backlog / Reject` 与理由
- 本轮最小修改
- 验证方案

Consult 是独立意见，不是投票。编排者必须核对 Grok 主张；普通分歧用证据收敛，不甩给用户代替工程判断。Grok 新提出的范围内问题同样过证据门槛。

### 5. Goal Gate

`goal-gate` 在本 Loop 有两个阶段：扫描前只读检查 active Goal relation / ownership，不创建、不替换、不 terminally update；只有**确认至少有一个 `Fix` 要实施**且关系为 `none` 时，才进入新 Goal 创建。`exact-same-goal` / `broader-compatible` 继续已有 Goal，`conflicting/unclear` 已在扫描前停门。

先记录 Goal 关系与完成所有权：

| Goal 关系             | 行为                                                                                                                                             | 完成所有权                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `none`                | 安全闸门通过后创建覆盖本次范围、验证与 `NO_ACTIONABLE_FINDINGS` 的 Goal                                                                          | `created-by-loop`                   |
| `exact-same-goal`     | 用户明确继续同一 architecture-hardening 目标；`Next: continue active goal`，不创建或替换                                                         | 本 Loop 可在全部条件满足后完成      |
| `broader-compatible`  | 本 Loop 是 active parent Goal 冻结范围与 Done condition 中的一个 checkpoint；`Next: continue active goal`，不创建、不替换、不收窄 Done condition | 父编排器；本 Loop 只上报 checkpoint |
| `conflicting/unclear` | 服从 `goal-gate` 的 `Decision: defer`，返回 `HUMAN_GATE`，只问如何处理冲突或归属                                                                 | none                                |

兼容性必须由 objective、冻结范围和 Done condition 的证据证明；仅仅“已经有 Goal”既不等于兼容，也不等于必须暂停。对 Codex 的继续不调用 terminal `update_goal`；对 Grok 只使用其已激活 Goal 的进度合同。永不创建嵌套 Goal。

### 6. 最小修改与验证

只实施已确认的 `Fix`：

- 每一行修改追溯到本轮某个 `Fix`
- 不添加当前问题不需要的扩展点、配置、层级或通用框架
- 行为变化：补或改回归测试；纯结构变化：用现有测试或最小特征测试证明公共行为不变
- 先跑针对性验证，再按影响面跑相关测试 / typecheck / build
- 命令未实际执行 → 写 `UNVERIFIED`，不得宣称通过

### 7. Grok 复审修改

调用 `agentic-review-handoff` 的自动 `run`，Reviewer 固定 **Grok**：

| 结果                                                     | 动作                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PASS`                                                   | 进入原范围重新扫描                                                                                                            |
| `BLOCKED`                                                | 只修经证据验证的有效发现 → 记 fix completion → 继续复审                                                                       |
| `PASS_WITH_CONCERNS`                                     | `awaiting_user_decision` 时返回 `HUMAN_GATE`；用户二选一：`run --continue` 续同一 packet，或用 Decision Closure 接受 concerns |
| `DELIVERY_UNKNOWN` / hash mismatch / deadlock / 预算耗尽 | `HUMAN_GATE`                                                                                                                  |

Reviewer 的风格偏好与无证据建议不构成 `Fix`，但编排 agent 仍不得代用户关闭 `PASS_WITH_CONCERNS` packet、把 verdict 改写为 `PASS`，或在 `awaiting_user_decision` 时进入复扫。恢复步骤 8 有两条互斥路径：用户 `run --continue` 后同一 packet 取得最终 `PASS` / `NO_FINDINGS` 且 archived；或用户执行 `close --reason accept-concerns`，Decision Closure 已记录、packet 已 archived 且没有 open Fix。后一条保留原始 verdict `PASS_WITH_CONCERNS`；前一条不要求也不产生 Decision Closure。

Evidence id 在 zero-Fix 与 Fix 分支都必须存在。每个 scanner pass 都拥有独立的 `scanEvidence`：初扫前建立 E1；实施过 Fix 时，使用 `review-loop run` / `close` 返回的 `evidence = { baseSha, pathFilter, digest, coveredPaths, sourceRound }`，并在复扫前重算确认 current identity 一致后，把它选为本轮 E2。终态 consult 后只与当前 scanner pass 的 `scanEvidence` 比较，不得与更早轮次的 identity 比较。相等性只比较 `baseSha + pathFilter + digest`；`coveredPaths` 仅供审计。Decision Closure 只复用 `sourceRound`，不重新证明当前 worktree。缺字段、无法重算或 digest 不一致时，旧 review 不可复用，必须重跑或报告 `UNVERIFIED`。

### 8. 原范围重新扫描

对**完全相同**的范围再跑扫描：

1. 新候选项再过证据门槛
2. 有 `Fix` → Grok consult → 下一轮（计入外层轮次）
3. 无 `Fix` → Grok consult 复核终态分类
4. Grok 未提出通过门槛的 `Fix` → `NO_ACTIONABLE_FINDINGS`

`Backlog` 与 `Reject` 可以留在完成报告里。它们不是失败，也不要求为“清零报告”继续改。

## 循环预算与 Human Gate

默认最多 **3** 个外层加固轮次。以下情况暂停并交给用户：

- 破坏性、不可逆、生产数据、认证、计费或外部发布
- 候选项要求扩大原始范围
- 同一问题连续两轮无新证据
- 3 轮后仍有通过门槛的 `Fix`
- 依赖、凭证或环境使完成条件无法验证
- 底层 review loop 返回尚无用户 Decision Closure 的 `PASS_WITH_CONCERNS` / `awaiting_user_decision`
- 底层 review loop 报告 delivery / hash / deadlock / 预算异常

暂停时输出 `HUMAN_GATE`、现有证据、已尝试内容、以及**唯一**需要用户决定的问题。

## 反漂移（常见失败）

| 失败模式                   | 正确行为                                   |
| -------------------------- | ------------------------------------------ |
| 把扫描强度当修改优先级     | 只认证据门槛四项                           |
| 范围外“顺手”修             | `Backlog` 或 `HUMAN_GATE`，不改            |
| 依赖缺失仍继续             | `MISSING_DEPENDENCIES` 并停                |
| 为理论优雅重写             | `Reject`/`Backlog`，除非有可复现当前伤害   |
| 代用户接受 review concerns | `HUMAN_GATE`；只交出 continue / close 命令 |
| 未跑命令却写通过           | `UNVERIFIED`                               |
| 报告还有建议就继续轮       | 无 `Fix` 即终态；不必清零报告              |

## 完成报告

```text
Architecture Hardening Result
- Scope: <原始范围>
- Iterations: <完成外层轮数>
- Result: NO_ACTIONABLE_FINDINGS | HUMAN_GATE | MISSING_DEPENDENCIES
- Fixed: <问题、文件与验证>
- Backlog: <真实但当前不处理的问题及理由，或 none>
- Rejected: <无证据或过度设计项及理由，或 none>
- Grok evidence: <consult；若实施过 Fix：最终 review verdict、packet 与 lifecycle，若有 Decision Closure 则记录用户命令；零 Fix：review not-run + 终态 consult>
- Evidence id: <baseSha + pathFilter + digest；另列 coveredPaths 与 sourceRound>
- Verification: <实际命令与结果，或 UNVERIFIED>
- Goal: <completed | active-checkpoint | not-created | deferred-conflict>
```

只有本 Loop 拥有完成权，且 `Result: NO_ACTIONABLE_FINDINGS`、必要验证通过、没有未处理的 `Fix` 时，才能把 Goal 标为 completed。若实施过 Fix，最终 review 还必须覆盖报告中的同一 Evidence id，并为 `PASS` / `NO_FINDINGS`，或是由用户 Decision Closure 收口且已归档的 `PASS_WITH_CONCERNS`；不得存在 `awaiting_user_decision` packet。`broader-compatible` 的父 Goal 始终报告 `active-checkpoint`，由父编排器在其余 Done condition 完成后收口。零 Fix 分支不虚构 review。
