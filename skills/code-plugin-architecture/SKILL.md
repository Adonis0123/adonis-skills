---
name: code-plugin-architecture
description: >-
  Use when the user's pain is "adding/removing one more X means editing N files" and X is a recurring kind of variant: popup, banner, modal, ad slot, payment method, AI model/tool, form field type, connector, sub-site, command, menu item, agent, VSCode-style extension, or data source. Use when they want to design, refactor, review, or name the mechanism that lets variants plug in via registry, interface/trait, runtime core, and convention folders; mention pluginize, pluggable, plugin architecture, extension point, registry pattern, or extensibility. Use when reviewing PRs where one new variant touches many files/switch cases and asking if that extension cost is acceptable. Use for cross-stack mapping to VSCode contributes, Webpack/Vite plugins, Rust/Tauri connectors, Python entry_points, or cargo features. Skip editing one variant's internals/styles/hooks/copy/bugs, and skip register/registry meaning DI container, user signup, or package registry.
metadata:
  author: adonis
  version: "0.2.0"
---

# Code Plugin Architecture

把"会持续新增的一类东西"改造成插件化结构的**方法论 skill**。

不是脚手架，不绑定具体框架/语言。React / Vue / Rust / Python / CLI / VSCode extension / Webpack plugin / 后台菜单都适用——所有这些**本质上都是这套模式的实例**。

## 这个 skill 解决什么

工程里反复出现的同一类痛点：

| 症状 | 真正问题 |
|---|---|
| "每次加一个新弹窗都要改 5 个文件" | 缺中央注册表 + 占位符引导 |
| "加新工具有半天要踩坑找改哪儿" | 没有约定式目录 |
| "几个相似模块各自 if-else 判断 type" | 缺核心 factory，business 写在调用方 |
| "首屏变慢，因为所有模态框都被打包进来" | 缺延迟加载层（仅 frontend / runtime loading 场景） |
| "新人改 A 弹窗结果 B 弹窗坏了" | 单插件没有自治目录 |
| "命名一会儿 camelCase 一会儿 snake_case，dataName 还不一样" | 没有从 key 推导其他命名 |
| "下线一个旧支付方式要改 8 处" | 注册表与实现耦合 |

如果用户描述命中其中任何一条，**这就是要这个 skill 介入的时刻**。

## 何时不要用

- 只有 1～2 个变种，且**未来确定不会再加**的功能：直接 if-else 比插件化便宜。
- 变种之间根本不共享行为（接口/输出/生命周期都不同）：强行套同一抽象会出现"5 个可选属性 4 个用不上"。
- 用户已经在用成熟的、强约定的框架插件机制（Next.js pages、VSCode extension manifest、Tauri plugin）——直接顺着用，不要发明第二套。
- 用户问的是**单个具体插件的内部实现**（"这个 modal 的样式怎么改"），而不是"插件机制本身的设计"。

## 核心结构 — 五件套

任何插件化系统的最小骨架是这五层。**只要少一层，扩展性就会在 3 个月内塌掉**。

> 注：第一版方法论曾把它叫"四件套"（把 Contract 隐藏在 Registry 类型里）。实践证明把 Contract 显式拎出来更稳——绝大多数事故都来自 Contract 不清晰。

### 1. Identity（主键）

每个插件必须有一个**唯一、稳定、来自最权威层**的 key。

```
站点：    hostKey: 'pollo.ai'  ← 来自 EHostKey 枚举（顶层）
工具：    appKey: 'Motion'    ← 来自后端 Labels schema（最权威）
弹窗：    configKey: 'npsSurveyModal' ← camelCase 自定义
模型：    modelId: 'gpt-4o'   ← 来自供应商 ID
```

**原则**：
- 主键由**最权威的层**定义（后端 schema、外部供应商 ID、顶层枚举），**不要在调用侧重新发明**。
- 主键派生其他所有命名：组件名、文件夹名、埋点名、route 段、CSS 变量。把推导关系列成一张表，加新插件就照表填。

错误示范：弹窗的 `configKey = "promoModal"`，组件名 `<PromoModalV2>`，埋点名 `promo_pop`，文件夹 `PromoPopup/`——四个名字互相猜不出，半年后没人敢删。

### 2. Contract（契约）

明确**每个插件必须提供什么、可以提供什么**的契约 — 通常是一个 interface / trait / TypedDict / Protocol。

```ts
// 必填字段（结构同质）
interface PluginContract {
  key: PluginKey
  component: ComponentRef
  // ...

  // 可选行为钩子
  shouldShow?: (ctx: Ctx) => boolean
  onMount?: (ctx: Ctx) => Cleanup
}
```

