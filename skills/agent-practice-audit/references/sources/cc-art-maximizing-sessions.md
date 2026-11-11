---
slug: cc-art-maximizing-sessions
title: Maximizing the value of your Claude Code sessions
publisher: Anthropic
url: https://claude.com/resources/articles/maximizing-the-value-of-your-claude-code-sessions
fetchedAt: 2026-11-11
lastVerifiedAt: 2026-11-11
linkStatus: ok
finalUrl:
---

# Maximizing the value of your Claude Code sessions

## Summary

- Per-task cost depends on model, input vs output tokens and prompt-cache hits; cache reads cost about a tenth of fresh input.
- Every file read and command output stays in the conversation and is re-sent on each later turn, so context size times turns drives cost.
- Switching `/model`, `/effort` or fast mode, or running `/compact`, invalidates the cache; the cheap moments are session start or right after `/clear`.
- The cache lapses after an hour on a subscription (five minutes on an API key), so compacting before a break is cheaper than after.
- Use `/rewind` instead of `/compact` to drop a few bad turns, since rewinding keeps the cached prefix.
- Run `/context` in a fresh session, keep `CLAUDE.md` specific, move workflow detail into skills and turn off unused MCP servers.
- @-mention files instead of letting Claude search, and put everyday commands with quiet flags into `CLAUDE.md`.
- `/clear` between tasks, `/compact` with focus instructions or a "Compact instructions" section, and run `/loop` from a fresh session.
- Send noisy jobs such as log digging to a subagent; repeat jobs can get their own subagent definition on a smaller model.

## Cited quotes

- "/model: every model has its own cache, so on the next turn the entire conversation gets prefilled again at full price." (ctx-model-at-start)
- "/compact before you take a break from your keyboard." (ctx-compact-before-break)
- "the cache expires after an hour on a subscription or five minutes on an API key" (ctx-compact-before-break)
- "put a "Compact instructions" section in CLAUDE.md if it's always the same thing" (ctx-compact-focus)
