# Lingui 日常工作流与发布前检查

本文件面向已完成 Lingui 接入的项目，聚焦日常命令执行顺序与故障排查，不讨论初始化脚手架。

## 场景一：新增或修改源码文案

执行顺序：

```bash
pnpm --filter @your/web run i18n:extract
pnpm --filter @your/web run i18n:translate
pnpm --filter @your/web run i18n:compile
```

目标：
1. `extract` 把最新文案落到 `po`。
2. `translate` 明确缺失项。
3. `compile` 生成 `mjs` 并刷新 manifest。

## 场景二：只更新翻译（未改源码）

建议顺序：

```bash
pnpm --filter @your/web run i18n:translate
pnpm --filter @your/web run i18n:compile
```

说明：
1. 不强制再跑 extract，但如果怀疑词条漂移可补跑 extract。
2. `compile` 是把翻译变成运行时可加载产物的关键步骤。

## 场景三：构建前检查

```bash
pnpm --filter @your/web run i18n:compile
pnpm --filter @your/web run typecheck
```

如果构建脚本已内置 compile gate（例如 build 前先跑 `i18n:compile`），可减少漏步骤风险。

## 场景四：快速占位回填

```bash
pnpm --filter @your/web run i18n:translate -- --fill-source
pnpm --filter @your/web run i18n:compile
```

用途：短期内先让非 source 语言有文案可显示，再安排人工翻译替换。

## 场景五：出现 locale 未激活运行时错误

报错示例：

`Lingui: Attempted to call a translation function without setting a locale`

建议顺序：

1. 先检查 `initLingui(locale)` 是否包含 `i18n.activate(locale)`。
2. 再检查服务端 `layout.tsx` 和服务端 `page.tsx` 是否都调用了 `initPageLingui(params)`（或等价初始化）。
3. 如果报错发生在共享服务端组件，优先改为 `useLingui`/`Trans`；避免依赖全局 `@lingui/core/macro` `t` 的调用时序。
4. 最后执行 `i18n:compile`，确认 `catalog-manifest.ts` 已覆盖对应 entry。

## 场景六：CI / 发布前翻译完整性检查

```bash
pnpm --filter @your/web run i18n:check
```

说明：
1. `i18n:check` 等价于 `i18n:translate -- --strict`，发现任何目标语言 `msgstr` 为空即非零退出。
2. 适用于 CI 管线或发布前门禁，确保所有文案均已翻译。
3. 只读操作，不会修改任何 `po` 文件。

推荐在 CI 中组合使用：

```bash
pnpm --filter @your/web run i18n:extract
pnpm --filter @your/web run i18n:check
pnpm --filter @your/web run i18n:compile
```

## 失败排查顺序（固定）

1. `extract` 是否成功产出/更新对应 `po`。
2. `po` 中目标语言 `msgstr` 是否为空。
3. `compile` 是否成功生成 `src/locales/**/*.mjs`。
4. `manifest` 是否已更新并包含对应 entry + locale loader。
5. 服务端 locale 初始化是否覆盖 layout + page 两层。

## 发布前最小验收

1. 新增文案已进入目标 `po`。
2. `i18n:check` 通过（无缺失翻译），或 `translate` 结果中缺失项可解释。
3. `compile` 后运行时可加载目标 locale。
4. 默认语言和非默认语言路由下文案一致可用。
