# Review Loop v2.1 · 文档消重与触发面硬化 — 任务分解与验收标准

> 状态：**已定稿，待实现**（2026-07-22 三席共审定案）。
> 分工：**Claude 规划（本文档）→ Grok 实现 → Codex 审查**。
> 决策链：Claude 提案 → Codex consult 收窄（否决 packet-tool 三子命令 / 失败模式 reference / 行数硬指标）→ Grok 第三席补盲区（触发面 + 可观测性）→ 用户拍板（含：token 用量记录暂不做）。
> Consult 记录：`.review-handoff/runtime/consults/2026-07-22T08-31-*-codex.md`、`2026-07-22T08-42-*-grok.md`。

## 0. 一句话目标

经典单 session 路径是 Incident A 唯一还活着的宿主（模型手写 packet、零脚本保证）。本轮**不建新机制**，只做三件小事：把它从默认入口降级为显式兼容路径（触发面同步改写，防"虚构降级"）、给它装上可观测标记（让观察窗真能采数）、并消灭 SKILL.md 与 references 的重复真相源。

## 1. 硬边界（先读）

- **只改文档与 frontmatter 类文本**：`skills/agentic-review-handoff/SKILL.md`、`references/**`、`evals/**`（如触发评测需要）。**禁止改 `scripts/**`\*\*。
- **评测道具只许放 /tmp，禁止 commit 任何仓库文件当道具**（上一轮的 LoginForm 事故教训）。
- 触发评测前必须先 `pnpm skills:install:local -- --skill agentic-review-handoff` 同步运行时镜像——`claude -p` 读的是镜像不是源（已实测踩坑）。
- 不做：packet-tool CLI、失败模式独立 reference、行数硬指标、最小加载集声明、自检 checklist、token 用量记录（用户明示暂不考虑）。这些全在 §5 backlog，别复活。

## 2. T1 · SKILL.md 受控消重（Codex 收窄版 B）

**动作**：

1. 把 SKILL.md 的 **Lifecycle and Archive 两张表、Stage Defaults 表、Mixed-stage 规则、packet 寻址算法步骤（Workflow §2 的 0–4 步）** 迁入 references——目标文件按就近原则：寻址与 lifecycle → `packet-addressing.md`，stage 语义 → `packet-anatomy.md` 或 `review-contract.md`。
2. **合并而非复制**：`packet-addressing.md` 现有 "Re-stated from SKILL.md for completeness" 的复述段落与迁入内容合并为唯一真相源；迁完后同一规则在全仓只允许出现一处，其他位置只放指针。
3. SKILL.md 主体保留：触发路由（Fast Path）、角色边界（Read-only Boundary）、**三条不可破坏不变量** + 各配一句**事故背书的违反后果**：
   - 绝对路径（违反 → monorepo 子目录会创建第二个 inbox / 找错 packet）；
   - 禁止伪造 `# Review Handoff`（违反 → 证据信任边界破坏，re-reviewer 无法独立复核）；
   - H1 只 EOF 追加 + frontmatter 原子改写（违反 → 物理末尾与 `last_anchor` 分裂，packet 作废，即 Incident A）。
4. 不设行数指标；验收看行为不看排版。

**验收**：

- 任一条协议规则（寻址步骤 / lifecycle 表 / stage 默认）在全仓 grep 只出现一处正文 + 若干指针；
- SKILL.md 主体不再含完整寻址算法与 lifecycle 表；
- `pnpm skills:quick-validate` + `skills:validate` + `skills:index` 绿。

## 3. T2 · 触发面改写（Grok 补丁：防虚构降级）

**动作**（三处必须同步改，缺一处即降级不成立）：

