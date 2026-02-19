# Pages Router Roadmap (Reserved)

This skill currently scaffolds App Router only. Use this document to guide future Pages Router support without breaking current templates.

## Planned Structure

1. Add templates under `assets/templates/pages-router/`.
2. Keep file naming and placeholder style identical to App Router templates.
3. Introduce `--router app|pages` only after pages templates are fully validated.

## Planned Runtime Shape

1. Locale routing with middleware/proxy equivalent behavior.
2. `_app.tsx` provider injection for Lingui runtime.
3. Shared extract/compile/manifest scripts where possible.

## Compatibility Constraints

1. Preserve existing CLI options:
`--mode`, `--locales`, `--default-locale`, `--source-locale`.
2. Keep incremental `web/package.json` merge behavior unchanged.
3. Avoid breaking App Router default path and generated file paths.

## Validation Before Enabling

1. Scaffold a Pages Router sample app.
2. Confirm extract + compile + runtime translation loop.
3. Validate default locale prefix policy in route handling.
