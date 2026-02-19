# 全站 Header/Footer 公共壳层改造（Claymorphism）

## Background

- 当前首页、技能详情页、404 页面都在各自文件中维护顶部/底部安全区与页高逻辑，缺少统一的站点壳层。
- 随着页面增多，重复实现 Header/Footer 会增加维护成本，不利于后续导航和品牌区扩展。
- 项目已经有 Soft 3D Claymorphism 的样式约束，需要在统一壳层中延续同一视觉语言。

## Goals

- 在根布局中引入全局 Header/Footer，所有页面自动继承。
- Header 与 Footer 支持配置驱动，新增导航或链接无需改动组件结构。
- 使用 `/logo_medium_64x64.png` 作为品牌 logo，在移动端和桌面端均保持清晰与合理占位。
- 保持现有 Clay 组件体系与 safe-area 节奏规则。

## Scope

- In scope:
- 新增站点布局配置文件与类型定义。
- 新增 `SiteHeader`、`SiteFooter`、`SiteShell` 三个布局组件。
- `app/layout.tsx` 接入公共壳层。
- 调整首页、技能详情页、404 页面，移除页面级 safe-area 与 `min-h-screen` 依赖。
- 增加少量样式辅助类（仅用于壳层与页面垂直节奏）。

- Out of scope:
- 不引入多级导航、汉堡菜单、主题切换等复杂交互。
- 不调整现有业务数据流、路由结构和后端接口。

## Proposed Solution

- 采用结构：`body > SiteShell > Header + main + Footer`，其中 Header 采用 `sticky top-0`。
- Header 外层承接 `safe-area-top`，Footer 外层承接 `safe-area-bottom`，页面内容仅负责主内容排版。
- 配置层提供以下可复用接口：
- `SiteNavItem`
- `FooterLinkItem`
- `FooterLinkGroup`
- `SiteBrand`
- Header 使用 `ClaySurface` + logo + 配置导航，外链统一 `target="_blank"` + `rel="noreferrer"`。
- Footer 使用双区块结构：左侧品牌/说明/安装命令，右侧配置化链接组，底部展示动态年份版权信息。
- 通过 `site-shell` / `site-page-shell` utility class 统一壳层层级与页面上下留白。

## Risks

- Technical risks:
- 吸顶 Header 可能遮挡页面首屏内容。
- 小屏导航可能出现换行拥挤。
- 404 页面在去掉 `min-h-screen` 后可能失去视觉居中感。

- Delivery risks:
- 当前工作区存在其他未提交改动，合并时可能出现样式冲突。

- Mitigations:
- 使用流式布局的 sticky header，避免绝对定位遮挡。
- Header 导航采用可换行布局并控制项宽。
- 404 页面设置最小可视高度段（`min-h-[52vh]`）保持居中体验。
- 只修改计划内文件，避免扩大冲突面。

## Acceptance Criteria

- [ ] 全站页面均渲染统一 Header/Footer，不需要单页重复实现。
- [ ] Header/Footer 内容由配置驱动，新增链接无需修改组件结构。
- [ ] UI 保持 Soft 3D Claymorphism 视觉规范并通过人工检查。
- [ ] Header/ Footer logo 使用 `logo_medium_64x64.png`，尺寸在移动端和桌面端都合适。
- [ ] `lint`、`typecheck`、`build` 检查通过。
