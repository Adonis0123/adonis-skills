---
slug: codex-best-practices
title: Best practices
publisher: OpenAI
url: https://learn.chatgpt.com/guides/best-practices
fetchedAt: 2026-10-31
lastVerifiedAt: 2026-10-31
linkStatus: ok
finalUrl:
---

# Best practices

## Summary

- Each prompt should state the goal, relevant context, constraints and what done looks like.
- Pick a reasoning effort that matches the task, lower for scoped work and higher for complex or agentic jobs.
- Use Plan mode or ask Codex to interview you before ambiguous or large tasks.
- Keep durable repo guidance in a short, accurate `AGENTS.md`, including build, test and lint commands, and revise it when mistakes repeat.
- Configure behavior at personal, repository and one-off levels so surfaces stay consistent.
- Keep approvals and sandbox tight by default; do not grant full computer access before the workflow is understood.
- Ask Codex to write tests, run checks and review its own diff before you accept changes; `/review` helps make review consistent.
- Use MCP for external context that changes often, and package repeated workflows as narrowly scoped skills.
- Schedule recurring tasks only after the manual workflow is reliable.
- Keep one chat per coherent unit of work, and fork or compact when context grows; use Git worktrees for concurrent tasks on the same files.

## Cited quotes

- "Keep one chat per coherent unit of work." (ctx-clear-between-tasks)
- "Giving Codex full permission to your computer before you understand the workflow" (safe-low-risk-preset)
- "Low for faster, well-scoped tasks" (safe-low-risk-preset)
- "A short, accurate AGENTS.md is more useful than a long file full of vague rules." (doc-short-instructions)
- "Build, test, and lint commands" (doc-test-commands)
- "When Codex makes the same mistake twice, ask it for a retrospective and update AGENTS.md." (doc-update-on-repeat)
- "Plan mode lets Codex gather context, ask clarifying questions, and build a stronger plan before implementation." (plan-mode-first)
- "Done when: What should be true before the task is complete, such as tests passing, behavior changing, or a bug no longer reproducing?" (plan-done-when)
- "Ask it to create tests when needed, run the relevant checks, confirm the result, and review the work before you accept it." (verify-runnable-checks)
- "Running live tasks on the same files without using Git worktrees" (auto-worktrees)
