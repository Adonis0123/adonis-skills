# Lingui Skill Maintenance Playbook

本手册仅用于维护本仓库保留的 Lingui 工作流文档。初始化模板已经退役，不再新建、迁移或同步对应模板。

## 适用范围

1. 根据既有项目的实际脚本更新命令语义文档。
2. 同步工作流入口与相关参考，并保持索引与校验通过。

## 标准剧本

### 1) 先核对实际项目

只读取本次问题对应的脚本与配置，记录适用版本或脚本约定。通用说明与历史模板示例分开；不把个别项目的命令名、目录和 manifest 机制当成 Lingui 的标准接口。

### 2) 更新工作流文档

同步入口、命令参考与受影响的场景说明；保留适用范围和副作用边界，不恢复已退役初始化 skill 的路由。

### 3) Finalize 固定流水线

```bash
pnpm skills:finalize -- skills/<skill-slug>
```

等价步骤：

1. `pnpm skills:quick-validate skills/<skill-slug>`
2. `pnpm skills:validate`
3. `pnpm skills:index`

## 常见失败与恢复步骤

### 场景 A：中断后状态不清楚（例如 turn aborted）

1. 先看当前状态：

```bash
git status --short
```

2. 确认关键文件存在性与内容：

```bash
rg --files skills/<skill-slug>
```

3. 若发现文档更新不完整，补齐入口与参考的一致性；不要借机删除其他内容。

### 场景 B：`quick-validate` 失败

重点检查：

1. `SKILL.md` frontmatter 的 `name`、`description`。
2. `description` 是否 English-only ASCII。
3. frontmatter 是否包含不允许键。

### 场景 C：`skills:index` 后未出现新 skill

重点检查：

1. 目录是否在 `skills/<slug>/`。
2. `SKILL.md` frontmatter 是否有效。
3. 重新执行：

```bash
pnpm skills:index
```

## 索引核对命令模板

```bash
rg -n "\"slug\": \"<skill-slug>\"" apps/web/src/generated/skills-index-lite.json
```

期望：能匹配到目标 slug，且描述未回退为模板占位文案。

## 命令语义漂移同步规则

仅当既有目标项目仍采用以下历史路径和实现，且本次已核实语义变化时更新说明；实际项目脚本优先：

1. `apps/web/scripts/i18n/index.ts`（含 `cleanOrphanedCatalogs` 文件级清理逻辑（`.po/.mjs`）、`I18N_DRY_RUN` 试运行开关，以及非 dry-run 清理后触发 `manifestI18n()` 的一致性保护）
2. `apps/web/scripts/i18n/cli.ts`
3. `apps/web/scripts/i18n/manifest.ts`（含 `resolveSourceLocale` 回退链、ownership 判据、多后缀匹配规则与 manifest 统计逻辑）
4. `packages/i18n/src/lingui-config.ts`

同步文档，不同步已退役的初始化模板：

1. `skills/lingui-workflow/references/i18n-commands.md`
2. `skills/lingui-workflow/references/workflow-daily.md`（若流程变化）
3. 相关 skill 中的误用说明与验收清单
