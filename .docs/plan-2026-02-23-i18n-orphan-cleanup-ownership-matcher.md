# Plan: i18n orphan cleanup safety and ownership matcher expansion

## Background
The current i18n extraction flow removes orphaned catalogs by recursively deleting the whole entry directory. This can accidentally remove valid child entry catalogs when parent and child entries coexist. In addition, ownership detection currently only recognizes `.ts/.tsx` source references, which is too narrow for future extractor coverage.

## Goals
- Prevent recursive orphan cleanup from deleting valid nested catalogs.
- Expand ownership matching to a controlled multi-extension whitelist.
- Keep runtime manifest filtering behavior consistent with extract cleanup behavior.
- Sync the same logic into the `lingui-next-init` templates and maintenance docs.

## Scope
### In scope
- `apps/web/scripts/i18n/index.ts`
- `apps/web/scripts/i18n/manifest.ts`
- `skills/lingui-next-init/assets/templates/app-router/web/scripts/i18n/index.ts.tpl`
- `skills/lingui-next-init/assets/templates/app-router/web/scripts/i18n/manifest.ts.tpl`
- `skills/lingui-workflow/references/i18n-commands.md`
- `skills/lingui-workflow/references/maintenance-playbook.md`

### Out of scope
- Changes to CLI interface shape.
- Changes to locale lists or source locale defaults.
- Refactoring unrelated i18n command internals.

## Solution
1. Replace recursive orphan directory deletion with file-level cleanup:
- Remove only direct `.po/.mjs` files under orphan entries.
- Prune directories only when empty, from leaf to parent, bounded inside `src/locales`.
- Keep `I18N_DRY_RUN=1` as preview mode with explicit file/directory logs.

2. Expand ownership matching suffixes:
- `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`, `.md`, `.mdx`.
- Continue using normalized `#:` source references with line/column suffix stripping.

3. Align manifest candidate counting with scanned catalog entries:
- Candidate entries are discovered from both `.po` and `.mjs` files.
- Manifest map still emits only supported locales with `.mjs` outputs.
- Ownership filtering remains mandatory before entry inclusion.

4. Template parity:
- Mirror all runtime script changes into `lingui-next-init` template scripts.

5. Documentation updates:
- Describe file-level orphan cleanup and empty-directory pruning.
- Document ownership whitelist extensions.
- Update dry-run behavior wording to file/directory-level preview.

## Risks
- Incorrect file matching could remove too many or too few files.
- Dry-run prediction could drift from actual cleanup behavior.
- Template/runtime drift if future edits are made in only one location.

## Acceptance Criteria
- `pnpm -C /Users/adonis/coding/adonis-skills/apps/web typecheck` passes.
- `pnpm -C /Users/adonis/coding/adonis-skills/apps/web i18n:extract` runs successfully.
- `I18N_DRY_RUN=1 pnpm -C /Users/adonis/coding/adonis-skills/apps/web i18n:extract` prints file/dir cleanup preview without mutating files.
- No recursive directory deletion API is used for orphan cleanup.
- Manifest/cleanup ownership logic both use the same extension whitelist.
- Template scripts match runtime behavior for the same features.
