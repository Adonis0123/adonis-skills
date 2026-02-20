# App Router Workflow

## Target Architecture

1. Locale routing in `web/src/proxy.ts`.
2. Runtime locale wiring in `web/src/app/[lang]/layout.tsx`.
3. Server i18n setup in `web/src/i18n/initLingui.ts`.
4. Catalog aggregation in `web/src/i18n/appRouterI18n.ts`.
5. Client hydration in `web/src/i18n/provider.tsx`.
6. Optional server-layout composition in `web/src/i18n/layout-factory.tsx` and `web/src/app/[lang]/(home)/layout.tsx`.
7. Extract/compile/manifest scripts in `web/scripts/i18n/*`.

## Commands

1. Extract:
`pnpm run i18n:extract`
2. Translate status:
`pnpm run i18n:translate`
3. Compile:
`pnpm run i18n:compile`
4. Regenerate manifest only:
`pnpm run i18n:manifest`

## Build Gate

`web/scripts/build.ts` should run `i18n:compile` before `next build` so production builds cannot skip Lingui compilation.

## Route Rules

1. Default locale accepts no-prefix URL (`/`) and rewrites internally.
2. Explicit default-locale prefix (`/en/...`) redirects to canonical no-prefix URL.
3. Non-default locales keep explicit prefix (`/zh/...`).

## Server Locale Initialization Rule (App Router / RSC)

1. `initLingui(locale)` must activate locale (`i18n.activate(locale)`) before calling `setI18n(i18n)`.
2. Do not rely on layout-only initialization. Call `initPageLingui(params)` in server `layout.tsx` and server `page.tsx` before using Lingui `t` or generating metadata.
3. For shared server components, prefer `useLingui`/`Trans` from `@lingui/react/macro` over global `t` from `@lingui/core/macro` unless initialization timing is strictly controlled.

## Optional Server Layout Composition

Enable this only when your project needs composable server layouts:

1. Pass `--with-server-layouts` to render `web/src/i18n/layout-factory.tsx` and `web/src/app/[lang]/(home)/layout.tsx`.
2. Use `--server-layouts-package` and `--server-layouts-version` when the layout package is not `@adonis-kit/react-layouts@latest`.
3. Keep `web/src/app/[lang]/layout.tsx` as the default `initLingui` entrypoint; use `I18nServerLayout` in nested route groups for composition.

## Translation Strategy

Keep translation flow deterministic:

1. Extract all source strings.
2. Fill missing target `msgstr`.
3. Compile catalogs and regenerate manifest.

Use source fallback when needed:

`pnpm run i18n:translate -- --fill-source`
