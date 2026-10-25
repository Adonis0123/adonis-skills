---
version: alpha
name: Nika Skills
description: Catalog site for Nika's agent skills. Near-white cool gray pages, one saturated leaf-green accent used on small areas, and the clay characters Nika and Kiki carrying the brand through every section.
# colors: injected by adonis-skills `pnpm brand:sync` from design-system/tokens.json (theme picked by
#   projects/skills/theme.json designSystem.accent). Light roles keep their name; dark roles get a
#   `-dark` suffix. Never write hex here.
typography:
  display:
    fontFamily: Bricolage Grotesque, Noto Sans SC, sans-serif
    fontSize: 70px
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: -0.035em
  h2:
    fontFamily: Bricolage Grotesque, Noto Sans SC, sans-serif
    fontSize: 34px
    fontWeight: 750
    lineHeight: 1.1
    letterSpacing: -0.03em
  h3:
    fontFamily: Bricolage Grotesque, Noto Sans SC, sans-serif
    fontSize: 24px
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: -0.025em
  card-title:
    fontFamily: Bricolage Grotesque, Noto Sans SC, sans-serif
    fontSize: 16px
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Noto Sans SC, sans-serif
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: Noto Sans SC, sans-serif
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.7
  body-sm:
    fontFamily: Noto Sans SC, sans-serif
    fontSize: 13.5px
    fontWeight: 400
    lineHeight: 1.55
  button:
    fontFamily: Noto Sans SC, sans-serif
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1
  mono:
    fontFamily: IBM Plex Mono, monospace
    fontSize: 12.5px
    fontWeight: 500
    lineHeight: 1.6
  wordmark:
    fontFamily: Shantell Sans, cursive
    fontSize: 20px
    fontWeight: 800
    lineHeight: 1
    letterSpacing: -0.01em
rounded:
  xs: 6px
  sm: 10px
  md: 12px
  lg: 16px
  xl: 22px
  plate: 28px
  full: 9999px
spacing:
  gutter-mobile: 20px
  gutter-desktop: 32px
  content-max: 1280px
  section: 72px
  group: 44px
  card-gap: 14px
  card-padding: 18px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    height: 46px
    padding: 0 20px
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    height: 46px
    padding: 0 20px
  skill-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.card-padding}"
  featured-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: 26px
  featured-card-lead:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: 26px
  tag:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.xs}"
    height: 22px
    padding: 0 8px
  chip:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.full}"
    height: 36px
  chip-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.full}"
    height: 36px
  command-box:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    height: 46px
  search-bar:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: 18px
    height: 62px
  art-plate:
    backgroundColor: "{colors.plate}"
    rounded: "{rounded.plate}"
  footer:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.foreground}"
  footer-dark:
    backgroundColor: "{colors.background-dark}"
    textColor: "{colors.foreground-dark}"
---

# Nika Skills 设计规范

