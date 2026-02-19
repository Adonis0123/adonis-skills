---
name: code-inspector-init
description: 标准化接入与迁移 code-inspector-plugin（codeInspectorPlugin）到 Next.js、Vite、Webpack、Rspack、Rsbuild、Esbuild、Mako、Umi、Nuxt、Astro。Use when user asks 接入/迁移/配置 inspector、DOM 点击跳转 IDE 定位、hotKeys、自定义 options、或排查 code inspector 不生效问题。
---

# Code Inspector Init

## Overview

在开发环境为前端项目接入 `code-inspector-plugin`，实现按组合键后点击 DOM 跳转到源码位置。优先给出最小改动、可复制、可回滚的迁移方案，默认使用插件原生开关策略：`needEnvInspector: true` + `.env.local` 中设置 `CODE_INSPECTOR=true`。

## Trigger Phrases

- 帮我接入 `code-inspector-plugin`
- 帮我迁移 `codeInspectorPlugin` 到新项目
- Next.js/Vite/Webpack 怎么配 code inspector
- 点击页面元素跳不到 IDE
- Alt+Shift 没反应 / 快捷键怎么改

## Decision Tree

1. 识别框架与 bundler。
- 从 `package.json`、配置文件名、构建命令确认是 Next.js、Vite、Webpack、Rspack、Rsbuild、Esbuild、Mako、Umi、Nuxt、Astro 中哪一种。

2. 如果是 Next.js，先判断版本区间。
- `<=14.x`：使用 webpack 插件接入。
- `15.0.x ~ 15.2.x`：使用 `experimental.turbo.rules`。
- `>=15.3.x`（包含 16）：使用 `turbopack.rules`。

3. 选择开关策略。
- 默认：`needEnvInspector: true`（推荐，迁移一致性最好）。
- 用户明确要求项目自定义开关时，再补充 `ENABLE_CODE_INSPECTOR` 等外层条件。

4. 判断是否需要高级选项。
- 只有用户明确提出需求才调整 `hotKeys`、`hideConsole`、`openIn`、`launchType`、`include/exclude`、`mappings`、`pathType`、`skipSnippets`。

## Execution Workflow

1. 识别项目环境。
- 确认框架、bundler、配置文件路径、是否 dev-only 配置。

2. 安装依赖。
- 给出单行命令：`pnpm add -D code-inspector-plugin`（如项目使用 npm/yarn，则给对应命令）。

3. 注入配置。
- 从 `references/bundler-recipes.md` 选择对应片段。
- 配置中必须包含正确的 `bundler` 值。

4. 设置 `.env.local`。
- 添加 `CODE_INSPECTOR=true`。
- 默认要求配置 `needEnvInspector: true` 以避免线上误开。

5. 本地验证。
- 启动 dev。
- 在页面按默认组合键（Mac: `Option+Shift` / Windows: `Alt+Shift`）后悬浮并点击 DOM。
- 观察浏览器控制台提示和 IDE 跳转结果。

6. 故障排查。
- 出现 IDE 无法打开、快捷键无效、路径错误、端口冲突时，按 `references/troubleshooting.md` 分步排查。

## Reference Routing

- 需要框架配置代码片段时：读取 `references/bundler-recipes.md`。
- 需要定制参数与风险评估时：读取 `references/options-cheatsheet.md`。
- 需要排障步骤时：读取 `references/troubleshooting.md`。
- 不要一次性加载全部 references，只按当前请求场景读取对应文件。

## Output Contract

输出必须严格包含以下四部分，且顺序固定：

1. 改动点清单
- 说明要改哪些文件、每个文件做什么。

2. 可复制代码块
- 给完整可用的配置片段，不给伪代码。
- 代码块里保留英文 API 名与配置键。

3. 验证命令
- 提供可直接执行的单行命令。
- 给出成功判定标准。

4. 回滚说明
- 说明如何移除插件配置和环境变量。

## Guardrails

- 默认只在开发环境启用，不在生产构建开启 inspector。
- 修改保持最小化，不顺带重构无关代码。
- 不确定框架版本时，先读取 `package.json` 与 lockfile 再下结论。
- 涉及 `node_modules` 源码映射时，优先使用 `mappings` 且给出风险说明。
