---
slug: cc-art-verification-loops
title: Building verification loops in Claude Code with skills
publisher: Anthropic
url: https://claude.com/resources/articles/building-verification-loops-in-claude-code-with-skills
fetchedAt: 2026-11-11
lastVerifiedAt: 2026-11-11
linkStatus: ok
finalUrl:
---

# Building verification loops in Claude Code with skills

## Summary

- Frames agentic work as a loop of gathering context, acting and verifying, and argues the verify step should be encoded rather than left to the human.
- Built-in aids include the `/verify` skill, toolchain errors, managed Code Review, GitHub Actions jobs and spec validation.
- Listing exact build and test commands in `CLAUDE.md` saves Claude from guessing them.
- Any check you repeatedly enforce by hand, deterministic or not, is a candidate for a custom verification skill.
- Skills can be drafted with the skill-creator plugin interviewing you, or hand-written under `.claude/skills/`.
- A check can run standalone, be embedded in the skill that produces the artifact, be chained after another skill, or run on every PR.
- Chaining turns a habit into a contract but costs tokens, so test chains before using them widely.
- Suggested start: pick the most frequent manual follow-up, try `/verify`, write the procedure in plain English, make it a skill and confirm it runs.

## Cited quotes

- "Anything you keep having to enforce by hand as a manual check qualifies for capture as a loop." (verify-checks-as-skills)
- "A good practice is to list your exact build and test commands in CLAUDE.md so Claude doesn't have to infer them." (doc-test-commands)
