# Review Fixes + Motion Migration Plan

## Background

- `SiteShell` currently wraps page-level `<main>` elements with another `<main>`, producing invalid nested main landmarks.
- Theme selection is applied in a client effect, so SSR always starts from light and can flash for dark-theme users.
- `ClayButton` supports `asChild` but does not forward `ref` in that branch.
- Typography tokens are partly centralized, but mono usage still reads `--font-ibm-plex-mono` directly.
- `react-motion@0.5.2` is old and declares React peer ranges that do not include React 19.

## Goals

- Remove invalid semantic nesting while preserving page-level landmark semantics.
- Eliminate theme FOUC by setting the initial theme before hydration.
- Make `ClayButton asChild` behavior ref-compatible.
- Normalize mono font usage through app-level design tokens.
- Fully replace `react-motion` with `motion/react` and remove legacy type shims.

## Scope

- In scope:
  - `apps/web/src/components/layout/site-shell.tsx`
  - `apps/web/src/app/layout.tsx`
  - `apps/web/src/components/ui/clay-button.tsx`
  - `apps/web/src/styles/shadcn-theme.css`
  - `apps/web/src/styles/custom.css`
  - `apps/web/src/components/motion/section-reveal.tsx`
  - `apps/web/src/components/motion/skills-grid-motion.tsx`
  - `apps/web/package.json`
  - root `package.json`
  - remove `apps/web/src/types/react-motion.d.ts`
- Out of scope:
  - Redesigning page content or changing route structure.
  - Introducing additional animation dependencies beyond `motion`.

## Solution

1. Change `SiteShell` content wrapper from `<main id="site-content">` to `<div id="site-content">`.
2. Add an inline theme-init script in root layout `<head>`:
   - read `localStorage['adonis-skills-theme']`
   - fallback to system preference
   - set `documentElement.dataset.theme`, `dark/light` classes, and `colorScheme`.
3. Add `suppressHydrationWarning` on `<html>` because class/data attributes may differ between SSR and pre-hydration script output.
4. Forward `ref` inside `ClayButton` `asChild` clone branch.
5. Add `--font-app-mono` + `--font-mono` tokens and switch `code/pre` to `--font-app-mono`.
6. Replace `react-motion` usage:
   - `SectionReveal`: `motion.div` with spring transition + delay (ms -> s).
   - `SkillsGridMotion`: container/child variants with `staggerChildren`.
   - keep reduced-motion early return behavior.
7. Remove `react-motion` deps and type declaration file, add `motion` dependency, regenerate lockfile.

## Risks

- Spring feel between libraries may differ slightly.
- `cloneElement` ref typing can be stricter in TypeScript.
- Theme script must stay consistent with `ThemeToggle` storage key and class naming.

## Mitigations

- Keep spring stiffness/damping close to current values.
- Use minimal type narrowing for ref forwarding to avoid broad API changes.
- Reuse existing storage key (`adonis-skills-theme`) and class conventions (`dark` / `light`).

## Acceptance Criteria

- No nested `<main>` structure in rendered layout hierarchy.
- Dark users do not see initial light flash on hard refresh.
- `ClayButton asChild` path forwards `ref` without type errors.
- Mono font is referenced through app tokens.
- `react-motion` no longer appears in app code, dependencies, or lockfile.
- `pnpm --filter @adonis-skills/web lint`, `typecheck`, and `build` pass.
