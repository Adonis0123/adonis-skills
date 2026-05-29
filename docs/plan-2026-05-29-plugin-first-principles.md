# Plan: 把"插件化第一性原理"沉淀进 code-plugin-architecture skill

- 日期: 2026-05-29
- 范围: `skills/code-plugin-architecture/`（方法论型 skill）
- 模式: Plan mode 下的重大变更（触及 5+ 文件、改动核心方法论内容）

## 背景（Background）

该 skill 是"把会持续新增的一类东西改造成插件化结构"的方法论 skill。两个驱动因素：

1. 发现 references 残留内部仓库名和具体业务组件名，影响"装到任意环境都能用"的通用性。
2. 用户要求从**第一性原理**出发、叠加 **DDD / 高内聚低耦合**、并**联网核实业界权威**，把插件化思想真正吃透后沉淀进 skill，不降低输出质量。

## 目标（Goals）

- 去除一切私有仓库名/误导性真实组件名，保留少量标注为"示意"的例子。
- 用第一性原理讲清"为什么必须是五件套"，并锚定业界正式术语。
- 新增两个方法论级洞察：递归组合（嵌套插件化 + Strategy 异质变种）、运行时重算 + 状态维度隔离。
- 全部表述**框架无关**，类比一律"可类比/可充当"，不画等号。

## 范围（Scope）

- `SKILL.md`：新增「第一性原理」「递归组合」两节 + 第八条设计要点；references 列表补 first-principles。
- `references/first-principles.md`：新建（完整推导 + DDD 全映射 + 业界出处 + SOLID 关系）。
- `references/case-studies.md`：补代码级证据注脚（modal/sideEffect、force、cacheKeySuffix），去标识化。
- `references/cross-stack.md`：去标识化。
- 生成产物 `apps/web/src/generated/skills-*.json` 随 `skills:index` 重生成。

## 方案（Solution）

依据来源：业界权威（Mark Richards Microkernel/Plug-in、Fowler Plugin、OCP、Shotgun Surgery、DDD 战略模式，均联网核实）+ 一个内部多站点 SaaS 的三套子系统实现（站群/横幅/弹窗，逐条 file:line 亲验，沉淀进 skill 时已去标识化）。架构取舍由 Codex 裁决，并修正了若干过度引申（Microkernel registry ↔ Registry 仅"中心清单"层、Published Language ↔ Contract 不画等号、单 plugin ≠ Bounded Context、OHS 有成立条件）。

## 风险（Risks）

- 正文膨胀：用 progressive disclosure 控制，深度内容外移 first-principles.md；SKILL.md 硬顶 475 行。
- 过度引申：已按 Codex 修正，全部改为"可类比"措辞。
- 通用性回退：红线——新增措辞不出现 React/Zustand/dynamic；真实细节标"示意"。

## 验收标准（Acceptance Criteria）

- `pnpm skills:quick-validate` / `skills:validate` / `skills:index` 全绿。
- 私有仓库名/误导真实组件名残留 = 0；references 链接 0 断链；SKILL.md ≤ 475 行。
- skill-creator 评测：新版在"业界锚定 / 第一性推导 / 递归方案 / 去框架化"维度 ≥ 旧版，且**速度与质量两维**均无回退（人工复核 viewer）。
- 改动留工作区，先 review，不擅自 commit/push。
