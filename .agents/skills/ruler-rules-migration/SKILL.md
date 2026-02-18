---
name: ruler-rules-migration
description: Migrate and bootstrap Ruler-based AI rules across repositories with English-first templates and safe, idempotent setup. Use when creating or standardizing `.ruler/*` files, generating `AGENTS.md`/`CLAUDE.md`, wiring `ruler:apply` into `package.json`, adding generated-file ignores in `.gitignore`, and designing `applyTo` scoping patterns such as `**` and `web/**`.
---

# Ruler Rules Migration

## Overview

Migrate a repository to a reusable Ruler rules structure with a safe audit/apply workflow.
Keep default templates in English and avoid overwriting existing repository-specific content unless explicitly forced.

## Inputs

Collect these inputs before applying changes:

- Target repository root path.
- Whether to run in `audit` or `apply` mode.
- Whether to include optional `skills:sync:claude` integration.
- Whether overwrite is allowed for differing files (`--force`).

## Workflow

1. Run the bootstrap script in `audit` mode.
2. Review missing files, differences, and manual actions.
3. Run in `apply` mode to create missing files and safe defaults.
4. Re-run `apply` to confirm idempotency.
5. Run `ruler:apply` in the target repo to generate root rule outputs.

## Decision Tree

1. Need only Ruler integration:
Use default behavior (do not pass `--with-optional-sync`).

2. Need optional Claude skills sync as well:
Pass `--with-optional-sync` to include `skills:sync:claude` suggestions.

3. Existing files differ from templates:
- Keep defaults safe: do not override without `--force`.
- Use `--force` only when intentional template replacement is required.

## Commands

Use these commands from this skill directory:

```bash
node ./scripts/bootstrap-ruler.mjs --target /path/to/repo --mode audit
node ./scripts/bootstrap-ruler.mjs --target /path/to/repo --mode apply
node ./scripts/bootstrap-ruler.mjs --target /path/to/repo --mode apply --with-optional-sync
node ./scripts/bootstrap-ruler.mjs --target /path/to/repo --mode apply --force
```

## Validation Checklist

After applying, verify:

1. `.ruler/ruler.toml` exists and defines `codex` + `claude` outputs.
2. Required `.ruler/*.md` templates exist.
3. `.gitignore` contains the Ruler generated-files block.
4. `package.json` contains `ruler:apply`.
5. If `is-ci` style guard is used, `is-ci` is installed (`pnpm add -D is-ci`).
6. `postinstall` follows the CI-skip recommendation or an explicit local alternative (preserve existing setup commands by chaining with `&& (...)`).
7. Running `ruler:apply` succeeds in the target repository.

## Resources

- Script:
`scripts/bootstrap-ruler.mjs`

- References:
`references/migration-playbook.md`
`references/applyto-patterns.md`

- Templates:
`assets/templates/.ruler/`
