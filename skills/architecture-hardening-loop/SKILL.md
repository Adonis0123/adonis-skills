---
name: architecture-hardening-loop
description: "Run a bounded scan-triage-fix-Grok-review-rescan loop on an explicit code scope until no evidence-backed architecture fixes remain. Use for implementation-inclusive architecture cleanup, DDD or high-cohesion hardening, and autonomous architecture improvement. Do not use for read-only diagnosis, ordinary feature or bug work, design-only discussion, one-shot review, full spec completion, or unspecified scope."
metadata:
  author: adonis
  version: "1.6.0"
---

# Architecture Hardening Loop

把一次调用编排成可停止的架构加固闭环：在用户指定范围内消除**现在值得修**的问题，而不是让扫描报告再提不出建议。

常见触发：架构加固、把架构问题修干净、scan-fix-review 直到没有可修项、review 完再扫、在指定模块里自主加固。

扫描器几乎总会再吐出候选项。价值是**候选准入 + 固定顺序 + 独立 Grok 复核 + 明确终态**。`0` 个架构深化候选有效；不要为了报告“有内容”而制造重构。

## Fast Path

- **范围明确且依赖可解析**：写下 `Hardening Contract`，跑 scanner Explore + HTML 报告（report-only），按五项准入分类。只有即将创建/继续 Goal，或要复用 review verdict 时，才加载 `references/ownership-and-evidence.md`。
- **范围缺失**：只问一个范围问题并停止。不要加载 references，不要默认全仓库。
- **host 能力缺失**：`MISSING_DEPENDENCIES` 并停止。文件存在 ≠ 可调用。

## 必需输入

必须给出明确审查范围（目录、模块、包或文件集合），并尽量带排除项。

- 范围缺失或无法判断：只问一个范围问题并停止。不要默认全仓库，也不根据扫描结果自行扩大范围。
- 一次调用 = 用户预授权：在范围内选择、修改、验证，无需为普通工程判断反复请示。

`agentic-review-handoff` 会写被 Git 忽略的 `.review-handoff/**`，首次还可能幂等更新 `$GIT_COMMON_DIR/info/exclude`。这些是协议产物，不是代码扫描范围，也不是交付动作；开始前披露并纳入写边界。用户禁止 `.git/**` 写且 exclude 尚未配置时，扫描前返回 `HUMAN_GATE`。

## 加固契约

扫描前写下不可漂移的 `Hardening Contract`，作为筛选与停止依据，不是新设计文档：

- `Scope / Exclusions`：允许读/改与明确排除的路径
- `Failure invariants`：必须保持或修复的可观察行为；未知写 `none observed`
- `Decision constraints`：有效 ADR、项目规则，以及每项 Deferred 的重考虑触发器
- `Write boundary`：源码、测试、临时报告、review packet 各自允许的写范围
- `Round budget`：默认最多 3 个实施轮次；零 `Fix` 可在首轮结束

批量重命名、文件移动、未提交迁移和变更条目数只解释扫描噪声。除非直接造成可复现失败或跨范围传播成本，否则不能当 `Fix` 证据。

## 硬依赖与 runtime 能力

本 Skill 是薄编排，**不复制**底层逻辑。硬依赖不必都在本仓 catalog，但必须已安装、可解析，且 host 能实际执行本次**声明内嵌套调用**；文件或 slug 存在不构成充分条件。

用户点名本 Loop（slash / `$skill` / 明确 skill 名），或 `workflow-gate` 把 `Runtime skill` 设为本 Loop，即授权下表依赖按其声明用途被嵌套调用。`disable-model-invocation` / `allow_implicit_invocation: false` 只禁止这些 skill 在没有父编排时被孤立自动触发；**不要求**用户再点名每个嵌套 skill，也不要把“请同时点名 scanner”写成继续方式。

