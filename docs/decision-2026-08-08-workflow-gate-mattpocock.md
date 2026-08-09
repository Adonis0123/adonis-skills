# workflow-gate × mattpocock 接入决策记录

> 在已删除全局 `brainstorming` 的前提下，按真实高频 job 重编排 `workflow-gate`：接入 mattpocock 的加压/架构能力，保留 obra 的调试与 TDD，不复活已否决的创意仪式。

## 背景

- `workflow-gate` 原默认：Brainstorm → `brainstorming`（obra）、Discuss → `discuss-before-plan`、Plan → `writing-plans`、Light → `systematic-debugging` / TDD、Review → `agentic-review-handoff`。
- 全局运行时已删除 `brainstorming`；gate 仍指向它，会触发 Resolution-failure 降级。
- 用量（`~/.agents/tools/skills-manager/stats-cache.json`，2026-08-08）：mattpocock 的 `grill-with-docs` / `improve-codebase-architecture` / `grilling` / `domain-modeling` / `codebase-design` 近几日活跃；本仓 `architecture-hardening-loop` 高用量但无 gate Route；obra 的 `systematic-debugging` / TDD 仍热，`brainstorming` / `writing-plans` 偏冷。
- 第一性原理与 Claude Code 顾问意见一致：gate 是分诊器，应按可观测工作种类路由，不是品牌选择器；缺的是 job 格子，不是「默认选错」。

## 目标

- 让 `workflow-gate` 与日常真实工具链一致（Claude / Grok / Codex 共用）。
- 不装回 `brainstorming`；创意无 spec 入口改接 Challenge（grilling 系）。
- 少增 Route：正式补 Architecture（诊断 / 闭环两段）；Design 不作一等 Route。
- 保留 Discuss、Light(debug/TDD)、Review-Handoff 等仍不可替代的路径。

## 非目标

- 装回或继续依赖 `brainstorming`。
- 整族用 mattpocock 替换 obra（尤其 debug / TDD）。
- `to-spec` 作为默认 Plan。
- 接入 addyosmani 命名空间为 Runtime skill。
- 用量自动调权、A/B、复杂 fallback 链。
- 给每个 matt skill 单独一格。
- 本轮顺手做全量 skill 清理或镜像全同步。

## 已确认决策

| #   | 决策问题                                        | 确认选择                                                                                                                                                                                           | 理由                                                    |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | 调整主目标                                      | 按 **job 缺口** 接入 mattpocock，不是整族换品牌                                                                                                                                                    | 用量显示缺格子；用户绕过 gate 直接点名                  |
| 2   | 实现形态                                        | **少增 Route（A1）**                                                                                                                                                                               | 控制 gate 可判定性，避免 Route 语义爆炸                 |
| 3   | `brainstorming`                                 | **不装回**；从运行时默认链路移除                                                                                                                                                                   | 主动删除；再装回等于恢复被否决仪式                      |
| 4   | 原 Brainstorm / 创意无 spec                     | 改接 **Challenge**：默认 `grilling`；要 ADR/glossary 时用 `grill-with-docs`                                                                                                                        | 先薄主张再压测；与 brainstorming 方向相反但匹配真实入口 |
| 5   | Architecture                                    | **新增一等 Route**，两段：scope 未明或只诊断 → `improve-codebase-architecture`；scope 已明且要落地 → `architecture-hardening-loop`                                                                 | hardening 用量高且与现有 Route 最少重叠；直连闭环风险大 |
| 6   | Design（`codebase-design` / `domain-modeling`） | **不做一等 Route**；作 Architecture/Challenge 子步或用户点名                                                                                                                                       | YAGNI；避免与 Challenge/Discuss 抢语义                  |
| 7   | 保留不动                                        | `discuss-before-plan`；Light 的 `systematic-debugging` / `test-driven-development`；`agentic-review-handoff`；下游 `goal-gate`                                                                     | 仍高频且不可替代                                        |
| 8   | Challenge 薄主张（O3）                          | **S1**：允许 agent 写短 strawman，但必须用户确认后再进入 `grilling` / `grill-with-docs`；输出合同增加 `Thesis: user-provided \| agent-strawman`                                                    | 三方顾问与主持人均推荐；避免自产自压；保留创意保护      |
| 9   | Plan 默认 Runtime（O1）                         | 仍默认 `writing-plans`；仅在已有稳定 spec/RFC 且明确要拆任务时触发                                                                                                                                 | 三方一致；冷用量 ≠ 应替换；`to-spec` 仍为非目标         |
| 10  | Route 命名（O2）                                | 输出合同使用新名 **`Challenge`**，不与 `Brainstorm` 双名并存；旧名最多作短期输入兼容别名并标注 deprecate                                                                                           | 三方一致；双名破坏可判定性与 eval 对齐                  |
| 11  | 同步改动范围（O6）                              | **必须**：`skills/workflow-gate/**` + 安装副本；**轻量同步**：`goal-gate` 文案/Route 信号；**不同步**：discuss-before-plan、hardening/completion loop 协议、第三方 matt skills、writing-plans 本体 | 断链/假绿必须修；下游执行器与上游 skill 本轮 YAGNI      |