**原则**：
- Contract 是 **Core ↔ Plugin 之间的唯一通讯协议**。Core 通过 Contract 看插件，插件通过 Contract 看 Core 暴露的能力。
- 必填字段尽量少，可选字段表达变种差异。但要给"宽核心，窄实现"留余地——core 容忍各种可选，单插件只填用到的。
- 一旦 Contract 上字段变了，所有插件要同步——所以**Contract 改动是高代价的**，加新字段优先用可选。
- **Identity 是字段，不是 Contract 本身**。这是常见误解——很多人把"插件的 key 类型"当作 Contract，但 Contract 实际是"key + 行为"。

### 3. Registry（中央注册表）

一处显式的"我这里有哪些插件"清单。

```ts
// ✅ 注册表只引用，不实现
import { DynamicNpsSurveyModal } from './popups/dynamic'

export const promotionPopupsConfig = {
  npsSurveyModal: initialPopupConfig({
    priority: 504,
    component: DynamicNpsSurveyModal,
    cache: { type: 'interval', timeout: 1, upperLimit: 2 },
    dataWidgetName: 'nps_survey_popup',
  }),
  // [Popup-Config]:(add)   ← 占位符
}
```

**原则**：
- **只引用，不实现**。注册表里不能出现任何插件的业务逻辑——一旦出现，下次加插件就要改注册表里的判断分支。
- **结构同质**。每条记录的字段集合完全一致（用 `pluginConfig({...})` 工厂统一兜底默认值）。
- **位置稳定**。所有同类插件的注册表只此一份，别因为"分组"拆成多个——分组的代价是丢失全局视野。

### 4. Runtime Core（运行时内核）

通用、无业务的内核，**对具体插件保持完全无知**。Runtime Core 负责"机制"，不负责"内容"。

```ts
export function createSitePromotionCoreSliceFactory<
  T extends PromotionsCoreRegistry,
  S extends Record<string, any>,
>(initialState, options) {
  return (...a) => {
    // 通用状态机
    return {
      init: (options) => { /* cache decision */ },
      closeAndTerminate: () => { /* ... */ },
      openForce: () => { /* ... */ },
      // ...
    }
  }
}
```

**原则**：
- 内核通过**泛型** `<T extends Registry>` 接收注册表形状，自己不 import 任何具体插件。
- 内核负责**横切同质的关注点**：状态机、缓存策略、生命周期、横切的埋点（"插件被打开时统一埋一次曝光"）、统一持久化。
- 业务相关的事（"这个弹窗要不要弹"、"用户登录后才显示"）**不能写在内核里**——那是单插件 `init.ts` 的事。
- 不要在内核里设 "if (key === 'X') ..." 的特殊分支——这是注册表机制失败的明确信号。

> **关于 Provider Orchestration**：在 React/Vue/前端场景里，"何时选择 openKey"、"渲染哪个插件"这种**编排决策**通常落在 Provider/Orchestrator 层（订阅 Core store，按 Contract 字段做决策），不在 Core 里。Core 是状态机和切面 SDK，Orchestrator 是策略实现。两者都属于"业务零知识"，但职责不同。把它当 Core 的子层即可，不必单列。

### 5. Convention Folder（约定式目录）

单个插件自治在一个目录内，所有相关物聚拢。

```
popups/[Name]/
├── index.tsx         ← UI（默认 export 一个组件）
├── init.ts           ← 何时打开（条件 / AB / 登录态）+ 该插件特有的副作用
└── constants.ts      ← 这个插件专属的常量、文案
```

**原则**：
- 删除这个插件 = `rm -rf` 这个目录 + 注册表删一行。**没有跨目录的反向引用**。
- 单插件内可以**完整理解**而不需要跳出去看核心机制。
- 文件分工固定（一两种模式即可），让阅读者闭着眼也知道找什么去哪个文件。
- 目录名 = 主键派生的 PascalCase。

## 七条设计要点

五件套之外，还有七个让系统真的"用起来顺"的要点。

### a. 配置 / 行为分离

```
config.ts  ← 静态（priority、cache 策略、埋点名、默认 disabled）
init.ts    ← 动态（订阅 store、判断登录态、调用 AB 实验、调 init({open: true/false}))
```

**同一属性只在一处写**。比如 cache 策略一律放 `config.ts`，`init.ts` 不重复传——否则双写就是双倍 bug。