| 依赖                            | 用途                                 | 本机检查                         | 缺失时提示（仅提示，不代装）                                                     |
| ------------------------------- | ------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------- |
| `improve-codebase-architecture` | 扫描 + 候选 HTML 报告                | 已安装且 host 能执行声明嵌套调用 | 第三方：`npx skills add mattpocock/skills --skill improve-codebase-architecture` |
| `codebase-design`               | scanner Explore 的强制词汇与门槛     | 已安装且 scanner 可调用          | 第三方 scanner companion；按其来源安装                                           |
| `agentic-review-handoff`        | Grok consult 与 review-fix-re-review | 已安装且真实 Grok adapter 可调用 | 本仓：`npx skills add adonis0123/adonis-skills --skill agentic-review-handoff`   |
| `goal-gate`                     | 有 Fix 时创建/沿用 Goal              | 已安装且当前 runtime 可解析      | 本仓：`npx skills add adonis0123/adonis-skills --skill goal-gate`                |

本 Skill：`npx skills add adonis0123/adonis-skills --skill architecture-hardening-loop`

扫描只调用 `improve-codebase-architecture` 的 **Explore + HTML 报告**，报告后停止（不进候选选择 / grilling / 领域文档）。`codebase-design` 是 scanner Explore 的传递硬依赖；`grilling` / `domain-modeling` 属报告后交互，本 Loop 不调用。scanner 还要求独立只读 exploration worker。本编排不代装、不复制这些能力。

## 前置检查

1. 确认当前目录属于 Git 仓库；记录仓库根与工作区状态。
2. **解析可调用能力，不只查文件存在**：本 Loop 已被调用时，下表依赖的 `disable-model-invocation` / `allow_implicit_invocation: false` **不等于**本轮不可调用。把父调用当作声明依赖的授权，再检查 host **能否实际加载并执行**：`improve-codebase-architecture`、`codebase-design`、`agentic-review-handoff`、`goal-gate`。仍不可调用：未安装、无法解析、host catalog 拒绝加载/执行、或用户明确禁止。不要因为用户没点名嵌套 skill 而停。
3. host 须能启动 scanner 要求的独立只读 exploration worker；`agentic-review-handoff` 须能创建或恢复真实 Grok consult/review 并返回可核对结果。只有 CLI 文件或 skill 名存在不算可用。
4. 任一 skill 未安装、host 无法执行、delegation 或 Grok capability 缺失 → `MISSING_DEPENDENCIES` + 准确依赖链，然后停止。不要静默降级、复制逻辑、冒充产品或代装。继续方式是安装、启用或补齐运行时能力；禁止写成“请再点名 `improve-codebase-architecture` 或其它已声明嵌套依赖”。
5. 检查 `.review-handoff/**` 与 `$GIT_COMMON_DIR/info/exclude` 协议写；用户禁止且当前需要写 → `HUMAN_GATE`。
6. 冻结调用时的代码范围。协议产物不混入 scanner scope。每次 scanner pass 前选定本轮 `scanEvidence`（初扫 E1；Fix 后用已确认的 review identity 作复扫 E2）。细节 → `references/ownership-and-evidence.md`。
7. 只读核对 Goal 关系：`none` / `exact-same-goal` / `broader-compatible` / `conflicting/unclear`。证据可来自 native getter **或**调用方可核对的 parent contract；native getter 不是唯一证据源。本步不创建 Goal。`conflicting/unclear` 服从 `goal-gate` 的 `defer`，扫描前 `HUMAN_GATE`。
8. 记录 `Hardening Contract` 和空 `Candidate Ledger`；保留用户已有改动。

## 闭环

```text
明确范围
  → 扫描候选项（仅扫描+报告）
  → Candidate Ledger 去重
  → Architecture Fix / Local Fix / Backlog / Reject
  → 零 Fix？→ Grok consult 复核终态 → NO_ACTIONABLE_FINDINGS
  → 有 Fix → Grok 事前 consult
  → Goal Gate
  → 最小修改与测试
  → Grok review-fix-re-review
  → 原范围重新扫描
  → （有 Fix 则下一轮；否则终态 consult）→ NO_ACTIONABLE_FINDINGS
```

### 1. 扫描候选项

调用已解析的 `improve-codebase-architecture`，**只做探索 + 候选 HTML 报告**：

