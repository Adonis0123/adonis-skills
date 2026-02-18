---
applyTo: '**'
---

## Project Context

- Stack: Node.js/TypeScript scripts + Python helper scripts + Turborepo monorepo + Next.js 16 web app (`apps/web`) + file-based skills catalog (`skills/*`).
- Package manager: pnpm (`pnpm@10.28.2`).
- Quality tools: ESLint, TypeScript typecheck, `scripts/validate-skills.mjs`, `scripts/generate-skills-index.mjs`, and repo-skill-creator Python helpers.

## Key Directories

- `skills/`: **public** skill definitions (for example `commit`, `staged-review-validator`, `weekly-report`) — indexed by web app, installable via `npx skills add`.
- `.agents/skills/`: **internal** agent skills and tooling — not published, synced locally to `.claude/skills/`.
- `.claude/skills/`: local mirror for Claude/Codex runtime testing (generated from `.agents/skills/`).
- `scripts/`: automation scripts:
  - `create-skill.ts` — interactive/CLI workflow for creating a new skill
  - `generate-skills-index.mjs` — scans `skills/`, generates `skills-index.json`
  - `validate-skills.mjs` — validates all skills' frontmatter (used by CI)
  - `install-local-skills.ts` — installs skills from `skills/` to `.agents/skills/` (supports `--all`, `--skill`, interactive mode)
  - `sync-llm-skills.ts` — atomically mirrors `.agents/skills/` to `.claude/skills/`
- `.agents/skills/repo-skill-creator/scripts/`:
  - `init_skill.py` — scaffolds a skill directory structure
  - `quick_validate.py` — validates a single skill quickly
  - `generate_openai_yaml.py` — generates `agents/openai.yaml` for skill metadata integration
- `apps/web/src/generated/skills-index.json`: generated skill index used by web UI (do not edit manually).
- `.ruler/`: source-of-truth rules that generate root `AGENTS.md` and `CLAUDE.md` via `pnpm ruler:apply`.
