---
applyTo: '**'
---

## Repository Conventions

- Keep changes minimal and aligned with existing script and file naming patterns.
- Prefer deterministic automation scripts over ad hoc manual steps for repeated workflows.
- When changing generated artifacts, update the source script and regenerate outputs.

## Package Conventions

- Each package should have a clear, single responsibility.
- Export public API through `src/index.ts` barrel files.
- Keep package-specific configuration (`tsconfig.json`, `.eslintrc`) at package root.
- Avoid circular dependencies between packages.

## Coding Conventions

- Use TypeScript and function components for React packages.
- Keep imports and naming consistent with repository conventions.
- Keep tests close to changed modules when practical.
- Document non-obvious tradeoffs in PR descriptions.