- 把用户范围直接传给扫描器；禁止走“按 Git 热点推断范围”的默认分支。
- 允许写临时 HTML 报告。
- **停在报告之后**：report-only 阶段；抑制 standalone 的候选选择问题，不进入 `grilling` 或领域文档。后续判断由本 Skill 负责。
- `Strong` / `Worth exploring` / `Speculative` 只是候选强度，不是修改命令。
- 不因 companion 缺失而复制扫描逻辑；scanner 跑不完报告则 `HUMAN_GATE` 或停在可复现失败上。

扫描器发现机会；**它不决定循环是否结束**。

### 2. 候选准入与 Candidate Ledger

| 分类               | 条件                                                                                     | 后续                                     |
| ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `Architecture Fix` | 通过下述五项准入；修改深化 Module、缩小 Interface 或把知识放回正确 Seam                  | 本轮可改，计入 architecture fixed        |
| `Local Fix`        | 可复现正确性问题，最小修复留在现有 Implementation；不需要新 Module、Interface 或 Adapter | 本轮可改，单独报告，不拿它证明架构应扩大 |
| `Backlog`          | 问题真实，但收益低、超范围、依赖未来需求、ADR 触发器未满足或暂时无法安全验证             | 记录重考虑触发器，不阻塞完成             |
| `Reject`           | 纯风格、重复抽象、推测性扩展、缺证据、违反有效决策、或只追求理论优雅                     | 记录反证；无新证据不再进入后续轮次       |

`Local Fix` 不是降级标签。它只覆盖有效架构扫描中顺带发现的普通 bug；把 bug 留在已有 Implementation，通常比为 bug 发明新架构更正确。

#### Architecture Fix 五项准入

五项必须同时通过；任一缺失只能 `Backlog` 或 `Reject`：

1. **当前伤害**：可观察失败、已发生的理解/修改传播成本、测试困难、知识泄漏，或可证伪不变量；“文件长”“参数多”“以后可能”不算。
2. **真实复杂度或变化**：已有第二消费者、重复生命周期/调用顺序、同一知识实际分叉，或单一调用方已承担多个必须协同修改和验证的状态/分支/顺序。只有拟议可替换 Adapter/Seam 才强制两个合理 Adapter（通常 production + test）；猜测中的未来调用方不算。
3. **删除测试**：删除拟议 Module 后，状态、分支、顺序或领域知识会回流 owner、调用方或测试；不要求多个 owner。复杂度反而消失则是 pass-through。
4. **决策允许**：不违反有效 ADR；若 ADR 给了启动条件，必须证明条件已发生。
5. **复杂度净下降**：最小方案减少调用方必须知道的事实，不靠新增 `mode`、policy flag、Provider、cache、registry、bus 或配置层掩盖语义差异。

`Local Fix` 须通过第 1、4、5 项，并证明不改变现有 Interface。后来出现真实第二消费者或知识传播，再作为新架构候选准入；不要在本次 bugfix 预付抽象。

每个 `Fix` 须写齐：`Evidence`（路径/测试/运行结果/传播路径）、`Impact`、`Minimal change`、`Verification`。

#### Candidate Ledger

每次 scanner pass 后先与 ledger 对账：

- `Fingerprint` = 失败不变量或传播成本 + 领域 owner + 拟议 Seam/最小修正；不用 scanner 标题或措辞。
- 记录 `First seen`、`Disposition`、证据/反证、`Reconsider when`、最后核验轮次。
- 改名/换类比/换文件切入点但 fingerprint 相同 = 同一候选；无新证据不重开，也不产生新实施轮次。
- `Backlog` 只在 `Reconsider when` 触发后重开；`Reject` 只在反证失效、ADR 修订或出现新的当前伤害后重开。
- 已实施 `Fix` 的预期内部细节先判断是否同一根因；不要把“修一层后看见下一层”自动当成新架构问题。

不要因报告更长、Reviewer 更强势或同一建议重复就抬高优先级。单实现却强加接口、为“未来多租户/多存储”加总线、纯六边形洁癖——默认 `Reject`/`Backlog`，除非有可复现当前伤害。同一轮只处理一个最小内聚批次。

