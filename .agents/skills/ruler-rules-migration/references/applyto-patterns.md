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

## Practical guidance

- Start with `**` for baseline principles.
- Add narrower scopes only when conventions truly diverge.
- Keep each file focused on one concern.
- Prefer incremental additions over large one-shot rule sets.
