---
version: alpha
name: Nika Skills
description: Catalog site for Nika's agent skills, drawn in a rubber-hose cartoon look. Warm cream paper, thick hand-inked outlines with slightly uneven corners, flat watercolour colour with a dusty blue wash under raised things, hand lettering, one deep teal accent, and the ink & watercolor characters Nika and Kiki carrying the brand through every section.
# colors: injected by adonis-skills `pnpm brand:sync` from design-system/tokens.json (theme picked by
#   projects/skills/theme.json designSystem.accent, plus the project's registered role overrides in
#   designSystem.roles). Light roles keep their name; dark roles get a `-dark` suffix. Never write hex here.
typography:
  display:
    fontFamily: Kalam, Noto Sans SC, sans-serif
    fontSize: 70px
    fontWeight: 700
    lineHeight: 1.16
  h2:
    fontFamily: Kalam, Noto Sans SC, sans-serif
    fontSize: 34px
    fontWeight: 700
    lineHeight: 1.1
  h3:
    fontFamily: Kalam, Noto Sans SC, sans-serif
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.15
  card-title:
    fontFamily: Kalam, Noto Sans SC, sans-serif
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.3
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
    fontFamily: Kalam, Noto Sans SC, sans-serif
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1
  mono:
    fontFamily: IBM Plex Mono, monospace
    fontSize: 12.5px
    fontWeight: 500
    lineHeight: 1.6
  wordmark:
    fontFamily: Kalam, cursive
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1
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
  ink-width: 2.5px
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
  featured-number:
    backgroundColor: "{colors.mustard}"
    textColor: "{colors.mustard-foreground}"
    typography: "{typography.button}"
  tag:
    backgroundColor: "{colors.mustard}"
    textColor: "{colors.mustard-foreground}"
    rounded: "{rounded.full}"
    height: 22px
    padding: 0 5px
  tag-neutral:
    backgroundColor: "{colors.dusty}"
    textColor: "{colors.dusty-foreground}"
    rounded: "{rounded.full}"
    height: 22px
    padding: 0 5px
  chip:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.button}"
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
  ink-outline:
    backgroundColor: "{colors.ink}"
    size: "{spacing.ink-width}"
  wash:
    backgroundColor: "{colors.wash}"
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