⚠️ **历史债的迁移建议**：真实项目里这条很容易腐烂——比如 `InviteTopBanner/init.ts` 同时在 `config.ts` 和 `init.ts` 写 `cache: { type: 'count', count: 2 }`，原因往往是早期没有 config 层、后来加上时没回收旧 init 里的 cache。这类双写应该作为技术债清理，而不是当作"规范"复制粘贴。

### b. 延迟加载默认开（仅对应用场景）

每个插件实现都用 `dynamic()` / `lazy()` / 框架的延迟加载机制包一层。

```ts
// dynamics.ts — 集中维护所有动态 import
export const DynamicNpsSurveyModal = dynamic(
  () => import('./NpsSurveyModal'),
  { ssr: false },
)
```

注册表只引用 `Dynamic*` 名字。**0 个用户用的插件不该进 bundle**。

**适用范围限定**：这条对前端 / 用户面应用（首屏 bundle 重要）成立；后端内部插件、CLI 工具、内部 admin 工具可以省。Rust 编译型项目用 cargo `features` 是等价手段。

### c. 占位符引导

在中央注册表里留注释占位符，引导下一个加插件的人在哪一行操作：

```ts
const config = {
  [EHostKey.PolloAI]: polloAiConfig,
  [EHostKey.ViggleDance]: viggleDanceConfig,
  // [EHostKey-Site]:(config)   ← 占位符
}
```

让"加新插件"成为**机械动作**而非脑力税。也是后续做 codegen / 模板插入的锚点。

### d. 命名推导表

每个插件主键能机械推导出所有其他命名。列成表写在 README 里：

| 占位符 | 规则 | 例子 |
|---|---|---|
| `__KEY__` | camelCase | `npsSurveyModal` |
| `__COMPONENT__` | PascalCase | `NpsSurveyModal` |
| `__DIR__` | = `__COMPONENT__` | `NpsSurveyModal` |
| `__HOOK__` | `use__COMPONENT__Init` | `useNpsSurveyModalInit` |
| `__DATA_NAME__` | snake_case | `nps_survey_modal` |
| `__DYNAMIC__` | `Dynamic__COMPONENT__` | `DynamicNpsSurveyModal` |

无歧义、可机器化。这一张表是 skill 落地阶段最值钱的产出。

### e. 副作用边界明确

| 副作用类型 | 归属 |
|---|---|
| **横切同质副作用**（每个插件都做同样的事） | Runtime Core 一处 subscribe |
| **插件特有副作用**（只这一个插件需要） | 该插件的 `init.ts` 或 render adapter |
| **跨插件编排副作用**（"A 打开后强制开 B"） | Provider/Orchestrator 层 |

```ts
// ✅ 横切：所有 promotion 都要的曝光埋点 → core
store.subscribe(
  (state) => state.openKey,
  (openKey) => openKey && tracker?.trackEvent({...}),
)

// ✅ 特有：NPS 弹窗专属的"提交后 closeAndTerminate" → init.ts
// ✅ 编排：用户登录后强制打开 onboardingExperiment → Provider
```

错误：把所有插件可能的副作用都塞进 core，导致 core 出现 `if (key === 'X')` 分支。

### f. 一份 Core，多个变种

实际工程里"插件"往往不只一种（弹窗、横幅、抽屉、Banner、Toast……）。把它们建在**同一个 core factory** 上，每种变种用自己的 store + Provider 注入：

```
SitePromotionProvider/
├── _factory/core.ts      ← 共享内核（缓存策略、生命周期、横切埋点）
├── popups/               ← 变种 A：弹窗
│   ├── store.ts          ← createPopupsStore (cachePrefix='popups')
│   └── Provider/         ← 弹窗 Orchestrator（按 priority 选 openKey）
└── banners/              ← 变种 B：横幅
    ├── store.ts          ← createBannersStore (cachePrefix='banners')
    └── Provider/         ← 横幅 Orchestrator（按 priority 选 openKey + renderHeight）
```

复用所有共性，分隔状态隔离。变种之间的差异（横幅有 renderHeight、弹窗没有）通过 slice 扩展实现。

### g. 全局调试探针

开发环境把 store 挂到 `window`（或等价的运行时全局）：

```ts
if (!IS_PROD) {
  (window as any).__SITE_PROMOTION_POPUPS_STORE__ = store
  (window as any).clearPromotionCache_popups = () => clearCacheWithPrefix('popups')
}
```

加新插件后第一次没显示——直接打开 DevTools 看 store 状态、清缓存就能定位。**省下"为啥不显示"的 30 分钟来回猜**。

## 落地流程（最小步骤）

接到"把这块改成插件化"或"我要建一套 X 的插件机制"任务时，按这个顺序做。

