# Web Copy English Migration (Skill-First)

## Background

The web app currently mixes Chinese and English copy and includes style-focused messaging that does not directly support the core user action. The primary product goal is to help users discover and install reusable skills.

## Goals

- Make all user-facing copy in `apps/web` English-only.
- Shift messaging to a skill-first narrative focused on discovery and installation.
- Standardize `skills/*/SKILL.md` frontmatter descriptions in English with a clear "Use when ..." pattern.
- Regenerate the web skills index so card/detail descriptions reflect updated frontmatter.

## Scope

- Update copy in:
  - `apps/web/src/app/*`
  - `apps/web/src/components/layout/*`
  - `apps/web/src/components/copy-install-command.tsx`
  - `apps/web/src/config/site-layout.ts`
- Update frontmatter `description` in six public skills under `skills/*`.
- Regenerate `apps/web/src/generated/skills-index.json`.
- Validate via skills validation, index generation, typecheck, and text scans.

Out of scope:

- Layout, visual style system, spacing, component architecture, or API/type contracts.
- Any deep rewrite of full skill body content beyond frontmatter `description`.

## Solution

1. Replace homepage hero/body/CTA copy with direct installation-focused messaging.
2. English-localize skill detail, 404 page, and global metadata/lang attributes.
3. English-localize navigation/footer/auxiliary aria/title/button-state copy.
4. Rewrite six skill frontmatter descriptions in concise professional English and include explicit "Use when ..." guidance.
5. Run:
   - `pnpm skills:validate`
   - `pnpm skills:index`
   - `pnpm -C apps/web typecheck`
   - `rg -n -P '[\\p{Han}]' apps/web/src`
   - `rg -n 'Soft 3D|Claymorphism' apps/web/src/app apps/web/src/components apps/web/src/config`

## Risks

- Chinese text may still appear from generated data if frontmatter changes are incomplete.
- Copy-only edits can still miss non-obvious accessibility strings (`aria-label`, `title`) if not scanned.
- Future skills may reintroduce non-English descriptions unless authoring standards are enforced.

## Acceptance Criteria

- Homepage and core pages are English-only and centered on "discover + install skills".
- 404, nav, footer, theme toggle, copy button, and accessibility labels are English.
- Skill card/detail descriptions in web app are English after regenerated index.
- `apps/web/src` has no Chinese characters.
- `Soft 3D`/`Claymorphism` marketing phrasing is removed from app/components/config copy surfaces.
- `pnpm -C apps/web typecheck` passes.
