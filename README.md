English | [中文](./README.zh-CN.md)

# adonis-skills

`adonis-skills` is an agent-oriented skills repository built with a `pnpm + Turborepo + Next.js 16` monorepo architecture.

Goals:

- Make skills directly installable via `npx skills add`
- Provide a web UI that presents skill metadata and install commands
- Keep room for future evolution (more skills, optional npm publishing)

**Live site**: <https://adonis-skills.vercel.app/>

## Current Status

- Public skills: `commit`, `staged-review-validator`, `tailwindcss-next-init`, `weekly-report`
- Web site: `apps/web` (Next.js 16)
- Skills directory: `skills/*`
- Skills index generation: `scripts/generate-skills-index.mjs`
- Skills structure validation: `scripts/validate-skills.mjs`

## Repository Structure

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

## Quick Start

```bash
pnpm install
pnpm skills:validate
pnpm skills:index
pnpm dev
```

Open `http://localhost:3000` in your browser.

## Install Skills

Default repository identifier: `adonis0123/adonis-skills`

```bash
npx skills add adonis0123/adonis-skills --skill weekly-report
npx skills add adonis0123/adonis-skills --skill tailwindcss-next-init
```

If the repository owner changes:

1. Set `SKILLS_REPO=<new-owner>/adonis-skills`
2. Run `pnpm skills:index` again

## Command Cheatsheet (What Each Command Does)

The table below explains each script in `package.json`.

| Command | Actual Execution | Meaning / When to Use |
| --- | --- | --- |
| `pnpm dev` | `turbo run dev --filter=@adonis-skills/web` | Starts web site development mode (`apps/web` only). Use for daily local UI debugging. |
| `pnpm build` | `turbo run build` | Runs monorepo build tasks. Use before submitting changes when you want to ensure the repo builds. |
| `pnpm lint` | `turbo run lint` | Runs code style/lint checks. Use after TS/JS changes. |
| `pnpm typecheck` | `turbo run typecheck` | Runs TypeScript type checks. Use after type/API changes. |
| `pnpm skills:new` | `node --experimental-strip-types ./scripts/create-skill.ts` | Interactive entrypoint to create a new skill. Automatically does: init -> quick validate -> full validate -> index refresh. |
| `pnpm skills:finalize -- <skill-path>` | `node --experimental-strip-types ./scripts/finalize-skill.ts` | Standard finalize flow for an existing/copied skill under `skills/*`: `quick-validate` -> `validate` -> `index`. Supports relative and absolute paths. |
| `pnpm skills:init <skill-name> --path skills` | `python3 ./.agents/skills/repo-skill-creator/scripts/init_skill.py` | Initializes only skill directory/template content (manual mode). Use when you do not want the full automated flow. |
| `pnpm skills:quick-validate skills/<skill-name>` | `python3 ./.agents/skills/repo-skill-creator/scripts/quick_validate.py` | Validates a single skill (especially frontmatter validity). Use as fast local check after editing one skill. |
| `pnpm skills:openai-yaml <skill-dir>` | `python3 ./.agents/skills/repo-skill-creator/scripts/generate_openai_yaml.py` | Generates `agents/openai.yaml` for a skill (OpenAI skill interface metadata). Use when interface metadata is needed. |
| `pnpm skills:validate` | `turbo run skills:validate --filter=@adonis-skills/web` | Repository-wide skills validation. Required before commit/CI. |
| `pnpm skills:index` | `turbo run skills:index --filter=@adonis-skills/web` | Regenerates `apps/web/src/generated/skills-index.json`. Run after adding/updating skills so web data stays fresh. |
| `pnpm skills:install:local` | `node --experimental-strip-types ./scripts/install-local-skills.ts` | Installs skills from `skills/` into local `.agents/skills` (supports interactive selection, `--all`, `--skill`). Use for local agent testing. |
| `pnpm skills:test:local` | `node --experimental-strip-types ./scripts/install-local-skills.ts --sync-llm` | Installs locally first, then syncs to `.claude/skills`. Use when testing in local Claude/Codex runtime too. |
| `pnpm skills:sync:llm` | `node --experimental-strip-types ./scripts/sync-llm-skills.ts` | Atomically syncs `.agents/skills` to `.claude/skills`. Use when you only want to rerun sync. |
| `pnpm ruler:apply` | `pnpm dlx @intellectronica/ruler@latest apply --local-only --no-backup` | Generates/updates root outputs like `AGENTS.md` and `CLAUDE.md` from `.ruler/*`. Run after rule changes. |
| `pnpm postinstall` | Conditional postinstall hook (`ruler:apply` and `skills:sync:llm` locally; skipped in CI) | Triggered by `pnpm install`: local runs perform `ruler:apply` and `skills:sync:llm`; CI skips them. |

