# Plan: lingui-next-init Full Fixes (2026-02-19)

## Background

`lingui-next-init` was introduced in both `skills/` and `.agents/skills/`. During review, three follow-up issues were identified:

1. `pages-router/_reserved.tpl` existed in `skills/` but was missing in `.agents/skills/`.
2. `scaffold_lingui_next.py` could leave partially written output when template rendering failed.
3. `SKILL.md` did not explicitly instruct users to merge `next.swc-snippet.ts` into `next.config.ts`.

## Goals

1. Keep `skills/lingui-next-init` and `.agents/skills/lingui-next-init` structurally consistent.
2. Make scaffold failure behavior explicit and safer in non-dry-run mode.
3. Document the required SWC plugin integration step in the user workflow.

## Scope

In scope:

- Add missing reserved template in `.agents/skills/lingui-next-init`.
- Update `scripts/validate-skills.mjs` with a mirror consistency guard.
- Update both scaffold scripts to stop early on write-mode template errors.
- Update both `SKILL.md` files with SWC merge guidance.

Out of scope:

- Changes to external `npx skills add` behavior.
- Broader refactors outside `lingui-next-init` and validation guard.

## Solution

1. Add `.agents/skills/lingui-next-init/assets/templates/pages-router/_reserved.tpl` with content identical to `skills/` counterpart.
2. Extend `scripts/validate-skills.mjs`:
   - Add `.agents/skills` root constant.
   - Add async `exists(...)` helper.
   - Validate that when `skills/<slug>/assets/templates/pages-router/_reserved.tpl` exists and `.agents/skills/<slug>` exists, the mirrored `.agents` file must also exist.
3. Update both `scaffold_lingui_next.py` files:
   - Introduce `stop_on_error = not args.dry_run`.
   - For template merge/render exceptions, collect error and break loop in non-dry-run mode.
   - Keep dry-run behavior as full error collection.
4. Update both `SKILL.md` files:
   - Add explicit instruction to merge `web/next.swc-snippet.ts` into `web/next.config.ts`.
   - Require `experimental.swcPlugins` to include `["@lingui/swc-plugin", {}]`.

## Risks

1. New validation guard may fail existing branches if mirror files are missing.
2. Early-stop scaffold behavior reduces total error surfacing in non-dry-run mode, but this is intentional for safer writes.
3. Documentation updates require mirror sync discipline across `skills/` and `.agents/skills/`.

## Acceptance Criteria

1. `diff -rq skills/lingui-next-init .agents/skills/lingui-next-init` returns no differences.
2. `pnpm skills:quick-validate skills/lingui-next-init` passes.
3. `pnpm skills:validate` passes with new consistency guard active.
4. `pnpm skills:index` succeeds.
5. Both `SKILL.md` files explicitly document SWC snippet merge requirement.
