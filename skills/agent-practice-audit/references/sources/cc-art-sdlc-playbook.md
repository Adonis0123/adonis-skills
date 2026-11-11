---
slug: cc-art-sdlc-playbook
title: The AI-native SDLC playbook
publisher: Anthropic
url: https://claude.com/resources/articles/the-ai-native-sdlc-playbook
fetchedAt: 2026-11-11
lastVerifiedAt: 2026-11-11
linkStatus: ok
finalUrl:
---

# The AI-native SDLC playbook

## Summary

- An organizational playbook for an AI-native development lifecycle across plan, design, build, test, deploy and maintain stages, with intent.md, spec.md and plan.md artifacts.
- Build stage: start sessions in plan mode, interrogate the plan and commit it as plan.md before implementation.
- Generate `CLAUDE.md` with `/init`, cut it to what a new joiner needs, keep it short, and add a correction whenever Claude repeats a mistake.
- Skills carry policies that must be applied consistently; hooks back them where a rule must always hold, e.g. formatting and linting after edits.
- Run two or three parallel sessions in separate worktrees to start, adding more only while review keeps up; turn repeated jobs into subagents.
- Test stage: always give Claude a feedback loop (tests, build, screenshots), list commands with healthy output, and write failing tests first for bugs.
- A verifier subagent with a fresh context window can give the final verdict without the assumptions that produced the code.
- Run agent evals in CI when `CLAUDE.md`, skills or hooks change; review PRs with Claude, and feed repeated review findings back into `CLAUDE.md`.
- Much of the playbook (stage gates, governance, metrics, release approval) targets teams rather than individual developers.

## Cited quotes

- "is one way to package the final check by running a fresh context window once the session believes the work is done." (verify-fresh-context-review)
- "Run the formatter and linter after file edits so drift never accumulates" (verify-lint-hook)
- "When Claude makes a mistake twice, the correction goes into CLAUDE.md." (doc-update-on-repeat)
