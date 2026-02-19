# Header 顶部质感与滚动阴影分态优化（Claymorphism）

## Background

- 当前 Header 使用固定阴影层级，顶部与滚动态缺少视觉分层，顶部质感显得不够干净。
- 设计目标是保持全宽贴顶结构，同时让滚动后才出现更明确的层次阴影。
- 项目已有 Soft 3D Claymorphism token，需要在现有系统内完成状态化增强。

## Goals

- 顶部状态保持轻量、干净，不出现厚重常驻阴影。
- 滚动超过阈值后，Header 阴影轻微增强，形成清晰层级变化。
- 保持 sticky 行为、导航与主题切换交互不变。
- 不改变正文与 Footer 布局宽度策略。

## Scope

- In scope:
- 新增 Header 滚动状态观察器组件。
- 在 Header 接入观察器并添加专用样式挂载类。
- 在 `custom.css` 增加顶部态/滚动态阴影规则与过渡。

- Out of scope:
- 不修改站点数据结构、配置接口、主题逻辑。
- 不调整 Footer 和页面主体排版结构。
- 不新增外部依赖。

## Proposed Solution

- 新增客户端组件 `header-scroll-shadow-observer.tsx`：
- 监听 `scroll`（passive）和 `resize`。
- 阈值固定为 `window.scrollY > 4`。
- 仅写入 `document.documentElement.dataset.headerScrolled`，不使用 React state。

- Header 接入：
- 在 `<header>` 中挂载观察器组件。
- 给 Header 的 `ClaySurface` 增加 `site-header-surface` 类。

- 样式分态：
- `.site-header-surface` 顶部态默认 `box-shadow: none`（更干净）。
- `:root[data-header-scrolled="true"] .site-header-surface` 切换到 `var(--shadow-clay-raised)`（轻微增强）。
- 过渡时长 200ms，保持 clay 体系的平滑节奏。

## Risks

- Technical risks:
- 顶部态如果阴影过弱，可能降低 Header 与页面内容的层级区分。
- 滚动阈值过低可能在轻微滚动下频繁切换。

- Delivery risks:
- 仓库当前存在并行改动，后续合并可能出现局部冲突。

- Mitigations:
- 保留底部分隔边框，维持基础层级感。
- 仅在状态变化时写入 data 属性，减少不必要更新。
- 用 lint/typecheck/build 和手工滚动验证双态表现。

## Acceptance Criteria

- [ ] 顶部初始状态下 Header 视觉更轻，不出现常驻厚阴影。
- [ ] 滚动超过 4px 后 Header 阴影变为 `--shadow-clay-raised`。
- [ ] 回到顶部后阴影恢复顶部态。
- [ ] sticky、导航、主题切换交互行为正常。
- [ ] `lint`、`typecheck`、`build` 校验通过。
