[English](./README.md) | 中文

# adonis-skills

`adonis-skills` 是一个面向 Agent 的技能仓库，采用 `pnpm + Turborepo + Next.js 16` 的 monorepo 架构。

目标：

- 让技能可通过 `npx skills add` 直接安装
- 提供展示技能元数据与安装命令的 Web 页面
- 为后续演进预留空间（新增技能、可选 npm 发布）

**在线地址**：<https://adonis-skills.vercel.app/>

## 当前状态

- 公开技能：`commit`、`staged-review-validator`、`tailwindcss-next-init`、`weekly-report`
- 展示站点：`apps/web`（Next.js 16）
- 技能目录：`skills/*`
- 技能索引生成：`scripts/generate-skills-index.mjs`
- 技能结构校验：`scripts/validate-skills.mjs`

## 仓库结构

```txt
.
├── apps/
│   └── web/
├── skills/
│   ├── commit/
│   ├── staged-review-validator/
│   ├── tailwindcss-next-init/
│   └── weekly-report/
├── scripts/
│   ├── generate-skills-index.mjs
│   └── validate-skills.mjs
├── turbo.json
├── pnpm-workspace.yaml
└── .github/workflows/ci.yml
```

## 快速开始

```bash
pnpm install
pnpm skills:validate
pnpm skills:index
pnpm dev
```

在浏览器打开 `http://localhost:3000`。

## 安装技能

默认仓库标识：`adonis0123/adonis-skills`

```bash
npx skills add adonis0123/adonis-skills --skill weekly-report
npx skills add adonis0123/adonis-skills --skill tailwindcss-next-init
```

如果仓库 owner 发生变化：

1. 设置 `SKILLS_REPO=<new-owner>/adonis-skills`
2. 重新运行 `pnpm skills:index`

## 命令速查（每条命令的作用）

下表解释 `package.json` 中每个 script 的用途。

| 命令 | 实际执行 | 含义 / 何时使用 |
| --- | --- | --- |
| `pnpm dev` | `turbo run dev --filter=@adonis-skills/web` | 启动 Web 站点开发模式（仅运行 `apps/web`）。用于日常本地页面调试。 |
| `pnpm build` | `turbo run build` | 执行 monorepo 构建任务。提交前用于确认仓库可构建。 |
| `pnpm lint` | `turbo run lint` | 执行代码规范检查。修改 TS/JS 后使用。 |
| `pnpm typecheck` | `turbo run typecheck` | 执行 TypeScript 类型检查。修改类型或 API 后使用。 |
| `pnpm skills:new` | `node --experimental-strip-types ./scripts/create-skill.ts` | 交互式创建新 skill 的推荐入口。自动执行：初始化 -> 快速校验 -> 全量校验 -> 刷新索引。 |
| `pnpm skills:finalize -- <skill-path>` | `node --experimental-strip-types ./scripts/finalize-skill.ts` | 对已创建/已复制到 `skills/*` 的 skill 执行标准收尾：`quick-validate` -> `validate` -> `index`。支持相对与绝对路径。 |
| `pnpm skills:finalize:new [-- --dry-run]` | `node --experimental-strip-types ./scripts/finalize-new-skills.ts` | 自动模式：仅当 `skills/<slug>/SKILL.md` 处于新增状态（`A` 或 `??`）时识别为新 skill，逐个执行 finalize，并自动暂存相关文件（`skills/<slug>` 与已变更的 skills 索引）。若未发现新增 skill，会自动回退到 `skills:new` 创建后再重扫。 |
| `pnpm skills:init <skill-name> --path skills` | `python3 ./.agents/skills/repo-skill-creator/scripts/init_skill.py` | 仅初始化 skill 目录与模板内容（手动模式）。当你不想走全自动流程时使用。 |
| `pnpm skills:quick-validate skills/<skill-name>` | `python3 ./.agents/skills/repo-skill-creator/scripts/quick_validate.py` | 校验单个 skill（尤其是 frontmatter 合法性）。用于修改单个 skill 后的快速自检。 |
| `pnpm skills:openai-yaml <skill-dir>` | `python3 ./.agents/skills/repo-skill-creator/scripts/generate_openai_yaml.py` | 为 skill 生成 `agents/openai.yaml`（OpenAI skill interface 元数据）。需要 interface 元数据时使用。 |
| `pnpm skills:validate` | `turbo run skills:validate --filter=@adonis-skills/web` | 仓库级 skills 校验。提交前/CI 前必跑。 |
| `pnpm skills:index` | `turbo run skills:index --filter=@adonis-skills/web` | 重新生成 `apps/web/src/generated/skills-index.json`。新增或修改 skill 后用于刷新 Web 数据。 |
| `pnpm skills:install:local` | `node --experimental-strip-types ./scripts/install-local-skills.ts` | 将 `skills/` 安装到本地 `.agents/skills`（支持交互选择、`--all`、`--skill`）。用于本地 agent 联调。 |
| `pnpm skills:test:local` | `node --experimental-strip-types ./scripts/install-local-skills.ts --sync-llm` | 先本地安装，再同步到 `.claude/skills`。用于同时验证本机 Claude/Codex 运行场景。 |
| `pnpm skills:sync:llm` | `node --experimental-strip-types ./scripts/sync-llm-skills.ts` | 将 `.agents/skills` 原子同步到 `.claude/skills`。仅想重跑同步时使用。 |
| `pnpm ruler:apply` | `pnpm dlx @intellectronica/ruler@latest apply --local-only --no-backup` | 根据 `.ruler/*` 规则生成/更新根目录 `AGENTS.md`、`CLAUDE.md` 等产物。修改规则后使用。 |
| `pnpm postinstall` | 条件执行安装后钩子（本地执行 `ruler:apply` 与 `skills:sync:llm`；CI 跳过） | 由 `pnpm install` 触发：本地会执行 `ruler:apply` 与 `skills:sync:llm`，CI 环境跳过。 |

