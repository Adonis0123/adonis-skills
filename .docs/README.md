# Plan Records

This directory stores plan records for major changes identified during Plan mode.

## When a record is required

Create a new plan record when any one of these is true:

- The planned work changes behavior across multiple modules or directories.
- The planned work changes public interfaces, architecture, or core data flow.
- The planned implementation is expected to touch 5 or more files.

## Naming rule

- Use `plan-YYYY-MM-DD-topic.md`.
- `topic` must be kebab-case and may contain only lowercase letters, digits, and hyphens.
- Suggested pattern: `^plan-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+\\.md$`.

Examples:

- `plan-2026-02-19-auth-refactor.md` (valid)
- `plan-auth-refactor.md` (invalid, missing date)
- `plan-2026-02-19-Auth_Refactor.md` (invalid, not kebab-case)

## Granularity

- One major change, one file.
- If a single Plan-mode session includes multiple major changes, create multiple files.

## Recommended sections

- Background
- Goals
- Scope
- Proposed Solution
- Risks
- Acceptance Criteria

## Quick start

Copy `.docs/plan-template.md` and fill in the sections for your change.
