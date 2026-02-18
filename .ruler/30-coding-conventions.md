---
applyTo: '**'
---

## Repository Conventions

- Keep changes minimal and aligned with existing script and file naming patterns.
- Prefer deterministic automation scripts over ad hoc manual steps for repeated workflows.
- When changing generated artifacts, update the source script and regenerate outputs.
- Prefer passing script arguments explicitly via `--` when invoking pnpm scripts in docs/CI to avoid ambiguity.

## Skill Authoring Conventions

- Use lowercase hyphen-case for skill directory names and frontmatter `name`.
- Ensure each `skills/<slug>/SKILL.md` has valid YAML frontmatter with non-empty `name` and `description`.
- Add optional directories (`scripts/`, `references/`, `assets/`) only when they are needed by the skill.
- Add `agents/openai.yaml` only when required by downstream OpenAI skill metadata integration; generate it via `pnpm skills:openai-yaml`.
- Avoid extra documentation files inside a skill unless they are operationally required.
- After creating or updating a skill, run `pnpm skills:validate` and `pnpm skills:index`.

**SKILL.md frontmatter schema:**

```yaml
---
name: skill-name          # required, lowercase hyphen-case
description: "..."        # required, non-empty; shown in web UI and tool selectors
allowed-tools: Read, Bash # optional; restrict which tools Claude may use
metadata:
  author: your-name       # optional
  version: "1.0.0"        # optional
---
```

Only `name` and `description` are validated by CI. Skills in `skills/` are public and appear in the web UI; skills in `.agents/skills/` are internal and not indexed.

## Web Coding Conventions (`apps/web/**`)

- Use TypeScript and function components.
- Keep imports and naming consistent with repository conventions.
- Keep tests close to changed modules when practical.
- Document non-obvious tradeoffs in PR descriptions.
