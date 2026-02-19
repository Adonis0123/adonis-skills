# Tailwind Audit for This Repository

## Current style chain

The current project uses this import chain:

1. `web/src/app/[lang]/layout.tsx`
   - imports `@/styles/globals.css`
   - imports `@/styles/custom.css`
2. `web/src/styles/globals.css`
   - imports `./tailwind-core.css`
3. `web/src/styles/tailwind-core.css`
   - imports `tailwindcss`
   - imports `tw-animate-css`
   - imports `./shadcn-theme.css`
   - enables `tailwind-scrollbar`
   - enables `@iconify/tailwind4`
4. `web/src/styles/custom.css`
   - uses `@reference` to access Tailwind context
   - defines safe-area and reduced-motion utilities

## Key history checkpoints

- `c17886d`
  - introduced `tailwind-core.css`
  - moved global entry to `globals.css -> tailwind-core.css`
  - added `custom.css`
  - added `tw-animate-css` and `tailwind-scrollbar`
- `c2f0cd3`
  - expanded `custom.css` with safe-area utilities and reduced-motion fallbacks
- `e6e68ec`
  - added `@plugin "@iconify/tailwind4"` in `tailwind-core.css`
  - added `@iconify-json/lucide`, `@iconify-json/mdi`, `@iconify-json/tabler`

## Icon usage status

- Runtime class usage currently observed: lucide (`icon-[lucide--...]`)
- Installed but currently less used: mdi, tabler
- Recommendation for cross-project init:
  - keep default `icons=all` for broad compatibility
  - allow `icons=lucide` for lean installs

## Reusable takeaways

- Keep Tailwind v4 config CSS-first.
- Keep style entry split: `tailwind-core.css`, `globals.css`, `custom.css`.
- Keep plugin setup in `tailwind-core.css`.
- Keep project-specific utilities in `custom.css`.
- Keep token and theme bridge in `shadcn-theme.css` (when using project-like preset).
- For this skill's template assets, store source files as `.tpl` and render runtime outputs as `.css`.
