# Claymorphism Theme Refactor Plan

## Background
The `apps/web` UI already uses clay-style primitives (`ClaySurface`, `ClayCard`, `ClayButton`, `ClayBadge`) but its palette and control styling do not match the requested orange/blue claymorphism reference.

## Goals
- Replace theme colors with the requested palette:
  - Primary `#ff9f43`
  - Secondary `#87ceeb`
  - Background `#fff8f0`
  - Text `#2d2d2d` / muted `#888888`
- Unify buttons, cards, and badges to the requested claymorphism visual spec.
- Keep structure, content, routing, and behavior unchanged.
- Keep dark-mode toggle functionality with readable dark adaptation.

## Scope
- `apps/web/src/styles/shadcn-theme.css`
- `apps/web/src/styles/custom.css`
- `apps/web/src/components/ui/clay-button.tsx`
- `apps/web/src/components/layout/theme-toggle.tsx`
- `apps/web/src/components/layout/site-header.tsx`

## Solution
1. Redefine theme tokens in `shadcn-theme.css` using the target palette.
2. Add clay-specific semantic tokens for radius, shadow, button press depth, and top highlight.
3. Rework `custom.css` component layers:
   - Card/surface: white base, 24px radius, 2px warm border, reference shadows, top inner highlight, hover lift.
   - Buttons: pill radius (50px), bold text, exact primary/secondary/blue variants and hover press behavior.
   - Badges: blue pill labels with white text.
   - Body/text: warm background with reduced visual noise and muted text semantics.
4. Extend `ClayButton` variants with `blue`.
5. Switch theme toggle to `blue` button variant.
6. Move header navigation links to the same clay-button visual language.

## Risks
- Strict shadow values may conflict with previous style-contract constraints.
- Dark-mode contrast may need minor tuning after visual QA on real devices.
- Header link sizing may change slightly due to unified button sizing.

## Acceptance Criteria
- Light mode button/card/badge visuals match the requested colors, radii, and shadow behavior.
- `ClayButton` supports `blue` variant.
- Theme toggle still switches between light/dark.
- No layout structure or business functionality changes.
- `pnpm -C apps/web lint`, `pnpm -C apps/web typecheck`, and `pnpm -C apps/web build` pass.
