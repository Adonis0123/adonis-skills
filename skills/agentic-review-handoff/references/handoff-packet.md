# Handoff Packet

Use this packet when an implementation agent hands work to a reviewer agent. Keep it factual and short. The reviewer should be able to verify the work without trusting the implementer's conclusion.

## Template

```md
# Review Handoff

## Goal

- User request:
- Intended behavior:
- Non-goals:

## Review Scope

- Scope type: staged diff / working tree diff / full branch diff / docs only / task files
- Repository:
- Branch:
- Files changed:

## Implementation Summary

- What changed:
- Main code paths:
- Data or API contracts affected:
- Feature flags, experiments, or environment assumptions:

## Verification

- Commands run:
- Passing results:
- Failing results:
- Pre-existing failures:
- Checks not run and why:

## Reviewer Focus

- Highest-risk areas:
- Boundary cases to inspect:
- Security/privacy/payment/data concerns:
- Compatibility or migration concerns:

## Open Questions

- Confirmed assumptions:
- Unverified assumptions:
- Decisions still needing human judgment:
```

## Packet Rules

- Do not paste full diffs unless the reviewer cannot access the repo.
- Prefer file paths, command names, and concise outcomes over narrative.
- Include failed checks. Failed checks are useful review context.
- Separate pre-existing failures from failures introduced by the change.
- If the review depends on docs/specs, include the exact paths.
- If the user asked for a narrow scope, write the excluded areas explicitly.

## Tiny Review Shortcut

For a tiny single-file review, this minimum packet is enough:

```md
Scope: working tree diff for path/to/file.ts
Goal: ...
Changed: ...
Verification: ...
Reviewer focus: ...
```
