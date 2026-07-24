---
name: architecture-hardening-loop
description: "Orchestrate a bounded architecture hardening loop when the user names a code scope and wants an independent scan, triage, minimal fix, test, Grok review, and rescan cycle until no actionable findings remain. Use for architecture cleanup, architecture hardening, DDD or high-cohesion reviews that include implementation, scan-fix-review-until-clean, clean up architecture issues in a loop, review-again-until-no-actionable-findings, or autonomous improve-review-fix cycles. Do not use for one-shot read-only reviews, ordinary feature work, pure design discussion without implementation, or requests without an explicit scope."
metadata:
  author: adonis
  version: "1.1.0"
---

# Architecture Hardening Loop

把一次调用编排成可停止的架构加固闭环。目标不是让扫描报告再提不出建议，而是在用户指定范围内消除**现在值得修**的问题。

常见触发说法（含中文）：架构加固、把架构问题修干净、scan-fix-review 直到没有可修项、review 完再扫、在指定模块里自主加固。

扫描器几乎总会再吐出候选项；若不加门槛，循环永远不会结束。本 Skill 的价值是：**证据门槛 + 固定顺序 + 独立 Grok 复核 + 明确终态**。

## 必需输入

调用必须给出明确审查范围（目录、模块、包或文件集合），并尽量带上排除项，例如“只看 `packages/core`，不看 React bridge”。

- 范围缺失或无法判断：只问一个范围问题并停止。不要默认全仓库，也不要根据扫描结果自行扩大范围。
- 一次调用 = 用户预授权：在范围内选择、修改、验证，无需为普通工程判断反复请示。

## 硬依赖与安装

本 Skill 是薄编排，**不复制**底层逻辑。公开 catalog 中的硬依赖必须同时可安装：

| 依赖                            | 用途                                 | 公开路径                                |
| ------------------------------- | ------------------------------------ | --------------------------------------- |
| `improve-codebase-architecture` | 扫描 + 候选 HTML 报告                | `skills/improve-codebase-architecture/` |
| `agentic-review-handoff`        | Grok consult 与 review-fix-re-review | `skills/agentic-review-handoff/`        |
| `goal-gate`                     | 有 Fix 时创建/沿用 Goal              | `skills/goal-gate/`                     |

干净环境推荐安装（catalog 完整集合，缺一不可）：

```bash
npx skills add adonis0123/adonis-skills --skill architecture-hardening-loop
npx skills add adonis0123/adonis-skills --skill improve-codebase-architecture
npx skills add adonis0123/adonis-skills --skill agentic-review-handoff
npx skills add adonis0123/adonis-skills --skill goal-gate
```

扫描路径依赖闭包：`improve-codebase-architecture` 的 **Explore + HTML 报告** 阶段自包含，不需要 `codebase-design` / `grilling` / `domain-modeling`。本编排只调用该阶段，并在报告后停止底层 Skill（不进 grilling）。那些 companion skill 仅在有人单独做完整 interactive grilling 时才相关，**不是**本 Skill 的硬依赖。

## 前置检查

开始扫描前：

1. 确认当前目录属于 Git 仓库；记录仓库根与现有工作区状态。
2. 解析三个直接依赖是否可用（读其 `SKILL.md` 路径或已安装 skill 列表）：
   - `improve-codebase-architecture`
   - `agentic-review-handoff`
   - `goal-gate`
3. 任一缺失 → 输出 `MISSING_DEPENDENCIES` 与准确名称，然后停止。不要静默降级，不要复制缺失 Skill 的逻辑，不要把「先装依赖再继续」当作本轮成功结果（可在报告中附上上方安装命令，但仍以 `MISSING_DEPENDENCIES` 结束本轮）。
4. 冻结调用时的范围；后续每轮复用同一范围。
5. 保留用户已有改动；不重置、不覆盖、不整理范围外内容。

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

调用 `improve-codebase-architecture`，**只执行探索 + 候选 HTML 报告**（该阶段零额外 skill 依赖）：

