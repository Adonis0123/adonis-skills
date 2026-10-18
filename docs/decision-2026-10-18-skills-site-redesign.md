# Catalog Site 改版（v3）与 DESIGN.md 同步

日期：2026-10-18

## 决定

- **视觉方向 v3**：页面用近白暖灰 `stone-*`（亮色页面 #FAF9F6），卡片近白；奶油色只做插画衬底和页脚（角色 `plate`）。唯一强调色是叶绿，主按钮实心 `leaf-9` 配墨色字，大面积浅绿用 `tint`。暗色用近中性的 `stone-dark-*`。
- **目录结构**：29 个 Public Skill 按 6 个 Scenario Group（场景分组）展示，每组一句说明；顶部 3 个 Featured Skill（`agent-dispatch`、`agentic-review-handoff`、`commit-push`）；卡片标题用 Display Name（人话名称），slug 作等宽副标题。分组、精选和 Display Name 写在 `apps/web/content/skill-catalog.yaml`，中英文各一份。
- **全部 skill 页**：新增 `/skills`（中文 `/zh/skills`），左侧吸顶分组栏、顶部搜索（`/`、⌘K 聚焦）、标签多选和排序，状态写进 URL（`?q=&group=&tag=&sort=`）。首页每组最多显示 6 张卡，多出的给“查看这组全部”链接；首页和页头搜索回车都跳到 `/skills?q=…`。首页负责介绍和带路，`/skills` 负责查找。
- **字体**：拉丁标题用 Bricolage Grotesque，中文和正文用 Noto Sans SC，字标 Shantell Sans，代码 IBM Plex Mono，全部 fontsource 自托管。
- **插画**：透明背景、亮暗通用；只给 hero、3 张精选卡、6 个分组头。普通卡不配插画。
- **DESIGN.md**：采用 `google-labs-code/design.md`（`version: alpha`，CLI 锁定 `@google/design.md@0.4.0`）。源头在私有 `adonis-brand/projects/skills/DESIGN.md`，`pnpm brand:sync` 把它复制进快照，并注入 `colors` 生成根目录 `DESIGN.md`；CI 跑 `pnpm design:lint`。`docs/web-ui-clay-contract.md` 只保留本仓的实现约定。
- **名字与地址**：对外名字保持 Nika Skills；仓库 `Adonis0123/adonis-skills`、域名 `adonis-skills.vercel.app`、安装命令和插件名 `adonis-skills@adonis-skills` 都不改（改插件名会让已安装的人要重装，且 `Adonis0123` 按品牌约定只当账号 ID）。`nika-skills.vercel.app` 别名等改版上线、要对外分享时再加。
- **品牌关系链**：哪些仓库使用品牌、方向如何，登记在 `adonis-brand/data/consumers.json`；检查和同步由私有 skill `adonis-brand/.agents/skills/brand-link` 负责。本仓只保留同步脚本和 `CLAUDE.md` 里的一行指针。

## 为什么

- 上一版把叶绿放在暖奶油纸上，主按钮全绿，暖绿压暖底显得发闷；visualgpt.io 的同类绿好看，是因为配了冷中性和白底，绿色只占 5–10%。
- 上一版首页约 2/3 是 29 张同质卡片，标题是 slug，主角只在首屏出现。8 个目录站（Linear Integrations、Raycast Store、Smithery、cursor.directory 等）的共同做法是场景分组、精选层级和人话名称。
- 站长否决了近黑主按钮，要求看设计稿再选。Codex 概念图和 3 版 HTML 稿（v1 冷灰白、v2 全页奶油、v3 近白暖灰）比较后选 v3：绿色最新鲜，又保留了插画的温度。
- 每张卡都配插画需要 29 张以上，新增 skill 都要补图；只给精选和分组配图共 10 张。
- 本仓是公开仓库，`.agents/skills` 会被发布；品牌数据和其他项目名是私有的，所以关系链放在品牌仓库（`adonis-brand/docs/adr/0001-brand-link-lives-in-brand-repo.md`）。

## 被否方案

| 方案                                                      | 原因                                         |
| --------------------------------------------------------- | -------------------------------------------- |
| v1 冷灰 slate + 纯白                                      | 插画自带暖底，放在冷白上像贴片；偏 SaaS 模板 |
| v2 全页奶油 + 深绿白字按钮                                | 不新鲜；每张卡都要插画；暗色难处理           |
| 绿色渐变胶囊按钮                                          | 模板感                                       |
| 近黑主按钮                                                | 站长否决                                     |
| DESIGN.md 只在本仓手写                                    | 颜色会在两处出现；品牌仓库已是颜色唯一来源   |
| `designmd export --format css-tailwind` 替换 `brand:sync` | 导出丢行高、没有暗色、写死 hex               |
| 品牌关系链放本仓 `.agents/skills`                         | 本仓公开，会泄露私有品牌数据                 |

## 改动流程

1. 在 adonis-brand 改 `data/palette.json`、`projects/skills/theme.json` 或 `projects/skills/DESIGN.md`，写 `process/` 记录，提交并推送。
2. 在本仓运行 `pnpm brand:sync`，提交快照、生成的 CSS 和 `DESIGN.md`。
3. CI 跑 `pnpm brand:check`、`pnpm design:lint`、`pnpm design:check`。
