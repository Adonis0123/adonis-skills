---
applyTo: '**'
---

## Repository Conventions

- Keep changes minimal and aligned with existing script and file naming patterns.
- Prefer deterministic automation scripts over ad hoc manual steps for repeated workflows.
- When changing generated artifacts, update the source script and regenerate outputs.

## Skill Authoring Conventions

- Use lowercase hyphen-case for skill directory names and frontmatter `name`.
- Ensure each `skills/<slug>/SKILL.md` has valid YAML frontmatter with non-empty `name` and `description`.
- Add optional directories (`scripts/`, `references/`, `assets/`) only when they are needed by the skill.
- Avoid extra documentation files inside a skill unless they are operationally required.
- After creating or updating a skill, run `pnpm skills:validate` and `pnpm skills:index`.

## Web Coding Conventions (`apps/web/**`)

- Use TypeScript and function components.
- Keep imports and naming consistent with repository conventions.
- Keep tests close to changed modules when practical.
- Document non-obvious tradeoffs in PR descriptions.
