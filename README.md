# adonis-skills

`adonis-skills` 是一个面向 Agent 的技能仓库，采用 `pnpm + Turborepo + Next.js 16` 的 monorepo 结构。

目标：

- 技能可通过 `npx skills add` 直接安装
- 提供 Web 页面展示 skills 元数据与安装方式
- 保持后续扩展（新增 skills、接入 npm 发布）的演进空间

## 当前状态

- 首批技能：`weekly-report`
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
```

如果仓库 owner 改变：

1. 设置环境变量 `SKILLS_REPO=<new-owner>/adonis-skills`
2. 重新运行 `pnpm skills:index`

## 新增 Skill 流程

1. 在 `skills/<skill-slug>/` 放置 `SKILL.md`
2. 可选增加 `references/`、`src/`
3. 运行：

```bash
pnpm skills:validate
pnpm skills:index
```

4. 提交后页面会自动展示新技能

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
