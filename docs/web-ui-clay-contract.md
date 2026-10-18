# Web UI Clay Contract

Scope: `apps/web/src/**` only. Do not apply these constraints to scripts, skills, or non-web packages.

The Catalog Site presents as **Nika Skills** and follows the Nika brand (private `adonis-brand` repo). Decisions behind this contract: `docs/plan-2026-10-18-nika-skills-upgrade.md` (D3, D6, D7, D9, D11, D12).

## Visual Direction

- Restrained soft claymorphism on warm cream paper, applied **by size**:
  - Illustrations (64 px and up), cards, and panels may use soft clay depth.
  - Logos, favicon, nav icons, and badges stay **flat**: solid fills with the brand ink outline, no gradients, no shadows.
- No pure black (`#000`) or pure white (`#fff`) surfaces or text. Light pages sit on cream; dark pages sit on deep ink.
- Prefer subtle depth and material layering over glossy, high-contrast effects.

## Tokens

Colors are owned by the private brand repo `adonis-brand`, not by this repo. Decision: `docs/decision-2026-10-18-brand-palette-from-adonis-brand.md`.

| Layer                | Source of truth                           | In this repo                                       | Contains                                                                                                                                                                                   |
| -------------------- | ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brand                | `adonis-brand/data/palette.json`          | `apps/web/src/styles/brand-tokens.css` (generated) | One `--brand-<id>` per palette color, commented with its name and group. Sources and rationale stay in the private brand repo; `brand/source.json` holds the brand commit to look them up. |
| Semantic             | `adonis-brand/projects/skills/theme.json` | `apps/web/src/styles/theme-roles.css` (generated)  | Color roles (`--background`, `--primary`, `--primary-hover`, `--link`, `--accent`, `--ring`, …) for light and `.dark`, each commented with the palette id it uses.                         |
| Semantic (non-color) | this repo                                 | `apps/web/src/styles/shadcn-theme.css`             | Radius, shadows, fonts, Tailwind `@theme` mapping.                                                                                                                                         |
| Component            | this repo                                 | `custom.css`, `components/**`, `app/**`            | Semantic tokens and Tailwind theme colors only.                                                                                                                                            |

- Never edit the two generated CSS files. Change `adonis-brand`, commit it, then run `pnpm brand:sync` (reads `$BRAND_REPO`, default `../adonis-brand`) and commit the snapshot in `apps/web/src/styles/brand/` with the regenerated CSS. `source.json` records the brand commit.
- `pnpm brand:check` (CI) fails when the CSS no longer matches the snapshot, when the snapshot came from uncommitted brand changes, or when any text pair listed in `theme.json` falls below 4.5:1.
- Components must not contain hex, `rgb()`, or Tailwind palette colors (`emerald-*`, `slate-*`, `black`, `white`). Add a semantic role in `theme.json` instead.
- `apps/web/src/lib/og-card.tsx` cannot read CSS variables, so it reads colors by id from the brand palette snapshot (`apps/web/src/styles/brand/palette.json`), never from hex literals.
- Crew colors (blue `#3F8FC4`, amber `#F2B35E`) belong to the jelly characters in the logo and illustrations; they are not UI accents.

Color system (2026-10-18; accent revised the same day from forest `forest-*` to leaf `leaf-*`): two 12-step scales, Radix step semantics (1–2 backgrounds, 3–5 component fills, 6–8 borders, 9–10 solids, 11–12 text). Full rules: `adonis-brand/projects/skills/DESIGN.md`.

