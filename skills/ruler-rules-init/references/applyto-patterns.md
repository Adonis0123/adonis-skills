# applyTo Patterns

Use `applyTo` to scope rule files intentionally.

## Pattern A: Global defaults

Use `applyTo: '**'` for repository-wide principles.

```md
---
applyTo: '**'
---

## Core Principles
- Keep changes minimal and verifiable.
```

## Pattern B: Global + directory-specific rules

Use global defaults for shared behavior and add directory rules for local conventions.

### Global rule

```md
---
applyTo: '**'
---

## General Rules
- Follow repository release process.
```

### Web-only rule

```md
---
applyTo: 'web/**'
---

## Web Conventions
- Use framework-specific import aliases.
```

## Pattern C: Multiple domains

Split by domain when monorepo parts have different constraints.

- `server/**` for backend conventions.
- `web/**` for frontend conventions.
- `packages/**` for shared library rules.

## Preset-Specific Scoping

### Next.js projects (`--preset nextjs`)

The `nextjs` preset scopes coding conventions to `src/**`:

```md
---
applyTo: 'src/**'
---

## Coding Conventions
- Prefer Server Components by default.
- Add `'use client'` only when client interactivity is required.
```

### Monorepo projects (`--preset monorepo`)

The `monorepo` preset uses global scope `**` for conventions that span multiple packages:

```md
---
applyTo: '**'
---

## Repository Conventions
- Use workspace protocol for internal dependencies.
- Keep package boundaries clear.
```

Add narrower scopes for app-specific rules:

```md
---
applyTo: 'apps/web/**'
---

## Web App Conventions
- Use TypeScript and function components.
```

### Node.js library projects (`--preset node-lib`)

The `node-lib` preset scopes coding conventions to `src/**`:

```md
---
applyTo: 'src/**'
---

## Coding Conventions
- Export public API through barrel file.
- Follow semantic versioning.
```

## Practical guidance

- Start with `**` for baseline principles.
- Add narrower scopes only when conventions truly diverge.
- Keep each file focused on one concern.
- Prefer incremental additions over large one-shot rule sets.
- Use preset defaults as starting points, then customize scopes for your project.
