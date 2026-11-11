---
slug: cc-art-loops
title: Loop engineering: Getting started with loops
publisher: Anthropic
url: https://claude.com/resources/articles/getting-started-with-loops
fetchedAt: 2026-11-11
lastVerifiedAt: 2026-11-11
linkStatus: ok
finalUrl:
---

# Loop engineering: Getting started with loops

## Summary

- Defines a loop as an agent repeating cycles of work until a stop condition is met, and advises starting with the simplest loop.
- Turn-based loops are ordinary prompts; encoding manual checks as a `SKILL.md` lets Claude verify more of its own work.
- Goal-based loops (`/goal`) need verifiable exit criteria and an explicit turn cap.
- Time-based loops (`/loop`, `/schedule`) suit recurring work or polling external systems; match the interval to how often things change.
- Proactive loops combine schedules, goals, workflows and auto mode for recurring well-defined streams like triage.
- Quality depends on a clean codebase, self-verification via skills, reachable docs and a second agent with fresh context for review.
- When one result misses the bar, encode the fix into the system instead of only patching that case.
- Control tokens with the right primitive and model, clear success and stop criteria, small pilots, scripts for deterministic steps and `/usage`.

## Cited quotes

- "Use a second agent for code reviews: A reviewer with fresh context is less biased and not influenced by the main agent’s reasoning." (verify-fresh-context-review)
- "You can improve the verification step by encoding your manual steps as a SKILL.md so Claude can check more of its own work, end-to-end." (verify-checks-as-skills)
- "Define clear success and stop criteria: Be specific about what done looks like so Claude can arrive at the solution sooner" (plan-done-when)
