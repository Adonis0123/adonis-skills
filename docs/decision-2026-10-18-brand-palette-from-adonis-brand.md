# 站点颜色以 adonis-brand 为唯一来源，本仓存快照并生成 CSS

日期：2026-10-18

## 决定

- 品牌原色只在私有仓库 `adonis-brand/data/palette.json` 定义：每个颜色一个 id，带名称、分组、出处文档和用途。
- 站点主题角色在 `adonis-brand/projects/skills/theme.json` 定义：亮色、暗色两套，每个角色指向一个颜色 id，并列出必须达到 4.5:1 的文字对比组合。决策理由和被否方案也写在这个文件里。
- 本仓在 `apps/web/src/styles/brand/` 保存这两个文件的公开快照：只含颜色 id、色值、分组、英文名和对比度规则。出处、用途说明和决策理由属于私有仓库，不复制过来；`source.json` 记录来自 adonis-brand 的哪个提交，凭它回品牌仓库查完整信息。
- `scripts/sync-brand-tokens.mjs` 从快照生成 `brand-tokens.css`（品牌层）和 `theme-roles.css`（颜色角色），每个变量都带来源注释。两个文件不能手改。
- 配色用两条 Radix 式 12 阶色阶：暖纸中性 `n-*`（色相约 80°）和叶绿强调 `leaf-*`（OKLCH 色相约 130°），暗色是同色相反转的 `n-dark-*`、`leaf-dark-*`。角色只引用阶号：主按钮 `leaf-9` 配墨色字 `n-12`、链接和亮色焦点环 `leaf-11`、标签 `leaf-3` 底配 `leaf-12` 字、页面 `n-2`、卡片 `n-1`。蓝和琥珀只留给小人插画和 logo。
- 组件和页面 CSS 不写 `color-mix`、行内 hex 和 `/NN` 透明度修饰，层级靠换阶。`pnpm design:check`（`scripts/check-design-tokens.mjs`）在 CI 里拦截。

## 为什么

- 原主色深蓝 `#29658E` 色相约 242°，奶油底约 85°，冷暖接近互补，按钮像别家组件；它还和小人身体的蓝几乎同色。调研的暖底站点（claude.com、The Browser Company、Mailchimp）都是一种彩色加暖黑暖灰，按钮多用墨色。两路调研分歧：调研 subagent 推荐墨色按钮，Grok 推荐深绿实底；站长先选了墨色按钮和暖炭暗色。
- 墨色按钮上线后整页发灰：表面、边框、阴影大量用 `color-mix(墨色 N%)` 临时混色，墨色偏冷，也没有色阶。参照 Google Stitch DESIGN.md、Radix Colors 和 Oxide 的规范改成色阶，并比了森林绿、灯笼琥珀、降彩度蓝三条强调色阶。站长选森林绿：来自主角外套，不占用小人专用的蓝和琥珀。
- 森林绿上线预览后显得发闷：色相 145° 偏蓝、彩度只有 0.105，和奶油底（约 85°）不搭。同日换成叶绿（参考 visualgpt.io 的 #74B425）：色相约 130°，更靠近奶油；彩度约 0.18，在暖纸上显得新鲜。亮叶绿 `leaf-9` #80BF31 上白字只有约 2.5:1，所以主按钮配墨色字（7.08:1）；`leaf-9` 对奶油底只有 2.0:1，亮色焦点环改用 `leaf-11` #43721D。
- 站点是公开仓库，Vercel 构建读不到私有的 adonis-brand，所以不能在构建时直接引用；npm 包需要发布流程和私有 registry，git submodule 也要求构建机有私有仓库权限。快照加同步脚本最轻，且每次改色都能在两个仓库的 git 历史里对上。
- 生成的 CSS 和 `pnpm brand:check` 让“改色只改一处”变成可检查的规则：CSS 与快照不符、快照来自未提交的品牌改动、或文字对比度不达标，CI 都会失败并提示怎么修。

## 改色流程

1. 在 adonis-brand 改 `data/palette.json` 或 `projects/skills/theme.json`，写一篇 `process/` 记录，提交。
2. 在本仓运行 `pnpm brand:sync`（读 `$BRAND_REPO`，默认 `../adonis-brand`），检查页面，提交快照和生成的 CSS。
3. CI 的 `pnpm brand:check` 确认两边一致。

## 同步范围

- 本仓：`apps/web/src/styles/{brand/*.json,brand-tokens.css,theme-roles.css,shadcn-theme.css,custom.css}`、`apps/web/src/lib/og-card.tsx`、`scripts/{sync-brand-tokens.mjs,check-design-tokens.mjs,lib/brand-tokens.mjs}`、`scripts/__tests__/{brand-tokens,check-design-tokens}.test.mjs`、`package.json`、`.github/workflows/ci.yml`、`docs/web-ui-clay-contract.md`。
- adonis-brand：`data/palette.json`、`projects/skills/{theme.json,BRAND.md,DESIGN.md}`、`panel/{design.ts,index.ts}`（Brand 面板的站点规范页）、`process/2026-10-18-skills-site-theme.md`、`data/cast.json`（琪琪的使用位置）。

## 修订记录

- 2026-10-18 第一版：强调色阶森林绿 `forest-*`（`forest-9` #38733C 配浅色字，`forest-11` #2C5D30）。已被下一条取代。
- 2026-10-18 修订：强调色阶换成叶绿 `leaf-*`，主按钮字改为墨色，亮色焦点环从 `forest-9` 改为 `leaf-11`。

## 未验证

- adonis-brand 的改动尚未提交，所以当前快照标记为 dirty，`pnpm brand:check` 会失败；提交后重跑 `pnpm brand:sync` 即可。
- Brand 面板的站点规范页（`/panel/design?site=skills`）展示色阶和角色；门户其他 Brand 页还没有读取 `palette.json`。
