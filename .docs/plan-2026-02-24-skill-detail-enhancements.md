# Skill Detail Page Enhancements

**Date:** 2026-02-24

## Background

The skill detail page (`apps/web/src/app/[lang]/skills/[slug]/page.tsx`) showed minimal information: name, description, version/author badges, install command, and yes/no flags for `hasReferences`/`hasSrc`. The `skills-index.json` only included frontmatter fields, leaving the rich SKILL.md body (usage scenarios, workflow, examples) unreachable.

## Goals

1. Surface **last update time** (`updatedAt`) so users can judge maintenance status.
2. Include **richer content** by indexing parsed SKILL.md body sections.
3. Expose **`allowed-tools`** frontmatter as tool badges.
4. Improve **package structure UX** — replace yes/no text with a complexity indicator.
5. Better SEO via body excerpt in `generateMetadata`.

## Scope

| File | Change |
|------|--------|
| `scripts/generate-skills-index.mjs` | Add `updatedAt`, `allowedTools`, `sections` |
| `apps/web/src/lib/skills.ts` | Add `SkillSection` type + new fields to `SkillIndexItem` |
| `apps/web/src/lib/skill-markdown.tsx` | NEW — section content renderer |
| `apps/web/src/app/[lang]/skills/[slug]/page.tsx` | Redesigned detail layout |
| `apps/web/src/generated/skills-index.json` | Regenerated (do not edit manually) |

## Solution

### Data layer (`generate-skills-index.mjs`)

- `updatedAt`: `git log -1 --format="%ci"` on each skill directory → ISO string
- `allowedTools`: split `frontmatter['allowed-tools']` by `,` → `string[]`
- `sections`: line-by-line parser splits SKILL.md body on `#{1,3}` headings into `{ heading?, level?, raw }` array

### Type layer (`lib/skills.ts`)

Added `SkillSection` interface and three optional fields (`updatedAt`, `allowedTools`, `sections`) to `SkillIndexItem`.

### Render layer (`lib/skill-markdown.tsx`)

Lightweight inline parser (`parseBlocks`) handles: paragraphs, fenced code blocks, bullet lists, headings, and pipe tables. Returns styled React nodes using existing clay design tokens.

### UI layer (`skills/[slug]/page.tsx`)

- **Header**: `allowedTools` badges (blue tone, max 4 visible + overflow count)
- **updatedAt row**: calendar icon + locale-formatted date using `Intl.DateTimeFormat`
- **Info grid (3 cols on md)**: Complexity | Tools Used | Source
  - Complexity: `hasReferences && hasSrc` → "Full Toolkit", `hasSrc` → "Standard", else "Basic"
- **Documentation section**: renders all parsed sections with heading + content

## Risks

- `git log` call in index generation script adds a subprocess per skill — acceptable at current scale (~10 skills); will slow down if hundreds of skills are added.
- Markdown rendering is intentionally minimal; complex nested structures (nested lists, inline formatting) are not fully supported.

## Acceptance Criteria

- [ ] `pnpm skills:index` completes without error; output JSON includes `updatedAt`, `allowedTools` (where present), `sections` for all skills.
- [ ] `pnpm typecheck` passes with no new errors.
- [ ] Skill detail page renders: updatedAt date, tool badges, complexity badge, documentation sections.
- [ ] `pnpm build` passes end-to-end.
