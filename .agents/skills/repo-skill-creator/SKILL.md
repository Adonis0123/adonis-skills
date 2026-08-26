---
name: repo-skill-creator
description: Create and maintain repository skills for adonis-skills. Use when users ask to scaffold a new skill under skills/, generate agents/openai.yaml, run skill validation, refresh web index data, or standardize the skill authoring workflow.
---

# Repo Skill Creator

Create and maintain repository skills with intent-specific workflows. Validation is read-only with respect to Git state; creation, finalization, staging, and runtime installation are separate actions.

## Trigger Rules

1. Classify the request as `create`, `finalize-path`, `validate`, or `finalize-and-stage` before running a command.
2. If the user provides a `skills/*` path and indicates the skill is already generated/copied, run path-finalize mode directly without additional confirmation.
3. A request to check, audit, or validate existing skills runs validation only. It must not create a skill or modify the Git index.
4. Run auto-discover finalize-and-stage only when the user explicitly asks to prepare newly added skills for commit or to stage them.
5. A bare invocation with no path or action defaults to validation. If exactly one new `skills/<slug>/SKILL.md` is discoverable, report it as the likely finalize target, but do not stage or create anything implicitly.

## Mode A: Create New Skill

Primary command (recommended):

```bash
pnpm skills:new
```

Manual creation commands:

```bash
pnpm skills:init <skill-name> --path skills --resources scripts,references
pnpm skills:finalize -- skills/<skill-name>
```

## Mode B: Finalize Existing Skill by Path

When the user pastes a path under `skills/*`, run:

```bash
pnpm skills:finalize -- <skill-path>
```

Examples:

```bash
pnpm skills:finalize -- skills/code-inspector-init
pnpm skills:finalize -- /Users/adonis/coding/adonis-skills2/skills/code-inspector-init/
```

Finalize pipeline is fixed and must run in order:

1. `pnpm skills:quick-validate skills/<skill-slug>`
2. `pnpm skills:validate`
3. `pnpm skills:index`

This mode does not stage files.

## Mode C: Validate Existing Skills

Use for “check”, “audit”, “validate”, or a bare invocation without a requested creation/finalize action:

```bash
pnpm skills:validate
```

When source changes already exist and generated index freshness is part of the check, also run:

```bash
pnpm skills:index
git diff --check
```

Do not call `skills:new`, `skills:finalize:new`, or `git add` in this mode.

## Mode D: Auto Discover + Finalize + Stage

Run only when the user explicitly asks to finalize and stage newly added skills:

```bash
pnpm skills:finalize:new
```

Behavior contract:

1. Discover newly added skill candidates from `git status --short --untracked-files=all`:
   - include `A` (index-added) and `??` (untracked)
   - only accept slugs where `skills/<slug>/SKILL.md` itself is in `A` or `??`
2. Finalize each discovered slug in stable sorted order:
   - `pnpm skills:finalize -- skills/<slug>`
   - stop immediately on first failure
3. Stage only related files after all finalize runs succeed:
   - `git add skills/<slug>` for each processed slug
   - `git add apps/web/src/generated/skills-index-lite.json apps/web/src/generated/skills-detail-index.json` for whichever generated index files changed
4. If no new skill is discovered:
   - report that no new skill was found
   - do not create a skill unless the user also requested creation

## Scope Boundaries

- Do not auto-run `pnpm skills:openai-yaml` unless explicitly requested.
- Do not auto-run local install/sync (`skills:install:local`, `skills:test:local`) unless explicitly requested.
- Do not stage in create, finalize-path, or validate mode. Staging requires an explicit `finalize-and-stage`/commit-preparation request.
- Do not use `git add -A`; only stage skill-related files from this workflow.

## Output Contract

When executing this skill, always return:

1. Commands executed (or planned commands in dry-run).
2. Success/failure status.
3. Detected/processed skill slugs and staged file paths, with `none` when the selected mode does not stage.
4. Next-step suggestion only when useful (for example, local agent testing via `pnpm skills:test:local`).

## Skill Rules

1. Use lowercase hyphen-case skill names.
2. Keep `SKILL.md` frontmatter valid with non-empty `name` and `description`.
3. `frontmatter.description` must be English-only (ASCII characters only), and should clearly include when to use the skill.
4. Add optional directories (`scripts/`, `references/`, `assets/`) only when needed.
5. Re-run validation and index generation after updates and before commit.
