# 案例研究 — 五件套落地后长什么样

## 目录

- 案例 1：多站点站群（站群站点配置）
- 案例 2：推广横幅（Banners）
- 案例 3：推广弹窗（Popups）——含递归组合 / force 重算 / 维度隔离的代码级证据
- 案例 4：工具扩展（Extension Apps）
- 横向对比 — 四个案例的差异点
- 当你的需求对不上任何一个案例

> **关于本文所有名称**：下面出现的 **域名、类型名、目录路径、key 全部是通用示意（illustrative）**，不指向任何真实项目——它们提炼自一个多站点 SaaS（Next.js + React + Zustand + TS）的生产实践，但已做去标识化处理。重点看"形状"，不要照搬名字：你的项目按自己的命名对照"五件套"概念即可。
> 这些 key 也会随业务演化（比如某个 `seasonalSaleBanner` 下线、再加新的 banner），所以更要把它们当形状看，而非清单。

把抽象方法论映射到四个真实案例。**实际操作前先扫一眼对应案例**，确保你心里有一份具体可参考的形状。

每个案例都按五件套（Identity / Contract / Registry / Runtime Core / Convention Folder）拆。

---

## 案例 1：多站点站群（站群站点配置）

需求：同一份代码服务多个域名（site-a.example.com、site-b.example.com、preview.site-a.example.com…），各站点有独立的 SEO、GTM、404 页、subscription、品牌色，但共享业务逻辑（生成视频、登录、付费）。

| 层 | 落地 |
|---|---|
| **Identity** | `SiteKey` 枚举（`'site-a.example.com'`、`'site-b.example.com'`）+ `VirtualSiteKey`（`'preview.site-a.example.com'`） |
| **Contract** | `SiteConfig` interface + `GetSiteConfig` 函数签名（`(input) => SiteConfig`） |
| **Registry** | `src/config/index.ts`：`Partial<Record<SupportedSiteKey, GetSiteConfig>>` 表 + 占位符 `// [SiteKey-Site]:(config)` |
| **Runtime Core** | `packages/sites/src/helpers.server.ts` 的 `loopTargetSite` + `composeSites`；`SiteContext` Provider 根据 `resolvedHostname` 注入 |
| **Convention Folder** | `src/pages/<hostKey>/`（site-a.example.com/、site-b.example.com/）每个站点完整自治，含 `_config/`、页面、组件 |

**关键设计**：
- Contract 是函数 `(input) => SiteConfig`，把 Provider 默认值和站点覆写优雅合并——这是 Contract 不只是数据结构、也可以是函数签名的典型例子。
- **virtualSites** 是给开发/预览环境用的"派生主键"——继承父站点配置但 hostKey 不同，避免环境分支污染业务代码。
- Next.js rewrites 自动按 `hostKey` 长度降序排序匹配，避免短前缀吞掉长前缀。

**特别注意**：
- 主键从 `SiteKey` 枚举派生到了 Next.js rewrites、URL、CDN、SEO、payment provider 的 webhook URL——**多处下游消费**，所以主键改一次代价极大。这是为什么主键必须挂在最稳定的层。

---

## 案例 2：推广横幅（Banners）

需求：站点顶部可以出现多个营销横幅（限时折扣、新功能、邀请奖励…），同时只能弹一个（最高优先级胜出），用户关掉后按缓存策略不再骚扰。

| 层 | 落地 |
|---|---|
| **Identity** | configKey camelCase（如 `flashSaleBanner`、`inviteTopBanner`，*示意*）。命名表派生：`FlashSaleBanner`（组件）/ `flash_sale_banner`（埋点）/ `useFlashSaleBannerInit`（hook） |
| **Contract** | `BannerConfig extends PluginCoreConfig`，必填 `priority` / `component` / `dataWidgetName` / `dataBannerName`，可选 `cache` / `disabled` / `closeIconClassName` |
| **Registry** | `Banners/config.ts`：`bannersConfig: Record<key, initialBannerConfig(...)>` |
| **Runtime Core** | `PluginProvider/_factory/core.ts` 提供 cache decision / init / openForce / closeAndTerminate。`banners/store.ts` 把 core slice 和 banner 专属 slice（`renderHeight`、`dynamicRendered`）合成 |
| **Provider Orchestration** | `banners/Provider/index.tsx` 订阅 store，等所有 `initKeys` 到齐后按 `priority` reduce 选出 `openKey`（**注意：priority 决策在这里，不在 Core**） |
| **Convention Folder** | `Banners/banners/[Name]/`：`index.tsx`（UI）+ `init.ts`（条件） |

