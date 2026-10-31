---
slug: codex-agents-md
title: Custom instructions with AGENTS.md
publisher: OpenAI
url: https://learn.chatgpt.com/docs/agent-configuration/agents-md
fetchedAt: 2026-10-31
lastVerifiedAt: 2026-10-31
linkStatus: ok
finalUrl:
---

# Custom instructions with AGENTS.md

## Summary

- Codex builds its instruction chain once at startup, so edits apply from the next run or session.
- A global override or `AGENTS.md` in the Codex home directory applies to every project; only the first non-empty file at that level is used.
- Project discovery walks from the repository root down to the working directory, taking at most one file per directory.
- Within a directory the order is override file, then `AGENTS.md`, then any configured fallback filenames.
- Files are concatenated root first, so those nearer the working directory come later and take precedence.
- Layering works well: root file for repo-wide norms, nested files for specific services or areas.
- Empty files are skipped and the combined size is capped at 32 KiB by default; `project_doc_max_bytes` raises the cap, or split files across directories.
- `project_doc_fallback_filenames` lets Codex recognise other filenames after a restart.
- The page also covers review rules in `AGENTS.md` and troubleshooting such as checking the home directory setting and stray override files.

## Cited quotes

- "stops adding files once the combined size reaches the limit defined by project_doc_max_bytes (32 KiB by default)" (doc-short-instructions)
