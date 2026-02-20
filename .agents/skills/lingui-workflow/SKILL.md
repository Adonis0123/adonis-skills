---
name: lingui-workflow
description: Guide daily Lingui command workflow for Next.js and React projects. Use when teams need clear extract/translate/compile/manifest routines, troubleshooting steps, and command semantics for i18n catalogs.
---

# Lingui Workflow

## Agent Behavior

当此 skill 被激活时，**先输出以下命令速查表**，再回应用户问题：

```
| 命令              | 作用摘要                                       | 可用参数                                          |
| ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| i18n:extract      | 提取源码文案到 po                              | —                                                 |
| i18n:translate    | 统计缺失翻译                                   | --fill-source, --strict                           |
| i18n:check        | 严格翻译检查，缺失即报错退出                   | —                                                 |
| i18n:compile      | 编译 po → mjs，自动执行 i18n:manifest          | —                                                 |
| i18n:manifest     | 基于已有 mjs 生成 catalog-manifest.ts           | —                                                 |
| i18n:sync         | 当前仅等价 i18n:extract                        | —                                                 |
| i18n:bootstrap    | 一次执行 extract + compile(+manifest)           | —                                                 |
| i18n              | 组合入口；默认 extract + translate              | --compile, --fill-source, --no-translate, --strict |
```

## Overview

这个 skill 面向“已经完成 Lingui 接入后的日常使用”，帮助你稳定执行 i18n 命令链路并快速排障。  
如果你需要的是“初始化/脚手架接入”，请使用 `lingui-next-init`，不要混用职责。

## Prerequisites

Before using this skill, confirm your project already has Lingui runtime setup:

1. `scripts/i18n/*` exists (at least `index.ts`, `cli.ts`, `manifest.ts`).
2. Next.js SWC plugin contains `["@lingui/swc-plugin", {}]`.
3. `src/locales/**` catalogs and `src/i18n/catalog-manifest.ts` flow are already wired.

## Quick Start

推荐最短日常流程（新增/修改文案）：

```bash
pnpm --filter @your/web run i18n:extract
pnpm --filter @your/web run i18n:translate
pnpm --filter @your/web run i18n:compile
```

高频补充命令：
- 首次初始化：`pnpm --filter @your/web run i18n:bootstrap`
- 仅重建 manifest：`pnpm --filter @your/web run i18n:manifest`
- 一条命令串联：`pnpm --filter @your/web run i18n -- --compile`
- CI / 发布前翻译检查：`pnpm --filter @your/web run i18n:check`

## Command Matrix

| 命令 | 作用摘要 | 可用参数 |
| --- | --- | --- |
| `i18n:extract` | 提取源码文案到 `po` | — |
| `i18n:translate` | 统计缺失翻译 | `--fill-source`, `--strict` |
| `i18n:check` | 严格翻译检查，缺失即报错退出 | — |
| `i18n:compile` | 编译 `po` 到 `mjs`，并自动执行 `i18n:manifest` | — |
| `i18n:manifest` | 基于现有 `mjs` 生成 `catalog-manifest.ts` | — |
| `i18n:sync` | 当前仅等价 `i18n:extract` | — |
| `i18n:bootstrap` | 一次执行 `extract + compile(+manifest)` | — |
| `i18n` | 组合入口；默认 `extract + translate`，加 `--compile` 才会编译 | `--compile`, `--fill-source`, `--no-translate`, `--strict` |

详细输入/输出/副作用请看 `references/i18n-commands.md`。

## Doc Drift Guard

When command semantics change, docs must be updated in the same change set.

Trigger files:
1. `apps/web/scripts/i18n/index.ts`
2. `apps/web/scripts/i18n/manifest.ts`
3. `apps/web/scripts/i18n/cli.ts`

Required doc sync:
1. `references/i18n-commands.md`
2. `references/workflow-daily.md` (if execution sequence changed)
3. `references/maintenance-playbook.md` (if maintenance workflow changed)

## Common Misconceptions

1. `i18n` 默认会 compile。  
实际：默认不会，必须显式传 `--compile`。

2. `i18n:sync` 是全量同步命令。  
实际：当前实现仅执行 extract。

3. `i18n:manifest` 可替代 `i18n:compile`。  
实际：manifest 依赖已有 `.mjs`，不会自行生成编译产物。

4. 只在 `[lang]/layout.tsx` 做初始化就够了。  
实际：在 Next App Router / RSC 下，服务端 `page.tsx` 也应在使用 `t` 或生成 metadata 前初始化 locale。

## Runtime Locale Error Checklist

遇到以下错误时按顺序检查：

`Lingui: Attempted to call a translation function without setting a locale`

1. `initLingui(locale)` 是否执行了 `i18n.activate(locale)`。
2. 服务端 `layout.tsx` 与服务端 `page.tsx` 是否都调用了 `initPageLingui(params)`（或等价逻辑）。
3. 共享服务端组件中的非 JSX 字符串是否优先使用 `useLingui`/`Trans`，避免依赖全局 `@lingui/core/macro` `t` 的初始化时序。
4. `i18n:compile` 后的 manifest 是否包含对应 entry + locale loader。

## Daily Checklist

1. 新增/修改文案后，已执行 `extract -> translate -> compile`。
2. `translate` 输出缺失项为预期状态（已补翻或接受占位）。
3. 构建前确认已执行 compile（或 `build` 脚本含 compile gate）。
4. `.gitignore` 已忽略编译产物 `web/src/locales/**/*.js|*.mjs`（及兼容路径）。

## References

1. `references/i18n-commands.md`
2. `references/workflow-daily.md`
3. `references/maintenance-playbook.md`
4. Runtime implementation check: `apps/web/scripts/i18n/index.ts`
5. Runtime implementation check: `apps/web/scripts/i18n/manifest.ts`
