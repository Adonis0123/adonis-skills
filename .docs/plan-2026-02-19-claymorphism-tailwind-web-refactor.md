# Plan: Claymorphism Tailwind Web Refactor

## Background
- `apps/web` already used Tailwind v4, but styling was based on a simpler card layout.
- We need a full Soft 3D Claymorphism redesign while keeping the code easy to migrate into `adonis-kit/packages/ui` later.
- This change must stay inside `adonis-skills` in this round.

## Goals
- Migrate style entry to `src/styles/{tailwind-core,globals,custom,shadcn-theme}.css`.
- Deliver Claymorphism light + dark themes with fixed light palette anchors: `#fbaf77`, `#87a6dd`, `#efdbc0`.
- Build reusable UI primitives under `apps/web/src/components/ui` and refactor existing pages to consume them.
- Add motion using `react-motion` plus reduced-motion fallback.
- Produce a concrete migration checklist for moving UI into `adonis-kit/packages/ui`.

## Scope
- In scope:
  - `apps/web/src/styles/**`
  - `apps/web/src/components/**`
  - `apps/web/src/app/layout.tsx`
  - `apps/web/src/app/page.tsx`
  - `apps/web/src/app/skills/[slug]/page.tsx`
  - `apps/web/src/app/not-found.tsx`
  - `apps/web/package.json`
- Out of scope:
  - Any direct edits under `/Users/adonis/coding/adonis-kit/**`.

## Solution
1. Initialize Tailwind v4 project-like style scaffold in `src/styles/`.
2. Replace base theme tokens with Claymorphism-focused variables and custom shadows.
3. Build reusable `ClayButton`, `ClayCard`, `ClayBadge`, `ClaySurface` primitives.
4. Add `SectionReveal` and `SkillsGridMotion` client components powered by `react-motion`.
5. Rebuild home/detail/404 pages around the new UI primitives and motion wrappers.
6. Keep server-client boundaries clean: only motion wrappers and clipboard action remain client components.

## Risks
- Tailwind plugin packages from the new style entry require dependency alignment.
- `react-motion` is older; type surface can be less strict than modern animation libraries.
- Claymorphism can reduce contrast if token values drift.

## Mitigations
- Add explicit dependencies in `apps/web/package.json`.
- Keep reduced-motion media fallback enabled in `custom.css`.
- Use shared color tokens and readable foreground colors for all components.

## Acceptance Criteria
- Home/detail/404 use consistent Claymorphism language.
- Light and dark theme both render with proper contrast.
- Motion is visible in normal mode and disabled in reduced-motion mode.
- `pnpm --filter @adonis-skills/web lint`, `typecheck`, and `build` pass.
- A migration checklist is included in the final report.

## Migration Checklist (to `adonis-kit/packages/ui`)
1. Copy UI primitives from:
   - `apps/web/src/components/ui/clay-button.tsx`
   - `apps/web/src/components/ui/clay-card.tsx`
   - `apps/web/src/components/ui/clay-badge.tsx`
   - `apps/web/src/components/ui/clay-surface.tsx`
   into `packages/ui/src/components/`.
2. Copy helper from `apps/web/src/components/ui/utils.ts` into `packages/ui/src/lib/` and adjust import paths.
3. Merge Clay tokens and utility classes from `apps/web/src/styles/shadcn-theme.css` + `apps/web/src/styles/custom.css` into `packages/ui/src/styles/globals.css`.
4. Export components in `packages/ui/src/index.ts`.
5. In consuming apps, replace local imports (`@/components/ui`) with `@adonis-kit/ui`.
6. Add Tailwind source scanning for built UI output path (for class extraction).
7. Run `typecheck` + `build` in both repositories and visually verify home/detail/404 pages.
