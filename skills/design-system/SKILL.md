---
name: design-system
description: >-
  Run a shared multi-site design system where every product swaps only its interface accent color: analyze any website's theme colors and roles, wire a new site or plugin to the semantic tokens, and lint plugins for hard-coded colors, fallback values and unknown roles. Use when the user gives a URL and asks what its theme or palette is, asks to connect a site to the design system, add an accent theme, or check whether a plugin follows the theme contract. Skip one-off styling tweaks, logo or illustration work, and plugin-architecture refactors (code-plugin-architecture).
metadata:
  author: adonis
  version: "0.1.0"
---

# Design System

一套设计系统给多个站点用：底色、分层、功能色、字体、圆角共用，每个产品只换界面强调色。本 skill 管三件事：分析站点的主题色、接入新站点或新主题、检查插件是否守契约。色值本身不在这里，在设计系统目录的 `tokens.json`（格式见 [references/token-format.md](references/token-format.md)）。

## 先找到设计系统

按顺序找，找到就停：用户给的路径 → 当前仓库的 `design-system/tokens.json` → 仓库 `AGENTS.md`/`CLAUDE.md` 里写明的品牌仓库路径。都没有就问用户，不自己编一套色值。

找到后先跑一次检查，确认起点是好的：

```bash
python3 scripts/check_tokens.py <design-system>/tokens.json
```

## 1. 分析一个站点的主题色

用户给 URL，问它的主题色、配色做法，或想参考它时用。

1. 用 dembrandt 抽取实际渲染的颜色（锁版本）。先直接跑；报缺浏览器时再跑 `install-browser`，它在本机已有浏览器或别的进程正在下载时会长时间无输出：

   ```bash
   npx -y dembrandt@0.39.2 <url> --shadcn --wcag --save-output
   npx -y dembrandt@0.39.2 install-browser   # 只在上一条报缺浏览器时
   ```

2. dembrandt 只给“出现过哪些色”，`--dark-mode` 也常常读不出深色变量。按钮、当前项、选中态各用了哪个色要实测：用 Playwright（或宿主自带的浏览器工具）打开页面，`waitUntil: "domcontentloaded"` 后再等几秒（营销站常有长连接，`networkidle` 会超时），对这几类元素读 `getComputedStyle`（`background-color`、`color`、`border-color`、`box-shadow`、`font-weight`），并读 `:root` 上的 CSS 变量。深色模式用 `colorScheme: "dark"` 的浏览器上下文再读一遍。
   - 页面上有好几种实心按钮时，全列出来：首屏面积最大、文案是主要行动（试用、注册、开始）的那个算主按钮，其余写成次要按钮。品牌色按钮不一定是主按钮。
   - 外层元素读到 `rgba(0, 0, 0, 0)` 时，颜色多半画在内层元素或 `::before`/`::after` 上，往里找，或读按钮用的 CSS 变量。
   - 遇到人机验证（例如 Cloudflare 的 “Verify you are human”）不绕过：这一页只用 dembrandt 的结果，并写明没实测。
   - 页面重定向到别的域名时，在结论里写明实际分析的是哪个地址。
   - 网页本身黑白无彩色时直说；再去官方品牌资料、设计系统仓库或产品源码里找它的标志色，写明出处。
   - 能找到一手品牌资料（官方 brand guidelines、设计系统仓库）就拿来核对强调色。
3. 输出一张表和 5 条以内的做法总结，回答这几个问题：
   - 界面强调色是哪个（色值和来源变量名）；它出现在哪些地方，面积大还是只上“点”。
   - 中性色偏冷、偏暖还是纯灰；分层靠线、靠亮度还是靠阴影。
   - 主按钮文字白还是深，WCAG 对比度多少，是否达标。
   - 选中态是实心块、淡彩底还是竖线；背景有没有染品牌色。
   - 每个数值标“实测”或“推断”。登录后才能看的页面没看到，就写 `UNVERIFIED`，不猜。
4. 用户想借鉴时，把结论映射到 `tokens.json` 的角色上，做成对比页面让用户看实物再定。不直接改 `tokens.json`。

## 2. 接入一个新站点或新主题

**新站点**：

1. 从 `tokens.json` 生成 CSS 变量（设计系统自带脚本时用它的；否则按 token-format 里的规则解析引用），放进站点样式。
2. 根元素加 `data-accent="<主题>"`，深色模式加 `.dark`。
3. 组件里只写语义角色 `var(--primary)` 等；把原有写死的颜色逐个换成最接近的角色，换不上就记下来问用户，不新造角色。
4. 跑第 3 节的插件检查，再用真实页面看浅色、深色各一遍。

**新主题（新的界面强调色）**：在 `themes` 里加一项：12 阶色阶（浅、深各一套）、`solid`、`solid-foreground`。按钮先试“强调色原色 + 近黑字”，对比度不过 4.5 再考虑加深配白字。跑 `check_tokens.py`，全部通过才算加完。按钮配白字还是深字有口味成分，做成样本给用户挑。

## 3. 检查插件是否守契约

插件只用语义角色：不写死色值，`var()` 不带后备色，不引用设计系统里没有的角色。缺变量就该显眼地坏掉，好让人发现没接上主题。

```bash
python3 scripts/lint_plugin.py <插件目录> --tokens <design-system>/tokens.json
```

脚本逐条报 `文件:行 — 问题 — 改法`，有问题时退出 1。故意保留的色值（例如品牌 logo 的固定色）在同一行写 `design-system-ignore` 并说明原因。脚本只是定位候选：logo、插画、截图里的颜色不算违规，逐条判断后再改。

插件的注册、加载结构要改时，交给 `code-plugin-architecture`；本 skill 只管颜色和主题契约。

## 交付

- 分析：表格加做法总结，标清实测和推断。
- 接入：改了哪些文件、`check_tokens.py` 和 `lint_plugin.py` 的结果、浅深两种模式的页面验证。没看页面就写 `UNVERIFIED`。
- 检查：问题清单和改法；用户要求时再动手修。
