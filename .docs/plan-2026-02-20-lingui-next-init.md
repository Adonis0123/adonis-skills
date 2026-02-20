# Lingui Initialization Plan for apps/web

## Background
- The web app currently uses App Router without locale segments and has no Lingui runtime wiring.
- We need shared i18n configuration in a workspace package for reuse and maintainability.

## Goals
- Initialize Lingui in `apps/web` with locales `en` and `zh`.
- Use default and source locale `en`.
- Introduce a shared package `@adonis-skills/i18n` under `packages/i18n`.
- Migrate routes into `[lang]` and keep internal links locale-aware.

## Scope
- In scope: scaffold output adoption, route/layout migration, locale-aware links, SWC plugin setup, package/workspace updates.
- Out of scope: migrating existing static copy to `@lingui/macro` messages.

## Solution
1. Scaffold Lingui app files under `apps/web` using `lingui-next-init`.
2. Create `packages/i18n` and export `next-config`/`lingui-config`.
3. Switch app-side i18n config imports to shared package.
4. Move pages to `src/app/[lang]/**` and merge existing shell/theme/fonts into `[lang]/layout`.
5. Add locale-aware href utilities and propagate locale through layout/header/footer/brand and pages.
6. Merge `@lingui/swc-plugin` into `next.config.ts` while preserving existing turbopack/code inspector setup.
7. Gate build with `scripts/build.ts` to ensure `i18n:compile` runs before `next build`.

## Risks
- Route migration may break links if locale propagation is incomplete.
- Root layout and nested layout HTML/body ownership can regress rendering if incorrectly composed.
- Workspace package resolution requires `pnpm-workspace.yaml` update and dependency linking.

## Acceptance Criteria
- `pnpm install` succeeds.
- `pnpm --filter @adonis-skills/web run typecheck` succeeds.
- `pnpm --filter @adonis-skills/web run i18n:extract`, `i18n:compile`, and `i18n:manifest` succeed.
- `/`, `/zh`, and `/zh/skills/<slug>` resolve correctly with expected locale behavior.
- Internal links preserve locale context.
