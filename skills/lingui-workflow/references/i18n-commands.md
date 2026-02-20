# Lingui i18n 命令说明（中文速查）

本文档解释 `web/package.json` 中的 `i18n:*` 命令含义、输入输出、副作用，以及日常该怎么执行。

## 先看这个

1. 日常新增/修改文案（推荐）：
`pnpm --filter @your/web run i18n:extract`
`pnpm --filter @your/web run i18n:translate`
`pnpm --filter @your/web run i18n:compile`

2. 首次初始化（快速跑通）：
`pnpm --filter @your/web run i18n:bootstrap`

3. 只重建 manifest：
`pnpm --filter @your/web run i18n:manifest`

4. 一条命令串联（高级用法）：
`pnpm --filter @your/web run i18n -- --compile`

注意：`i18n` 默认不会 compile；只有传 `--compile` 才会执行 compile。

## 参数组合速查

1. 标准串联并产出编译结果：
`pnpm --filter @your/web run i18n -- --compile`

2. 仅提取并编译（跳过 translate 统计）：
`pnpm --filter @your/web run i18n -- --no-translate --compile`

3. 翻译缺失项回填 source 文案：
`pnpm --filter @your/web run i18n:translate -- --fill-source`

4. 严格翻译检查（发现缺失即失败）：
`pnpm --filter @your/web run i18n -- --strict`

## 8 个命令的真实语义（基于当前脚本实现）

| 命令 | 实际执行 | 主要输入 | 主要输出 | 副作用 | 典型场景 |
| --- | --- | --- | --- | --- | --- |
| `i18n:extract` | `lingui extract-experimental` | 源码中的 `<Trans>` / `t` 文案 | `src/locales/**/*.po` 更新 | 会改写 `po` 文件 | 文案新增或改动后第一步 |
| `i18n:translate` | 统计目标语言缺失；`--fill-source` 时回填 `msgstr`；`--strict` 时缺失即报错 | `src/locales/**/*.po` | 控制台缺失统计 | `--fill-source` 会写回目标语言 `po` | 翻译前检查缺失项；占位回填 |
| `i18n:check` | `translate.ts --strict`；调用 `translateI18n({ strict: true })`，缺失 `msgstr` 时抛出 Error 并非零退出 | `src/locales/**/*.po` | 控制台缺失统计；缺失时非零退出 | 只读，不修改文件 | CI 管线中的翻译完整性门禁 |
| `i18n:compile` | `lingui compile` 后自动执行 `i18n:manifest` | `src/locales/**/*.po` | `src/locales/**/*.mjs` + `src/i18n/catalog-manifest.ts` | 会生成/覆盖编译产物与 manifest | 翻译完成后用于运行与构建 |
| `i18n:manifest` | 仅运行 `scripts/i18n/manifest.ts` | 已存在的 `src/locales/**/*.mjs` | `src/i18n/catalog-manifest.ts` | 会覆盖 manifest 文件 | 只想重建 loader 映射时 |
| `i18n:sync` | 当前仅调用 extract | 源码文案 | `src/locales/**/*.po` 更新 | 行为等价 `i18n:extract` | 兼容入口（不是全流程同步） |
| `i18n:bootstrap` | `extract + compile(+manifest)` | 源码文案 + `po` | `po/mjs/manifest` 全链路更新 | 会执行多步写入 | 初始化或一次性补齐产物 |
| `i18n` | 组合入口：默认 `extract + translate`；可加 `--compile`、`--fill-source`、`--no-translate`、`--strict` | 源码文案 + `po` | 默认输出统计；可选生成 `mjs/manifest`；`--strict` 时可非零退出 | 取决于参数 | 本地串联流程，减少多条命令 |

## `.gitignore` 建议（编译产物）

建议忽略以下编译产物，避免提交运行时生成文件：

```gitignore
web/src/locales/**/*.js
web/src/locales/**/*.mjs
web/locale/**/*.js
web/locale/**/*.mjs
```

说明：
1. 常用目录是 `web/src/locales/**`，`web/locale/**` 作为兼容路径一并忽略。
2. 这些规则只忽略编译产物，不影响 `po` 源文件提交。

## 常见误用与纠正

1. 误用：以为 `i18n` 默认会 compile。  
纠正：默认不会，需显式加 `--compile`。

2. 误用：把 `i18n:sync` 当成“全量同步”。  
纠正：当前实现只做 extract。

3. 误用：只跑 `i18n:manifest` 就想得到最新翻译。  
纠正：manifest 依赖已编译的 `.mjs`；先 compile 再谈 manifest。

4. 误用：只在 layout 初始化 locale，page 和共享服务端组件不处理。  
纠正：App Router / RSC 下应确保服务端 layout + page 都完成 locale 初始化（如 `initPageLingui(params)`）；共享服务端组件优先 `useLingui`/`Trans`。

## 变更后校验清单（命令语义有改动时）

当 `apps/web/scripts/i18n/index.ts`、`cli.ts`、`manifest.ts` 任一语义变化后，至少执行：

1. 文档同步：
- 更新本文件命令矩阵与参数组合。
- 如流程变化，更新 `references/workflow-daily.md`。

2. 运行校验：
```bash
pnpm --filter @your/web run i18n:extract
pnpm --filter @your/web run i18n -- --strict
pnpm --filter @your/web run i18n:compile
pnpm --filter @your/web run typecheck
```

3. 结果核对：
- `src/i18n/catalog-manifest.ts` 有预期 entry。
- `src/locales/**/*.mjs` 与 `po` 输入一致更新。

## 对应实现位置（便于核对）

1. 组合逻辑：`web/scripts/i18n/index.ts`
2. 组合入口参数：`web/scripts/i18n/cli.ts`
3. 仅 extract 的 sync 入口：`web/scripts/i18n/sync.ts`
4. extract + compile 的 bootstrap 入口：`web/scripts/i18n/bootstrap.ts`
5. manifest 生成器：`web/scripts/i18n/manifest.ts`
6. translate / check 逻辑：`web/scripts/i18n/translate.ts`（`i18n:check` = `translate.ts --strict`）
