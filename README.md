# adonis-skills

`adonis-skills` 是一个面向 Agent 的技能仓库，采用 `pnpm + Turborepo + Next.js 16` 的 monorepo 结构。

目标：

- 技能可通过 `npx skills add` 直接安装
- 提供 Web 页面展示 skills 元数据与安装方式
- 保持后续扩展（新增 skills、接入 npm 发布）的演进空间

## 当前状态

- 当前公开技能：`commit`、`staged-review-validator`、`tailwindcss-next-init`、`weekly-report`
- 展示站：`apps/web`（Next.js 16）
- 技能目录：`skills/*`
- 技能索引自动生成：`scripts/generate-skills-index.mjs`
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

打开 `http://localhost:3000` 查看页面。

## 安装技能

默认仓库标识：`adonis0123/adonis-skills`

```bash
npx skills add adonis0123/adonis-skills --skill weekly-report
npx skills add adonis0123/adonis-skills --skill tailwindcss-next-init
```

如果仓库 owner 改变：

1. 设置环境变量 `SKILLS_REPO=<new-owner>/adonis-skills`
2. 重新运行 `pnpm skills:index`

## 命令速查（每条命令是做什么的）

下面按 `package.json` 中的 scripts 逐条说明，便于直接对照回忆。

| 命令 | 实际执行 | 含义 / 何时使用 |
| --- | --- | --- |
| `pnpm dev` | `turbo run dev --filter=@adonis-skills/web` | 启动 Web 站点开发模式（只跑 `apps/web`）。日常本地调试页面时用。 |
| `pnpm build` | `turbo run build` | 执行 monorepo 构建任务。提交前想确认可构建时用。 |
| `pnpm lint` | `turbo run lint` | 执行代码规范检查。改了 TS/JS 代码后用。 |
| `pnpm typecheck` | `turbo run typecheck` | 执行 TypeScript 类型检查。改类型或 API 后用。 |
| `pnpm skills:new` | `node --experimental-strip-types ./scripts/create-skill.ts` | 交互式创建新 skill（推荐入口）。会自动做：初始化目录 -> 快速校验 -> 全量校验 -> 刷新索引。 |
| `pnpm skills:init <skill-name> --path skills` | `python3 ./.agents/skills/repo-skill-creator/scripts/init_skill.py` | 只初始化 skill 目录和模板内容（手动模式）。当你不想走完整自动流程时用。 |
| `pnpm skills:quick-validate skills/<skill-name>` | `python3 ./.agents/skills/repo-skill-creator/scripts/quick_validate.py` | 只校验单个 skill（尤其是 frontmatter 合法性）。改完某个 skill 后先快速自检。 |
| `pnpm skills:openai-yaml <skill-dir>` | `python3 ./.agents/skills/repo-skill-creator/scripts/generate_openai_yaml.py` | 为 skill 生成 `agents/openai.yaml`（OpenAI skill interface 元数据）。需要补 interface 展示信息时用。 |
| `pnpm skills:validate` | `turbo run skills:validate --filter=@adonis-skills/web` | 仓库级 skills 校验。提交前、CI 前必须跑。 |
| `pnpm skills:index` | `turbo run skills:index --filter=@adonis-skills/web` | 重新生成 `apps/web/src/generated/skills-index.json`。新增/修改 skill 后用于刷新站点展示数据。 |
| `pnpm skills:install:local` | `node --experimental-strip-types ./scripts/install-local-skills.ts` | 把 `skills/` 安装到本地 `.agents/skills`（支持交互选择、`--all`、`--skill`）。本地联调 agent 时用。 |
| `pnpm skills:test:local` | `node --experimental-strip-types ./scripts/install-local-skills.ts --sync-llm` | 先本地安装，再自动同步到 `.claude/skills`。需要在本机 Claude/Codex 场景一起验证时用。 |
| `pnpm skills:sync:llm` | `node --experimental-strip-types ./scripts/sync-llm-skills.ts` | 将 `.agents/skills` 原子同步到 `.claude/skills`。当你只想重做同步，不想重新安装时用。 |
| `pnpm ruler:apply` | `pnpm dlx @intellectronica/ruler@latest apply --local-only --no-backup` | 根据 `.ruler/*` 规则生成/更新根目录 `AGENTS.md`、`CLAUDE.md` 等。修改规则后用。 |
| `pnpm postinstall` | 条件执行安装后钩子（CI 跳过，本地执行 `ruler:apply` 与 `skills:sync:llm`） | `pnpm install` 后自动触发：本地环境会执行 `ruler:apply` 和 `skills:sync:llm`，CI 环境会跳过。 |

补充：

- 日常新增 skill 最常用顺序：`skills:new` -> `skills:validate` -> `skills:index`
- 手动模式最常用顺序：`skills:init` -> `skills:quick-validate` -> `skills:validate` -> `skills:index`

## 新增 Skill 标准流程（SOP）

推荐使用一条命令快速创建：

```bash
pnpm skills:new
```

默认会交互收集 `name`、`description`、可选资源目录，并自动执行：

1. 初始化 skill 目录（默认到 `skills/`）
2. 单 skill 快速校验（`skills:quick-validate`）
3. 全仓库校验（`skills:validate`）
4. 更新索引（`skills:index`）

非交互创建示例：

```bash
pnpm skills:new -- --name demo-skill --description "用于演示新增 skill 流程" --resources scripts,references --non-interactive
```

底层命令（按需手动执行）：

```bash
pnpm skills:init <skill-name> --path skills --resources scripts,references
pnpm skills:quick-validate skills/<skill-name>
pnpm skills:validate
pnpm skills:index
```

## 本地交互安装与测试

本仓库支持将 `skills/` 目录内的技能先安装到 `.agents/skills`，再按需同步到 `.claude/skills`。

```bash
# 默认进入交互下拉菜单（select + checkbox）
pnpm skills:install:local

# 先交互安装，再一键同步到 .claude/skills
pnpm skills:test:local
```

交互菜单流程：

1. 先选择 `安装选中的 skills` / `安装全部 skills` / `退出`
2. 如果选择“安装选中的 skills”，进入多选列表（空格勾选）
3. 确认后执行安装

非交互模式同样可用：

```bash
# 安装单个（可重复 --skill）
pnpm skills:install:local -- --no-interactive --skill weekly-report

# 安装全部
pnpm skills:install:local -- --no-interactive --all

# 非交互安装后同步
pnpm skills:test:local -- --no-interactive --skill weekly-report
```

说明：

- 安装命令底层使用 `npx skills add ./skills -a codex ...`，目标目录是 `.agents/skills`
- `skills:test:local` 会在安装完成后执行 `skills:sync:llm`，把 `.agents/skills` 镜像到 `.claude/skills`

## CI

GitHub Actions 会执行：

- `pnpm install --frozen-lockfile`
- `pnpm skills:validate`
- `pnpm skills:index`
- `pnpm turbo run lint typecheck build --filter=@adonis-skills/web`

失败会阻断合并，保证主分支可部署。

## Vercel 部署（自动）

推荐在 Vercel 里连接本仓库并使用以下命令：

- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm turbo run build --filter=@adonis-skills/web`
- Output: Next.js 默认输出（不手动指定）

当主分支更新时，Vercel 会自动部署；若版本异常，直接在 GitHub revert 到上一个绿色提交即可回滚。

## 未来计划

V1 仅支持 GitHub 安装链路。后续可追加 npm 发布（含 GitHub Action 发包与回滚策略）。
