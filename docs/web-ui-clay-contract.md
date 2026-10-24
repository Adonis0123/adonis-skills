# Web UI Contract

Scope: `apps/web/src/**` only. Do not apply these constraints to scripts, skills, or non-web packages.

The Catalog Site presents as **Nika Skills**. **What it looks like** is defined in the root [`DESIGN.md`](../DESIGN.md) (colors, typography, layout, elevation, shapes, components, illustration, dark mode, do's and don'ts). That file is generated: its source is the private `adonis-brand` repo (`projects/skills/DESIGN.md`), and `pnpm brand:sync` injects the colors. This contract covers **how this repo implements it**.

Decisions: `docs/decision-2026-10-18-brand-palette-from-adonis-brand.md` (colors come from adonis-brand), `docs/decision-2026-10-18-skills-site-redesign.md` (v3 redesign).

## Tokens

| Layer                | Source of truth                                                                                                                                                      | In this repo                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Brand                | `adonis-brand/design-system/tokens.json` (scales of the accent theme picked by `projects/skills/theme.json` `designSystem.accent`, currently `teal`)                 | `apps/web/src/styles/brand-tokens.css` (generated) |
| Semantic color roles | `adonis-brand/design-system/tokens.json` `roles`, plus four site helpers (`ring-halo`, `overlay`, `shadow-tint`, `highlight-tint`) in `scripts/lib/brand-tokens.mjs` | `apps/web/src/styles/theme-roles.css` (generated)  |
| Design spec          | `adonis-brand/projects/skills/DESIGN.md`                                                                                                                             | `DESIGN.md` (generated)                            |
| Semantic (non-color) | `DESIGN.md` tokens, implemented here                                                                                                                                 | `apps/web/src/styles/shadcn-theme.css`             |
| Component            | this repo                                                                                                                                                            | `custom.css`, `components/**`, `app/**`            |

- Never edit generated files. Change `adonis-brand`, commit and push it, then run `pnpm brand:sync` (reads `$BRAND_REPO`, default `../adonis-brand`) and commit the snapshot in `apps/web/src/styles/brand/` with the regenerated CSS and `DESIGN.md`.
- `pnpm brand:check` (CI) fails when generated files no longer match the snapshot, when the snapshot came from uncommitted brand changes, or when a design-system text pair falls below its minimum (the pairs mirror `design-system/check.py`). `pnpm design:lint` (CI) runs `designmd lint` on `DESIGN.md`.
- Components must not contain hex, `rgb()`, `color-mix`, `/NN` opacity modifiers, or Tailwind palette colors (`emerald-*`, `slate-*`, `black`, `white`). Use a design-system role (`--primary`, `--accent`, `--selected`, `--border-strong`, `--danger-text`, …); if none fits, add the role to the design system in adonis-brand first. `pnpm design:check` (CI) enforces this; the only exceptions are the generated files and the shadow formulas in `shadcn-theme.css`.
- `apps/web/src/lib/og-card.tsx` cannot read CSS variables, so it resolves light-mode roles from `apps/web/src/styles/brand/design-system.json`, never from hex literals.

## Brand Assets

- Mark: Kiki in the cream plate (`public/brand/kiki-plate.svg`); favicon `app/icon.svg`; apple icon is the plate at 180 px.
- Illustrations: `public/brand/illustrations/*.webp`, transparent, copied from `adonis-brand/projects/skills/illustrations/`. Edit them in adonis-brand first; `adonis-brand/data/consumers.json` lists every copy.
- Public attribution is Nika. `Adonis0123` appears only in install commands and repository links.

## Fonts

- Fonts in `DESIGN.md` are self-hosted through fontsource; the build must not fetch Google Fonts.
- Bricolage Grotesque and Shantell Sans have no Chinese glyphs: every `font-family` that starts with them falls back to Noto Sans SC.

## Layout Spacing

- Drive vertical spacing through safe-area utilities and `--page-space-y-mobile`, `--page-space-y-desktop`, and `--page-space-y`.
- `safe-area-top` and `safe-area-bottom` must include both safe-area insets and base page spacing.
- Do not add per-page `py-*` spacing when safe-area utilities already provide the vertical rhythm.

## Components

- Reuse the primitives in `apps/web/src/components/ui/*` instead of ad hoc wrappers; keep radius, border, and shadow behavior token-driven.
- Every interactive element shows a visible focus indicator on `:focus-visible` only, drawn with `outline` (never box-shadow) so shadow utilities cannot hide it. Bordered controls turn their border `--ring` and add a flush 3px `--ring-halo` outline with no offset; borderless links and solid `--primary` fills use a solid 2px `--ring` outline with a 2px offset. Wrappers around inputs or stretched card links use `.clay-focus-within-ring`.
- Never add hard bottom lines such as `0 1px 0 ...` to raised, floating, or button shadows.

## Motion

- Keep motion restrained, use smooth cubic-bezier curves, and provide a reduced-motion fallback.
- Prefer `translate3d` over `translateY` when avoiding subpixel edge artifacts.
- Do not add decorative motion that changes layout flow or harms readability.
