---
slug: cc-art-steering
title: Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents
publisher: Anthropic
url: https://claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more
fetchedAt: 2026-11-11
lastVerifiedAt: 2026-11-11
linkStatus: ok
finalUrl:
---

# Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents

## Summary

- Compares seven ways to steer Claude Code: root and subdirectory `CLAUDE.md`, rules, skills, subagents, hooks, output styles and appended system prompts.
- Each differs in when it loads, whether it survives compaction, its context cost and how much authority it carries.
- Keep `CLAUDE.md` under about 200 lines, owned and reviewed like code; it should be an index and hold build commands and conventions.
- Scope rules with `paths:` so they load only when matching files are touched; an unscoped rule costs the same as `CLAUDE.md`.
- Procedures such as deploy or review checklists belong in skills, which load their body only when invoked.
- Use subagents for side tasks whose intermediate output would clutter the main thread; only the final message returns.
- Use hooks for anything that must happen deterministically, such as linting after edits or blocking commands; prompted "never" rules can fail under pressure.
- Prefer built-in output styles; a custom one replaces default coding instructions unless told to keep them.
- Keep personal preferences in user-level files and team-wide ones in project files.

## Cited quotes

- "Use hooks for anything that should happen deterministically: running linters after edits, posting to Slack on completion, or blocking specific commands before they execute." (verify-lint-hook)
- "A real guardrail needs to be deterministic, and the enforcement methods are hooks and permissions." (safe-hooks-for-musts)
- "A 30-line procedure in CLAUDE.md. Procedures belong in skills." (doc-skills-on-demand)
