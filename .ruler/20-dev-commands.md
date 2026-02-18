---
applyTo: '**'
---

## Development Commands

```bash
pnpm skills:new
pnpm skills:init <skill-name> --path skills
pnpm skills:quick-validate skills/<skill-slug>
pnpm skills:validate
pnpm skills:index
pnpm skills:install:local
pnpm skills:test:local
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
```

## Recommended Local Validation Flow

1. For a new skill, run `pnpm skills:new` (or `pnpm skills:init ...`) and ensure frontmatter is complete.
2. Run `pnpm skills:quick-validate skills/<skill-slug>`.
3. Run `pnpm skills:validate` for repository-wide checks.
4. Run `pnpm skills:index` to refresh `apps/web/src/generated/skills-index.json`.
5. If local agent testing is needed, run `pnpm skills:install:local` or `pnpm skills:test:local`.
6. For app/runtime changes, run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