1. **frontmatter description**：普通 review 类措辞（second pair of eyes / audit this diff / review-fix-re-review）指向 auto loop；经典路径只保留其**独有语义**的触发词：Review Intake（reviewer-initiated 当前会话亲审）、feedback validation、manual packet continuation。
2. **Fast Path**：经典路径条目改为显式兼容标注——"compatibility path, prompt-protocol only (no script guarantees), for: intake / feedback validation / manual continuation"。
3. **Stage Defaults 表**（迁入 references 后同步改）："review / audit this diff" 类信号默认路由 auto `run`；仅上述独有语义路由经典。
4. **禁止静默扩大 auto 的承接范围**：未映射语义（Review Intake / feedback validation）**留在经典**，不得声称 auto 已覆盖——auto 的 `createPacketFile` 会硬写 implementer `# Review Handoff`，把 reviewer-initiated 场景路由进去等于脚本伪造 Handoff；`rounds=1` 首轮 BLOCKED 的出口（budget_exhausted）也与经典"停在 Fix Handoff 等人修"不等价。这段差异要在经典路径的兼容标注里写明。

**验收**：

- description 通过 quick-validate（ASCII、≤1024）；
- 定向触发评测（同步镜像后跑，方法与 trigger-results.json 记录一致）：至少复测 3 条——1 条普通 review 正例应仍触发本 skill（走 auto 措辞）、1 条 feedback validation 正例仍触发、1 条普通实现负例不触发；结果追加进 `evals/trigger-results.json`；
- SKILL.md 中经典路径兼容标注含"无脚本保证"与"与 auto 的语义差异"两点。

## 4. T3 · 经典入口可观测（Grok 补丁：给观察窗装仪器）

**动作**：

1. 经典路径创建/续写 packet 的协议文本中，要求 frontmatter 增加两个字段：
   ```yaml
   mode: classic
   classic_reason: intake | feedback_validation | manual_continuation
   ```
   （auto 路径已有自己的标记，不动。）
2. `packet-anatomy.md` 的 frontmatter 模板同步补这两个字段及取值表。
3. 在本文档 §5 backlog 的 A 项触发条件旁注明数据来源：统计 `.review-handoff/{active,archive}/**` 中 `mode: classic` 的 packet 数量与 reason 分布。

**验收**：references 模板与 SKILL.md 协议文本一致；字段取值闭集（三值）；无脚本改动。

## 5. Backlog（登记 + 触发条件，本轮不做）

| 项                                                                          | 触发条件（满足才立项）                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 经典路径事务级 writer（**一个** lifecycle-aware 命令，非三个松散子命令） | 2–4 周内、≥2 个仓库、出现多次 auto 覆盖不了且带 `classic_reason` 标记的真实经典用量。**数据来源**：统计 `.review-handoff/{active,archive}/**` 中 `mode: classic` 的 packet 数量与 `classic_reason` 分布 |
| 淘汰经典路径（A 的对立出口）                                                | 书面 use-case 矩阵证明 Intake / feedback validation / manual continuation 全部无损映射 auto（含创建器不伪造 Handoff）                                                                                   |
| C. 失败模式 reference                                                       | CLI 具备稳定错误码、且排障记录显示 agent 反复撞同一错误并会主动加载文档                                                                                                                                 |
| token/美元用量记录与硬顶                                                    | 用户重新提出（2026-07-22 明示暂不考虑）                                                                                                                                                                 |
| `doctor` 沙箱探针命令                                                       | 任一家 CLI 升版后实测破过一次只读沙箱                                                                                                                                                                   |
| 运行时证据冻结（测试输出进 evidence，弥补只读 Reviewer 跑不了测试的局限）   | 静态误审造成一次真实错误放行                                                                                                                                                                            |

## 6. 协作契约与验收流程

| 角色          | 职责                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| Grok（实现）  | T1→T2→T3 按序，各自单独 commit（只 add 自己改的文件）；触发评测道具只放 /tmp                |
| Codex（审查） | Grok 完成后对 diff 全量审：重点核对"消重后无双真相源""触发面三处同步""未静默扩大 auto 范围" |
| 用户          | 收口拍板；`commit-push` 授权                                                                |

收敛规则沿用 §6.4（3 轮预算、可证伪拦路、死锁上交）。

## 7. 参考

- 终案决策过程：本文件头部 consult 记录两份
- v2 主任务书：`plan-2026-07-22-review-loop-v2-auto-loop.md`（含 §6.4 收敛规则全文）
- 触发评测方法与坑：`skills/agentic-review-handoff/evals/trigger-results.json`
