---
name: repo-skill-creator
description: Create and maintain repository skills for adonis-skills. Use when users ask to scaffold a new skill under skills/, generate agents/openai.yaml, run skill validation, refresh web index data, or standardize the skill authoring workflow.
---

# Repo Skill Creator

Create new skills for this repository with a repeatable workflow.

## Primary Command

Use the interactive command:

```bash
pnpm skills:new
```

This command collects name/description/resources, initializes the skill, runs quick validation, runs repository validation, and refreshes the web index.

## Manual Commands

When manual control is needed, run:

```bash
pnpm skills:init <skill-name> --path skills --resources scripts,references
pnpm skills:quick-validate skills/<skill-name>
pnpm skills:validate
pnpm skills:index
```

## Skill Rules

1. Use lowercase hyphenated skill names.
2. Keep `SKILL.md` frontmatter valid with `name` and `description`.
3. Add optional directories (`scripts/`, `references/`, `assets/`) only when needed.
4. After edits, re-run validation and index generation before commit.

## Optional Local Testing

Install and test locally when needed:

```bash
pnpm skills:install:local
pnpm skills:test:local
```