## 目标路由表（决策意图）

| Route          | 触发状态（机械信号）                              | Runtime skill                                                                  |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Direct / Light | 读写/小改/症状/船运检查（既有规则）               | `none` / `systematic-debugging` / `test-driven-development`                    |
| Challenge      | 创意或设计加压：已有或可生成薄主张；无已定稿 spec | `grilling`；需要文档沉淀 → `grill-with-docs`                                   |
| Discuss        | 命名选项存在，瓶颈是收敛拍板；或破坏性难回滚      | `discuss-before-plan`                                                          |
| Architecture   | 既有代码结构痛                                    | 诊断：`improve-codebase-architecture`；落地闭环：`architecture-hardening-loop` |
| Plan           | 已有 spec/RFC，要任务拆解                         | 仍 `writing-plans`（决策 #9）                                                  |
| Review-Handoff | 跨代理 / fix-then-re-review                       | `agentic-review-handoff`                                                       |

互斥信号（防 gate 不可判定）：

- 无主张且需打开空间 → 先生成薄 strawman，再进 Challenge（不复活 brainstorming）
- 有主张要打 → Challenge
- 多选项要收敛 → Discuss
- Architecture 与 Review/Debug 不互相吞并：有症状优先 Debug；有 diff 复审优先 Review-Handoff

## 风险与对策

| 风险                                            | 对策                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Challenge / Discuss 语义重叠，gate 自身不可判定 | 互斥机械信号；输出合同写清判据；evals 覆盖边界用例                             |
| Architecture 直连 hardening 误触发重闭环        | 两段门槛：缺 scope 或仅诊断不进 loop                                           |
| 删除 Brainstorm 标签破坏旧 eval / 调用习惯      | 实现时明确：新 Route 名 `Challenge` 替换 `Brainstorm`，并同步 evals/references |
| 依赖 skill 本机缺失                             | 沿用 Resolution-failure：报缺失并降级到最小安全 Route，不代装                  |

## 待定事项

| #   | 事项                                                          | 状态                         | 说明                                                            |
| --- | ------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| O1  | Plan 是否仍默认 `writing-plans`                               | **已确认：保持**             | 见决策 #9                                                       |
| O2  | 输出合同用新名 `Challenge` 还是保留 `Brainstorm` 只换 Runtime | **已确认：新名 `Challenge`** | 见决策 #10                                                      |
| O3  | Challenge 入口的「薄主张」归属与确认门槛                      | **已确认 S1**                | 见决策 #8                                                       |
| O4  | 本仓 `.agents/skills/brainstorming` 副本去留                  | **已执行：删除**             | 项目镜像与 `.claude/skills` 下均已不存在；避免假绿              |
| O5  | Grok 顾问意见                                                 | 已送达（grok002）            | 默认 `grok` home 403；经 `GROK_HOME=~/.grok-002`（grok002）送达 |
| O6  | 同步改动的相关 skill 范围                                     | **已确认**                   | 见决策 #11                                                      |

## 相关 skill 同步范围（调研结论，待确认）

### 同变更集必须改（否则断链 / 假绿）

| 工件                                                    | 原因                                                    |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `skills/workflow-gate/**`（SKILL + references + evals） | Route/Runtime/Thesis/Architecture 的主改面              |
| 安装到 `~/.agents/skills/workflow-gate`（及项目镜像）   | 日常 Claude/Grok/Codex 读的是安装副本，不是只改 catalog |

### 建议同变更集轻量同步

| 工件                                        | 改什么                                                                                                                            | 不改什么                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `skills/goal-gate/SKILL.md`（及已安装副本） | 把 defer/safety 文案里的 `brainstorming` 改为 `grilling` / Challenge；消费 `Route: Challenge` / `Architecture` 作为 goal-fit 信号 | 不改 goal 决策语义、不强制依赖 workflow-gate |
| `skills/goal-gate/references/examples.md`   | 若有 `Route: Brainstorm` / `Full` 示例，对齐新枚举                                                                                | 不扩 scope 重写整个 goal-gate                |

### 本轮明确不同步（YAGNI）

