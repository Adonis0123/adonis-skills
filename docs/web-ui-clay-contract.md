# Web UI Clay Contract

Scope: `apps/web/src/**` only. Do not apply these constraints to scripts, skills, or non-web packages.

## Visual Direction

- Keep the UI in a restrained Soft 3D Claymorphism direction.
- Preserve `--clay-peach: #fbaf77`, `--clay-blue: #87a6dd`, and `--clay-cream: #efdbc0`.
- Prefer subtle depth and material layering over glossy, high-contrast effects.

## Surfaces and Shadows

- Use `--shadow-clay-raised`, `--shadow-clay-inset`, and `--shadow-clay-floating`.
- Never add bottom outer highlight lines such as `0 1px 0 ...` to raised or floating shadows.
- Use inset or top-edge inner highlights when an accent is needed.
- Keep `clay-surface` edges stable during hover and transform transitions; avoid visible seams.

## Layout Spacing

- Drive vertical spacing through safe-area utilities and `--page-space-y-mobile`, `--page-space-y-desktop`, and `--page-space-y`.
- `safe-area-top` and `safe-area-bottom` must include both safe-area insets and base page spacing.
- Do not add per-page `py-*` spacing when safe-area utilities already provide the vertical rhythm.

## Components

- Reuse `ClaySurface`, `ClayCard`, `ClayButton`, and `ClayBadge` from `apps/web/src/components/ui/*` instead of ad hoc wrappers.
- Keep radius, border, and shadow behavior token-driven.
- Preserve `.clay-focus-ring` for interactive elements.

## Motion

- Keep motion restrained, use smooth cubic-bezier curves, and provide a reduced-motion fallback.
- Prefer `translate3d` over `translateY` when avoiding subpixel edge artifacts.
- Do not add decorative motion that changes layout flow or harms readability.
