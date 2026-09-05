# Lingui 日常工作流与发布前检查

本文件使用已退役的 `lingui-next-init` 历史模板命令举例，只服务既有项目维护。先核对目标项目已有脚本，只读取与当前场景有关的部分；实际命令优先，不调用初始化 skill 或同步其模板。

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

如果本次构建已包含 compile，就复用该结果，不在同内容上先重复编译。采用此历史脚本实现的 compile 已包含 manifest；以实际入口为准。

## 场景四：快速占位回填

```bash
pnpm --filter @your/web run i18n:translate -- --fill-source
pnpm --filter @your/web run i18n:compile
```

仅在用户明确接受源语言占位时使用；回填不是实际翻译完成。

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

## 按失败阶段选择检查

从实际失败阶段开始，必要时向前核查输入，不要求每次跑完整链路。

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
