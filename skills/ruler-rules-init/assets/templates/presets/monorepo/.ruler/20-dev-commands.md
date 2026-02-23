---
applyTo: '**'
---

## Development Commands

```bash
pnpm dev          # start all dev servers via Turbo
pnpm build        # build all packages/apps via Turbo
pnpm lint         # lint all packages/apps
pnpm typecheck    # typecheck all packages/apps
pnpm test         # run tests across workspace
```

## Recommended Local Validation Flow

1. Run type checks with `pnpm typecheck`.
2. Run linting with `pnpm lint`.
3. Run target test scope for affected packages.
4. Run `pnpm build` to confirm cross-package build succeeds.

## Cross-Package Conventions

- Use workspace protocol (`workspace:*`) for internal dependencies.
- Build shared packages before consuming apps (Turbo handles ordering).
- Keep package boundaries clear: apps import from packages, not from other apps.

## Updating AI Rules

Edit files in `.ruler/*.md`, then run `pnpm run ruler:apply` to regenerate `CLAUDE.md` and `AGENTS.md`. Never edit `CLAUDE.md` or `AGENTS.md` directly.
