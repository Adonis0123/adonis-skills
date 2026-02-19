---
applyTo: 'apps/web/src/**'
---

## Web UI Style Contract (apps/web only)

This rule applies only to source files under `apps/web/src/**`.
Do not apply these visual constraints to scripts, skills, or non-web packages.

### Visual Direction

- Keep the web UI in a **Soft 3D Claymorphism** direction with restrained contrast.
- Preserve the current clay palette anchors:
  - `--clay-peach: #fbaf77`
  - `--clay-blue: #87a6dd`
  - `--clay-cream: #efdbc0`
- Prefer subtle depth and material layering over high-contrast glossy effects.

### Surface and Shadow Rules

- Use shared clay tokens (`--shadow-clay-raised`, `--shadow-clay-inset`, `--shadow-clay-floating`) for depth.
- Do **not** introduce bottom outer highlight lines such as `0 1px 0 ...` in raised/floating shadows.
- If highlight accents are needed, prefer **inset** highlights or top-edge inner highlights.
- Keep `clay-surface` edges stable during hover/transform transitions and avoid visible seam artifacts.

### Layout Spacing Rules

- Keep page vertical spacing driven by safe-area utilities plus base spacing variables:
  - `--page-space-y-mobile`
  - `--page-space-y-desktop`
  - `--page-space-y`
- `safe-area-top` and `safe-area-bottom` should include both safe-area insets and base page spacing.
- Avoid duplicating top/bottom spacing with per-page `py-*` when safe-area utilities already provide vertical rhythm.

### Component Usage Rules

- Reuse primitives from `apps/web/src/components/ui/*` (`ClaySurface`, `ClayCard`, `ClayButton`, `ClayBadge`) instead of ad hoc visual wrappers.
- Keep radius, border, and shadow behavior token-driven.
- Preserve accessible focus states (`.clay-focus-ring`) for interactive elements.

### Motion Rules

- Maintain restrained motion with smooth cubic-bezier curves and reduced-motion fallback.
- Hover lift should avoid subpixel edge artifacts (`translate3d` is preferred over plain `translateY` when needed).
- Do not add decorative motion that changes layout flow or harms readability.