**关键设计**：
- `dynamics.ts` 集中管理所有 `dynamic()` import，注册表只引用 `Dynamic*` 名字。
- `inits.ts` 集中调用所有 init hook，父组件只调一次 `useInitBanners()`。
- 缓存策略是**可插拔**的——四种策略（default/count/interval/util）由 Core 实现，单插件只声明用哪种。
- `withDynamicRendered` HOC 自动告诉 store"我渲染了"，Core 用这个信号去测量高度并触发横幅出现的曝光埋点。
- **Core 不知道任何 banner key**：Core 只知道"有一组 key、每个有 priority"，谁该弹是 Orchestrator 决定。

**注意：cache 双写的历史债**：
- 规范上说"cache 只在 `config.ts` 定义，`init.ts` 不传 cache"——但实践中常见某些 banner 的 `init.ts` 仍然在写 `cache: { type: 'count', count: 2 }`，与 `config.ts` 形成**双写**。
- 这是早期 init 先于 config 出现的历史债，不是要照搬的"正例"。
- 迁移做法：让 PR template 加一条 "不要在 init 里写 cache"，逐步清理；或在 Core 的 `init()` 实现里加 dev 警告（"`cache` 出现在 init 调用里，请挪到 config"）。

---

## 案例 3：推广弹窗（Popups）

需求：与推广横幅同构——同一时间只弹一个 modal，可缓存，按优先级排序，可被 `openForce` 强制打开。

| 层 | 落地 |
|---|---|
| **Identity** | configKey camelCase（`npsSurveyModal`、`upgradePromptModal`） |
| **Contract** | `PopupConfig extends PluginCoreConfig`（与 Banner 共享 base，无 banner 专属字段） |
| **Registry** | `Popups/config.ts` |
| **Runtime Core** | **复用 banner 的 `createPluginCoreFactory`**，只换 `cachePrefix: 'popups'` 和不同的 slice 扩展 |
| **Provider Orchestration** | `popups/Provider/index.tsx`：等 `isAllInitialized()` 为真后按 `priority` reduce 选 openKey；专属逻辑（如 NPS 提交完关闭、Onboarding 登录后强制开）放在 `Popups/index.tsx` 的渲染层 |
| **Convention Folder** | `Popups/popups/[Name]/` |

**关键设计**：
- 这个案例最重要的洞察：**和横幅几乎同构，但状态独立**。横幅显示时弹窗也可以同时显示——它们不竞争，所以 store 完全分开。共享的是**机制**（cache 决策、生命周期）而非状态。
- 对照看 banner store 和 popup store——只有几个 slice 字段不同（横幅多 `renderHeight`、`dynamicRendered`），其他完全一样。这是"一份 Core，多个变种"的典型代码长相。

**关于"插件特有副作用"的真实例子**：
- NPS Survey 弹窗需要传 `surveyType` 这种**只它自己用**的额外 prop——做法是在 `Popups/index.tsx` 的 render 里特判 `key === 'npsSurveyModal'` 注入 prop。这是**渲染层 adapter** 的合理用法（Core 仍然不知道），不是 anti-pattern。
- 但如果**多个**插件都需要这种特判，就该升级 Contract 加一个"额外 props 提供者"字段，而不是继续叠特判。

**特别注意**：
- 复杂插件（`OnboardingExperiment`）内部还做了二次插件化——`domain/variant.ts` 维护 variant registry、`application/canShow.ts` 集中可见性判断。这是嵌套插件化的合法用法：当单个插件本身有多个变种时，复用同一套模式。

