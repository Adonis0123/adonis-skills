---
applyTo: 'src/**'
---

## Coding Conventions

- Use TypeScript with strict mode enabled.
- Export public API through `src/index.ts` barrel file.
- Keep internal utilities unexported unless needed by consumers.
- Follow semantic versioning: breaking changes bump major, new features bump minor.
- Keep tests close to changed modules when practical.
- Document non-obvious tradeoffs in PR descriptions.

## Publishing Conventions

- Ensure `main`, `module`, or `exports` fields in `package.json` point to compiled output.
- Include only necessary files in published package (use `files` field or `.npmignore`).
- Run full test suite before publishing.
