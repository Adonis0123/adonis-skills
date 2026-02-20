# Plan: Optional Server Layouts in `lingui-next-init`

## Background

`skills/lingui-next-init` currently scaffolds App Router Lingui i18n with a direct `[lang]/layout.tsx` initialization flow.
Some real-world Next.js App Router projects also compose route-group layouts using `withServerLayouts(...)` and a reusable i18n server layout wrapper.

## Goals

1. Add an optional, non-breaking server-layout scaffolding mode.
2. Keep current default output unchanged when no new flag is passed.
3. Support package and version customization for server-layout dependency injection.
4. Document the new optional flow clearly for skill users.

## Scope

In scope:

1. Add CLI flags to `scaffold_lingui_next.py`:
   - `--with-server-layouts`
   - `--server-layouts-package`
   - `--server-layouts-version`
2. Add optional templates:
   - `web/src/i18n/layout-factory.tsx`
   - `web/src/app/[lang]/(home)/layout.tsx`
3. Inject server-layout dependency into `web/package.json` only when enabled.
4. Update `SKILL.md` and `references/workflow-app-router.md`.

Out of scope:

1. Changing existing default `[lang]/layout.tsx` ownership of `initLingui`.
2. Updating `.claude/skills` directly (handled by sync workflow).

## Solution

1. Extend argument parsing with defaults:
   - package: `@adonis-kit/react-layouts`
   - version: `latest`
2. Add `SERVER_LAYOUTS_IMPORT_PATH` replacement as `<package>/server`.
3. Add conditional template rendering:
   - Skip optional templates unless `--with-server-layouts` is set.
4. Extend package merge logic to accept `extra_dependencies` and add only missing keys.
5. Add summary notes for enabled/disabled optional mode.
6. Update docs with command examples, behavior, and troubleshooting notes.

## Risks

1. Optional templates could be rendered without proper dependency export contract.
2. Users may assume optional mode replaces the default root i18n initialization.
3. Version string may be invalid for some package managers if users provide custom values.

Mitigations:

1. Explicit docs for `<package>/server` export requirement.
2. Explicit docs that `[lang]/layout.tsx` default init flow remains unchanged.
3. Keep merge strategy non-destructive and surface behavior in summary notes.

## Acceptance Criteria

1. Running scaffold without `--with-server-layouts` does not generate optional files or add dependency.
2. Running scaffold with `--with-server-layouts` generates both optional files.
3. Running scaffold with custom package/version renders imports and dependency key/value accordingly.
4. Existing dependency versions in target `web/package.json` are not overwritten.
5. `pnpm skills:validate` and `pnpm skills:index` pass after changes.
6. `pnpm skills:install:local -- --skill lingui-next-init` syncs updates into `.agents/skills`.