- 把用户范围直接传给扫描器；禁止走“根据 Git 热点推断范围”的默认分支。
- 允许写临时 HTML 报告。
- **停在报告之后**：不进入候选选择、`grilling`、领域文档写入。后续判断由本 Skill 负责。
- 报告里的 `Strong` / `Worth exploring` / `Speculative` 只是候选强度，不是修改命令。
- 若底层 Skill 因缺少 optional companion 而拒绝扫描，视为实现错误：扫描阶段必须自包含。

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
3. 仍无通过门槛的 `Fix` → `NO_ACTIONABLE_FINDINGS`。此时**不创建 Goal**（报告里 `Goal: not-created`），直接出完成报告。

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

仅在**确认至少有一个 `Fix` 要实施**之后调用 `goal-gate`：

- 无活动 Goal 且安全闸门通过 → 创建覆盖本次范围、验证与终态的 Goal
- 已有 Goal → 严格遵循 `goal-gate` 活动 Goal 规则；不嵌套、不静默替换
- Done 条件必须是本 Skill 的 `NO_ACTIONABLE_FINDINGS`，并要求实际测试证据

### 6. 最小修改与验证

只实施已确认的 `Fix`：

- 每一行修改追溯到本轮某个 `Fix`
- 不添加当前问题不需要的扩展点、配置、层级或通用框架
- 行为变化：补或改回归测试；纯结构变化：用现有测试或最小特征测试证明公共行为不变
- 先跑针对性验证，再按影响面跑相关测试 / typecheck / build
- 命令未实际执行 → 写 `UNVERIFIED`，不得宣称通过

### 7. Grok 复审修改

调用 `agentic-review-handoff` 的自动 `run`，Reviewer 固定 **Grok**：

| 结果                                                     | 动作                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `PASS`                                                   | 进入原范围重新扫描                                                              |
| `BLOCKED`                                                | 只修经证据验证的有效发现 → 记 fix completion → 继续复审                         |
| `PASS_WITH_CONCERNS`                                     | 再套证据门槛：仍是 `Fix` 则继续改；其余进 `Backlog`/`Reject` 并写理由后才可接受 |
| `DELIVERY_UNKNOWN` / hash mismatch / deadlock / 预算耗尽 | `HUMAN_GATE`                                                                    |

Reviewer 的风格偏好与无证据建议不构成阻塞。

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
- 底层 review loop 报告 delivery / hash / deadlock / 预算异常

暂停时输出 `HUMAN_GATE`、现有证据、已尝试内容、以及**唯一**需要用户决定的问题。

## 反漂移（常见失败）

| 失败模式               | 正确行为                                 |
| ---------------------- | ---------------------------------------- |
| 把扫描强度当修改优先级 | 只认证据门槛四项                         |
| 范围外“顺手”修         | `Backlog` 或 `HUMAN_GATE`，不改          |
| 依赖缺失仍继续         | `MISSING_DEPENDENCIES` 并停              |
| 为理论优雅重写         | `Reject`/`Backlog`，除非有可复现当前伤害 |
| 未跑命令却写通过       | `UNVERIFIED`                             |
| 报告还有建议就继续轮   | 无 `Fix` 即终态；不必清零报告            |

## 完成报告

```text
Architecture Hardening Result
- Scope: <原始范围>
- Iterations: <完成外层轮数>
- Result: NO_ACTIONABLE_FINDINGS | HUMAN_GATE | MISSING_DEPENDENCIES
- Fixed: <问题、文件与验证>
- Backlog: <真实但当前不处理的问题及理由，或 none>
- Rejected: <无证据或过度设计项及理由，或 none>
- Grok evidence: <consult 与最终 review 结果>
- Verification: <实际命令与结果，或 UNVERIFIED>
- Goal: <completed | active | not-created>
```

只有 `Result: NO_ACTIONABLE_FINDINGS`、必要验证通过、且没有未处理的 `Fix` 时，才能把 Goal 标为 completed。
