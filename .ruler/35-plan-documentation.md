---
applyTo: '**'
---

## Plan Mode Major-Change Documentation

- This rule applies only when operating in Plan mode.
- A change is major if any one condition is true:
  - It changes behavior across multiple modules or directories.
  - It changes public interfaces, architecture, or core data flow.
  - It is expected to touch 5 or more files in a single implementation.
- For each major change, you MUST create one Markdown plan record in `.docs/`.
- If one Plan-mode session includes multiple major changes, create one file per major change.
- Plan record file names in `.docs/` MUST use `plan-YYYY-MM-DD-topic.md`.
- `topic` MUST be kebab-case and may contain only lowercase letters, digits, and hyphens.
- The file name SHOULD match this pattern: `^plan-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+\\.md$`.
- Each plan record SHOULD include: background, goals, scope, solution, risks, and acceptance criteria.
