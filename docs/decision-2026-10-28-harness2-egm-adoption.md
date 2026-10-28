# 借鉴 Harness² 与 EGM 的设计决策记录

> 状态：accepted（2026-10-28，用户确认“按推荐”，改动后经新旧版盲测）

## 来源

| 来源                                                                       | 链接                                                                                                                                 | 许可       | 读了什么                                                                                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Harness²（Google Research，“recursive agent harnessing in an open world”） | 代码 https://github.com/google-research/harness2 ；论文 https://arxiv.org/abs/2610.14224 （正文 https://arxiv.org/html/2610.14224 ） | Apache-2.0 | 论文 HTML v1（2026-10-09）；代码 `harness2/core/` 下 `recursion.py`、`proposer.py`、`prompts.py`、`tree.py`、`selection.py`、`library.py`、`judge.py`、`ledger.py` |
| Elephant-Goldfish Model（EGM，Google）                                     | https://github.com/google/elephant-goldfish-model                                                                                    | Apache-2.0 | `skills/egm-review`、`skills/egm-drift-report`、`resources/document_standards/re-implementation-standard.md`                                                       |

两个项目都注明“not an officially supported Google product”。

## 背景

- 本仓库的 loop 类 skill（`task-completion-loop`、`architecture-hardening-loop`）每次任务结束后，学到的东西都会丢失，下一次同类任务从头开始。
- skill 优化靠测评通过率，缺少“同一案例上新旧版本行为差在哪”的对照。
- 设计文档的验收只有 added-guarantee 审计，没有检查“照着文档能不能实现”。

## 采纳的理念

以下理念不依赖具体模型或执行器，引文已在原文中核对。

1. **没有标准答案时，用对照执行代替打分。** 原文：“The reference reveals how the harness behaves, not whether its deliverable is correct.”（Harness² 论文）
2. **改动分两类提：通用流程（INV）和领域知识（DOM）。** 代码提示词：“You own procedure, tool use and completion -- not subject matter”，以及 “what a PRACTITIONER knows”（`core/prompts.py`）。论文消融实验去掉这种分工后，两项分数分别下降 2.9 和 3.7。
3. **合并是最后一道关，每个取舍都对应一次观察。** 代码注释：“merging an edit launders it”（`core/prompts.py`）。
4. **跨任务只带走经验，不继承上次的整套 harness；证据不足就不记。** 原文：“When evidence is insufficient, reflection adds no new experience entry.” 代码中，一条经验必须有 cue、lesson、evidence 三项，cue 写成 “SHAPE OF SITUATION”（`core/prompts.py`、`core/library.py`）。
5. **改动只写差异。** 代码注释：“omitted-is-inherited”（`core/tree.py`）。
6. **只加探索预算不一定有效。** 原文：“Increasing test-time exploration alone therefore does not ensure better performance.”
7. **重实现标准（EGM）。** 原文：“A document passes if a competent engineer (or fresh AI session) who is unfamiliar with the codebase can write functionally identical code on the first attempt using _only_ the document”。

## 决策

| Skill                                                               | 改动                                                                                                                       | 对应理念 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| `task-completion-loop`                                              | 新增“跨任务经验”：开始时读取 cue 匹配的条目，结束时最多写一条；cue、lesson、evidence 三项缺一不写；报告新增 `Lessons` 字段 | 4        |
| `architecture-hardening-loop`                                       | 前置检查第 9 步读取经验，作为 scanner 的提示，不作为证据；完成报告前写经验                                                 | 4        |
| `agent-dispatch`                                                    | 多个研究员答同一个设计问题时，一个从流程角度、一个从领域角度回答，brief 其余部分保持一致                                   | 2        |
| `decision-first-technical-writing`                                  | 新文档或大改的文档，派全新 subagent 做重实现测试，列出实现时必须靠猜的地方                                                 | 7        |
| `dev-environment-roi-audit`（私有源导出，本仓库副本随下次导出更新） | 新增 Rewrite 决策：出流程版和领域版两个变体，与原文在同一批 prompt 上对照，按观察到的行为差异决定是否采纳                  | 1、2、5  |

经验目录：`${AGENT_LESSONS_DIR:-$HOME/.local/state/agent-lessons}/<skill>/`。它放在 skill 目录外，有两个原因：安装器更新 skill 时会覆盖 skill 目录；本仓库是公开仓库，经验不应进入仓库。

## 不采纳

- **`agentic-review-handoff` 的“合并要对应观察”规则（理念 3）**：加上后盲测新旧版都是 4/4，现有的 `Preference` 和 open 规则已覆盖这个场景。按理念 1，看不出行为差异就保留原文，因此撤回。
- **测评加匿名盲选**：skill-creator 已有 `agents/comparator.md`，不重复做。
- **整套安装 Harness² 或 EGM**：Harness² 要求 Linux 和 Vertex AI，执行器网络不受限，Codex 运行时关闭沙箱；EGM 的 brainstorm、draft 和代码审查与现有 `grilling`、`decision-first-technical-writing`、`agentic-review-handoff` 重叠。

## 验证

- `pnpm skills:validate` 通过；改动的 skill 跑 `quick_validate.py` 均为 valid。`agent-dispatch` 报 description 含中文，这是改动前就有的问题，本次没有改 description。
- `agent-dispatch` 的 6 个测试文件全部通过。
- 盲测：新版取工作区，旧版取 `HEAD`，随机标成 A/B，由独立 subagent 作答，再由另一个盲评 subagent 按断言评分。

| Skill                              | 新版 | 旧版          |
| ---------------------------------- | ---- | ------------- |
| `task-completion-loop`             | 6/6  | 1/6           |
| `architecture-hardening-loop`      | 5/5  | 2/5           |
| `decision-first-technical-writing` | 4/4  | 1/4           |
| `agent-dispatch`                   | 5/5  | 4/5           |
| `agentic-review-handoff`           | 4/4  | 4/4（已撤回） |

局限：每个 skill 只有 1 条用例，只跑 1 次，而且用例由改规则的人自己写。分数只说明新规则会被读到并执行，不能证明真实任务效果变好。

## 后续

- 真实任务中检查 `Lessons` 字段：写出的经验是否有用，下次读取后是否改变了做法。效果不对时，再对那个 skill 跑完整 skill-creator 流程。
- Harness² 论文承认的待解问题同样适用于本仓库：经验库会膨胀、旧经验会过时，需要合并和修订机制。条目积累多了以后再设计。
