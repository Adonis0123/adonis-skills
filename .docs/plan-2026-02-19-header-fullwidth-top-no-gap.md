# Header 全宽贴顶改造（Claymorphism）

## Background

- 当前 Header 虽然在视觉上已贴近顶部，但仍处于容器宽（`site-frame--wide`）模式，不是完整全宽条带。
- 在宽屏设备下，Header 左右边缘仍有较大留白，和“全宽贴顶”的预期不一致。
- 项目遵循 Soft 3D Claymorphism 风格，需要在全宽化时保持材质层次和低对比视觉契约。

## Goals

- 将 Header 调整为整条全宽材质条，顶部无额外留白。
- 保留 Header 内部内容与主容器对齐，避免元素贴屏边。
- 保持 sticky 行为、主题切换和导航交互不变。
- 不影响正文/页脚宽度策略。

## Scope

- In scope:
- 调整 `site-header.tsx` 结构为“全宽外壳 + 容器内芯”。
- 保持 `safe-area-top-edge` 顶部安全区逻辑（仅 inset）。
- 通过最小类名改动实现全宽条带视觉。

- Out of scope:
- 不改 Footer 与页面主体容器宽度。
- 不改站点配置、主题切换逻辑、颜色 token 与阴影 token。
- 不新增 Header 之外的组件或全局样式体系。

## Proposed Solution

- 结构从 `header > site-frame > ClaySurface` 改为 `header > ClaySurface(full-bleed) > site-frame`。
- Header 继续使用 `safe-area-top-edge sticky top-0 z-40`，不使用 `safe-area-top`。
- ClaySurface 调整为全宽条带样式：
- `rounded-none`（取消卡片型外轮廓）
- 去掉左右与顶部边框（保留底部分隔语义）
- 保留现有 backdrop 与 clay tone/elevation 体系
- 内容层使用 `site-frame site-frame--wide` 维持对齐与可读性。

## Risks

- Technical risks:
- 全宽条带在暗色主题下可能显得视觉重量偏高。
- 取消圆角后与其他卡片组件的层次关系需要人工确认。

- Delivery risks:
- 当前仓库已有多处并行改动，后续合并时需注意 Header 文件冲突。

- Mitigations:
- 保持现有 token，不额外增加阴影强度。
- 用 `lint/typecheck/build` + 手工预览确认亮暗主题的一致性。

## Acceptance Criteria

- [ ] Header 在桌面端视觉上完整全宽，左右边缘不再受容器限制。
- [ ] Header 顶部无额外留白，仅保留设备安全区 inset。
- [ ] Header 内部内容仍与 `site-frame--wide` 对齐。
- [ ] sticky、导航、主题切换交互正常。
- [ ] `lint`、`typecheck`、`build` 全部通过。
