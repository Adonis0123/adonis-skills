---
applyTo: '**'
---

## Development Commands

```bash
pnpm build        # compile TypeScript to dist/
pnpm test         # run test suite
pnpm lint         # run ESLint
pnpm typecheck    # run TypeScript compiler check
```

## Recommended Local Validation Flow

1. Run type checks with `pnpm typecheck`.
2. Run linting with `pnpm lint`.
3. Run full test suite with `pnpm test`.
4. Run `pnpm build` to confirm compilation succeeds.

## Updating AI Rules

Edit files in `.ruler/*.md`, then run `pnpm run ruler:apply` to regenerate `CLAUDE.md` and `AGENTS.md`. Never edit `CLAUDE.md` or `AGENTS.md` directly.