补充：

- 默认直达流程（不传路径）：`skills:finalize:new`
- 新增 skill 的常用顺序：`skills:new` -> `skills:validate` -> `skills:index`
- 手动模式常用顺序：`skills:init`（或手工复制）-> `skills:finalize -- <skill-path>`

## 新增 Skill 标准流程（SOP）

自动模式（当你已在 `skills/*` 下新增/复制 skill 时推荐）：

```bash
pnpm skills:finalize:new
```

仅预览将执行内容（dry-run）：

```bash
pnpm skills:finalize:new -- --dry-run
```

推荐快速路径：

```bash
pnpm skills:new
```

默认会交互收集 `name`、`description`、可选资源目录，并自动执行：

1. 初始化 skill 目录（默认路径：`skills/`）
2. 单 skill 快速校验（`skills:quick-validate`）
3. 全仓库校验（`skills:validate`）
4. 更新索引（`skills:index`）

非交互创建示例：

```bash
pnpm skills:new -- --name demo-skill --description "用于演示新增 skill 流程" --resources scripts,references --non-interactive
```

手动模式（先初始化或复制，再执行收尾）：

```bash
pnpm skills:init <skill-name> --path skills --resources scripts,references
pnpm skills:finalize -- skills/<skill-name>
```

仅收尾（无需重新初始化）：

```bash
# 相对路径
pnpm skills:finalize -- skills/code-inspector-init

# 绝对路径（末尾 / 会自动处理）
pnpm skills:finalize -- /Users/adonis/coding/adonis-skills2/skills/code-inspector-init/

# 仅预览将执行的命令，不实际执行
pnpm skills:finalize -- --dry-run skills/code-inspector-init
```

## 本地交互安装与测试

本仓库支持将 `skills/` 内的技能安装到 `.agents/skills`，再按需同步到 `.claude/skills`。

```bash
# 默认进入交互菜单（select + checkbox）
pnpm skills:install:local

# 交互安装后，一键同步到 .claude/skills
pnpm skills:test:local
```

交互菜单流程：

1. 选择 `Install selected skills` / `Install all skills` / `Exit`
2. 选择“安装选中 skills”时，进入多选列表（空格勾选）
3. 确认后执行安装

也支持非交互模式：

```bash
# 安装单个（可重复 --skill）
pnpm skills:install:local -- --no-interactive --skill weekly-report

# 安装全部
pnpm skills:install:local -- --no-interactive --all

# 非交互安装后同步
pnpm skills:test:local -- --no-interactive --skill weekly-report
```

说明：

- 安装命令底层使用 `npx skills add ./skills -a codex ...`，目标目录为 `.agents/skills`
- `skills:test:local` 会在安装后执行 `skills:sync:llm`，将 `.agents/skills` 镜像到 `.claude/skills`

## CI

GitHub Actions 会执行：

- `pnpm install --frozen-lockfile`
- `pnpm skills:validate`
- `pnpm skills:index`
- `pnpm --filter @adonis-skills/web run i18n -- --compile --strict`
- `pnpm turbo run lint typecheck build --filter=@adonis-skills/web`

每一步的校验目标：

- `install`：按 lockfile 一致性安装依赖
- `skills:validate`：校验 `skills/*` 的 frontmatter/schema 合法性
- `skills:index`：重新生成 `apps/web/src/generated/skills-index.json`
- `Prepare i18n Catalogs`：将 `src/locales/**/*.po` 编译为 `*.mjs`，并重建 `src/i18n/catalog-manifest.ts`
- `lint/typecheck/build`：校验代码规范、TypeScript 类型正确性与生产构建可用性

为什么必须增加 i18n 步骤：

- Lingui 编译产物 `src/locales/**/*.mjs` 被设计为不入库（已被 git ignore）。
- `src/i18n/catalog-manifest.ts` 会静态导入这些 `.mjs` 文件。
- 如果 CI 未先编译 catalogs，`typecheck` 会出现 `TS2307`（`Cannot find module .../src/locales/.../*.mjs`）。

常见失败类型：

- 依赖安装失败（`pnpm install`）
- skills 校验失败（`pnpm skills:validate`）
- i18n 编译或严格翻译检查失败（`Prepare i18n Catalogs`）
- TypeScript 模块/类型错误（`typecheck`）

排障规则：

- 若出现 `TS2307` 且路径指向 `src/locales/**/*.mjs`，先执行 `pnpm --filter @adonis-skills/web run i18n -- --compile`，再重跑 typecheck。

若任一步失败会阻断合并，以保证主分支可部署。

## Vercel 自动部署

在 Vercel 连接本仓库时推荐使用：

- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm turbo run build --filter=@adonis-skills/web`
- Output: Next.js 默认输出（无需手动指定）

主分支更新后，Vercel 会自动部署。若出现异常版本，可在 GitHub 回滚到上一个绿色提交。

## 未来计划

V1 仅支持 GitHub 安装链路。后续可增加 npm 发布（包含 GitHub Action 发包与回滚策略）。
