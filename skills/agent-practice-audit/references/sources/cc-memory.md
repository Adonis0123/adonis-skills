---
slug: cc-memory
title: How Claude remembers your project
publisher: Anthropic
url: https://code.claude.com/docs/en/memory
fetchedAt: 2026-10-31
lastVerifiedAt: 2026-10-31
linkStatus: ok
finalUrl:
---

# How Claude remembers your project

## Summary

- Each session starts with a fresh context; `CLAUDE.md` files you write and auto memory notes Claude writes carry knowledge across sessions.
- Both memory systems are context, not enforcement; to block an action reliably, use a hook instead of an instruction.
- Files can live at project, user or organization scope, and a gitignored `CLAUDE.local.md` holds personal per-project preferences.
- Aim for under about 200 lines per `CLAUDE.md`; longer files cost context and lower adherence.
- Instructions should be specific and concise, and contradictory entries across files should be reviewed and removed because Claude may pick one arbitrarily.
- `CLAUDE.md` can import other files with `@path` syntax; imports outside the working directory prompt an approval step.
- Files above the working directory load at launch, while subdirectory files load on demand when Claude touches that directory.
- `.claude/rules/` splits instructions into topic files, and rules can be scoped to file paths so they load only when relevant.
- Claude Code can read a repository `AGENTS.md` in place of or alongside `CLAUDE.md`, which helps share one file across tools.
- Auto memory is per repository, shared across worktrees, and loads only the first 200 lines or 25KB each session.
- `/memory` lets you view and edit what is loaded, and the page has troubleshooting for ignored or oversized instructions.

## Cited quotes

- "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence." (doc-short-instructions)
