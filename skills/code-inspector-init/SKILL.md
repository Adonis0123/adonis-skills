---
name: code-inspector-init
description: Set up or migrate code-inspector-plugin across modern frontend frameworks. Use when you need click-to-source IDE navigation, hotkey customization, or inspector troubleshooting.
metadata:
  author: adonis
---

# Code Inspector Init

## Overview

在开发环境为前端项目接入或修复 `code-inspector-plugin`，实现按组合键后点击 DOM 跳转到源码位置。新接入默认使用插件原生开关策略：`needEnvInspector: true` + `.env.local` 中设置 `CODE_INSPECTOR=true`；但 Next.js `>=15.3` 主模板默认使用 `hotKeys: ["altKey"]` + `needEnvInspector: false`。

## Scope and Intent

- 用户要求接入、迁移或修复时，检查工作树后完成对应改动；已有明确授权无需再让用户确认方案。仅询问原理、配置示例或排障原因时保持只读。
- 已安装但不生效时，先读取现有配置、实际运行模式和错误证据，再按 [references/troubleshooting.md](references/troubleshooting.md) 定位。下面的安装流程用于新接入；不要为排障重装依赖、重建配置或覆盖已有开关、快捷键和插件链。
- 确认需要修改后，只改与原因相关的配置。沿用已安装版本；查明版本兼容问题后才考虑升级。新接入模板的默认值不替代用户已有选择。

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
- Next.js `>=15.3` 主模板特例：默认 `needEnvInspector: false`，并使用 `hotKeys: ["altKey"]` 做最小接入。
- 用户明确要求项目自定义开关时，再补充 `ENABLE_CODE_INSPECTOR` 等外层条件。

4. 判断是否需要高级选项。

- 只有用户明确提出需求才调整 `hotKeys`、`hideConsole`、`openIn`、`launchType`、`include/exclude`、`mappings`、`pathType`、`skipSnippets`。

## New Integration Workflow

1. 识别项目环境。

- 确认框架、bundler、配置文件路径、是否 dev-only 配置。

2. 安装依赖。

- 给出单行命令：`pnpm add -D code-inspector-plugin`（如项目使用 npm/yarn，则给对应命令）。

3. 注入配置。

- 从 `references/bundler-recipes.md` 选择对应片段。
- 配置中必须包含正确的 `bundler` 值。

4. 设置 `.env.local`。

- 仅当模板显式使用 `needEnvInspector: true` 时，添加 `CODE_INSPECTOR=true`。
- 对 Next.js `>=15.3` 主模板（`hotKeys: ["altKey"]` + `needEnvInspector: false`）不强制配置 `.env.local`。

5. 本地验证。

- 启动 dev。
- 在页面按默认组合键（多数模板为 Mac: `Option+Shift` / Windows: `Alt+Shift`；Next.js `>=15.3` 主模板为 `Option/Alt` 单键）后悬浮并点击 DOM。
- 观察浏览器控制台提示和 IDE 跳转结果。

6. 故障排查。

- 出现 IDE 无法打开、快捷键无效、路径错误、端口冲突时，按 `references/troubleshooting.md` 分步排查。

## Reference Routing

- 需要框架配置代码片段时：读取 `references/bundler-recipes.md`。
- 需要定制参数与风险评估时：读取 `references/options-cheatsheet.md`。
- 需要排障步骤时：读取 `references/troubleshooting.md`。
- 不要一次性加载全部 references，只按当前请求场景读取对应文件。

## Output Contract

- 实施或修复：说明已改内容、原因和验证结果；引用修改文件即可，不必再次输出完整配置。回退说明只针对本次改动，不能把修复的回退扩大为卸载已有插件。
- 解释或示例：直接回答原因或给出与项目版本匹配的最小片段；不要声称已经修改或验证。
- 验证区分配置检查、开发页面遮罩和 IDE 实际跳转。涉及交互修复时，在目标页面用实际配置的快捷键点击验证；无法操作浏览器或观察 IDE 时，将该层标为 `UNVERIFIED`，说明缺少的证据。配置正确或命令成功不能证明跳转已恢复。

## Guardrails

- 默认只在开发环境启用，不在生产构建开启 inspector。
- 修改保持最小化，不顺带重构无关代码。
- 不确定框架版本时，先读取 `package.json` 与 lockfile 再下结论。
- 涉及 `node_modules` 源码映射时，优先使用 `mappings` 且给出风险说明。
