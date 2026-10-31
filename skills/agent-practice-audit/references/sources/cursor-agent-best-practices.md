---
slug: cursor-agent-best-practices
title: Best practices for coding with agents
publisher: Cursor
url: https://cursor.com/blog/agent-best-practices
fetchedAt: 2026-10-31
lastVerifiedAt: 2026-10-31
linkStatus: ok
finalUrl:
---

# Best practices for coding with agents

## Summary

- Plan before coding: use Plan Mode so the agent researches, asks questions and drafts a plan you can edit and save.
- If results drift from intent, revert and sharpen the plan instead of stacking follow-up prompts.
- Let the agent search for context; tag files only when you already know the exact one.
- Start a fresh conversation when the task changes or the agent repeats mistakes, and reference past work with `@Chats`.
- Keep rules short, listing key commands, style patterns and example files; add one only after the same mistake recurs.
- Commit rules to git so the team shares them, and package repeatable workflows as commands, skills or hooks.
- Give the agent verifiable goals such as tests; test-driven work with failing tests first lets it iterate to success.
- Review diffs carefully, use built-in review passes, and stop the agent early when it heads the wrong way.
- Run parallel agents in separate worktrees or compare several models on the same prompt.
- Use images for design-to-code, and hand background jobs to cloud agents.

## Cited quotes

- "Start simple. Add rules only when you notice the agent making the same mistake repeatedly." (doc-update-on-repeat)
- "The most impactful change you can make is planning before coding." (plan-mode-first)
- "Tests allow the agent to make changes, evaluate results, and incrementally improve until it succeeds." (verify-runnable-checks)
- "Revert the changes, refine the plan to be more specific about what you need, and run it again." (verify-revert-retry)
