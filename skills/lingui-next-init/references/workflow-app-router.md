# App Router Workflow

This reference mirrors the proven workflow implemented in `ai-media2`.

## Target Architecture

1. Locale routing in `web/src/proxy.ts`.
2. Runtime locale wiring in `web/src/app/[lang]/layout.tsx`.
3. Server i18n setup in `web/src/i18n/initLingui.ts`.
4. Catalog aggregation in `web/src/i18n/appRouterI18n.ts`.
5. Client hydration in `web/src/i18n/provider.tsx`.
6. Extract/compile/manifest scripts in `web/scripts/i18n/*`.

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

## Translation Strategy

Keep translation flow deterministic:

1. Extract all source strings.
2. Fill missing target `msgstr`.
3. Compile catalogs and regenerate manifest.

Use source fallback when needed:

`pnpm run i18n:translate -- --fill-source`
