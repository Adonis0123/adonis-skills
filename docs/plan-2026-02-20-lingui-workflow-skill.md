# Plan: lingui-workflow skill

## Background

`skills/lingui-next-init` currently mixes two responsibilities:
1. Initialization/scaffolding for Lingui in Next.js App Router.
2. Day-to-day command guidance (`extract/translate/compile/manifest`) and troubleshooting.

This coupling makes daily usage guidance harder to discover and maintain.  
The repository needs a dedicated public skill for operational Lingui workflows.

## Goals

1. Create a standalone public skill `skills/lingui-workflow` focused on daily Lingui usage.
2. Keep `skills/lingui-next-init` scoped to setup and architecture.
3. Preserve existing script behavior; only change documentation and skill packaging.
4. Ensure the new skill is validated and included in generated skills index.

## Scope

In scope:
1. Add `skills/lingui-workflow/SKILL.md`.
2. Add `skills/lingui-workflow/references/i18n-commands.md`.
3. Add `skills/lingui-workflow/references/workflow-daily.md`.
4. Remove day-to-day guidance from `skills/lingui-next-init/SKILL.md`.
5. Remove day-to-day handbook sections from `skills/lingui-next-init/references/workflow-app-router.md`.
6. Delete duplicated `skills/lingui-next-init/references/i18n-commands.md`.
7. Run finalize pipeline to validate and refresh index.

Out of scope:
1. Any code change under `apps/web/scripts/i18n/*`.
2. Adding automation scripts in the new skill.
3. Local install/sync operations (`skills:install:local`, `skills:test:local`).

## Solution

1. Scaffold new skill directory:
   `pnpm skills:init lingui-workflow --path skills --resources references`
2. Replace scaffold template content with production-ready content:
   - `SKILL.md`: overview, quick start, command matrix, misconceptions, checklist, references.
   - `references/i18n-commands.md`: Chinese command semantics and pitfalls.
   - `references/workflow-daily.md`: scenario-based daily workflow and release checks.
3. Enforce boundaries:
   - Add explicit pointer in `lingui-next-init` to `skills/lingui-workflow` for daily usage.
   - Remove migrated daily content from `lingui-next-init` references.
4. Remove duplicated old daily reference file from `lingui-next-init`.
5. Finalize:
   `pnpm skills:finalize -- skills/lingui-workflow`

## Risks

1. Overlap confusion between old and new skills if migration is partial.
2. Validation/index failure caused by unrelated existing workspace changes.
3. Drift risk if daily command semantics change in runtime scripts but docs are not updated.

Mitigations:
1. Keep explicit role boundary statements in both skills.
2. Use finalize pipeline for structural and index verification.
3. Include implementation file pointers in references for quick re-validation.

## Acceptance Criteria

1. `skills/lingui-workflow/SKILL.md` has valid frontmatter:
   - `name` is `lingui-workflow`.
   - `description` is English ASCII and non-empty.
2. New references exist and are readable:
   - `skills/lingui-workflow/references/i18n-commands.md`
   - `skills/lingui-workflow/references/workflow-daily.md`
3. `skills/lingui-next-init` no longer contains the migrated daily handbook content.
4. Duplicate file is removed:
   - `skills/lingui-next-init/references/i18n-commands.md`
5. `pnpm skills:finalize -- skills/lingui-workflow` succeeds.
6. Generated skills index includes `lingui-workflow`.
