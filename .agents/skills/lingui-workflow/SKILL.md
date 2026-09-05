---
name: lingui-workflow
description: Choose and troubleshoot extract, translation-check, compile, and catalog-manifest commands in an existing Lingui project. Use for daily catalog maintenance and command semantics, not initial setup, plain text translation, or choosing an i18n library.
metadata:
  author: adonis
---

# Lingui Workflow

处理已经接入 Lingui 的项目。先回答当前问题或执行已授权的步骤；只有用户要完整速查时才输出命令表。

## Resolve the Project Contract

- 复用本轮已确认的项目、包管理器和脚本信息。缺少时先读目标包的 `package.json` 与 Lingui 配置，再按问题查看对应入口；不预先读取所有脚本。
- `i18n:*` 是项目自定义名称，不是 Lingui 标准接口。下文示例来自已退役的 `lingui-next-init` 历史模板，仅用于维护既有项目；所有项目以实际脚本为准。不要因缺少 `scripts/i18n`、manifest 或 Next.js SWC 配置就判定普通 React/Lingui 接入不完整。
- `@your/web` 是占位符，先替换成已核实的包名；非 workspace 项目在目标包目录运行相应脚本。沿用已有包管理器。
- 首次接入不属于本 skill 范围，优先复用用户已选定的项目模板；不要调用已退役的初始化 skill。单纯问命令含义不运行写入命令。

## Choose the Shortest Relevant Flow

- **源码文案改变**：extract → 检查缺失翻译 → 完成翻译后 compile。
- **仅修改已有翻译**：检查目标 catalog → compile；没有词条漂移证据就不重复 extract。
- **只检查缺失翻译**：已存在的只读严格检查命令，例如 `i18n:check`；不附加 extract、占位回填或 compile。
- **只重建 manifest**：确认编译产物已经存在且新鲜，再运行 `i18n:manifest`。
- **编译或构建**：先确认 `i18n:compile` / build 是否已包含 manifest 或 compile，避免重复执行。

采用该历史脚本约定的既有项目，新增源码文案的示例：

```bash
pnpm --filter @your/web run i18n:extract
pnpm --filter @your/web run i18n:translate
pnpm --filter @your/web run i18n:compile
```

`i18n:translate` 默认统计缺失，并不调用翻译服务。只有明确接受源文案占位时才用 `--fill-source`，不能把占位回填报告为完成翻译。

## Command Semantics and Side Effects

需要参数或输入/输出细节时读 [references/i18n-commands.md](references/i18n-commands.md)。需要场景例子时读 [references/workflow-daily.md](references/workflow-daily.md)。不要为一个命令问题同时加载全部参考。

仅对经核对仍采用以下历史脚本约定的项目：

- `i18n` 默认 extract + translate，显式 `--compile` 才编译；`i18n:sync` 仅 extract。
- `i18n:compile` 包含 manifest；`i18n:manifest` 不生成编译 catalog。
- `i18n:check` 是只读严格检查。组合入口的 `--strict` 仍会先 extract，不能作为只读检查的替代。
- extract 会改写 catalog，并可能清理不再归属的 entry。`I18N_DRY_RUN=1` 只预览清理阶段，**不阻止 extract 写入**；需要只读探测时选只读命令或可丢弃副本。
- CLI 失败与“没有缺失翻译”不同。保留实际退出状态；旧脚手架缺少新命令时说明版本差异，不假装执行成功。

## Diagnose from the Observed Failure

从失败阶段开始，不固定重跑整个流程：

1. 文案未提取：检查对应源码、catalog include/entry 和 extract 结果。
2. 翻译未显示：核对目标 `po`、编译产物与实际 locale loader；有 manifest 的项目再检查它。
3. `Attempted to call a translation function without setting a locale`：先查 locale 初始化与调用顺序，不先修改翻译内容。
4. Next.js App Router / RSC：确认使用翻译的 server layout/page 在调用前完成 locale 初始化；共享服务端组件按已有版本和 `useLingui`/`Trans` 约定取上下文。此项不适用于普通 React 客户端项目。

运行命令只能证明对应步骤。涉及页面显示时，还需在目标 locale 的真实页面核对文案；没运行就标记 `UNVERIFIED`。

## Maintaining These Skills

仅在修改本仓库 Lingui 工作流文档时读取 [references/maintenance-playbook.md](references/maintenance-playbook.md)。已有项目的命令语义变化经核实后，同步此入口与命令参考；不再维护或同步已退役的初始化模板，也不把仓库维护流程加入下游项目的日常翻译任务。
