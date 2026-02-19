# 全站宽屏化与 Header 贴顶优化（Claymorphism）

## Background

- 现有站点在宽屏下整体容器偏窄，Header、Footer 和页面主内容在 2K 屏幕上留白过多。
- Header 使用 `safe-area-top` 工具类，包含 `safe-area + page-space-y`，导致桌面端顶部出现额外 24/40px 空隙。
- 项目已建立 Soft 3D Claymorphism 设计体系，需要在扩大画幅时保持现有视觉契约。

## Goals

- 让 Header、Footer、首页、详情页和 404 页面在宽屏下统一扩展到更大容器宽度。
- Header 实现贴顶显示，仅保留刘海安全区，不再叠加页面垂直留白。
- 引入可复用的站点级容器 token 和工具类，替代分散的 `max-w-* + px-*` 写法。
- 保持组件风格和可读性，避免“变宽后文本过长”的阅读疲劳。

## Scope

- In scope:
- 在 `custom.css` 新增站点宽度 token 与 frame 工具类。
- 新增 `safe-area-top-edge` 工具类，并保留 `safe-area-bottom` 原语义。
- 改造 `site-header.tsx` 与 `site-footer.tsx` 的容器宽度与顶距策略。
- 改造 `page.tsx`、`skills/[slug]/page.tsx`、`not-found.tsx` 的主容器宽度类。
- 将首页与详情页的正文段落 `max-w-3xl` 提升至 `max-w-4xl`。

- Out of scope:
- 不调整 Header 导航信息架构和 Footer 信息结构。
- 不新增断点体系、不改动路由和业务数据结构。
- 不修改 Clay 颜色与阴影 token。

## Proposed Solution

- 在 `:root` 中新增：
- `--site-gutter-mobile: 20px`
- `--site-gutter-desktop: 32px`
- `--site-gutter: var(--site-gutter-mobile)`
- `--site-max-wide: 1400px`
- `--site-max-main: 1400px`
- `--site-max-detail: 1320px`
- `--site-max-narrow: 1080px`
- 在 `@media (min-width: 768px)` 中将 `--site-gutter` 切换为 desktop。

- 新增通用容器工具类：
- `.site-frame`
- `.site-frame--wide`
- `.site-frame--main`
- `.site-frame--detail`
- `.site-frame--narrow`

- 新增 `.safe-area-top-edge`，仅保留 `var(--safe-area-top)`，用于 Header 贴顶。
- Header 调整为：
- `safe-area-top-edge sticky top-0 z-40`
- 容器使用 `site-frame site-frame--wide`
- ClaySurface 内边距从 `px-4 py-3 md:px-5` 调整为 `px-5 py-3.5 md:px-6`

- Footer 调整为：
- 外层去除 `px-*`
- 容器使用 `site-frame site-frame--wide`

- 页面主内容容器调整为：
- 首页：`site-page-shell site-frame site-frame--main`
- 技能详情：`site-page-shell site-frame site-frame--detail`
- 404：`site-page-shell site-frame site-frame--narrow`

## Risks

- Technical risks:
- 容器变宽后，局部卡片在中间断点可能显得内容稀疏。
- Header 贴顶后视觉“留白仪式感”减弱。

- Delivery risks:
- 工作区已有较多并行改动，合并时可能产生样式冲突。

- Mitigations:
- 保持正文段落宽度限制，仅放开外层容器。
- 通过 ClaySurface 的层次与阴影维持 Header 视觉权重。
- 仅触达计划范围文件，降低冲突面。

## Acceptance Criteria

- [ ] 桌面端 Header 贴顶，无额外 24/40px 顶部空隙。
- [ ] Header/Footer/首页/详情页/404 页面宽度策略统一，宽屏展示更大气。
- [ ] 首页与详情页文本阅读宽度仍可控，不出现明显“长行难读”。
- [ ] 小屏下导航与主题按钮可正常换行且不溢出。
- [ ] `lint`、`typecheck`、`build` 校验通过。