### Step 1: 找 Identity

回答三个问题：
1. **谁来命名？** 后端 schema、供应商 ID、还是自定义？尽量挂最权威的那层。
2. **类型是什么？** 字符串字面量联合、enum、还是来自外部包的类型？
3. **新增 key 时改哪里？** 这条路径将出现在所有插件作者的工作流里，要短。

### Step 2: 设计 Plugin Contract

写出每条插件**必须**有什么、**可以**有什么：

```ts
interface PluginContract {
  // 必填（结构同质）
  priority: number
  component: React.ComponentType<any>
  dataWidgetName: string

  // 可选（变种特有）
  cache?: PromotionCache
  disabled?: boolean
  closeIconClassName?: string  // 只横幅用
}
```

写一个 `initialPluginConfig(data) { return { open: false, ...data } }` 兜底默认值。

### Step 3: 写 Runtime Core

零业务、纯泛型。核心动作至少：
- 注册（init）
- 触发（open / close / openForce）
- 销毁（terminate）
- 状态查询
- 横切同质的副作用切面（同质埋点、cache、持久化）

**绝对不允许**出现具体插件的 key 字符串。

如果需要"按 Contract 字段做策略决策"（例如 priority 排序选 openKey），把决策放到 **Provider/Orchestrator** 层，而不是 Core 状态机里——Orchestrator 也是业务零知识，但它消费 Core 暴露的 store。

### Step 4: 建中央 Registry

一份注册表。注册表里只有引用、配置、占位符，**没有 if-else**。

### Step 5: 写第一个插件示例

照 Convention Folder 模板写一个最小可用插件。这是后面所有插件的"复制粘贴模板"。

### Step 6: 加占位符引导和命名表

在 README 或注释里：
- 占位符注释行
- 命名推导表
- 5 分钟 onboarding 文档（"加一个新 X 的 5 个步骤"）

### Step 7: 写自检清单 + 调试探针

按下面的"评审清单"对照过一遍。每一条都能回答"是"才算落地完成。挂上全局调试探针。

## 从存量代码迁移到插件化

把已有的"散装 if-else"迁移到插件化结构，跟从零搭建是两件事。**强行一刀切迁移 = 大批量回归**。推荐绞杀者模式：

1. **保留旧实现，建立新机制**。先在新位置建好 Contract / Registry / Core 三层，**不动旧代码**。
2. **建 adapter**。让 Registry 既能接旧的"裸组件"，也能接新的"完整 plugin contract"。adapter 把旧的塞成 contract 的形状（cache 类型先用 `{type: 'default'}` 占位、埋点名沿用旧值）。
3. **新增插件全走新路**。从这一刻起，**新弹窗 / 新工具只允许走新机制**——给团队设硬边界。
4. **逐个迁移老插件**。每次只迁一个，PR 必须包含：(a) 迁移前后的展示行为对比截图/视频、(b) 缓存兼容验证（旧用户已存的 localStorage key 仍有效）、(c) 埋点 dataName 对应表。
5. **设旧 key 兼容期**。如果新机制变了命名规则，旧的 `localStorage` key / 埋点 name 要兼容一段时间——给 Core 加 `legacyKey?: string` 字段做映射，迁移期过后回收。
6. **删旧机制**。所有旧插件迁完 + 兼容期过 → 删旧机制 + 占位符代码 + 旧文档。

**反模式**：一个大 PR 把所有旧弹窗一次性重写——审 review 几乎不可能、回归看不全、出 bug 时无法二分。

## 评审清单（add / review 通用）

落地一个插件化结构 / 评审现有插件化结构时，逐条对照。每条都标了 **Check method**——优先用机器化方法验证，能 grep 就别人眼瞅。