### 3. 分支：零 Fix vs 有 Fix

Goal ownership + evidence freshness → `references/ownership-and-evidence.md`。

**零 Fix：** Grok `consult` 只复核终态分类。按本轮 `scanEvidence` 重算 `review-loop evidence`；`baseSha + pathFilter + digest` 与本轮扫描前 identity 一致才进入 `NO_ACTIONABLE_FINDINGS`，否则同范围重扫，无法重扫则 `UNVERIFIED`。匹配后立即停止，禁止再扫一轮求安心。Fix 后复扫只比 E2，绝不回退 E1。不创建新 Goal：`none` → `not-created`；`exact-same-goal` → 加载 reference，完整 Done condition 有证据后按当前 runtime 的终态 schema 完成；`broader-compatible` → `active-checkpoint`；`conflicting/unclear` 到不了本分支。

**有 Fix：** 进入步骤 4–7。

### 4. Grok 事前 consult

修改前调用 `agentic-review-handoff` 的 DecisionConsult / `review-loop consult`，Reviewer 固定 **Grok**。提供冻结范围、契约、ledger、分类、最小修改与验证。Consult 是独立意见不是投票；普通分歧用证据收敛。Grok 新提出的范围内问题同样过证据门槛。

### 5. Goal Gate

扫描前只读检查关系，不创建、不替换、不 terminally update。只有确认至少一个 `Fix` 且关系为 `none` 时才创建新 Goal。`exact-same-goal` / `broader-compatible` 继续已有 Goal（`Next: continue active goal`）；`conflicting/unclear` 已在扫描前停门。永不创建嵌套 Goal。完成所有权与 Codex/Grok 终态字段 → `references/ownership-and-evidence.md`。

### 6. 最小修改与验证

只实施已确认的 `Fix`：每行追溯到本轮某个 `Fix`；`Architecture Fix` 才可动 Module/Interface/Seam，`Local Fix` 留在现有 Implementation；不添加当前问题不需要的扩展点或框架。行为变化补回归测试；纯结构变化用现有或最小测试证明公共行为不变。先针对性验证，再按影响面跑相关测试 / typecheck / build。命令未执行 → `UNVERIFIED`。

### 7. Grok 复审修改

调用 `agentic-review-handoff` 的自动 `run`，Reviewer 固定 **Grok**：

