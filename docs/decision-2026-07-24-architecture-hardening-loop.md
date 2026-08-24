# architecture-hardening-loop Skill 决策记录

> 创建一个通用的架构加固编排 Skill：在用户指定范围内，筛选真实问题，完成最小修改与验证，直到没有可执行问题。

## 目标

- 串联 `improve-codebase-architecture`、`agentic-review-handoff` 和 `goal-gate`。
- 由 Codex 负责编排、修改、测试和 Goal，由 Grok 提供独立评审。
- 只修复有证据、有收益且可验证的架构问题。
- 用固定闭环减少人工重复指挥，同时保留必要的 Human Gate。

## 已确认决策

| #   | 决策问题     | 确认选择                                                                                                                                                                         | 理由                                                                     |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Skill 名称   | `architecture-hardening-loop`                                                                                                                                                    | 表达架构扫描、加固和复审闭环，不绑定具体业务                             |
| 2   | 适用范围     | 通用 Skill；每次调用必须明确指定审查范围                                                                                                                                         | 防止默认扫描全仓库或自行扩大范围                                         |
| 3   | 主编排者     | Codex                                                                                                                                                                            | 统一持有 Goal、实施修改并验证结果                                        |
| 4   | 独立评审者   | Grok                                                                                                                                                                             | 保留独立视角，避免编排者自证正确                                         |
| 5   | 主流程       | 扫描 → 证据筛选 →（有 Fix）Grok consult → Goal Gate → 最小修改与测试 → Grok review → 再扫描；（零 Fix）终态 consult → 完成                                                       | 判断、实施和独立复审串成可验证闭环；无 Fix 不空转                        |
| 6   | 发现分类     | `Architecture Fix`、`Local Fix`、`Backlog`、`Reject`                                                                                                                             | 扫描结果是候选项，不是修改命令                                           |
| 7   | 修改门槛     | 真实、范围内、有证据、高收益、可验证                                                                                                                                             | 防止过度设计和为了修改而修改                                             |
| 8   | 完成标准     | `NO_ACTIONABLE_FINDINGS`                                                                                                                                                         | 终点是没有值得立即处理的问题，不是理论完美                               |
| 9   | 自主权限     | 调用即授权 Codex 与 Grok 在指定范围内判断和修复                                                                                                                                  | 减少普通审查轮次中的人工确认                                             |
| 10  | Human Gate   | 仅在破坏性操作、外部副作用、范围冲突、无法验证、死锁或预算耗尽时暂停                                                                                                             | 普通工程判断自动闭环，高风险事项仍由用户控制                             |
| 11  | 依赖策略     | 三个硬依赖只检查**本机**是否可解析；缺失时列明并停止。扫描器来自上游（如 mattpocock），不强制进本仓 catalog                                                                      | 保持薄编排，不 vendor 他人 skill；不静默降级                             |
| 12  | 实现形式     | 以精简 `SKILL.md` 为主；只在测试证明有必要时增加资源或脚本                                                                                                                       | 避免为一次编排增加无收益抽象                                             |
| 13  | 验收方式     | 至少运行 3 个真实场景，并与旧版或不使用 Skill 的基线对比                                                                                                                         | 验证范围约束、反过度设计判断和依赖失败行为                               |
| 14  | Goal 时机    | **仅在确认至少有一个 `Fix` 要实施后** 才创建新 Goal；零 Fix 不新建，但已有同目标或更宽 Goal 仍按 ownership contract 收口                                                         | 避免无行动项新建 Goal，同时不破坏父级完成权                              |
| 15  | 候选准入     | 架构候选同时通过当前伤害、真实复杂度/变化、删除测试、ADR 允许、复杂度净下降五项；缺一即 `Backlog` / `Reject`                                                                     | 防止把代码形状和未来可能性误当成当前架构问题                             |
| 16  | 修复分流     | 分开报告 `Architecture Fix` 与 `Local Fix`；普通正确性 bug 留在现有 Implementation，不借机增加 Module / Interface                                                                | 修 bug 不等于证明需要新架构                                              |
| 17  | 候选去重     | 用失败不变量/传播成本 + owner + 拟议 Seam 或最小修正形成 fingerprint，并记录 disposition 与重考虑触发器                                                                          | scanner 改名或换切入点不能重启已判定候选                                 |
| 18  | 停止边界     | `0` 个架构深化候选有效；零 Fix 经终态 consult 与 evidence freshness 后立即停止，不再追加确认性扫描                                                                               | 避免开放式扫描变成无穷“再看一轮”                                         |
| 19  | 嵌套调用授权 | 点名本 Loop（或 workflow-gate 将其设为 Runtime skill）即授权声明硬依赖按其用途嵌套调用；`disable-model-invocation` / `allow_implicit_invocation: false` 不要求用户再点名 scanner | 扫描器是命令型 skill，防止孤立自动触发，不是给已授权父编排再加一道确认门 |

