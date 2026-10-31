---
slug: cc-costs
title: Manage costs effectively
publisher: Anthropic
url: https://code.claude.com/docs/en/costs
fetchedAt: 2026-10-31
lastVerifiedAt: 2026-10-31
linkStatus: ok
finalUrl:
---

# Manage costs effectively

## Summary

- Token cost grows with context size, so keeping context small is the main lever; caching and auto-compaction help but do not replace habits.
- `/usage` shows session tokens and, on plans, a breakdown of what drives consumption with suggested fixes.
- Use `/clear` when switching to unrelated work, since stale context is resent with every message.
- Give `/compact` focus instructions, or put compaction guidance in `CLAUDE.md`, so the summary keeps what matters.
- Pick a cheaper model for most work and reserve the strongest one for hard reasoning; simple subagents can run on a small model.
- Prefer CLI tools over MCP servers where possible, and disable MCP servers you are not using.
- Hooks can pre-filter large output such as logs, and skills load only when invoked, keeping the base context lean.
- Keep `CLAUDE.md` essentials-only, under roughly 200 lines, and move workflow-specific detail into skills.
- Delegate verbose work like tests, docs fetching and log processing to subagents so only a summary returns to the main thread.
- Lower effort or thinking budget for simple tasks, write specific prompts, use plan mode, and course-correct early.
- Agent teams multiply token use per teammate, so keep them small and shut teammates down when finished.
- Long sessions, cache misses and idle scheduled tasks all quietly add usage.

## Cited quotes

- "the verbose output stays in the subagent's context while only a summary returns to your main conversation." (ctx-subagent-offload)
- "For simple subagent tasks, specify model: haiku in your subagent configuration." (ctx-custom-subagents)
- "/compact Focus on code samples and API usage tells Claude what to preserve during summarization." (ctx-compact-focus)
- "Skills load on-demand only when invoked, so moving specialized instructions into skills keeps your base context smaller." (doc-skills-on-demand)
