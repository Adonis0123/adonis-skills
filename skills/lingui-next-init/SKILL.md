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

Optional server-layout composition:

```bash
python3 "${SKILL_ROOT}/scripts/scaffold_lingui_next.py" \
  --project-root /abs/path/to/project \
  --mode app-only \
  --locales en,zh \
  --default-locale en \
  --source-locale en \
  --package-manager pnpm \
  --with-server-layouts \
  --server-layouts-package @adonis-kit/react-layouts \
  --server-layouts-version latest \
  --dry-run
```

When `--with-server-layouts` is enabled:
- Render optional templates: `web/src/i18n/layout-factory.tsx` and `web/src/app/[lang]/(home)/layout.tsx`.
- Merge `--server-layouts-package` and `--server-layouts-version` into `web/package.json` `dependencies` when missing.
- Preserve the default `web/src/app/[lang]/layout.tsx` `initLingui` flow.
- Keep server initialization explicit: call `initPageLingui(params)` in server layouts and server pages before using Lingui `t`/metadata.

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
3. `assets/templates/app-router/web/src/i18n/layout-factory.tsx.tpl` and `assets/templates/app-router/web/src/app/[lang]/(home)/layout.tsx.tpl` (only when `--with-server-layouts` is enabled)
4. `assets/templates/pages-router/_reserved.tpl` (reserved for future extension, not scaffolded)

`web/package.scripts.json.tpl` is merged into `web/package.json` incrementally:
- Add missing `scripts`
- Add missing `dependencies`
- Add missing `devDependencies`
- If `--with-server-layouts` is enabled, add missing `dependencies.<server-layouts-package>` with `<server-layouts-version>`
- Never overwrite existing keys

Project-root `.gitignore` is merged incrementally:
- Add missing compiled-catalog ignore patterns:
  - `web/src/locales/**/*.js`
  - `web/src/locales/**/*.mjs`
  - `web/locale/**/*.js`
  - `web/locale/**/*.mjs`
- Never remove existing rules

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

Daily command execution and troubleshooting are maintained in `lingui-workflow`.
Use `skills/lingui-workflow` for the day-to-day extract/translate/compile workflow.

## Experience Notes

Use this checklist to avoid common maintenance mistakes when updating Lingui skills:

1. Handoff timing:
After scaffold/setup is done, hand over immediately to `skills/lingui-workflow` for day-to-day command guidance.

2. Documentation migration order:
Migrate content to the target new doc first, then delete old duplicate docs, and run finalize pipeline last.

3. `skills:init` side effect:
`pnpm skills:init` creates `agents/openai.yaml` automatically.
If this file is not needed for the new public skill, remove it before finalize.

4. Large workspace safety:
Run `git status` before `skills:finalize` so `AD`/`MM` states are understood and not misinterpreted as current-task failures.

## Troubleshooting

1. Manifest empty:
Confirm `web/src/locales/**` contains compiled `.mjs` files, then rerun `i18n:manifest`.

2. Locale route mismatch:
Verify `web/src/proxy.ts` default-locale rewrite and non-default prefix redirect logic.

3. No translated text at runtime:
Check `web/src/i18n/catalog-manifest.ts` and `web/src/i18n/appRouterI18n.ts` loader paths.

4. Error: `Attempted to call a translation function without setting a locale`:
Confirm `web/src/i18n/initLingui.ts` activates locale before `setI18n`.
Then ensure both server `layout.tsx` and server `page.tsx` call `initPageLingui(params)` (or equivalent) before `t`/metadata usage.
Prefer `useLingui`/`Trans` in shared server components.

5. `shared-auto` with existing `packages/i18n`:
`shared-auto` will reuse the existing shared package and skip rendering `packages/i18n/**` templates.
Ensure your package exports `<i18n-package-name>/next-config` and `<i18n-package-name>/lingui-config`.
If not, use `--mode shared-force` to scaffold shared templates or switch to `--mode app-only`.

6. `withServerLayouts` setup issues:
Confirm `--with-server-layouts` is enabled and your package exports `<server-layouts-package>/server`.
If you use a custom package, pass `--server-layouts-package` explicitly.

## References

Read these files only when needed:

1. `references/workflow-app-router.md`
2. `references/official-notes.md`
3. `references/pages-router-roadmap.md`
4. Daily workflow skill: `skills/lingui-workflow`
