---
name: css-tailwind-styling
description: Expert guidance for writing clean, performant CSS and Tailwind CSS. Use when creating styles, designing components, optimizing performance, or establishing styling conventions. Covers modern CSS features, Tailwind utility patterns, responsive design, accessibility, and team collaboration standards.
---

# CSS and Tailwind CSS Styling Expert

## Overview

This skill provides comprehensive best practices for writing maintainable, performant, and accessible styles using both traditional CSS and Tailwind CSS. It covers modern techniques, performance optimization, responsive design patterns, and team collaboration standards.

Follow the requested styling scope and the project's existing design tokens, component patterns, formatter, linter, and package manager. A local style fix does not require adopting Tailwind, migrating versions, installing tools, or reformatting unrelated code.

## When to Use This Skill

- Creating or refactoring component styles
- Setting up a new project's styling architecture
- Optimizing CSS or Tailwind performance
- Establishing team styling conventions
- Reviewing code for style-related issues
- Implementing responsive designs
- Ensuring accessibility compliance
- Debugging style conflicts or specificity issues

## Core Principles

### General Styling Philosophy

1. **Maintainability First**: Write styles that are easy to understand and modify
2. **Performance Conscious**: Minimize bundle size and render-blocking
3. **Accessibility By Default**: Ensure WCAG AA compliance (4.5:1 contrast ratio minimum)
4. **Mobile-First Responsive**: Start with mobile and progressively enhance
5. **Consistency Over Cleverness**: Establish and follow patterns

---

## Version Detection & Decision Flow

Use this protocol only when the task needs Tailwind-specific guidance; ordinary CSS work skips it. Reuse version evidence already established in the current task instead of repeating the same inspection.

### 1. Detect Tailwind Version (Dependency First)

Inspect `package.json` first:

- `tailwindcss` major version `4` -> initial state: `v4`
- `tailwindcss` major version `3` -> initial state: `v3`
- Missing/unclear dependency -> initial state: `unknown` (continue with signal checks)

### 2. Cross-Check with Configuration and Style Signals

Use these signals to validate or refine the initial state:

- Prefer **v4** when you find: `@import "tailwindcss"`, `@theme`, `@utility`, `@custom-variant`
- Prefer **v3** when you find: `@tailwind base;`, `@tailwind components;`, `@tailwind utilities;` with a config-driven setup

### 3. Resolve Final State

- `v4`: dependency and signals align to v4
- `v3`: dependency and signals align to v3
- `conflict`: dependency and syntax/config signals disagree
- `unknown`: insufficient evidence to identify a single version

### 4. Required Decision Behavior

- `v4`: Use the v4 path; include v3 only for an explicit comparison or migration decision.
- `v3`: Use the v3 path; include v4 only for an explicit comparison or migration decision.
- `conflict`: Inspect the conflicting dependency/config signals and recommend the smallest justified repair. Compare repair paths only when that choice affects the requested work.
- `unknown`: Gather only the evidence needed for version-dependent changes. For a new project with no established version, recommend v4; version-independent CSS work can continue without a migration proposal.

---

## Load Only the Relevant Detail

Use the existing task context first. If the requested change is already clear, proceed without opening a reference. Otherwise select the relevant reference and read only the named sections from its contents list; do not load all references by default.

| Requested work or established state                                                    | Read only when the detail is needed                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary CSS, layout, selectors, tokens, or a responsive fix                           | [CSS reference](references/css.md): the matching Traditional CSS section; Modern CSS Features only for the feature involved. Skip Tailwind guidance.                    |
| Tailwind utilities, complete class mappings, component variants, or class organization | [Tailwind reference](references/tailwind.md): the matching numbered section. Reuse the project's existing formatter and components.                                     |
| Confirmed Tailwind v3 configuration or source scanning                                 | [Tailwind reference](references/tailwind.md): section 6's **v3 (config-first)** block or section 10's v3 guidance only. Do not add the v4 alternative.                  |
| Confirmed Tailwind v4 configuration or source scanning                                 | [Tailwind reference](references/tailwind.md): section 6's **v4 (CSS-first)** block or section 10's v4 guidance only. Do not add the v3 alternative.                     |
| Version conflict, migration, or an explicit version comparison                         | Use the version decision flow above, then only the implicated configuration sections in the [Tailwind reference](references/tailwind.md).                               |
| Affected accessibility, browser compatibility, or performance behavior                 | [Verification reference](references/verification.md): only the relevant section and applicable checklist items. Tool lists are options, not installation prerequisites. |

Reference examples do not replace the current styling system or expand the requested work. Use the existing checks and relevant runtime evidence for the affected surface; a recipe or code read alone does not prove a UI interaction passed. Report missing runtime evidence as `UNVERIFIED` instead of broadening a local task into a full-site audit.

---

## Output Format

Scale the response to the requested CSS/Tailwind work:

1. **Use the existing context**: Follow the project's framework, styling system, and conventions.
2. **Detect the version when relevant**: For Tailwind-specific decisions, use dependency and syntax/config evidence. Skip Tailwind detection for ordinary CSS work.
3. **Report decision-relevant evidence**: Name the detected version and chosen approach when they affect the answer. Include an alternate version or repair comparison only for an unresolved conflict, migration, or requested comparison.
4. **Provide code examples when useful**: Keep small fixes focused; a full good/bad tutorial is optional.
5. **Explain non-obvious choices**: Connect the change to the requested result.
6. **Preserve accessibility**: Report relevant a11y implications and actual checks for the affected surface.
7. **Check performance**: Flag evidence-backed risks relevant to the change.
8. **Suggest tools only for an actual gap**: Reuse existing tooling; do not add setup work merely to satisfy this guide.

Always prioritize:

- ✅ Maintainability and readability
- ✅ Performance and bundle size
- ✅ Accessibility compliance
- ✅ Team consistency
- ✅ Modern best practices

---

## Version History

- **v1.2** (2026-02-24): Added v3/v4 dual-track support with dependency-first detection flow, conflict handling, and structured output contract fields.
- **v1.1** (2026-02-24): Clarified Tailwind adoption criteria, responsive prefix guidance, and compatibility wording.
- **v1.0** (2025-01): Initial release covering Tailwind CSS + modern CSS best practices.
