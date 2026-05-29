# 第一性原理 — 为什么是这五件套，以及它和业界的关系

这篇是 SKILL.md「第一性原理」小节的展开版。SKILL.md 给的是结论；这里给**完整推导**、**DDD 全映射**、**业界出处**，以及和 SOLID 的关系。需要说服别人"这套不是我编的"、或者想把术语对齐到团队已有的架构词汇时，读这篇。

## 目录

- [一、从根问题推导五件套](#一从根问题推导五件套)
- [二、症状 → 原理 → 对应件 追溯表](#二症状--原理--对应件-追溯表)
- [三、业界出处：每件套各自被谁论证过](#三业界出处每件套各自被谁论证过)
- [四、DDD 映射（精确版，不画等号）](#四ddd-映射精确版不画等号)
- [五、和 SOLID 的关系](#五和-solid-的关系)
- [六、常见的"看起来像、其实不是"](#六常见的看起来像其实不是)

---

## 一、从根问题推导五件套

**根问题**：软件里总有"会持续同类新增的东西"——弹窗、支付方式、AI 工具、数据源、菜单项、表单字段类型、连接器……。如果每加一个新变种都要去改散落在多个文件里的代码，这个症状业界叫 **Shotgun Surgery（霰弹式修改）**：一个逻辑改动被迫散着打很多枪。它的根因（refactoring.guru 的定义）是"一个单一职责被切散到了大量的类/文件里"。

**第一性目标**：把"加一个新变种"的成本，从 **O(N)**（改 N 处分散代码）降到 **O(1)**（新建一个自治单元 + 在名单里加一行）。

**关键推导**：O(1) 不是随便能达到的。要让"加一个"只触碰一个新单元 + 一行注册，**逻辑上必须同时满足五个条件**。每个条件缺失，成本就会从某条路径漏回 O(N)。这五个条件，就是五件套——它们不是被"设计"出来的，是被这个目标**逼**出来的：

1. **所有变种必须共享一个稳定的"形状"**。
   否则核心代码要为每一种变种写特判（`if type === A … else if type === B …`），加第 N+1 种就要回去加一个分支 → O(N)。
   → 这个"形状"就是 **Contract**。

2. **每个变种必须有一个唯一、稳定、权威的"身份"**。
   否则同一个变种在组件名、文件夹名、埋点名、路由段里各叫各的，无法从一个名字机械推出其余名字，加变种时每处都要人脑对一遍 → O(N) 的认知成本。
   → 这个身份就是 **Identity**。

3. **必须有且仅有一处"名单"**。
   "系统里现在有哪些变种"这条知识，如果散在多个文件，加一个就要在每处都登记一次 → O(N)。收敛到一处，才可能"加一行"。
   → 这处名单就是 **Registry**。

4. **核心必须对"具体有哪些变种"完全无知**。
   只要核心 import 了任何一个具体变种、或写了任何一个具体变种的 key，它就会随变种增长而被反复修改 → O(N)，而且违反 OCP。核心只能通过 Contract 这层抽象看变种。
   → 这个对变种零知识的核心就是 **Runtime Core**。

5. **单个变种必须自治、且没有指向外部的反向引用**。
   否则删一个变种要满代码库找谁引用了它（O(N) 搜索），加一个变种要去多个目录埋钩子。只有当一个变种的所有东西聚在一个目录、且外部只通过 Registry 引用它，"删 = 删目录 + 删一行""加 = 加目录 + 加一行"才成立。
   → 这个自治目录就是 **Convention Folder**。

**结论**：五件套是"O(1) 扩展"这一目标的**必要条件集**，不是充分多的"最佳实践清单"。这也是为什么 SKILL.md 说"少任何一件，扩展性 3 个月内塌掉"——少一件，就有一条路径偷偷退回 O(N)。

> 第六件套是**按场景可选的 Lazy Loading**：它不是 O(1) *扩展成本*的必要条件，而是 O(1) *运行时成本*（新增变种不拖慢首屏/启动）的条件。前端用户面必修，后端/CLI/编译型可省（见 SKILL.md 要点 b）。

## 二、症状 → 原理 → 对应件 追溯表

把开篇痛点表的每一条，追到第一性原理，再追到对应的件。评审时可以反过来用：看到症状，就知道缺哪件。

| 症状（用户原话） | 第一性原理违背 | 缺失的件 |
|---|---|---|
| "每次加新弹窗要改 5 个文件" | 名单被切散 / 没有自治单元 | Registry + Convention Folder |
| "加新工具半天找不到改哪" | 没有约定式落点 | Convention Folder |
| "几个相似模块各自 if-else 判断 type" | 核心对变种有知识 | Runtime Core（违反 OCP） |
| "命名一会 camelCase 一会 snake_case" | 身份不权威、不可推导 | Identity |
| "下线旧支付方式要改 8 处" | 名单与实现耦合 | Registry（只引用不实现） |
| "新人改 A 弹窗结果 B 弹窗坏了" | 变种之间有反向引用 | Convention Folder（自治性） |

## 三、业界出处：每件套各自被谁论证过

这套方法论不是新发明，它是几个成熟概念在"会持续新增的东西"这个场景下的合流。

- **Microkernel / Plug-in 架构模式** — Mark Richards《Software Architecture Patterns》(O'Reilly)。
  明确把系统拆成 **core system + plug-in modules**，并指出 **registry**（含 plugin 的 name、data contract、连接协议）和 **contract**（约定 behavior / input / output）是两个独立部件。这正是本方法论 Registry + Contract + Runtime Core 的母本。Richards 也点名该模式的主要复杂度来源：contract versioning、plugin registry、plugin granularity——和本 skill 的告诫一致。

- **Plugin 模式** — Martin Fowler《Patterns of Enterprise Application Architecture》。
  一句话定义："Links classes during configuration rather than compilation."（在配置期而非编译期把实现接上）。并强调"Configuration shouldn't be scattered throughout your application"——即配置/名单要收敛，不要散落。对应本方法论的 Registry。

- **Open–Closed Principle** — Meyer (1988) 提出，Robert C. Martin 用多态重新诠释。
  "Software entities should be open for extension, but closed for modification." 多态版强调：用抽象接口让多个实现可以互相替换，而调用方代码不变。这正是 Runtime Core "对变种零知识、靠 Contract 抽象" 的理论依据，也是"注册表里别写 switch"的根据。

- **Shotgun Surgery** — code smell（Fowler《Refactoring》/ refactoring.guru）。
  "A single change is made to multiple classes simultaneously." 根因"单一职责被切散"。这是本 skill 开篇痛点的正式命名，也是"为什么要插件化"的反向论证。

- **DDD 战略模式** — Eric Evans《Domain-Driven Design》/ Open Group 标准。
  Published Language、Anti-Corruption Layer、Open Host Service、Bounded Context、Upstream/Downstream——见下一节的精确映射。

## 四、DDD 映射（精确版，不画等号）

DDD 的几个战略模式能很好地解释本方法论的边界设计，但**类比要精确，不能画等号**——否则会把概念用滥。

- **Contract ↔ Published Language**：Contract **可以充当** Core 与 Plugin 之间边界的 Published Language（一套双方都认、稳定、有文档的"通讯语言"）。但两者层次不同：Published Language 是 DDD 里跨 Bounded Context 通信的*语言规范*，Contract 是代码层的*类型/接口约束*。说"Contract 起到了 Published Language 的作用"是对的；说"Contract 就是 Published Language"是过度引申。

- **渲染层 adapter / 旧代码 adapter ↔ Anti-Corruption Layer**：当你把一个"旧的裸组件"塞进新 Contract 的形状、或在渲染层为某个插件做一次性 prop 注入时，这一层翻译就是 ACL——下游用它"礼貌地说不"，把外部模型转换成自己的概念。这个类比比较站得住，因为职责一致：边界翻译。

- **单个 plugin ↔ Bounded Context**：**这是推断，不是事实**。一个 plugin 通常只是某个 BC *内部*的一个实现细节（一个扩展点）。只有当这个 plugin 自带完整的领域模型、有自己的领域语言时，它才**可能**升格为一个 BC（比如本 skill「递归组合」里那种"内部再套一层五件套"的复杂插件）。不要默认"一个插件 = 一个 BC"。

- **Core 暴露给插件的能力 ↔ Open Host Service**：**仅当** Core 明确地把一组能力作为标准化接口暴露给所有插件消费时，才是 OHS。如果 Core 只是被动持有状态、没有对外的"服务接口"，就别套 OHS 这个词。

- **依赖方向 ↔ Upstream/Downstream**：Contract 是 upstream，Core 和 Plugin 都是 downstream——双方都依赖 Contract，但谁都不依赖对方的实现。这就是依赖倒置（DIP）在这套结构里的体现。

## 五、和 SOLID 的关系

- **OCP（开闭）是主轴**：整套方法论就是 OCP 的一个工程化落地。"加变种不改核心" = 对扩展开放、对修改封闭。
- **DIP（依赖倒置）定义依赖方向**：`Plugin → Contract ← Core`。高层（Core）和低层（Plugin）都依赖抽象（Contract），不互相依赖具体实现。
- **SRP（单一职责）解释 Convention Folder**：一个变种的所有职责聚在一个目录 = 高内聚；而 Shotgun Surgery 正是 SRP 被破坏（一个职责散到多处）的后果。
- **ISP（接口隔离）提醒 Contract 别太胖**：必填字段尽量少、可选字段表达差异（SKILL.md Contract 小节的"宽核心、窄实现"）。
- **LSP** 在这里相对弱——变种之间一般不是继承替换关系，而是并列实现同一 Contract。

一句话：**这套方法论 = OCP 为目标 + DIP 为骨架 + SRP 为单元划分 + ISP 约束 Contract**。

## 六、常见的"看起来像、其实不是"

- **DI 容器 ≠ 本方法论的 Registry**。DI 容器解决"谁来 new、生命周期归谁管"；本方法论的 Registry 解决"这一类东西有哪些"。两者可以共存，但别混为一谈。
- **包管理器 registry / 用户注册 ≠ 这里的 Registry**。同名不同义。
- **微内核操作系统 ≠ 微内核架构模式**。前者是 OS 概念（进程隔离、IPC），后者是应用架构（core + plugin）。本方法论借的是后者。
- **运行时动态注册（从 DB 拉配置、运营后台投放）≠ 静态代码插件化**。后者是开发者写代码 + 编译期/启动期注册；前者还需要数据模型 + 运营 UI + 缓存失效策略。本 skill 主线讲静态代码插件化（见 case-studies.md 末尾的分流说明）。

## Source pointers

- Martin Fowler, [Plugin](https://martinfowler.com/eaaCatalog/plugin.html) — centralized configuration instead of scattered conditional wiring.
- Refactoring.Guru, [Shotgun Surgery](https://refactoring.guru/smells/shotgun-surgery) — one change requiring many small edits across classes.
- Mark Richards, [Software Architecture Patterns: Microkernel Architecture](https://www.oreilly.com/library/view/software-architecture-patterns/9781491971437/ch03.html) — core system plus plug-in modules for extensibility and separation.
