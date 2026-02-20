---
name: lingui-next-init
description: Scaffold Lingui i18n for Next.js App Router projects with deterministic scripts and templates. Use when you need to initialize or standardize multilingual setup in a single project or monorepo.
---

# Lingui Next Init

Initialize Lingui i18n in a Next.js App Router codebase using deterministic templates and a single scaffold script.

## Quick Start

Run the scaffold script with an absolute project path:

Set `SKILL_ROOT` to your actual skill install location first:
- Repository development: `.agents/skills/lingui-next-init`
- Installed runtime location: `.claude/skills/lingui-next-init`

```bash
python3 "${SKILL_ROOT}/scripts/scaffold_lingui_next.py" \
  --project-root /abs/path/to/project \
  --mode app-only \
  --locales en,zh \
  --default-locale en \
  --source-locale en \
  --package-manager pnpm
```

Dry-run first:

```bash
python3 "${SKILL_ROOT}/scripts/scaffold_lingui_next.py" \
  --project-root /abs/path/to/project \
  --mode shared-auto \
  --locales en,zh \
  --default-locale en \
  --source-locale en \
  --package-manager pnpm \
  --dry-run
```

`--package-manager` is restricted to: `pnpm`, `npm`, `yarn`, `bun`.

## Mode Decision

Choose one mode:

1. `app-only`
Create only app-side files under `web/**`. Never create `packages/i18n`.

2. `shared-auto`
Detect workspace and existing `packages/i18n`:
- Workspace + missing `packages/i18n`: create shared package templates.
- Existing `packages/i18n`: skip creating package files.
- No workspace and no package: fallback to app-only behavior.

3. `shared-force`
Always render shared package templates under `packages/i18n`.

## Generated Scope

The script renders templates from:

1. `assets/templates/app-router/web/**.tpl`
2. `assets/templates/app-router/packages/i18n/**.tpl` (mode-dependent)
3. `assets/templates/pages-router/_reserved.tpl` (reserved for future extension, not scaffolded)

`web/package.scripts.json.tpl` is merged into `web/package.json` incrementally:
- Add missing `scripts`
- Add missing `dependencies`
- Add missing `devDependencies`
- Never overwrite existing keys

## Validation Workflow

After scaffolding a target project:

First, merge the generated SWC snippet into your Next config:
- Merge `web/next.swc-snippet.ts` into `web/next.config.ts`.
- Ensure `experimental.swcPlugins` contains `["@lingui/swc-plugin", {}]`.
- Without this step, Lingui extraction/compile behavior may not match expectations.

```bash
pnpm --filter @your/web run i18n:extract
pnpm --filter @your/web run i18n:compile
pnpm --filter @your/web run i18n:manifest
pnpm --filter @your/web run typecheck
```

Use `--fill-source` when placeholder translation is acceptable:

```bash
pnpm --filter @your/web run i18n:translate -- --fill-source
```

## Troubleshooting

1. Manifest empty:
Confirm `web/src/locales/**` contains compiled `.mjs` files, then rerun `i18n:manifest`.

2. Locale route mismatch:
Verify `web/src/proxy.ts` default-locale rewrite and non-default prefix redirect logic.

3. No translated text at runtime:
Check `web/src/i18n/catalog-manifest.ts` and `web/src/i18n/appRouterI18n.ts` loader paths.

4. `shared-auto` with existing `packages/i18n`:
`shared-auto` will reuse the existing shared package and skip rendering `packages/i18n/**` templates.
Ensure your package exports `<i18n-package-name>/next-config` and `<i18n-package-name>/lingui-config`.
If not, use `--mode shared-force` to scaffold shared templates or switch to `--mode app-only`.

## References

Read these files only when needed:

1. `references/workflow-app-router.md`
2. `references/official-notes.md`
3. `references/pages-router-roadmap.md`
