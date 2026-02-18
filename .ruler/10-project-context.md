---
applyTo: '**'
---

## Project Context

- Stack: Node.js scripts + Turborepo monorepo + Next.js 16 web app (`apps/web`) + file-based skills catalog (`skills/*`).
- Package manager: pnpm (`pnpm@10.28.2`).
- Quality tools: ESLint, TypeScript typecheck, `scripts/validate-skills.mjs`, `scripts/generate-skills-index.mjs`.

## Key Directories

- `skills/`: public skill definitions consumed by index/validation and web pages.
- `.agents/skills/`: local agent skills and helper workflows (including repository-specific skill tooling).
- `scripts/`: repository automation scripts (`create-skill.ts`, `install-local-skills.ts`, `sync-llm-skills.ts`).
- `apps/web/src/generated/skills-index.json`: generated skill index used by web UI.
- `.ruler/`: source-of-truth rules that generate root `AGENTS.md` and `CLAUDE.md`.
