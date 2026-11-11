---
slug: cc-art-opus-5-5-context
title: Coding sessions are longer and use more context. Claude Opus 5.5 is built with that in mind.
publisher: Anthropic
url: https://claude.com/resources/articles/claude-opus-5-5-built-for-coding-sessions-that-use-more-context
fetchedAt: 2026-11-11
lastVerifiedAt: 2026-11-11
linkStatus: ok
finalUrl:
---

# Coding sessions are longer and use more context. Claude Opus 5.5 is built with that in mind.

## Summary

- Opus 5.5 is estimated at about 40% cheaper than Opus 5 for typical token-billed workloads, with cached reads cut most.
- Aggregate Claude Code data from March to September 2026 shows longer runs per prompt, fewer interruptions and 2.6x more context per request.
- Because most cost is now re-read context, cache efficiency matters more than before.
- Claude Code changes cut cache-missing input by over half; newer models keep the cache when effort changes mid-session.
- API and cloud users can set a one-hour cache lifetime, and forked subagents reuse the parent cache.
- Opus 5.5 may need fewer turns on open-ended tasks, though well-scoped tasks take about the same number.
- Advice: check cached share with `/usage`, pick the model at session start, compact before stepping away, and use the one-hour cache on API keys.

## Cited quotes

- "Pick your model at the start of a session rather than switching midway" (ctx-model-at-start)
- "Compact before you step away rather than after" (ctx-compact-before-break)
