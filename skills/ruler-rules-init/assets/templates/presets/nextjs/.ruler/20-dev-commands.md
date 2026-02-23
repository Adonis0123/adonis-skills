---
applyTo: '**'
---

## Development Commands

```bash
pnpm dev          # start Next.js dev server
pnpm build        # production build
pnpm start        # serve production build
pnpm lint         # run ESLint
pnpm typecheck    # run TypeScript compiler check
```

## Recommended Local Validation Flow

1. Run type checks with `pnpm typecheck`.
2. Run linting with `pnpm lint`.
3. Run `pnpm build` to confirm production build succeeds.

## Updating AI Rules

Edit files in `.ruler/*.md`, then run `pnpm run ruler:apply` to regenerate `CLAUDE.md` and `AGENTS.md`. Never edit `CLAUDE.md` or `AGENTS.md` directly.
