---
applyTo: 'src/**'
---

## Coding Conventions

- Use TypeScript and function components with hooks.
- Prefer Server Components by default; add `'use client'` only when client interactivity is required.
- Keep data fetching in Server Components or Route Handlers, not in client components.
- Use Next.js `<Image>`, `<Link>`, and metadata APIs over raw HTML equivalents.
- Keep imports and naming consistent with repository conventions.
- Keep tests close to changed modules when practical.
- Document non-obvious tradeoffs in PR descriptions.
