---
slug: cc-common-workflows
title: Common workflows
publisher: Anthropic
url: https://code.claude.com/docs/en/common-workflows
fetchedAt: 2026-10-31
lastVerifiedAt: 2026-10-31
linkStatus: ok
finalUrl:
---

# Common workflows

## Summary

- The page gives short prompt recipes for exploring a codebase, fixing bugs, refactoring, writing tests, opening pull requests and documentation.
- For bugs, share the reproduce command and error output; for refactors, work in small testable steps and run tests afterward.
- Use `@` references to pull files, directories or MCP resources into context; `PreToolUse` hooks do not run for them, so use deny rules for sensitive paths.
- Resume earlier work with `claude --continue` or `/resume` rather than re-explaining context.
- Run `claude --worktree <name>` for isolated parallel sessions on separate branches so edits do not collide.
- Plan mode lets Claude read and propose without editing until you approve.
- Hand large exploration to a subagent so the main context receives only the findings.
- Non-interactive `claude -p` fits CI, pre-commit hooks and batch jobs, with stdin and stdout behaving like other Unix tools.
- Scheduled work can run in the cloud, in the desktop app, in GitHub Actions or via `/loop`; prompts should state success criteria because the run cannot ask questions.
- Images can be pasted or referenced to explain errors, designs and schemas.

## Cited quotes

- "Delegate the exploration so only the findings come back." (ctx-subagent-offload)
- "Claude reads files and proposes a plan but makes no edits until you approve." (plan-mode-first)
- "Run Claude non-interactively for CI, pre-commit hooks, or batch processing." (auto-headless)
