# Documentation Persistence Adapter

This file defines how the discuss-before-plan skill persists Spec/Decision Records and Implementation Plans to disk. It is a **persistence adapter** — not the core domain. The core domain is the decision-gating workflow in SKILL.md.

## Documentation Profile Resolver

Before writing any document, resolve which profile to use. Check in this order — first match wins:

```
1. Repo-local docs rules       → CLAUDE.md, AGENTS.md, .ruler/*.md explicit path/format rules
2. Same-directory examples      → 2-3 existing files in the target directory
3. Existing docs conventions    → docs/specs/, docs/plans/, docs/decisions/, docs/adr/
4. docs/superpowers/ fallback   → only if this directory already exists AND matches repo style
5. Generic defaults             → docs/specs/ + docs/plans/ (see below)
```

Once resolved, record the profile as a **Docs Style Snapshot** before writing.

## Docs Style Snapshot

Output this (internally or visibly) before writing any persistent document. This makes style adherence verifiable.

```
Docs Style Snapshot
- Samples read: [list 2-3 files you examined]
- Target directory: [resolved path]
- Naming pattern: [e.g. YYYY-MM-DD-topic.md]
- Frontmatter: [yes/no, which fields]
- Heading language: [zh/en/mixed]
- Required sections: [list]
- Link style: [relative/absolute]
- Special fields: [status, history, branch, etc. — or "none"]
```

If the user can see chat output, show the snapshot briefly. If running non-interactively, keep it internal but still use it to guide formatting.

## Style Detection Protocol

To populate the snapshot, read these sources (stop early if rules are unambiguous):

1. **Project rules**: `CLAUDE.md`, `AGENTS.md`, `.ruler/*.md` — look for explicit doc conventions
2. **Docs structure**: `docs/README*`, target subdirectory README
3. **Similar examples**: 2-3 Markdown files in the same directory, same topic, or same `doc_type`
4. **Extract**: directory hierarchy, date format, frontmatter style, heading language, section order, link style, metadata fields (status/history/branch)

**Project conventions always win.** If the project says "no frontmatter" and the template below includes frontmatter, follow the project.

## Default Naming Rules

When no project convention is detected:

| Artifact | Directory | Filename | Purpose |
|----------|-----------|----------|---------|
| Spec/Decision Record | `docs/specs/` | `YYYY-MM-DD-topic-design.md` | Background, goals, non-goals, decisions, architecture, risks |
| Focused Decision | `docs/specs/` | `YYYY-MM-DD-topic.md` | Smaller-scope technical decision |
| Implementation Plan | `docs/plans/` | `YYYY-MM-DD-topic.md` | Task-by-task plan referencing corresponding spec |

Naming rules:
- `YYYY-MM-DD`: current local date
- `topic`: lowercase hyphen-case, matches feature name
- Spec and plan share the same topic for cross-reference
- Architecture/data-flow/interface-level designs use `-design.md` suffix
- If a file on the same topic already exists, read and update it — don't create parallel truths

## Spec/Decision Record Template

```md
---
title: [Title]
description: [One-line summary]
date: YYYY-MM-DD
doc_type: spec
---

# [Title]

## Background

## Goals

## Non-goals

## Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|

## Architecture / Data Flow

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|

## Open Items
```

## Implementation Plan Template

```md
# [Feature] Implementation Plan

**Spec**: [link to corresponding spec/decision document]
**Goal**: [one-line goal]

## File Structure

- New: ...
- Modified: ...

## Conventions

[Commit, test, typecheck constraints for this task]

## Tasks

### Task 1: [Title]

**Files**: [affected files]

- [ ] Step 1
- [ ] Step 2

**Verification**: [how to verify]
```

Plan constraints:
- Never introduce new design choices in task steps
- Line numbers are snapshot values; note "re-locate if drifted" when fragile
- Never use `git add -A`; commit steps list exact files