Notes:

- Most common flow for new skills: `skills:new` -> `skills:validate` -> `skills:index`
- Most common manual flow: `skills:init` (or copy manually) -> `skills:finalize -- <skill-path>`

## New Skill Standard Flow (SOP)

Recommended quick path:

```bash
pnpm skills:new
```

By default it interactively collects `name`, `description`, optional resource directories, then runs:

1. Initialize skill directory (default path: `skills/`)
2. Single-skill quick validation (`skills:quick-validate`)
3. Repository-wide validation (`skills:validate`)
4. Index regeneration (`skills:index`)

Non-interactive creation example:

```bash
pnpm skills:new -- --name demo-skill --description "Used to demonstrate the new skill workflow" --resources scripts,references --non-interactive
```

Manual mode (initialize or copy first, then finalize):

```bash
pnpm skills:init <skill-name> --path skills --resources scripts,references
pnpm skills:finalize -- skills/<skill-name>
```

Finalize only (no re-initialization needed):

```bash
# Relative path
pnpm skills:finalize -- skills/code-inspector-init

# Absolute path (trailing / is handled automatically)
pnpm skills:finalize -- /Users/adonis/coding/adonis-skills2/skills/code-inspector-init/

# Preview commands only; do not execute
pnpm skills:finalize -- --dry-run skills/code-inspector-init
```

## Local Interactive Install and Testing

This repository supports installing skills from `skills/` into `.agents/skills`, then optionally syncing to `.claude/skills`.

```bash
# Default: enter interactive menu (select + checkbox)
pnpm skills:install:local

# Interactive install, then one-step sync to .claude/skills
pnpm skills:test:local
```

Interactive menu flow:

1. Choose `Install selected skills` / `Install all skills` / `Exit`
2. If choosing selected install, go into multi-select list (space to check)
3. Confirm and execute install

Non-interactive mode is also supported:

```bash
# Install one skill (repeat --skill if needed)
pnpm skills:install:local -- --no-interactive --skill weekly-report

# Install all
pnpm skills:install:local -- --no-interactive --all

# Install then sync in non-interactive mode
pnpm skills:test:local -- --no-interactive --skill weekly-report
```

Notes:

- Install command uses `npx skills add ./skills -a codex ...` under the hood, target directory is `.agents/skills`
- `skills:test:local` runs `skills:sync:llm` after install and mirrors `.agents/skills` into `.claude/skills`

## CI

GitHub Actions runs:

- `pnpm install --frozen-lockfile`
- `pnpm skills:validate`
- `pnpm skills:index`
- `pnpm --filter @adonis-skills/web run i18n -- --compile --strict`
- `pnpm turbo run lint typecheck build --filter=@adonis-skills/web`

What each step validates:

- `install`: lockfile-consistent dependency install
- `skills:validate`: frontmatter/schema validity for `skills/*`
- `skills:index`: regenerates `apps/web/src/generated/skills-index.json`
- `Prepare i18n Catalogs`: compiles `src/locales/**/*.po` into `*.mjs` and regenerates `src/i18n/catalog-manifest.ts`
- `lint/typecheck/build`: code quality, TS correctness, and production buildability

Why the i18n step is required:

- compiled Lingui catalogs (`src/locales/**/*.mjs`) are intentionally ignored by git.
- `src/i18n/catalog-manifest.ts` imports those `.mjs` files.
- without pre-compiling catalogs in CI, `typecheck` can fail with `TS2307` ("Cannot find module .../src/locales/.../*.mjs").

Common failure categories:

- dependency/install issue (`pnpm install`)
- skills validation failure (`pnpm skills:validate`)
- i18n compile/translation strict check failure (`Prepare i18n Catalogs`)
- TypeScript module/type errors (`typecheck`)

Troubleshooting rule:

- if you see `TS2307` paths pointing to `src/locales/**/*.mjs`, run `pnpm --filter @adonis-skills/web run i18n -- --compile` first, then rerun typecheck.

Failures block merge to keep the main branch deployable.

## Vercel Deployment (Automatic)

Recommended Vercel settings for this repository:

- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm turbo run build --filter=@adonis-skills/web`
- Output: default Next.js output (no manual override)

After main branch updates, Vercel deploys automatically. If a bad release appears, revert to the previous green commit on GitHub.

## Future Plan

V1 supports GitHub installation flow only. Later we can add npm publishing (including GitHub Action release and rollback strategy).
