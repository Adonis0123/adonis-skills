---
name: discuss-before-plan
description: "Enforces 'decide then plan' discipline - the pre-planning decision gate. Use when the user asks for a plan or starts a change while key decisions are unresolved: architecture tradeoffs, data flow, public interfaces, unclear requirements, multi-module scope, or roughly 5+ files affected. Also triggers when the user explicitly wants to discuss, compare options, or review architecture before committing. Core job: reduce incorrect-execution cost by confirming decisions before producing executable plans."
metadata:
  author: adonis
  version: "2.1.0"
---

# Discuss Before Plan

The most common reason plans fail is not poor execution — it's starting to write steps before decisions are aligned. This skill enforces three stages: clarify first (Deliberation), lock decisions down (Commitment), then write the executable plan (Planning). No plan until facts are verified, options compared, and decisions confirmed.

<HARD-GATE>
- All blocking decisions must be confirmed by the user before entering Plan Mode, outputting execution steps, or starting implementation.
- If a new decision point surfaces while writing a Plan, stop immediately and return to Deliberation.
- Before transitioning to Plan, output a Decision Summary and explicitly ask whether to persist it as a document.
</HARD-GATE>

## Glossary

These terms have precise meanings in this skill. Use them consistently — do not interchange.

| Term | Definition | When it appears |
|------|-----------|-----------------|
| **Decision Summary** | Structured table of confirmed decisions produced during conversation. Lives in chat, not on disk. | End of Deliberation (Phase 3) |
| **Spec / Decision Record** | Persisted document capturing what was decided and why. Survives across sessions. | Commitment stage (Phase 4) |
| **Implementation Plan** | Task-by-task execution steps that reference confirmed decisions. Contains only how/when, never new what/why. | Planning stage (Phase 5) |

## 触发判定

满足任一强信号，或同时满足两个以上弱信号时使用。

**强信号**（任一即触发）:

| 信号 | 示例 |
|------|------|
| 存在 2+ 可行方案 | "缓存用 Redis、内存还是 CDN？" |
| 涉及架构/数据流/接口/发布决策 | "把轮询改成实时推送" |
| 影响多模块或 ~5+ 文件 | 路由、服务、类型、测试、前端联动 |
| 用户明确要求先讨论/对比/评审 | "先把方案聊清楚再做" |

**弱信号**（2+ 同时出现即触发）:

| 信号 | 示例 |
|------|------|
| 需求有歧义 | "让它更快一点" |
| 用户要 plan 但问题未收敛 | "给我一个实现计划" |
| 选择显著影响成本/风险/可维护性 | 单体 vs 拆服务、同步 vs 异步 |

**应跳过**:

| 信号 | 示例 |
|------|------|
| 纯执行 | 跑测试、格式化、改文案 |
| 需求明确无歧义 | 指定文件、指定行为 |
| 低风险单文件改动 | 改 typo、改常量 |
| 用户说直接做且无阻塞决策 | "按这个接口实现" |

## 模式选择

开始前先判断走哪个模式：

- **标准模式**: 方案 ≥3 或影响 ≥5 文件或有架构级影响。Phase 1→5 完整走，每轮只收敛一个决策点。
- **轻量模式**: 方案 ≤2 且影响 ≤3 文件且无架构影响。Phase 1-3 压缩为 1-2 轮，但仍须列决策记录、仍须问落盘。
- **用户坚持跳过**: 2-4 句说明未决策项和风险 → 追问一个最关键问题 → 用户仍坚持则记录"按用户指定继续"后进入 Plan。

---

## 阶段一：讨论 (Deliberation)

从「不清楚」到「已确认」。三个 Phase 逐步收敛。

### Phase 1: 摸底

读代码、配置、文档，输出你的理解。**严格区分三类信息**：

- **已确认事实** — 在代码/文档中亲眼看到的
- **当前假设** — 推断但未验证的
- **待确认问题** — 需要用户输入的

列出所有需要拍板的决策点，然后只问一个——当前最影响后续方案选择的那个。没有用户确认前，不进入方案推荐。

> "这是我对现状的理解：[摘要]。如果有偏差先纠正我。现在最需要先定的是：[单个问题]。"

### Phase 2: 讨论

围绕单个决策点，先亮推荐再展开替代。每轮结构：

1. **推荐 + 理由**: "我倾向于 A，因为 [理由]"
2. **替代方案 + 取舍**: B 的优势是 X，代价是 Y
3. **影响面**: 实现复杂度、受影响模块、测试成本、回滚难度
4. **YAGNI 挑战**: 对过度设计主动质疑，明确什么现在不做
5. **收尾问题**: "这一步你确认选 A 吗？"

如果某方案有致命缺陷，直接指出。不为"中立"隐藏判断。