给人和 AI agent 共用。本文是唯一来源：放在私有品牌仓库 `adonis-brand/projects/skills/DESIGN.md`，adonis-skills 跑 `pnpm brand:sync` 时把它复制到仓库根目录的 `DESIGN.md`，并从 `design-system/tokens.json` 注入文件头的 `colors`（主题由 `projects/skills/theme.json` 的 `designSystem.accent` 选，现在是 `teal`；本站登记的例外角色写在同一文件的 `designSystem.roles`）。格式遵循 [google-labs-code/design.md](https://github.com/google-labs-code/design.md)（`version: alpha`），adonis-skills 的 CI 跑 `designmd lint`。

颜色规则以设计系统 `design-system/README.md` 为准，本文只写这个站点怎么用。决策记录：`process/2026-11-19-skills-rubber-hose.md`（本版，待主人确认）、`process/2026-10-18-skills-site-redesign.md`（v3 改版）、`process/2026-10-24-design-system.md`（改用设计系统）。风格来源：[finktheartist/rubber-hose-ui](https://github.com/finktheartist/rubber-hose-ui)（MIT），只借它的界面画法，不嵌入它的组件。

## Overview

一本画在暖纸上的卡通技能手册：页面是奶油色纸面，卡片、按钮、输入框都用深棕墨线勾一圈，角略微不齐，像手画的；颜色平涂，浮起的东西下面晕一层灰蓝水彩。唯一的强调色是深青绿（Nika 外套的颜色），芥末黄和番茄红只做小点缀。

- 线稿统一，界面安静：30 多张目录卡并排时，墨线和圆角的不规则要轻，读起来是一页整齐的手稿，不是一堆抖动的框。
- 青绿只做“点亮”：主按钮、选中态、链接、焦点环。
- 访客先找到要的 skill，再被品牌打动。目录可读性优先于装饰：正文、说明和命令不用手写字。

## Colors

站点只用设计系统的语义角色（`var(--primary)` 等），不写死色值，也不带后备色。adonis-skills 里 `brand-tokens.css`（色阶）和 `theme-roles.css`（角色）都是生成文件。

本站是设计系统原则 1（中性色只用冷灰）的登记例外：浅色模式的中性角色改取暖奶油 `cream` 色阶（`tokens.json` 新增，比插画衬底用的 `paper` 更暖更黄），深色模式仍是冷灰 `neutral`。覆盖写在 `theme.json` 的 `designSystem.roles`，只引用 `tokens.json` 的色阶，不改别的项目在用的值。

| 角色 | 用在 |
|---|---|
| `background` / `card` / `popover` | 浅色：页面暖奶油 cream-3、卡片更浅的奶油 cream-2；深色：冷灰 |
| `foreground` / `muted-foreground` / `subtle-foreground` | 正文（深棕墨）、次要文字、占位符 |
| `ink` | 手绘描边：浅色深棕墨 cream-12，深色浅奶油墨 paper-10。卡片、按钮、输入框、chip、命令框、标签页、菜单、分隔线都用它 |
| `wash` | 浮起元素下面的灰蓝水彩晕，只当模糊投影的颜色用；深色模式为 `transparent`（关掉） |
| `dusty` / `dusty-foreground` | 灰蓝标签底（第二个及以后的标签），配深棕墨字 |
| `border` / `border-strong` / `input` | 表格行线、内部细分隔这类次要细线；主要轮廓一律用 `ink` |
| `hover` | 次按钮悬停底 |
| `primary` / `primary-foreground` | 主按钮：青绿饱和原色配白字，深浅共用 |
| `accent` / `accent-foreground` | 选中的 chip、选中态；浅色字用 teal 第 12 阶，保证在奶油上叠的淡青底上 ≥ 4.5 |
| `mustard` / `mustard-foreground` | 芥末黄小点缀：精选卡的编号胶囊、卡片的第一个标签 |
| `tomato` | 番茄红小点缀，只用于非文字记号（精选卡要点前的小方点） |
| `tint` | 浅色为最浅的奶油 cream-1：安装面板、首张精选卡 |
| `link` / `ring` | 链接和小标题、焦点环（浅色用 teal 第 11 阶，在卡片上 5.3:1） |
| `plate` / `plate-border` | 浅色模式的插画衬底和页脚（cream-2，和卡片同色）；深色模式不用 |
| `page-tint` | 本站深浅两种模式都是平涂的 `background`，不加顶部渐变 |

- 主按钮白字对比度 4.10，低于 4.5 是设计系统的有意取舍（见设计系统 README「按钮规则」）；`pnpm brand:sync` 按 4.0 检查这一对，其余文字仍按 4.5。
- `ink` 在卡片和页面上要 ≥ 3:1（非文字），`mustard-foreground` 在 `mustard` 上 ≥ 4.5；这几对由 adonis-skills 的 `pnpm brand:sync` / `brand:check` 检查（`check.py` 不读项目角色）。
- 主按钮悬停是站点自己加的：在 `primary` 上叠一层 14% 阴影墨色（`--primary-hover-veil`），深浅两种模式都变深。
- 蓝、紫只给角色（Kiki），界面不用。

## Typography

| 用途 | 字体 | 规格 |
|---|---|---|
| 展示标题、h2、h3、卡片标题（拉丁） | Kalam Bold | 700，带倾斜的毛笔手写体，不用合成加粗 |
| 标题（中文） | Noto Sans SC | 字重、行高和改版前一样（800 / 750 / 650） |
| 导航、按钮、chip、标签页、字标（拉丁） | Kalam Bold | 700，导航和 chip 16px；词间距收紧 0.14em（标题 0.1em），Kalam 默认词距太宽；中文标签仍是 Noto Sans SC 500 |
| 正文、说明 | Noto Sans SC | 400，15/1.7；导语 18/1.6；小字 13.5/1.55 |
| 代码、slug、命令 | IBM Plex Mono | 500，12.5/1.6 |

- `font-family` 写成 “Kalam, Noto Sans SC, sans-serif”：Kalam 没有中文字形，中文自动落到 Noto Sans SC。中文手写体待主人决定。
- 手写字不加负字距；中文标题不加字距，中文正文行高不低于 1.7。
- Kalam 的 x-height 约 0.52，和 Noto Sans SC 的 0.55 接近，不需要 `font-size-adjust`。
- 展示标题行高拉丁 1.16、中文 1.3：Kalam 的 g、y、j 下伸部长，1.02 会压到下一行。
- 14px 以下不用手写字：太小看不清。标签、小徽标、命令框里的复制胶囊用正文字体。
- 导语、卡片说明和文档正文不用手写字：倾斜的手写体在长句里扫读慢，手写字只给短标签和标题。标题必须比下面的文字大一级（文档小标题 20–24px）。
- slug 一律等宽小字，作为人话名称（Display Name）的副标题，不当标题。
- 所有字体经 fontsource 自托管（`@fontsource/kalam` 锁精确版本，SIL OFL），构建不访问 Google Fonts。

## Layout

- 内容最大宽 1280px，左右留白手机 20px、桌面 32px，页头与内容左缘对齐。
- 首页顺序：页头 → hero（左文案、右插画，下方大搜索框与场景跳转 chip）→ 3 张精选卡 → 按场景分组的目录 → 安装区 → 页脚。
- 场景分组：桌面左侧 280px 放分组头（插画、编号、组名、一句说明，滚动时吸顶），右侧三列卡片；手机分组头在上，卡片单列。
- 区块之间 72px，分组之间 44px 并用一条 `ink` 手绘分隔线；同一层级的卡片间距 14px。
- 手机首屏必须看到搜索框和至少一个场景 chip。
- 本版只换画法，不改布局、文案和路由。

## Elevation & Depth

- 分层先靠墨线和底色：`background` 纸面上放 `card` 奶油卡，外面一圈 2.5px `ink`。
- 浮起的东西（主次按钮、搜索框、插画衬底、精选卡、悬停的卡片、浮层）下面晕一层看得见的 `wash` 灰蓝：向下偏移 7–14px、模糊 3–6px，略向右偏 1–3px，像水彩在纸上洇开。静止的目录卡只有一层很窄的晕，保持安静。悬停时上移 2–3px，晕得更开。
- 永远不用零模糊的偏移投影（`0 Npx 0 …`）：这不是新粗野主义，仓库也禁止底部硬边。
- 浅色页面底有一层很淡的纸纹（纯 CSS 噪点平铺）；不加胶片颗粒、灰尘、闪烁或暗角。
- 深色模式没有 `wash`、没有纸纹，层级靠换阶和墨线。

## Shapes

圆角 token 不变；每个带描边的元素用不对称的椭圆圆角（PaperCSS 的做法）。大元素（插画衬底、精选卡、搜索框、详情页面板）的不规则要一眼看得出：四角半径相差到 2 倍左右，墨线下边略粗（2–3px，像毛笔收笔）。目录卡、chip、小按钮只差 2–4px，整页 30 多张卡放一起仍然整齐。

| 元素 | 圆角 token |
|---|---|
| 插画衬底 | `plate` 28px |
| 精选卡、详情页安装面板 | `xl` 22px |
| 普通卡、浮层 | `lg` 16px |
| 命令框、菜单、标签页 | `md` 12px |
| 输入框、图标按钮、语言切换 | `sm` 10px |
| 描边复制按钮 | 9px |
| 主次按钮、实心复制按钮、chip、标签、徽标 | `full`（略不齐的胶囊） |

## Components

- **墨线** `ink-outline`：卡片、按钮、输入框、chip、命令框、标签页、菜单、分隔线一律 2.5px `ink`（大元素下边 3.75px）。墨线像毛笔线一样轻微抖动：描边和它下面的底色由伪元素画出，再过一个 SVG 位移滤镜（大元素位移约 3.5px，按钮和 chip 约 2.2px）；文字和内容不过滤镜。会裁切内容的盒子和输入框保持直线描边。分隔线是一笔略带起伏的墨线。标签不描边。悬停时卡片、chip、次按钮、描边复制按钮的墨线换成 `primary` 青绿，同时上移、晕变大。
- **主按钮** `button-primary`：`primary` 底、白字、`ink` 描边、Kalam Bold；悬停叠 `--primary-hover-veil` 并上移 1px，按下轻轻压扁（scale 约 0.97 / 1.03 的 squash，减少动效时只换底色）。一屏只放一个主按钮，旁边可以有 1–2 笔 `ink` 小撇（内联 SVG）。首屏大标题左上角有两颗 `mustard` 小星星加两笔小撇，只在宽屏显示。
- **次按钮** `button-secondary`：`card` 底、`ink` 描边；悬停底换 `hover`。
- **搜索框** `search-bar`：62px 高，`card` 底、`ink` 描边、`wash` 晕；键盘聚焦时墨线不变，外面加 2px `ring`、偏移 2px。右侧显示结果数（等宽小字）。
- **场景 chip** `chip`：左侧 26px 圆形角色头像，组名用 Kalam Bold，等宽计数；`ink` 描边；选中用 `accent`。
- **精选卡** `featured-card`：顶行左边是芥末黄编号胶囊（`featured-number`，手写字，`ink` 细描边），右边是角落徽标；然后是角色插画、人话名称、slug、一句说明、2 条要点（`tomato` 小方点）、命令框加实心复制按钮。
- **普通卡** `skill-card`：人话名称、slug、最多 3 行说明、标签、右下角描边复制按钮；整卡可点进入详情，复制按钮单独可点。
- **复制按钮**：实心版就是小号主按钮；描边版 `card` 底加 `ink` 描边，悬停墨线换 `primary`、字换 `link`；失败时边框和字换 `danger-text`。
- **分组头**：圆形角色插画，`plate` 衬底，编号加数量（`01 · 5 skills`），组名，一句说明。
- **命令框** `command-box`：`background` 底加 `ink` 描边，前缀 `$` 用 `link` 色，长命令省略号截断。
- **标签** `tag`：芥末黄平涂胶囊，不描边，正文字体；第二个及以后用 `tag-neutral` 灰蓝平涂。
- **小记号**：hero 标题下的手绘下划线保留；主按钮旁和区块标题旁最多几笔 `ink` 短撇，内联 SVG。不写拟声词（BOP!、POP! 之类）。
- **详情页安装面板**：浅色 `tint` 奶油底加 `ink` 描边，深色换 `card` 底。
- **页脚** `footer`：浅色 `plate` 底、上沿一条 `ink` 线，深色换 `background`（`footer-dark`）。
- **空状态**：120px 角色插画，“没找到”一句话，加一个清空搜索的按钮。
- **焦点**：只在 `:focus-visible` 显示；墨线保持不变，外面加 2px 实心 `ring` 描边、偏移 2px（实心主按钮同样）。不把墨线换成 `ring`：`ring` 叠在 `ink` 上浅色只有 2.7:1、深色 1.1:1，看不出来。
- **动效**：保持克制，沿用现有曲线；按钮按下的压扁是唯一新增；尊重 `prefers-reduced-motion`。

## Illustration

- 钢笔淡彩（2026-10-31 起）：深棕墨线、水彩晕染、一点彩铅，青绿 `#2BA5A0` 是画面里最饱和的颜色。尼卡约 1:6 头身，穿青绿连帽衫、兜帽放下；不画灯笼、帽子、皮包和帽尖挂件，没有发光光源。琪琪保持蓝色身体、紫色巫师帽和星星魔杖，画法换成水彩。
- 一张图最多一件情境道具，要说明这张图在讲什么；琪琪的魔杖是身份道具，不算。点缀（小星星、叶芽）合计不超过 4 个。
- 所有插画用透明背景，同一张图在浅深两种模式都能用；衬底由界面提供，不画进图里。
- 用到插画的位置：hero、3 张精选卡、场景分组头、空状态、页脚。普通卡不配插画。
- 出图必须附参考图（`personal/assets/characters/nika/nika.png`、`sheet-ink.png`，有琪琪时加 `personal/assets/characters/crew-sheet.png`），提示词照 `personal/BRAND.md` 第 6 节母版（PRESERVE / CHANGE ONLY / AVOID）；角色颜色、比例不能漂移；图里不出现文字。2026-10-31 前的黏土提灯版只作历史参考。
- 2026-11-19 界面改成 Rubber Hose 画法；角色要不要按 rubber-hose 重画，待主人决定，在那之前插画不动。

## Dark Mode

- 上游风格只画给浅色纸面（深棕墨线在深底上会消失），深色版是本站自己设计的：底色仍是冷灰 `neutral` 的深色阶，和改版前一样；描边换浅奶油墨 `ink`（paper-10，在卡片上 4.9:1），所以轮廓始终看得见。
- 没有纸纹，`wash` 为 `transparent`，层级靠换阶和墨线。
- 暖纸 `plate` 和 `tint` 不进深色：插画衬底和头像底换 `card`；页脚换 `background`；首张精选卡和安装面板换 `card` 底。
- 主按钮深浅共用 teal solid，仍是白字。
- 芥末黄在深色换暗琥珀底配浅琥珀字。

## Do's and Don'ts

- Do：浅色页面用暖纸，深色页面用冷灰；墨线在两种模式都要看得见。
- Do：每个轮廓都是 2.5px、轻微抖动的 `ink`；大元素的圆角明显不齐，目录卡的很轻。
- Do：浮起的东西下面用模糊的 `wash` 灰蓝晕。
- Do：卡片标题用人话名称，slug 做等宽副标题。
- Don't：零模糊的偏移投影、底部硬边、按钮内侧高光。
- Don't：给文字或带内容的容器加 SVG 位移滤镜（只加在画描边的伪元素上），或让墨线抖动到影响阅读。
- Don't：胶片颗粒、灰尘、闪烁、暗角，或拟声词。
- Don't：导语、卡片说明、文档正文和命令用手写字；在中文上指望 Kalam（它没有中文字形）。
- Don't：组件和页面 CSS 里写 hex、`rgb()`、`color-mix` 或后备色；唯一的混色是主题层 `shadcn-theme.css` 里阴影墨色混透明（主按钮悬停等）。
- Don't：嵌入上游的 `<hose-*>` 组件；用蓝、紫做界面强调色。

## Iteration

- 改色只改 `design-system/tokens.json`（全局）或 `theme.json` 的 `designSystem.accent` / `designSystem.roles`（本站），跑 `design-system/check.py`，写一篇 `process/` 记录，提交品牌仓库，再到 adonis-skills 跑 `pnpm brand:sync` 并提交快照。
- 改本文后同样跑 `pnpm brand:sync`，adonis-skills 根目录的 `DESIGN.md` 会更新，CI 跑 `designmd lint`。
- 一次只改一个组件，改完在浅深两种模式和 390px 手机宽度下核对。