| 结果                                                     | 动作                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PASS`                                                   | 进入原范围重新扫描                                                                                                            |
| `BLOCKED`                                                | 只修经证据验证的有效发现 → 记 fix completion → 继续复审                                                                       |
| `PASS_WITH_CONCERNS`                                     | `awaiting_user_decision` 时返回 `HUMAN_GATE`；用户二选一：`run --continue` 续同一 packet，或用 Decision Closure 接受 concerns |
| `DELIVERY_UNKNOWN` / hash mismatch / deadlock / 预算耗尽 | `HUMAN_GATE`                                                                                                                  |

不得代用户关闭 `PASS_WITH_CONCERNS` packet、把 verdict 改写为 `PASS`，或在 `awaiting_user_decision` 时进入复扫。恢复步骤 8 两条互斥路径：用户 `run --continue` 后同一 packet 取得最终 `PASS` / `NO_FINDINGS` 且 archived（不要求 Decision Closure）；或用户 `close --reason accept-concerns`，Decision Closure 已记录、packet 已 archived 且没有 open Fix（保留原始 `PASS_WITH_CONCERNS`）。

每个 scanner pass 都有独立 `scanEvidence`。相等性只比 `baseSha + pathFilter + digest`；`coveredPaths` 仅供审计。缺字段、无法重算或 digest 不一致时，旧 review 不可复用，必须重跑或 `UNVERIFIED`。E1 / E2 / E3 与 Decision Closure 的 `sourceRound` → `references/ownership-and-evidence.md`。

### 8. 原范围重新扫描

对**完全相同**的范围再扫：先按 fingerprint 对账；只有新 fingerprint 或已满足 `Reconsider when` 的候选才重新过门槛。有 `Fix` → consult → 下一轮。无 `Fix` → 终态 consult；仍无门槛内 `Fix` → `NO_ACTIONABLE_FINDINGS`，停止，不再追加确认性扫描。`Backlog`/`Reject` 可留在报告里，不是失败。

## 循环预算与 Human Gate

默认最多 **3** 个外层轮次。暂停并交给用户：破坏性/不可逆/生产数据/认证/计费/外部发布；候选项要求扩大原始范围；同一已验证 `Fix` 连续两次实施或验证仍失败；3 轮后仍有门槛内 `Fix`；依赖/凭证/环境使完成条件无法验证；底层 review 返回尚无用户 Decision Closure 的 `PASS_WITH_CONCERNS` / `awaiting_user_decision`；delivery / hash / deadlock / 预算异常。

暂停时输出 `HUMAN_GATE`、现有证据、已尝试内容、以及**唯一**需要用户决定的问题。

## 反漂移（常见失败）

| 失败模式                   | 正确行为                                   |
| -------------------------- | ------------------------------------------ |
| 把扫描强度当修改优先级     | 只认五项准入与 Local Fix 条件              |
| 把代码形状当当前伤害       | 用五项准入；允许零 Architecture Fix        |
| 用局部 bug 证明需要新架构  | 归 `Local Fix`，在现有 Implementation 内修 |
| scanner 改名后重开候选     | 按 fingerprint 查 ledger；无新证据不重开   |
| 批量迁移条目数当严重度     | 只作噪声背景，不作 `Fix` 证据              |
| 范围外“顺手”修             | `Backlog` 或 `HUMAN_GATE`，不改            |
| 依赖缺失仍继续             | `MISSING_DEPENDENCIES` 并停                |
| 为理论优雅重写             | `Reject`/`Backlog`，除非有可复现当前伤害   |
| 代用户接受 review concerns | `HUMAN_GATE`；只交出 continue / close 命令 |
| 未跑命令却写通过           | `UNVERIFIED`                               |
| 报告还有建议就继续轮       | 无 `Fix` 即终态；不必清零报告              |
| zero-Fix 后再扫一轮求安心  | consult + evidence 新鲜即停止              |

## 完成报告

```text
Architecture Hardening Result
- Scope: <原始范围>
- Hardening Contract: <scope/exclusions、invariants、decision constraints、write boundary、round budget>
- Iterations: <完成外层轮数>
- Result: NO_ACTIONABLE_FINDINGS | HUMAN_GATE | MISSING_DEPENDENCIES | UNVERIFIED
- Architecture Fixed: <深化的 Module / Interface / Seam 与验证，或 none>
- Local Fixed: <留在现有 Implementation 的正确性修复与验证，或 none>
- Backlog: <真实但当前不处理的问题及理由，或 none>
- Rejected: <无证据或过度设计项及理由，或 none>
- Candidate Ledger: <fingerprint、disposition、reconsider trigger>
- Stop reason: <zero-fix-first-pass | post-fix-rescan-zero | duplicate-only | human-gate | missing-dependencies | evidence-drift>
- Grok evidence: <consult；若实施过 Fix：最终 review verdict、packet 与 lifecycle，若有 Decision Closure 则记录用户命令；零 Fix：review not-run + 终态 consult>
- Evidence id: <baseSha + pathFilter + digest；另列 coveredPaths 与 sourceRound>
- Verification: <实际命令与结果，或 UNVERIFIED>
- Goal: <completed | active-checkpoint | not-created | deferred-conflict>
```

只有本 Loop 拥有完成权，且 `Result: NO_ACTIONABLE_FINDINGS`、必要验证通过、没有未处理的 `Fix` 时，才能把 Goal 标为 completed。若实施过 Fix，最终 review 还必须覆盖报告中的同一 Evidence id，并为 `PASS` / `NO_FINDINGS`，或是由用户 Decision Closure 收口且已归档的 `PASS_WITH_CONCERNS`；不得存在 `awaiting_user_decision` packet。`broader-compatible` 的父 Goal 始终报告 `active-checkpoint`。零 Fix 分支不虚构 review。Codex/Grok 终态字段见 `references/ownership-and-evidence.md`。