| 工件                                                                       | 理由                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `discuss-before-plan`                                                      | 无 brainstorming 耦合；Discuss 职责不变                       |
| `architecture-hardening-loop` / `task-completion-loop`                     | 已是下游执行器；gate 只负责路由到它们，协议本身不用为改名重写 |
| `grilling` / `grill-with-docs` / `improve-codebase-architecture`（第三方） | 不 fork 上游；gate 适配调用约定即可                           |
| `writing-plans`                                                            | O1 若保持默认，本轮只消费不改造                               |
| 仓库内 `.agents/skills/brainstorming`                                      | 属 O4 去留决策，可同 PR 删除，但不是改 grilling 逻辑          |

### 可选后续（不阻塞本轮）

- 若 eval 证明 Challenge×Discuss 边界不稳，再补轻量 Ideation Route（三方改立场条件之一）。
- `to-spec` 替换 Plan：非目标，另开决策。

## 顾问意见区

> DecisionConsult（advisory）。完整原文：
>
> - Claude: `.review-handoff/runtime/consults/2026-08-08T09-47-08-409Z-claude.md`
> - Codex: `.review-handoff/runtime/consults/2026-08-08T09-46-06-826Z-codex.md`
> - Grok（grok002）: `.review-handoff/runtime/consults/2026-08-08T09-49-32-301Z-grok.md`
>
> **实现门槛**：三方「有条件同意」的条件（O1/O2/O3/O6）已由用户于 2026-08-08 确认。进入 Plan / 改代码前仍须用户明确同意开始 Plan。

### 三方共识摘要

| 议题                    | Claude                                            | Codex                              | Grok(grok002)                         |
| ----------------------- | ------------------------------------------------- | ---------------------------------- | ------------------------------------- |
| 总体方向                | 有条件同意                                        | 有条件同意                         | 有条件同意                            |
| O1 Plan=`writing-plans` | 保持                                              | 保持                               | 保持                                  |
| O2 Route 名=`Challenge` | 新名，不双名                                      | 新名；旧名最多短期输入别名         | 新名；旧名最多 deprecate 别名         |
| O3 薄主张               | **阻塞**：须归属字段；agent-strawman 先确认再压测 | **阻塞**：写死生成者/字段/退出条件 | **阻塞**：同 Claude；用户确认后再压测 |
| hardening 第二门槛      | scope=用户路径/模块名                             | scope + 明确实施/闭环意图          | 同 Codex                              |
| 本仓 brainstorming 副本 | 验收假绿风险，须断解析                            | （未单列，方向一致）               | O4：实现期必须断解析                  |

### Claude — 有条件同意

- 方向对：按 job 分诊、Architecture 两段、少增 Route。
- **阻塞漏洞**：薄主张无归属。建议 `Thesis: user-provided | agent-strawman`，且 `agent-strawman` 必须先与用户确认再压测。
- 另：本仓 brainstorming 副本假绿；description / resolution 表 / eval 声称需同源更新；Architecture scope 收紧为用户路径/模块名。

### Codex — 有条件同意

- 方向对：job 分流、Challenge 名实相符、Architecture 两段降误触发。
- **必须修**：strawman 规则；hardening 需「实施/闭环」意图；Challenge/Discuss/Architecture 冲突优先级与边界 eval。
- O1 保持 `writing-plans`；O2 输出用 `Challenge`。

### Grok（grok002）— 有条件同意

- 方向对：分诊对齐可观测 job；Challenge 名实更合；Architecture 两段 + Design 非一等。
- **O3 阻塞**：agent 自产自压 = 自评；须写死 Thesis 字段且 agent-strawman 经用户确认后再压测。
- hardening 第二门槛；O4 断本仓 brainstorming 解析；O1/O2 与 Claude/Codex 同向。

## 验收结果（2026-08-08 实现）

- [x] gate 不再默认加载 `brainstorming`（仅 deprecate 输入别名 → Challenge）。
- [x] 创意无 spec → Challenge + `grilling` / Thesis S1。
- [x] Architecture 两段：诊断 → `improve-codebase-architecture`；落地 → `architecture-hardening-loop`。
- [x] Discuss / Light debug / typo 回归在 skill-creator 基线上仍正确。
- [x] `goal-gate` 文案改为 grilling / Challenge / Architecture。
- [x] 项目 `.agents/skills/brainstorming` 已删；catalog + 项目镜像 + `~/.agents/skills` 已同步 v3。
- [x] skill-creator iteration-1：`with_skill` mean pass **1.00** vs `old_skill` **0.44**（+0.56）。
  - Workspace: `skills/workflow-gate-workspace/iteration-1/`
  - Benchmark: `skills/workflow-gate-workspace/iteration-1/benchmark.md`
  - Viewer: http://localhost:3117 ；静态页 `skills/workflow-gate-workspace/iteration-1/review.html`
- [ ] description 触发率 `run_loop` 优化：路由已稳定，可作为后续可选；本轮已在 SKILL frontmatter 重写 description，未再跑 expensive trigger loop。