**代码级证据（呼应 SKILL.md「递归组合」与要点 h，框架无关地看这三处真实实现）**：

1. **二级 Contract 是"可辨识联合"，承载异质变种**。该插件的二级注册表 `domain/registry.ts` 把 A/B/C/D/E 五个变种登记进 `ONBOARD_VARIANT_REGISTRY`；其 Contract（`domain/variant.ts` 的 `OnboardVariantStrategy`）不是"一个组件"，而是：

   ```ts
   type OnboardVariantStrategy =
     | { mode: 'modal';     Component; modalWidth? }   // A/C/D/E：渲染型
     | { mode: 'sideEffect'; perform: (deps) => void } // B：副作用型（不渲染 UI，直接执行一个动作）
   ```

   编排层（`application/useOnboardExperiment.ts`）按 `strategy.mode` 分流——`modal` 走弹窗注册、`sideEffect` 走副作用触发，核心对此一无所知。这就是 SKILL.md「递归组合」说的"Contract 可承载行为型变种"。

2. **`force` 重算逃生阀**。`init` 对同一个 key 默认幂等短路（`initKeys.includes(key)` 就 return），但弹窗的"该不该显示"依赖登录态——用户登出再换号登入，`open` 会从 false→true，必须 `init({ key, open, force: true })` 才能把新状态送进去。真实注释写得很直白："没有它，A 账户关闭后换 B 账户登入，弹窗永远不会重新初始化。"`NpsSurveyModal/init.ts` 用的是同一招。这正是要点 h 的"重算逃生阀"。

3. **`cacheKeySuffix` 维度隔离**。横切的缓存键由 `prefix + key + suffix` 组成，suffix 带 `userId`（如 `${userId}_cache`），所以"已关闭一次/已终止"的记录按账号隔离，A 账户的关闭记录不会串到同设备的 B 账户。这正是要点 h 的"状态维度隔离"。

   > 三者都不是这个项目独有的奇技——它们是"声明式注册 + 横切状态"在真实运行时必然撞上的问题，所以被升进了通用方法论（背后的第一性原理见 [first-principles.md](first-principles.md)）。

---

## 案例 4：工具扩展（Extension Apps）

需求：每个 AI 工具（Motion、Relight、Shots…）是一个独立的 app，有自己的左侧表单、右侧展示区、SEO、路由。

| 层 | 落地 |
|---|---|
| **Identity** | `appKey: Labels`，**来自后端 schema**（`backend/schema/labels.ts`） |
| **Contract** | `AppConfig` interface（30+ 个可选字段：`appKey`、`displayName`、`fields`、`layout?`、`preGenerateComponent?` 等），通过 `defineAppConfig(config: AppConfig)` 工厂创建 |
| **Registry** | `src/pages/_block/extensions/index.ts`：数组 + 三个查表函数（`getExtensionConfigByAppKey`、`AppKeyToRoute`、`getFormTypeByAppKey`） |
| **Runtime Core** | `_components/_layout/WorkSpaceLayout.tsx`（默认布局）+ `AppCreationRecord` 渲染链路（按 `resultRendererType` 分发 `image`/`video`/`storyboard-grid`） |
| **Convention Folder** | `extensions/[name]/`：`index.tsx`（导出 `defineAppConfig(...)`）、`_components/`、`Fields/` |

**关键设计**：
- 主键来自**后端 schema 类型** — 前端 `appKey: Labels` 直接消费后端导出的字面量联合类型。
- 注册表附带**三套查表函数**：`appKey ↔ routeSegment ↔ formType`。这种"主键 + 多套映射"非常常见，把映射统一放在 registry 旁边，避免散落。
- 单插件内大量用 `dynamic()` 异步加载字段组件 — 不只是模块级延迟，**字段级延迟**也是这套模式的延展。
- `defineAppConfig` 没做任何运行时检查，只用类型约束 — `AppConfig` interface 有 30+ 个可选字段。这反映了**"宽核心，窄实现"**：Core 容忍各种可选项，单插件只填用得到的。

