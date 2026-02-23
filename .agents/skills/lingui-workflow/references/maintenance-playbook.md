# Lingui Skill Maintenance Playbook

本手册记录可复用的维护剧本，目标是下次遇到同类任务时可直接照抄执行。

## 适用范围

1. 新建 `skills/*` 下的 Lingui 相关公共 skill。
2. 在 `lingui-next-init` 与 `lingui-workflow` 之间迁移文档职责。
3. 更新命令语义文档并保持索引与校验通过。

## 标准剧本

### 1) 新建 skill（Creation Mode）

```bash
pnpm skills:init <skill-slug> --path skills --resources references
```

注意：
1. `skills:init` 会自动创建 `agents/openai.yaml`。
2. 若该文件不在本次范围，需在 finalize 前删除。

### 2) 迁移文档（先迁移再删除）

固定顺序：
1. 先在目标 skill 新增或更新完整文档。
2. 再在来源 skill 删除重复内容/文件。
3. 最后补交叉链接，确保入口不丢失。

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
find skills/<skill-slug> -maxdepth 3 -type f | sort
```
3. 若发现半迁移状态（目标已写，来源未删），按“先补齐目标，再清来源”收敛。

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
rg -n "\"slug\": \"<skill-slug>\"" apps/web/src/generated/skills-index.json
```

期望：能匹配到目标 slug，且描述未回退为模板占位文案。

## 命令语义漂移同步规则

当以下文件有语义变化时：
1. `apps/web/scripts/i18n/index.ts`（含 `cleanOrphanedCatalogs` 文件级清理逻辑（`.po/.mjs`）、`I18N_DRY_RUN` 试运行开关，以及非 dry-run 清理后触发 `manifestI18n()` 的一致性保护）
2. `apps/web/scripts/i18n/cli.ts`
3. `apps/web/scripts/i18n/manifest.ts`（含 `resolveSourceLocale` 回退链、ownership 判据、多后缀匹配规则与 manifest 统计逻辑）
4. `packages/i18n/src/lingui-config.ts`

必须同步：
1. `skills/lingui-workflow/references/i18n-commands.md`
2. `skills/lingui-workflow/references/workflow-daily.md`（若流程变化）
3. 相关 skill 中的误用说明与验收清单
