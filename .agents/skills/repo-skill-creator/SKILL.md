---
name: repo-skill-creator
description: Create and maintain repository skills for adonis-skills. Use when users ask to scaffold a new skill under skills/, generate agents/openai.yaml, run skill validation, refresh web index data, or standardize the skill authoring workflow.
---

# Repo Skill Creator

Create and maintain repository skills with a dual workflow: creation mode and path-finalize mode.

## Trigger Rules

1. If the user provides a `skills/*` path and indicates the skill is already generated/copied, run finalize mode directly without additional confirmation.
2. Otherwise, use creation mode (`skills:new` or `skills:init`) and then finalize.

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

## Scope Boundaries

- Do not auto-run `pnpm skills:openai-yaml` unless explicitly requested.
- Do not auto-run local install/sync (`skills:install:local`, `skills:test:local`) unless explicitly requested.

## Output Contract

When executing this skill, always return:

1. Commands executed (or planned commands in dry-run).
2. Success/failure status.
3. Next-step suggestion only when useful (for example, local agent testing via `pnpm skills:test:local`).

## Skill Rules

1. Use lowercase hyphen-case skill names.
2. Keep `SKILL.md` frontmatter valid with non-empty `name` and `description`.
3. Add optional directories (`scripts/`, `references/`, `assets/`) only when needed.
4. Re-run validation and index generation after updates and before commit.
