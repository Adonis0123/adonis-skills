# Plan: Staged Review Follow-up Fixes

## Background

- `SkillCard` currently hardcodes the repository string in install command text.
- `ThemeToggle` reads localStorage in state initializer, which can produce SSR/client first-render mismatch.
- Skill detail page uses `ClayCardTitle` (`h3`) for the page-level primary heading.
- Example skill links are duplicated as string literals across page-level components.

## Goals

- Ensure install command text uses a single repository source of truth.
- Prevent hydration mismatch risk in `ThemeToggle`.
- Restore correct heading semantics on skill detail page.
- Centralize example skill path in one exported config constant.

## Scope

- `apps/web/src/components/skill-card.tsx`
- `apps/web/src/components/layout/theme-toggle.tsx`
- `apps/web/src/app/skills/[slug]/page.tsx`
- `apps/web/src/config/site-layout.ts`
- `apps/web/src/app/not-found.tsx`
- `apps/web/src/app/page.tsx`

## Solution

1. Replace hardcoded repo text in `SkillCard` with `skillsRepo`.
2. Refactor `ThemeToggle` to a mounted-guard flow:
   - initialize with `light`
   - read localStorage in client effect
   - apply and persist theme only after mounted.
3. Use a direct `<h1>` in skill detail page for the main title.
4. Export `exampleSkillHref` from `site-layout.ts` and consume it in `site-layout`, home page, and not-found page.

## Risks

- Mounted guard introduces a short placeholder for the toggle before hydration.
- Shared constant import paths can be accidentally bypassed in future new pages.

## Mitigations

- Keep placeholder dimensions close to the final toggle size to avoid visible layout shift.
- Use `exampleSkillHref` in all current "示例 Skill" links to establish the pattern.

## Acceptance Criteria

- No hardcoded repo string remains in `SkillCard` install command.
- `ThemeToggle` no longer performs localStorage read in state initializer.
- Skill detail page renders the primary title with `<h1>`.
- Example skill href is centralized and reused.
- `pnpm --filter @adonis-skills/web lint`, `typecheck`, and `build` all pass.