| Role                                  | Light                                 | Dark                                            |
| ------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| `--background` / `--card`             | warm paper `n-2` / `n-1`              | warm char `n-dark-1` / `n-dark-2`               |
| `--muted`                             | `n-3`                                 | `n-dark-3`                                      |
| `--border` / `--input`                | `n-6` / `n-7`                         | `n-dark-6` / `n-dark-7`                         |
| `--foreground` / `--muted-foreground` | `n-12` / `n-11`                       | `n-dark-12` / `n-dark-11`                       |
| `--primary` / `--primary-hover`       | `leaf-9` / `leaf-10`, ink `n-12` text | `leaf-dark-9` / `leaf-dark-10`, `n-dark-1` text |
| `--accent` (tags)                     | `leaf-3`, `leaf-12` text              | `leaf-dark-3`, `leaf-dark-11` text              |
| `--link`                              | `leaf-11`                             | `leaf-dark-11`                                  |
| `--ring` / `--ring-halo`              | `leaf-11` / `leaf-6`                  | `leaf-dark-9` / `leaf-dark-6`                   |
| `--overlay`                           | `n-12` at 30%                         | warm shadow at 60%                              |

- Primary text is ink, not white: white on `leaf-9` is only ~2.5:1. The light focus ring uses `leaf-11` because `leaf-9` on cream is only 2.0:1, below the 3:1 non-text minimum.
- No `color-mix`, hex, or `/NN` opacity modifiers outside the generated files and the shadow formulas in `shadcn-theme.css`; `pnpm design:check` (CI) enforces it. Hierarchy comes from picking another step, not from opacity.

## Surfaces and Shadows

- Use `--shadow-clay-raised`, `--shadow-clay-inset`, and `--shadow-clay-floating` (or the `clay-elevation-*` classes).
- Shadows are soft and tinted with `--shadow-tint` (brand ink in light mode, near-black navy in dark mode).
- Never add hard bottom lines such as `0 1px 0 ...` or `0 6px 0 ...` to raised, floating, or button shadows.
- `--clay-highlight-top` is a soft inner glow for surfaces (cards, panels) only; never put it on buttons, where it reads as a second border.
- Keep `clay-surface` edges stable during hover and transform transitions; avoid visible seams.

## Brand Marks

- Mark: Kiki in the cream plate (`public/brand/kiki-plate.svg`), from `adonis-brand/projects/local-tools/icons/skills.svg`. Favicon: the 16 pt variant (`app/icon.svg`); apple icon: the plate at 180 px.
- Wordmark: lowercase "nika skills" in Shantell Sans 800 (`font-display`), "skills" in `--link`.
- Public attribution is Nika. `Adonis0123` appears only in install commands and repository links.
- Edit brand marks in `adonis-brand` first, then copy the result here.

## Typography

- Body and headings: Noto Sans SC; headings at weight 900.
- Wordmark only: Shantell Sans 800 (Latin only; never for Chinese text).
- Code: IBM Plex Mono.
- All fonts are self-hosted through fontsource; the build must not fetch Google Fonts.

## Layout Spacing

- Drive vertical spacing through safe-area utilities and `--page-space-y-mobile`, `--page-space-y-desktop`, and `--page-space-y`.
- `safe-area-top` and `safe-area-bottom` must include both safe-area insets and base page spacing.
- Do not add per-page `py-*` spacing when safe-area utilities already provide the vertical rhythm.

## Components

- Reuse `ClaySurface`, `ClayCard`, `ClayButton`, and `ClayBadge` from `apps/web/src/components/ui/*` instead of ad hoc wrappers.
- Keep radius, border, and shadow behavior token-driven.
- Every interactive element shows a visible focus indicator on `:focus-visible` only, drawn with `outline` (never box-shadow) so shadow utilities cannot hide it. Bordered controls (`.clay-button`, `.clay-surface`, `.border` chips) turn their border `--ring` and add a flush 3px `--ring-halo` outline with no offset; borderless links and solid `--primary` fills use a solid 2px `--ring` outline with a 2px offset. Wrappers around inputs or stretched card links use `.clay-focus-within-ring`.

## Motion

- Keep motion restrained, use smooth cubic-bezier curves, and provide a reduced-motion fallback.
- Prefer `translate3d` over `translateY` when avoiding subpixel edge artifacts.
- Do not add decorative motion that changes layout flow or harms readability.
