# Web UI Contract

Scope: `apps/web/src/**` only. Do not apply these constraints to scripts, skills, or non-web packages.

The Catalog Site presents as **Nika Skills**. **What it looks like** is defined in the root [`DESIGN.md`](../DESIGN.md) (colors, typography, layout, elevation, shapes, components, illustration, dark mode, do's and don'ts). That file is generated: its source is the private `adonis-brand` repo (`projects/skills/DESIGN.md`), and `pnpm brand:sync` injects the colors. This contract covers **how this repo implements it**.

Decisions: `docs/decision-2026-10-18-brand-palette-from-adonis-brand.md` (colors come from adonis-brand), `docs/decision-2026-10-18-skills-site-redesign.md` (v3 redesign). Since 2026-11-19 the site is drawn in a rubber-hose look (warm paper, hand-inked outlines, watercolour wash, hand lettering; adonis-brand `process/2026-11-19-skills-rubber-hose.md`, pending the owner's confirmation).

## Tokens

| Layer                | Source of truth                                                                                                                                                                                                                                                                                                                                                     | In this repo                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Brand                | `adonis-brand/design-system/tokens.json` (scales of the accent theme picked by `projects/skills/theme.json` `designSystem.accent`, currently `teal`)                                                                                                                                                                                                                | `apps/web/src/styles/brand-tokens.css` (generated) |
| Semantic color roles | `adonis-brand/design-system/tokens.json` `roles`, overridden or extended per mode by the project's registered exception in `projects/skills/theme.json` `designSystem.roles` (warm paper neutrals in light; `ink`, `wash`, `mustard`, `tomato`), plus four site helpers (`ring-halo`, `overlay`, `shadow-tint`, `highlight-tint`) in `scripts/lib/brand-tokens.mjs` | `apps/web/src/styles/theme-roles.css` (generated)  |
| Design spec          | `adonis-brand/projects/skills/DESIGN.md`                                                                                                                                                                                                                                                                                                                            | `DESIGN.md` (generated)                            |
| Semantic (non-color) | `DESIGN.md` tokens, implemented here                                                                                                                                                                                                                                                                                                                                | `apps/web/src/styles/shadcn-theme.css`             |
| Component            | this repo                                                                                                                                                                                                                                                                                                                                                           | `custom.css`, `components/**`, `app/**`            |

- Never edit generated files. Change `adonis-brand`, commit and push it, then run `pnpm brand:sync` (reads `$BRAND_REPO`, default `../adonis-brand`) and commit the snapshot in `apps/web/src/styles/brand/` with the regenerated CSS and `DESIGN.md`.
- `pnpm brand:check` (CI) fails when generated files no longer match the snapshot, when the snapshot came from uncommitted brand changes, or when a design-system text pair falls below its minimum (the pairs mirror `design-system/check.py`; `PROJECT_CONTRAST_PAIRS` adds `ink` and `mustard` pairs, which `check.py` cannot see because it does not read project roles). `pnpm design:lint` (CI) runs `designmd lint` on `DESIGN.md`.
- Components must not contain hex, `rgb()`, `color-mix`, `/NN` opacity modifiers, or Tailwind palette colors (`emerald-*`, `slate-*`, `black`, `white`). Use a design-system role (`--primary`, `--accent`, `--selected`, `--border-strong`, `--danger-text`, …); if none fits, add the role to the design system in adonis-brand first. `pnpm design:check` (CI) enforces this; the only exceptions are the generated files and the shadow-ink formulas in `shadcn-theme.css` (shadows and `--primary-hover-veil`).
- `apps/web/src/lib/og-card.tsx` cannot read CSS variables, so it resolves light-mode roles from `apps/web/src/styles/brand/design-system.json`, never from hex literals.

## Brand Assets

- Mark: Kiki in the cream plate (`public/brand/kiki-plate.svg`); favicon `app/icon.svg`; apple icon is the plate at 180 px.
- Illustrations: `public/brand/illustrations/*.webp`, transparent, copied from `adonis-brand/projects/skills/illustrations/`. Edit them in adonis-brand first; `adonis-brand/data/consumers.json` lists every copy.
- Public attribution is Nika. `Adonis0123` appears only in install commands and repository links.

## Fonts

- Fonts in `DESIGN.md` are self-hosted through fontsource (exact versions); the build must not fetch Google Fonts.
- Kalam (`--font-app-hand`, also `--font-app-heading` and `--font-app-display`) letters Latin headings, nav, buttons, chips, card titles and the wordmark in Bold 700, with word spacing tightened (Kalam's default gaps slow scanning). It has no Chinese glyphs: every `font-family` that starts with it falls back to Noto Sans SC, so Chinese keeps its weights and line-heights. Ledes, card descriptions, document body and anything under 14px (the outline copy button) stay in the body face; slugs and commands stay IBM Plex Mono. Self-hosted through `@fontsource/kalam` (exact version, Latin subset).
- Body copy and descriptions stay in Noto Sans SC; slugs and commands stay IBM Plex Mono. Hand lettering takes no negative tracking.
- Chinese display titles (`.type-display`, `.type-h2`, `.type-h3`) use `--font-app-title`, which puts Ma Shan Zheng (brush, one weight 400, `@fontsource/ma-shan-zheng`, sliced by unicode-range) between Kalam and Noto Sans SC; their `:lang(zh)` rules set weight 400 and a larger size. Chinese card titles, buttons, nav and chips stay Noto Sans SC.
- Kalam's x-height (about 0.52 em) is close to Noto Sans SC's 0.55, so hand lettering needs no `font-size-adjust`.
- The OG card (`lib/og-card.tsx`) uses Kalam Bold and `textWrap: balance`; its colours come from light-mode roles through `lib/og-palette.ts`.

## Layout Spacing

- Drive vertical spacing through safe-area utilities and `--page-space-y-mobile`, `--page-space-y-desktop`, and `--page-space-y`.
- `safe-area-top` and `safe-area-bottom` must include both safe-area insets and base page spacing.
- Do not add per-page `py-*` spacing when safe-area utilities already provide the vertical rhythm.

## Components

- Reuse the primitives in `apps/web/src/components/ui/*` instead of ad hoc wrappers; keep radius, border, and shadow behavior token-driven.
- Outlines: every card, button, input, chip, command box, tab, menu, panel and section divider is a `--ink-width` (2.5px) `--ink` line; tags and badges use `--ink-width-thin`. Corners use the hand-drawn radii `--hand-radius-{xs,sm,md,lg,xl,plate,pill}` (slightly uneven elliptical radii) from `shadcn-theme.css`. For panels built from utilities use `.ink-box` (+ `--sm`, `--md`, `--xl`, `--pill`, `--dashed`), `.ink-raised` for the wash, `.ink-rule-t` / `.ink-rule-b` for dividers; drop `border`, `border-border` and `rounded-*` utilities on the same element, since utilities override them. Plain `--border` stays for secondary lines (table rows, inner separators).
- Wavering ink: `.art-plate`, `.search-bar`, `.skill-card`, `.featured-card`, `.speech-bubble`, `.scenario-chip`, `.clay-button`, `.command-box`, `.copy-button` and `.ink-box` draw their outline, and a copy of their fill under it, with `::before` pushed through an SVG displacement filter (`#ink-wobble`, `#ink-wobble-sm`, rendered once by `components/ui/ink-filters.tsx` in the root layout). The element's own border is transparent and keeps its width, so text and children are never filtered. Change the line colour with `--ink-line` (for example `hover:[--ink-line:var(--primary)]`), never with `border-color` or a `border-*` utility: a visible border would sit straight on top of the drawn line. `--ink-pen` sets uneven side widths. An `.ink-box` with an `overflow-*` utility, or on `input`, `select`, `textarea`, `table` or `img`, keeps a plain straight border, because its `::before` would be clipped or cannot exist. `.ink-rule-t` / `.ink-rule-b` dividers are one wavy stroke: `--ink` shown through `--ink-rule-mask`.
- Depth: raised things use the `--clay-shadow-*` variables, which are blurred, downward offsets of the solid `--wash` role (dusty blue in light, `transparent` in dark): a visible band under buttons, chips, the search bar, the hero plate, featured cards and panels (`--clay-shadow-feature`), a narrow one under resting catalog cards. Never a zero-blur offset shadow.
- Large elements (hero plate, featured cards, search bar, `.ink-box--xl` panels) set `--ink-pen: var(--ink-width-hand)` (heavier bottom stroke) and the visibly uneven `--hand-radius-xl` / `-plate` / `-search`; catalog cards and small controls keep the quiet radii. Tags carry no outline: flat `--mustard` or `--dusty` fills.
- Paper: the light page and the sticky header carry `--paper-texture` (CSS-only noise tiles in `custom.css`); dark mode sets it to `none`. No film grain, dust, flicker or vignette.
- Small marks: `<InkTicks>` (inline SVG, `--ink` stroke) beside the hero's primary button and after section titles; no sound-effect words.
- Every interactive element shows a visible focus indicator on `:focus-visible` only, drawn with `outline` (never box-shadow) so shadow utilities cannot hide it. Ink-outlined controls (clay buttons, chips, cards, `.ink-box`, the search bar) keep their `--ink` border and add a solid 2px `--ring` outline with a 2px offset: recolouring the ink border would not show (`--ring` on `--ink` is 2.7:1 light, 1.1:1 dark). Borderless links and solid `--primary` fills use the same 2px `--ring` outline with a 2px offset. Wrappers around inputs or stretched card links use `.clay-focus-within-ring` / `.clay-focus-link-ring`.
- Latin button labels are Kalam Bold; Chinese labels keep weight 500. Solid `--primary` buttons are hand-drawn pills with white text and an `--ink` outline; on hover they lay `--primary-hover-veil` over the fill (the design system has no hover color), so hover is visible in both modes. Pressing squashes the button slightly about its bottom; reduced motion drops the squash.
- Hover turns the outline of cards, chips, secondary and outline buttons, copy buttons and filter chips `--primary` (teal) on top of the lift, wash or fill change. The primary button keeps its ink and deepens its fill. A selected plugin card turns its outline `--link`.
- Dark mode keeps one family of surfaces (neutral steps): `.dark` rules in `custom.css` move plates, the footer and `tint` panels onto `--card` / `--background`; the light cream `--ink` outlines keep the drawing visible.
- Never add hard bottom lines such as `0 1px 0 ...` to raised, floating, or button shadows.

## Motion

- Keep motion restrained, use smooth cubic-bezier curves, and provide a reduced-motion fallback.
- Prefer `translate3d` over `translateY` when avoiding subpixel edge artifacts.
- Do not add decorative motion that changes layout flow or harms readability.

## Hover and copy effects

Adapted from coco-skills (2026-11-19) and drawn in ink. Shared layer: `styles/effects-hover.css`, `components/motion/{hover-fx.tsx,pointer-effects.tsx,use-copy-target.ts,beam-lap.ts}`; one `<PointerEffects />` in the root layout tracks the pointer and keyboard focus for the whole site.

- Beam: on hover or keyboard focus, an ink-outlined element with `fx-surface` and a `<HoverFx />` first child runs a `--primary` → `--mustard` beam around its outline (2.2s a lap). The beam goes through the same `--ink-filter` as the outline, so it follows the wavering line. A dot grid shows near the pointer (`dots={false}` turns it off).
- An element that lifts on hover sits inside a still `fx-host` that owns the hover, so the pointer never leaves and re-enters at the edge.
- Lists (`components/motion/row-highlight.tsx`): one `--selected` highlight slides between fixed-height rows; hover swaps a row's meta for its install command in the same grid cell, so row height never changes.
- Command boxes copy on a click anywhere (`fx-copy` + `useCopyTarget`), except when text is selected, on a double or triple click, or on tabs and other controls. Success runs one `--mustard` lap (`playBeamLap`).
- Plugin ticks fly to the install box along an arc (`components/motion/fly-to.ts`).
- Page entrances are CSS (`SectionReveal`, `.detail-enter`) so server-rendered content never waits for hydration.
- Reduced motion: the beam stops, dots do not follow, the highlight jumps, the copy lap fades once, nothing flies and entrances are off.
