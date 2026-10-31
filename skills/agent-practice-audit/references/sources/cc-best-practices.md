---
slug: cc-best-practices
title: Best practices for Claude Code
publisher: Anthropic
url: https://code.claude.com/docs/en/best-practices
fetchedAt: 2026-10-31
lastVerifiedAt: 2026-10-31
linkStatus: ok
finalUrl:
---

# Best practices for Claude Code

## Summary

- Defaults already work for a first prompt; extra setup matters when the project holds knowledge or rules that the code alone does not reveal.
- Write specific prompts, and brainstorm or interview with Claude before building so it does not guess what you meant.
- Keep `CLAUDE.md` short and focused; scope narrow rules to one part of the codebase and move team procedures into skills.
- Put the command that runs tests or checks in `CLAUDE.md`, because a runnable check is the most useful single instruction.
- Give Claude a check that returns pass or fail, and ask for evidence such as command output or screenshots.
- A Stop hook can enforce that a check passes before Claude is allowed to finish.
- Rules without exceptions belong in hooks, deny rules or managed settings, not in prose instructions that Claude may weigh against other things.
- Deny rules apply in every permission mode, so secrets such as `.env` files should be blocked there.
- Keep the enforced set small; a very long list of hard rules usually means many are really preferences.
- Use `/clear` between unrelated tasks, and restart with a better prompt after repeated failed corrections instead of arguing further.
- Choose model, effort and permission mode deliberately, and remember that subagents add their own cost.
- For unattended work, run Claude from scripts with turn and budget limits, schedule runs, and give parallel work separate checkouts.

## Cited quotes

- "/clear between unrelated tasks. It costs nothing…" (ctx-clear-between-tasks)
- "after two failed corrections run /clear and write a better prompt instead of a third" (ctx-clear-between-tasks)
- "Set model: haiku in a subagent's definition if its work is simple" (ctx-custom-subagents)
- "If something has to happen every time, make it a hook, a deny rule, or a managed setting." (safe-hooks-for-musts)
- "Whatever the scope, keep the enforced set small. … If you ever find yourself at forty of them, most are probably preferences" (safe-small-enforced-set)
- "deny rules hold in every permission mode, including auto and bypassPermissions, which is exactly why the .env rule belongs there" (safe-deny-secrets)
- "the single most useful line in your CLAUDE.md is the command that runs it." (doc-test-commands)
- "Ask Claude to interview you instead" (plan-interview)
- "Give Claude something it can run that comes back pass or fail." (verify-runnable-checks)
- "ask Claude for evidence: the command it ran and its output, or the screenshot." (verify-runnable-checks)
- "When you have separate pieces of work going at once, give each its own checkout so the edits can't collide." (auto-worktrees)
- "runs once and exits, which is how Claude Code ends up in CI jobs, git hooks, and shell loops." (auto-headless)
- "What stops it? --max-turns, --max-budget-usd, a spend limit." (auto-headless-limits)
