# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

外部开发者，用 Claude Code、Codex、Grok Build、Cursor 等 coding agent。来站点浏览 Nika Skills 公开的 skill 和 hook 插件，挑选后复制对应宿主的安装命令。

## Product Purpose

Nika Skills 是作者公开的 agent skill 与 hook 插件目录：说明每个 skill 或插件做什么、什么时候生效，并按宿主给出安装命令。成功标准是访客能判断某个插件是否适合自己，并一次装好。

## Positioning

所有内容由作者本人日常使用并维护，跨多个 agent 宿主可用；hook 插件与 skill 来自同一个 marketplace。

## Operating Context

- 安装入口：Claude Code `/plugin marketplace add Adonis0123/adonis-skills`；Codex 经 `codex plugin marketplace add`；其他宿主按站点的宿主安装标签页。
- 站点中英双语（`[lang]` 路由）。

## Capabilities and Constraints

- Plugin 不写 version，安装跟随 commit。
- 站点数据由构建脚本扫描仓库生成。

## Brand Commitments

品牌名 Nika Skills；视觉以仓库根目录 `DESIGN.md` 为准（近白冷灰底、叶绿色小面积强调、Nika 与 Kiki 水墨角色），该文件由 adonis-brand 生成，不手改。

## Evidence on Hand

内容来源是仓库 `skills/`、`plugins/`；没有用户评价或安装量数据，页面不得编造。

## Product Principles

- 先讲清插件在什么时机做什么、会不会拦住你，再给安装命令。
- 每个插件都写明怎么停用。
- 中英文内容同等完整。