给人和 AI agent 共用。本文是唯一来源：放在私有品牌仓库 `adonis-brand/projects/skills/DESIGN.md`，adonis-skills 跑 `pnpm brand:sync` 时把它复制到仓库根目录的 `DESIGN.md`，并从 `design-system/tokens.json` 注入文件头的 `colors`（主题由 `projects/skills/theme.json` 的 `designSystem.accent` 选，现在是 `leaf`）。格式遵循 [google-labs-code/design.md](https://github.com/google-labs-code/design.md)（`version: alpha`），adonis-skills 的 CI 跑 `designmd lint`。

颜色规则以设计系统 `design-system/README.md` 为准，本文只写这个站点怎么用。决策记录：`process/2026-10-18-skills-site-redesign.md`（v3 改版）、`process/2026-10-24-design-system.md`（改用设计系统）。

## Overview

一本摊开的、干净的技能手册：页面几乎无彩，是近白的冷灰；唯一的强调色是叶绿，只出现在小面积；暖色和高饱和交给黏土角色尼卡（Nika）和琪琪（Kiki），他们从首屏一直陪到页脚。

- 界面安静，角色热闹。插画是页面里唯一大面积的暖色区域。
- 叶绿只做“点亮”：主按钮、标签、选中态、链接、悬停边框、焦点环。
- 访客先找到要的 skill，再被品牌打动。目录可读性优先于装饰。

## Colors

站点只用设计系统的语义角色（`var(--primary)` 等），不写死色值，也不带后备色。adonis-skills 里 `brand-tokens.css`（色阶）和 `theme-roles.css`（角色）都是生成文件。

| 角色 | 用在 |
|---|---|
| `background` / `card` / `popover` | 页面、卡片、浮层。中性色阶是冷灰 `neutral` |
| `foreground` / `muted-foreground` / `subtle-foreground` | 正文、次要文字、占位符 |
| `border` / `border-strong` / `input` | 分隔线、强调边框、可交互边框 |
| `hover` | 次按钮悬停底 |
| `primary` / `primary-foreground` | 主按钮：叶绿饱和原色配白字，浅色 #568C11、深色 #64A400 |
| `accent` / `accent-foreground` | 标签、选中的 chip |
| `tint` / `tint-border` | 大面积浅绿和绿色边：hero 光晕、首张精选卡、安装面板、搜索框聚焦，以及卡片、chip、次按钮的悬停边框 |
| `link` / `ring` | 链接和小标题、焦点环 |
| `shadow-accent` | 主按钮和搜索框的叶绿柔光，深色模式为 `none` |
| `plate` / `plate-border` | 浅色模式的插画衬底和页脚（暖纸）；深色模式不用 |
| `page-tint` | 页面顶部 180px 的淡绿渐变 |

- 主按钮白字对比度浅色 4.07、深色 3.06，低于 4.5 是设计系统的有意取舍（见设计系统 README「按钮规则」）；`pnpm brand:sync` 按 3.0 检查这一对，其余文字仍按 4.5。
- 主按钮悬停是站点自己加的：在 `primary` 上叠一层 14% 阴影墨色（`--primary-hover-veil`，主题层里唯一允许的混色公式），深浅两种模式都变深，白字对比只升不降。设计系统没有 hover 角色。
- 蓝、琥珀只给角色（logo、插画），界面不用。

## Typography

| 用途 | 字体 | 规格 |
|---|---|---|
| 展示标题（拉丁） | Bricolage Grotesque | 800，字距 -0.035em；h2/h3 750 |
| 标题（中文） | Noto Sans SC | 跟随同一 token 的字号 |
| 正文 | Noto Sans SC | 400，15/1.7；导语 18/1.6；小字 13.5/1.55 |
| 按钮 | Noto Sans SC | 500，主次按钮和复制按钮一样 |
| 字标 | Shantell Sans | 800，全小写 “nika skills”，只用于字标 |
| 代码、slug、命令 | IBM Plex Mono | 500，12.5/1.6 |

- `font-family` 写成 “拉丁展示字体, Noto Sans SC, sans-serif”：拉丁字形由 Bricolage 渲染，中文自动落到 Noto Sans SC。
- 中文标题不加负字距（负字距只给拉丁），中文正文行高不低于 1.7。
- 按钮字重 500，不用 600：设计系统统一规定，12–15px 中文用 600 发闷。
- slug 一律等宽小字，作为人话名称（Display Name）的副标题，不当标题。
- 所有字体经 fontsource 自托管，构建不访问 Google Fonts。

## Layout

- 内容最大宽 1280px，左右留白手机 20px、桌面 32px，页头与内容左缘对齐。
- 首页顺序：页头 → hero（左文案、右插画，下方大搜索框与场景跳转 chip）→ 3 张精选卡 → 按场景分组的目录 → 安装区 → 页脚。
- 场景分组：桌面左侧 280px 放分组头（插画、编号、组名、一句说明，滚动时吸顶），右侧三列卡片；手机分组头在上，卡片单列。
- 区块之间 72px，分组之间 44px 并用一条 `border` 分隔；同一层级的卡片间距 14px。
- 手机首屏必须看到搜索框和至少一个场景 chip。

## Elevation & Depth

- 分层先靠底色：`background` 上放 `card`，首张精选卡用 `tint`。阴影只做辅助。
- 静止的卡片几乎无阴影（浅色 1px 极淡投影，深色无）。悬停时上移 2–3px，边框换 `tint-border`，加一层中性色相的柔和投影。
- 只有主按钮和搜索框带 `shadow-accent` 叶绿柔光；其他投影用中性色相。
- 不加底部硬边（`0 Npx 0`），按钮不加内侧高光。
- 深色模式下投影几乎不可见，层级只靠换阶。

## Shapes

| 元素 | 圆角 token |
|---|---|
| 插画衬底 | `plate` 28px |
| 精选卡、详情页安装面板 | `xl` 22px |
| 普通卡、浮层 | `lg` 16px |
| 命令框、菜单 | `md` 12px |
| 输入框、图标按钮、语言切换 | `sm` 10px |
| 描边复制按钮 | 9px |
| 标签 | `xs` 6px |
| 主次按钮、实心复制按钮、chip、徽标 | `full` |

## Components

- **主按钮** `button-primary`：`primary` 底、白字、字重 500、胶囊；悬停叠 `--primary-hover-veil` 变深并上移 1px，按下回落；带 `shadow-accent`。一屏只放一个主按钮。
- **次按钮** `button-secondary`：`card` 底加 `input` 边框；悬停底换 `hover`，边框换 `tint-border`。
- **搜索框** `search-bar`：62px 高，`card` 底，带 `shadow-accent`；聚焦时边框换 `tint-border`，外加 4px `tint`；键盘聚焦改用 `ring` 加 `ring-halo`。右侧显示结果数（等宽小字）。
- **场景 chip** `chip`：左侧 26px 圆形角色头像，组名，等宽计数；悬停边框换 `tint-border`，选中用 `accent`。
- **精选卡** `featured-card`：编号、角落徽标、角色插画、人话名称、slug、一句说明、2 条要点、命令框加实心复制按钮。第一张用 `featured-card-lead`（`tint` 底、`tint-border` 边）。
- **普通卡** `skill-card`：人话名称、slug、最多 3 行说明、标签、右下角描边复制按钮；整卡可点进入详情，复制按钮单独可点。
- **复制按钮**：实心版就是小号主按钮（`primary` 底、胶囊、悬停同样叠 `--primary-hover-veil`）；描边版 `card` 底，悬停边框换 `tint-border`、字换 `link`；失败时边框和字换 `danger-text`。
- **分组头**：圆形角色插画，`plate` 衬底，编号加数量（`01 · 5 skills`），组名，一句说明。
- **命令框** `command-box`：`background` 底加 `border`，前缀 `$` 用 `link` 色，长命令省略号截断。
- **标签** `tag`：`accent` 底、`accent-foreground` 字，无边框；第二个及以后用中性 `muted` 底。
- **详情页安装面板**：浅色 `tint` 底加 `tint-border` 边，深色换 `card` 底、保留绿边。
- **页脚** `footer`：浅色 `plate` 暖纸底，深色换 `background`（`footer-dark`）。
- **空状态**：120px 角色插画，“没找到”一句话，加一个清空搜索的按钮。
- **焦点**：只在 `:focus-visible` 显示；有边框的控件把边框换成 `ring` 并贴一圈 3px `ring-halo`，实心主按钮用 2px `ring` 外描边、偏移 2px。

## Illustration

- 黏土质感，光源是尼卡手里的灯（暖黄，从左上照）。
- 所有插画用透明背景，同一张图在浅深两种模式都能用；衬底由界面提供，不画进图里。
- 用到插画的位置：hero、3 张精选卡、场景分组头、空状态、页脚。普通卡不配插画。
- 出图必须附参考图（`projects/skills/hero/` 与主角设定图），角色颜色、比例不能漂移；图里不出现文字。

## Dark Mode

- 深色只用一套底：冷灰 `neutral` 的深色阶。暖纸 `plate` 和深色 `tint`（暗橄榄绿）放在冷灰旁边发褐、发脏，所以插画衬底和头像底换 `card`，衬底外圈用 `border`；页脚换 `background`；首张精选卡和安装面板换 `card` 底，只保留 `tint-border` 绿边。
- hero 顶部光晕和 `page-tint` 保留：它们是渐变到页面底色的淡光，不是一块底。
- 主按钮换深色 solid #64A400，仍是白字；`shadow-accent` 为 `none`。
- 投影几乎不可见，层级靠换阶。

## Do's and Don'ts

- Do：页面用冷灰 `neutral`；暖纸只给浅色模式的插画衬底和页脚。
- Do：叶绿只用在小面积；大面积浅绿用 `tint`，悬停边框用 `tint-border`。
- Do：卡片标题用人话名称，slug 做等宽副标题。
- Don't：主按钮用近黑字、渐变或加深到发灰的绿；按钮字重 600 以上。
- Don't：悬停时边框变灰（`border-strong`），或主按钮悬停没有颜色变化。
- Don't：组件和页面 CSS 里写 hex、`rgb()`、`color-mix` 或后备色；唯一的混色是主题层 `shadcn-theme.css` 里阴影墨色混透明（投影和主按钮悬停）。
- Don't：深色模式混用暖纸、暗绿和冷灰三种底。
- Don't：用蓝、琥珀做界面强调色；在中文上用 Shantell Sans 或 Bricolage Grotesque。
- Don't：给按钮或卡片加底部硬边阴影。

## Iteration

- 改色只改 `design-system/tokens.json`（全局）或 `theme.json` 的 `designSystem.accent`（换主题），跑 `design-system/check.py`，写一篇 `process/` 记录，提交品牌仓库，再到 adonis-skills 跑 `pnpm brand:sync` 并提交快照。
- 改本文后同样跑 `pnpm brand:sync`，adonis-skills 根目录的 `DESIGN.md` 会更新，CI 跑 `designmd lint`。
- 一次只改一个组件，改完在浅深两种模式和 390px 手机宽度下核对。
