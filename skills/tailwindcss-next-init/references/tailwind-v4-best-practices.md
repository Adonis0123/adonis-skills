# Tailwind v4 + Next.js Best Practices

## 1) Use CSS-first configuration

- Put core setup in CSS, not `tailwind.config.js`, when possible.
- Use:
  - `@import "tailwindcss";`
  - `@theme`
  - `@plugin`
  - `@source`
  - `@reference`

Why:
- Fewer moving parts.
- Better fit with Tailwind v4 design.
- Easier migration and maintenance.

## 2) Keep PostCSS minimal and explicit

Use a minimal `postcss.config.mjs`:

```js
const config = {
  plugins: ["@tailwindcss/postcss"],
};

export default config;
```

## 3) Split style responsibilities

Recommended split:
- `tailwind-core.css`: imports/plugins/theme bridge
- `globals.css`: app global entry
- `custom.css`: project utilities and overrides

Benefits:
- clear ownership
- easier migration
- safer incremental refactor

## 4) Use @source for external class scanning

Tailwind may miss classes from ignored folders or built package outputs.
When class tokens are from external UI libraries, add explicit sources:

```css
@source "../node_modules/@your-scope/ui/dist/**/*.{js,ts,jsx,tsx}";
@source "../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}";
```

## 5) Use @reference in local CSS contexts

When using CSS Modules or isolated style files that still need Tailwind theme/utilities, add:

```css
@reference "./tailwind-core.css";
```

This avoids repeating setup while keeping utilities available.

## 6) Iconify plugin needs icon data packages

`@iconify/tailwind4` only provides plugin behavior.
Install icon set packages for real icons:
- `@iconify-json/lucide`
- `@iconify-json/mdi`
- `@iconify-json/tabler`

## 7) Keep initialization idempotent

- Skip existing files by default.
- Overwrite only with explicit `--force`.
- Support `--dry-run` before write mode.

This is required for safe operation in existing projects.

## 8) Keep template source files as `.tpl`

For skill assets under `.agents/skills/**/assets/templates`, use `.tpl` source files and
render target files as `.css`.

Why:
- avoids noisy IDE CSS diagnostics on Tailwind-only directives in template assets
- separates "template source" from "runtime output" clearly
- keeps script behavior explicit and deterministic

## 9) `project-like` preset includes optional `antd` layer

The `project-like` template keeps this repository's style layering:

```css
@layer theme, base, antd, components, utilities;
```

`antd` is a repository-specific compatibility layer, not a universal Next.js requirement.
If the target project does not use Ant Design, remove `antd` from the layer list.

## Official docs

- https://tailwindcss.com/docs/functions-and-directives
- https://tailwindcss.com/docs/detecting-classes-in-source-files
- https://tailwindcss.com/docs/upgrade-guide
- https://tailwindcss.com/docs/compatibility
- https://nextjs.org/docs/app/guides/tailwind-css
- https://iconify.design/docs/usage/css/tailwind/