**关于 `Labels` 编译保障的精确说明**：
- 当前实现的保障**不是均一的**，需要拆开看：
  - ✅ `APP_FORM_TYPE_BY_KEY` 用了 `... as const satisfies Record<Labels, string>`——后端加新 Label 时这张表不补，会编译错。
  - ✅ `APP_ROUTE_SEGMENT_BY_KEY` 同样用了 `satisfies Record<Labels, string>`——同上。
  - ❌ **`extensionsConfig` 本身是一个数组**（不是 `Record<Labels, AppConfig>`），没有 `satisfies` 约束——也就是说**后端加新 Label 时，前端不补对应 AppConfig，仍然能编译通过**。
- 换句话说："新 Label → 必须配新 route 段、新 form_type"已经被 typecheck 强约束，但"新 Label → 必须配新完整 AppConfig"还**没有**被强约束。
- 真实的"加新 Label 必须建对应 extension"靠的是：team convention + 路由跳转时 `getExtensionConfigByAppKey` 返回 undefined。
- 如果想统一加强，可以把 `extensionsConfig` 改成：`{ [K in Labels]: AppConfig & { appKey: K } } satisfies Record<Labels, AppConfig>`——这是一个具体的改进空间。
- 一条评审清单的典型应用："typecheck 类规则可以用 satisfies 强约束"——映射部分已经用上了，主数组还没用上。

**特别注意**：
- "页面是否能进入"还依赖**后台数据库里的 FeatureFlag 记录**——这是插件化机制和外部数据的耦合点。一定要在文档里写明白这种隐式依赖，否则部署时会全栈级别的灵异 bug。

---

## 横向对比 — 四个案例的差异点

| 维度 | 站群 | 横幅 | 弹窗 | Extension Apps |
|---|---|---|---|---|
| **Identity 来源** | 顶层 enum | 自定义 | 自定义 | 后端 schema |
| **Contract 形状** | function `(input) => Config` | interface (~6 字段) | interface (~5 字段) | interface (~30 字段) |
| **Registry 形状** | `Record<key, getConfig>` | `Record<key, ...>` | `Record<key, ...>` | `Array<config>` + 查表函数 |
| **同时显示几个** | 1（按 host 匹配） | 1（按 priority） | 1（按 priority） | 1（按路由） |
| **缓存策略** | 无（每次新加载） | 四种可插拔 | 四种可插拔 | 无（受控于父路由） |
| **延迟加载** | 路由级（Next.js 自动） | 模块 `dynamic()` | 模块 `dynamic()` | 模块 + 字段两级 `dynamic()` |
| **Orchestrator 位置** | rewrites 配置 + Provider | `Provider/index.tsx` subscribe | `Provider/index.tsx` subscribe | Next.js route handler |
| **外部依赖** | rewrites、SEO 配置 | 埋点 | 埋点 | 后台 FeatureFlag 数据 + SEO |

**核心差异看注册表形状**：
- 用 Record 还是 Array？Record 适合"主键即查询条件"的场景，Array 适合"需要按顺序枚举 / 多种方式查询"的场景。
- 用 Array 时一定要提供配套查表函数（不要让消费方自己 `array.find(...)`）。

## 当你的需求对不上任何一个案例

可能是因为：

- **变种太少**（< 3） → 先用 if-else，等真要加第 4 个时再插件化（YAGNI）。
- **变种之间几乎没共性** → 不要强求统一抽象，每种独立写。
- **本身就是框架原生的扩展点**（Next.js pages、VSCode contribution） → 顺着框架做，不自己再造一层。
- **运行时动态注册**（从 DB 拉配置、运营后台投放） → 这是另一种插件化（动态注册表 / inventory），不在本 skill 主要范围。需要先分流：**static code plugin**（开发者写代码 + 编译期注册）vs **runtime inventory**（运营在后台勾选 + 数据库存储 + 前端运行时拉取）。后者除了本 skill 的五件套，还需要数据模型 + 运营 UI + 缓存失效策略 —— 别用同一个名字混在一起谈。