## 流程

```text
明确审查范围
  → improve-codebase-architecture 扫描（仅报告）
  → 将候选项分为 Architecture Fix / Local Fix / Backlog / Reject
  → 零 Fix？
       → Grok consult 复核终态分类
       → NO_ACTIONABLE_FINDINGS（不创建新 Goal；已有 Goal 按 ownership contract 收口）
  → 有 Fix？
       → agentic-review-handoff consult（Grok）
       → goal-gate：创建或沿用 Goal（Done = NO_ACTIONABLE_FINDINGS + 实测）
       → 只实施 Fix，并运行针对性测试
       → agentic-review-handoff run（Grok 复审）
       → 对原范围重新扫描
       → 有 Fix 则下一轮；无 Fix 则终态 consult → NO_ACTIONABLE_FINDINGS（Goal: completed）
```

新一轮扫描发现候选项时，仍须重新通过修改门槛。报告中持续出现建议，不等于必须继续修改。

同一建议若仅换标题、类比或文件切入点，先按 Candidate Ledger fingerprint 去重；没有新证据或重考虑触发器时不重开。若 scanner 发现的是可复现局部 bug，允许作为 `Local Fix` 最小修复，但不得把它升级成 Provider、cache、registry、bus 或其它新架构。

## 非目标

- 不追求理论上的完美架构。
- 不因为报告出现建议就自动修改。
- 不把风格偏好、推测性扩展或低收益优化当作完成阻塞项。
- 不默认扫描整个仓库，也不在执行中自行扩大用户指定范围。
- 不替代或复制三个底层 Skill 的职责。
- 不把 `PASS_WITH_CONCERNS` 无条件视为完成。
- 不为零 Fix 场景新建 Goal。

## 风险与对策

| 风险                                   | 对策                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| 扫描器每轮都能提出新建议，形成无限循环 | 只处理通过修改门槛的 `Fix`；以 `NO_ACTIONABLE_FINDINGS` 结束                         |
| scanner 换措辞后重报同一候选           | Candidate Ledger 按 fingerprint 去重；无新证据不重开                                 |
| 局部 bug 被包装成架构深化              | 单独归类 `Local Fix`，保持现有 Interface，只在 Implementation 内修                   |
| 活跃迁移制造大量结构噪声               | 变更条目数、重命名和移动只作背景；没有当前失败或传播成本就不作为 `Fix` 证据          |
| 审查范围逐轮扩大                       | 每轮沿用调用时的显式范围；超出范围的发现进入 `Backlog` 或 Human Gate                 |
| Codex 同时实施和判断，形成自证         | 修改前和修改后都由 Grok 独立评审                                                     |
| 为了统一流程复制底层 Skill 逻辑        | 新 Skill 只描述编排、输入、分类标准和终止条件                                        |
| 依赖缺失后行为不一致                   | Fail closed：输出准确缺失列表并停止                                                  |
| 只装本 Skill 时缺本机硬依赖            | 前置检查本机 skill 列表；`MISSING_DEPENDENCIES`；安装提示分来源（扫描器上游 / 本仓） |
| 测试只验证文字，不验证行为             | 用至少 3 个场景比较新版与旧版或无 Skill 的完整输出和关键断言                         |

## 验收标准

1. 未提供明确范围时，Skill 停止并要求补充范围。
2. Skill 不访问或修改范围外文件。
3. 每个修改项都包含代码证据、实际收益和验证方法。
4. 推测性、纯风格或低收益建议被归入 `Backlog` 或 `Reject`。
5. 依赖缺失时列出准确名称，不静默降级。
6. 依赖齐全且存在 `Fix` 时：按既定顺序 Grok consult → Goal Gate → 修改 → 测试 → Grok review → 复扫。
7. 依赖齐全但零 `Fix` 时：终态 consult 后 `NO_ACTIONABLE_FINDINGS`，且不创建新 Goal；已有同目标或更宽 Goal 按 ownership contract 完成或保留 active checkpoint。
8. 只有 `NO_ACTIONABLE_FINDINGS` 且（若曾创建 Goal）验证通过时，才完成 Goal。
9. 本机三个硬依赖可解析即可启动；不要求扫描器发布在本仓 catalog。用户只点名本 Loop 且 scanner 可加载时，不因 `disable-model-invocation` 或未点名 scanner 而返回 `MISSING_DEPENDENCIES`。
10. 与无 Skill 基线相比，使用 Skill 的结果更稳定地满足上述约束。
11. 架构候选逐项通过五项准入；普通 bug 归入 `Local Fix`，不会触发新架构。
12. 同一候选换措辞后仍复用 ledger disposition；只有记录的重考虑触发器满足才重开。
13. 首轮或复扫零 Fix 经 consult 与 evidence freshness 后立即停止，允许报告零架构候选。