| # | 评审项 | Check method |
|---|---|---|
| 1 | 加新插件 = 新建一个目录 + 注册表加一行 | 在 onboarding 文档里走一遍"加一个 X"的步骤，数改了几个文件 |
| 2 | 删插件 = `rm -rf` 目录 + 注册表删一行 | 选一个最简单的插件，真的删一次（branch 上），看构建 + typecheck 报错处 |
| 3 | 单插件目录内可以完整理解 | human review：随机抽一个插件目录，让没看过的人 10 分钟内说出它做啥 |
| 4 | Core factory 不知道任何具体插件 | `grep -RE "['\"](pluginKeyA|pluginKeyB)['\"]" core/` 应为空（用真实插件 key 替换；分隔用裸 `|`，标准 ERE，不要转义） |
| 5 | 同一属性只在一处定义（cache 不要 config + init 双写） | `grep "cache:" plugins/*/init.ts` 应为空 |
| 6 | Bundle 真的按需加载 | DevTools Network panel / bundle analyzer 看每个插件是否独立 chunk（非 frontend 场景跳过） |
| 7 | 命名遵循推导表 | 写一个脚本：从 key 推导出所有命名，对照实际文件名/常量名/埋点名 |
| 8 | 占位符注释存在 | `grep -RE "\[[A-Za-z]+-[A-Za-z]+\]:\(" registry.ts` 应有命中（约定格式：`// [Domain-Action]:(slot)`） |
| 9 | 横切副作用在 Core subscribe 一处 | `grep "subscribe\|emit\|trackEvent" plugins/` ≈ 0；core/ 集中 |
| 10 | 开发环境有调试探针 | DevTools console：`__YOUR_REGISTRY_STORE__` 应可访问；清缓存命令应存在 |
| 11 | 没有 `if (key === 'X')` 这种特例 | `grep -RE "key\s*===\s*['\"]" core/ orchestrator/` 应为空 |

**关于占位符的格式约定**：本 skill 全程统一用 `// [Domain-Action]:(slot)` 形式，例如：
- `// [Popup-Config]:(add)` — 在 PromotionPopups 注册表里加新 popup config 的位置
- `// [EHostKey-Site]:(config)` — 在站群中央注册表里加新 hostKey config 的位置
- `// [Plugin-Placeholder]:(register)` — Rust 例子里 vec! 注册插件的位置

`grep` 时用同一种 regex 即可命中所有。**不要混用 `[X-Placeholder]` 和 `[X]:(Y)` 两种格式**——选一种全项目沿用，否则 grep 总会漏。

**Check method 的轻重**：
- `grep` 类规则可以放进 lint / CI（一旦回归立即拦住）。
- `typecheck` 类规则可以用 `satisfies Record<Identity, Contract>` 强约束。
- `human review` 类规则只能进 PR template。
- `Network panel` 类规则进 release 前 checklist。

每条都通才算"真的插件化"。任意一条不通——**先回答"为什么这条不适用于本场景"，能解释清楚再放过**。

## 案例研究与跨技术栈应用

按需读取：

- [references/case-studies.md](references/case-studies.md) — 4 个真实案例的对照表（多站点站群、推广横幅、推广弹窗、工具扩展 apps），每个案例都给出"五件套"映射，**用于实际操作前对齐**。
- [references/anti-patterns.md](references/anti-patterns.md) — 八种最常见的"伪插件化"反模式（按严重程度分层：Must-fix / Smell / Context-dependent），**用于代码评审和 PR review 时挑出问题**。
- [references/cross-stack.md](references/cross-stack.md) — 这套模式在 Webpack / VSCode / Express / Tailwind / Rust trait / Python entry_points 上的同构映射，**用于跨语言/跨框架 onboarding 时建立类比**。

## 用户给的需求不够明确时

当用户说"帮我把这块改成插件化"但没说细节，主动问：

1. **这一类东西未来还会加吗？预计多久加一个？** 不会加 → 不该用。
2. **主键从哪来？** 后端 / 供应商 / 自定义。回答不上来 → 先讨论主键，不要急着写代码。
3. **变种之间共享哪些行为？哪些不一样？** 共享的进 Core，不一样的进单插件。这是抽象边界。
4. **现在的痛点是"加慢"、"删难"还是"互相影响"？** 三种痛点对应不同重点（占位符 / 反向引用 / 自治目录）。
5. **有没有现成的框架插件机制可以顺？** 有就别造轮子。
6. **存量 vs 增量？** 已有插件多少个？新机制能容忍同时存在两套吗？（决定是否走绞杀者迁移）

不要在没回答这六个问题之前开始写 Core——很可能写出来用户用不上。

## 输出要求

执行这个 skill 时，**至少**产出：

1. 一份 Plugin Contract 类型定义（TypeScript / Rust trait / Python TypedDict 等，按项目栈）。
2. 一份中央 Registry 文件（含占位符注释）。
3. 一份 Runtime Core（泛型，零业务）。
4. 一个完整的示例插件（按 Convention Folder 模板）。
5. 一份 README（含命名推导表、"加新插件 5 步"、调试探针使用说明）。
6. 评审清单的**逐条勾选回应**（不能直接 copy 清单——要针对当前项目情况说"为什么这条满足/不满足"，给出 Check method 的实际结果）。
7. 如果是存量代码改造，**附迁移路径**：adapter 设计、旧 key 兼容方案、PR 拆分计划。
