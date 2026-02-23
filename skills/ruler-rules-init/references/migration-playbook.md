# Ruler Migration Playbook

## Goal

Set up a reusable Ruler integration that is safe by default, English-first, and portable across repositories.

## Preset Selection

Choose a preset that matches the target project type. The bootstrap script supports auto-detection or explicit selection.

| Preset | When to Use | Auto-detect Signal |
|--------|-------------|-------------------|
| `base` | Generic or unknown projects | Fallback |
| `nextjs` | Next.js App Router projects | `next.config.*` found |
| `monorepo` | Turborepo / pnpm workspaces | `turbo.json` or `pnpm-workspace.yaml` found |
| `node-lib` | Published Node.js libraries | `main` or `exports` in `package.json` |

Auto-detection priority: `monorepo` > `nextjs` > `node-lib` > `base`.

To override auto-detection, pass `--preset <name>` explicitly.

## Recommended Flow

1. Run audit mode first:

```bash
node ./scripts/bootstrap-ruler.mjs --target /path/to/repo --mode audit
```

2. Review summary items marked `missing`, `differs`, and `manual`.
   Check the detected preset and confirm it matches the project type.
3. Run apply mode:

```bash
node ./scripts/bootstrap-ruler.mjs --target /path/to/repo --mode apply
```

Or with an explicit preset:

```bash
node ./scripts/bootstrap-ruler.mjs --target /path/to/repo --mode apply --preset nextjs
```

4. Re-run apply mode to confirm idempotency.
5. Run `pnpm run ruler:apply` inside the target repository.

## Postinstall Recommendation (CI Skip)

Prefer CI-safe postinstall defaults so CI does not rewrite generated files unexpectedly.
Prefer `is-ci` style when the package is installed.

Install it if needed:

```bash
pnpm add -D is-ci
```

### Ruler-only mode

```json
{
  "scripts": {
    "ruler:apply": "pnpm dlx @intellectronica/ruler@latest apply --local-only --no-backup",
    "postinstall": "is-ci && echo 'Skipping ruler:apply in CI environment' || pnpm run ruler:apply"
  }
}
```

### Ruler + optional skills sync mode

```json
{
  "scripts": {
    "ruler:apply": "pnpm dlx @intellectronica/ruler@latest apply --local-only --no-backup",
    "skills:sync:claude": "node --experimental-strip-types ./scripts/sync-claude-skills.ts",
    "postinstall": "is-ci && echo 'Skipping ruler:apply and skills sync in CI environment' || (pnpm run ruler:apply && pnpm run skills:sync:claude)"
  }
}
```

### Preserve existing postinstall chain

If your repository already has setup commands (for example `db:generate`), keep them and append the CI-guarded Ruler segment:

```json
{
  "scripts": {
    "postinstall": "pnpm run db:generate && (is-ci && echo 'Skipping ruler:apply and skills sync in CI environment' || (pnpm run ruler:apply && pnpm run skills:sync:claude))",
    "prepare": "simple-git-hooks"
  }
}
```

### Fallback without is-ci

If you do not install `is-ci`, use the environment-variable guard:

```json
{
  "scripts": {
    "postinstall": "[ -n \"$CI\" ] && echo 'Skipping ruler:apply in CI environment' || pnpm run ruler:apply"
  }
}
```

## Template Resolution

The bootstrap script uses a base + overlay strategy:

1. Universal files (`ruler.toml`, `AGENTS.md`, `00-core-principles.md`) always come from `base/`.
2. Project-specific files (`10-project-context.md`, `20-dev-commands.md`, `30-coding-conventions.md`) are checked in the preset directory first, then fall back to `base/`.
3. This means presets only need to provide the files that differ from base.

## Safe Overwrite Policy

- Do not overwrite differing files by default.
- Use `--force` only when intentional template replacement is required.
- Treat existing repository conventions as source-of-truth unless migration explicitly requires standardization.

## Validation Checklist

- `.ruler/ruler.toml` exists with both `codex` and `claude` agent outputs.
- `.ruler/*.md` baseline files are present.
- `.gitignore` includes generated-file ignore block.
- `package.json` includes `ruler:apply`.
- `postinstall` behavior is explicitly chosen.

## Manual Follow-up Cases

- Existing `package.json` scripts conflict with recommendations.
- Existing `.gitignore` marker block is custom and should not be force-replaced.
- Existing `.ruler` files intentionally differ from template defaults.
- Auto-detected preset does not match actual project type (use `--preset` to override).
