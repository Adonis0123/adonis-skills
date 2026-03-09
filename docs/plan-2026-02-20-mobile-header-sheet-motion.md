# Mobile Header Sheet + Hero Mobile Refinement

## Background
- The current mobile header places GitHub, locale switcher, and theme toggle in a single crowded row.
- Tap targets are dense and reduce usability on narrow viewports.
- The home hero section is visually strong on desktop but feels tight on mobile.

## Goals
- Improve mobile header ergonomics with a clear, touch-friendly navigation pattern.
- Keep desktop layout and interaction unchanged.
- Preserve the existing claymorphism visual language.
- Add restrained, purposeful motion while honoring reduced-motion settings.

## Scope
- Add a shadcn-style `Sheet` primitive based on Radix Dialog.
- Implement a mobile-only sheet menu in the site header.
- Refine mobile hero spacing, typography, and CTA layout.
- Add i18n keys for mobile menu actions.
- Add `@radix-ui/react-dialog` dependency.

## Solution
- Create `src/components/ui/sheet.tsx` and export sheet primitives from `src/components/ui/index.ts`.
- Create `src/components/layout/mobile-header-menu.tsx` as a client component:
  - Right-side sheet with large vertical action targets.
  - Actions include GitHub link, locale switcher, and theme toggle.
  - Motion overlays and panel slide-in with subtle timings.
  - Staggered action list animation.
  - Reduced-motion fallback through `usePrefersReducedMotion`.
- Update `src/components/layout/site-header.tsx`:
  - Mobile: brand + menu trigger.
  - Desktop: existing nav actions remain.
- Update `src/app/[lang]/page.tsx`:
  - Mobile-first single-column rhythm in hero.
  - Full-width CTA buttons on mobile, row layout on `sm+`.
  - Better long-text handling for repo badge.
- Update `src/styles/custom.css` with mobile sheet utility classes and clay-consistent surface styling.
- Add `siteHeader.menu.open`, `siteHeader.menu.close`, `siteHeader.menu.aria` to locale catalogs.

## Risks
- Animating Radix sheet layers can cause subtle timing mismatches between visual exit and interaction state.
- Existing local in-progress changes in the same files may increase merge complexity.
- Mobile-specific utility classes must avoid affecting desktop behavior.

## Acceptance Criteria
- Mobile header interaction is no longer crowded and supports easy one-handed tapping.
- Menu opens/closes correctly via trigger, overlay click, and keyboard escape.
- Motion feels smooth and restrained; reduced-motion users get minimal transitions.
- Home hero mobile layout reads clearly without horizontal overflow.
- Desktop header behavior and appearance remain unchanged.
- New i18n keys resolve correctly in both English and Chinese catalogs.