> "这个方案最大的风险不是复杂度，而是 [具体失败场景]。"

### Phase 3: 决策

把讨论结果压缩为结构化记录。这是讨论阶段中第一次输出正式表格——之前都用自然对话。

**决策记录格式**:

| # | 决策问题 | 确认选择 | 理由 | 放弃的替代方案 |
|---|---------|---------|------|----------------|
| 1 | [问题] | [选择] | [理由] | [替代方案] |

**非目标**: 当前明确不做的事项。

**待定事项**: 未确认的内容——不要混进已确认列。用户没有明确 confirm 的项不计入决策记录。

逐条和用户确认。

> "下面是已确认项；如果有哪条还没拍板，直接指出。"

---

## 阶段二：落盘 (Commitment)

在进入 Plan 前，把决策固化下来。**本阶段必须完成后，才进入阶段三。**

1. 输出 **Decision Summary**：已确认决策、实施范围、非目标、风险与对策、待定事项。
2. 如果待定项会阻塞 Plan，明确说"建议先解决 X 再继续"。
3. **显式询问是否保存为 Spec/Decision Record**：用能直接回答"要/不要"的问句。标准模式默认建议保存；轻量模式也必须问。
4. **等用户回复后才继续**。用户没回答保存问题就聊别的，追问一次。
5. 若保存：resolve documentation profile（见 `references/doc-conventions.md`），按 resolved profile 写入。
6. 若不保存：记录"未落盘，按当前 Decision Summary 继续"。

> "要不要我把这份决策保存成文档？要的话我建议放到 [resolved path]；不要就直接拆 plan。"

---

## 阶段三：计划 (Planning)

只有落盘问题解决后才进入。

1. 询问用户是否进入 Plan；确认后再开始。
2. Implementation Plan 拆成可执行任务，每个任务包含受影响文件、checkbox 步骤、验证条件。
3. Plan 只引用已确认的 Decision Summary / Spec，**不在 task steps 里新增方案选择**。
4. 写 Plan 时发现新决策点——停下来，告诉用户，回到阶段一。
5. 若保存 Plan 文档，resolve documentation profile（见 `references/doc-conventions.md`）后写入。

---

## 收敛信号

以下信号表明讨论可以转入 Commitment：

1. **无阻塞待定项**：待定项已清空或降级为不阻塞
2. **收敛趋势**：最近 1-2 轮没有新增关键决策点
3. **关键类别已覆盖**：范围、方案、约束、接口、风险
4. **用户主动说**："可以了" / "开始 plan"

不需要全部满足。但若仍有关键风险，转入前先简短提醒。

---

## 核心原则

| 原则 | 背后的原因 |
|------|-----------|
| 事实、假设、确认分开写 | 把推测当事实，Plan 就建在沙子上 |
| 每轮只推进一个决策点 | 多个问题 → 用户只答最简单的，关键问题被跳过 |
| 先推荐，再列替代 | 中立信息堆砌把决策负担全推给用户 |
| YAGNI 优先 | 用户提的不一定都要做；主动问"这个现在真的需要吗？" |
| 风险要具体 | "可能有问题"没用；"当 X 发生时 Y 会挂"有用 |
| 用户拍板，AI 建议 | 提供分析和推荐，但不替用户确认决策 |
| 文档分层 | spec 记录 what/why，plan 记录 how/when — 不要混 |

## 反模式

| 反模式 | 为什么有害 | 正确做法 |
|--------|----------|---------|
| 跳过讨论直接 Plan | 步骤做到一半方向错，返工成本高 | 走完讨论再 Plan |
| 一轮多个问题 | 用户答最简单的，关键问题悬而未决 | 每轮一个决策点 |
| 讨论阶段过度形式化 | 每轮输出表格，对话变笨重 | 自然对话，Phase 3 才出表格 |
| 摘要夹带未确认内容 | 建议被当成决定，执行基于假共识 | 只放用户明确 confirm 的 |
| 跳过落盘询问 | 决策没记录 = 下次对话重来 | 轻量模式也要问一句 |
| Plan 里新增决策 | 半讨论半计划，两头都不好 | 停 Plan，回讨论 |

## 常见的跳过理由

| 你可能想 | 实际情况 |
|---------|---------|
| "需求很清楚，不用讨论" | 你认为清楚 ≠ 用户认为清楚。摸底 2 分钟，返工 2 小时。 |
| "用户要 plan，给他 plan" | 未收敛的 plan 做到一半方向不对更浪费。 |
| "先做一版再迭代" | 关键决策没对齐的实现是赌博，不是迭代。 |
| "讨论差不多了，落盘跳过吧" | 不落盘的决策 = 没有决策。 |
