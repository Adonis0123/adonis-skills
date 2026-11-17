English | [中文](./README.zh-CN.md)

# completion-claim-check

A hook plugin for Claude Code and Codex that stops the agent once when it says the work is done but shows no proof.

## Scenario

The agent ends a turn with "done" or "已完成", yet the reply has no verification evidence: no command it ran, no test result, nothing marked as unverified.

## Why use it

- You find out at the end of the turn, not later, that a claim was never checked.
- The agent gets one more step to add the commands it ran and their results, or to mark what it did not verify as `UNVERIFIED`.
- It blocks at most once per turn, so a turn never loops.

## How it works

A `Stop` hook runs `scripts/completion-claim-check.sh` when the agent tries to end its turn. It blocks only when all of these hold:

1. The stop flag is not set (`stop_hook_active`), so this is the first stop of the turn.
2. The working directory is a git worktree with uncommitted changes (`git status --porcelain`).
3. The last reply claims completion: `已完成`, `改完`, `已修复`, `搞定`, `done`, `fixed`, `all set` and similar. Negations such as `未完成` or `not done yet` do not count.
4. The reply has no evidence: words such as `验证`, `测试`, `test`, `pytest`, `pnpm`, `PASS`, `FAIL`, `UNVERIFIED`, `exit code`, or a code block.

The host is read from the payload itself. Claude Code and Codex send snake_case fields, Grok Build sends camelCase; both are read on every call. A `--agent claude|codex|grok` argument is still accepted for existing hook files.

Every error allows the stop (exit 0, no output). `git status` is abandoned after 3 seconds. No network, no model call.

## What it blocks

| Reply and working tree                             | Result            |
| -------------------------------------------------- | ----------------- |
| `已完成修改。`, uncommitted changes                | Blocked once      |
| `All done, the bug is fixed.`, uncommitted changes | Blocked once      |
| `Done. Ran pnpm test: all green`                   | Allowed: evidence |
| `改完了，浏览器部分 UNVERIFIED`                    | Allowed: marked   |
| `已完成` with a clean tree, or `还未完成`          | Allowed           |

## What the agent sees

The reason is written in Chinese. It says the reply claims completion while the working tree has uncommitted changes and no verification evidence, and asks for the commands and results, or `UNVERIFIED` marks:

```text
你说已完成，但工作区有未提交改动，回复里没有验证证据。补上验证命令和结果，或把没验证的项标成 UNVERIFIED。
```

In Codex the reason arrives as a continuation prompt, and the agent replies once more.

## Install

Claude Code (2.1.292 or later), one command:

```bash
claude plugin install completion-claim-check --marketplace Adonis0123/adonis-skills
```

Codex:

```bash
codex plugin marketplace add Adonis0123/adonis-skills
codex plugin add completion-claim-check@adonis-skills
```

Codex skips plugin hooks until you trust them: open Codex, run `/hooks` and trust this plugin's hook. Codex asks again after the script changes.

Requires `sh`, `jq` and `git` on `PATH`; `perl` is used to time out `git status` when present. Without `jq` or `git` the hook does nothing. Supports macOS, Linux and WSL; native Windows is not supported.

## Configure

| Variable                         | Meaning                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `COMPLETION_CHECK=0`             | Turn the check off entirely.                                         |
| `COMPLETION_CHECK_GIT_TIMEOUT=3` | Seconds before `git status` is abandoned (then the stop is allowed). |

## Turning it off

```bash
claude plugin disable completion-claim-check@adonis-skills
```

In Codex, run `codex plugin remove completion-claim-check@adonis-skills`, or set `enabled = false` under `[plugins."completion-claim-check@adonis-skills"]` in `~/.codex/config.toml`.

## Limitations

- Keyword matching: a reply that words a claim or its evidence differently is not judged correctly.
- Outside a git repository, or with a clean tree, it never blocks.
- It checks that evidence is mentioned, not that it is true.

## Tests

```bash
zsh plugins/completion-claim-check/tests/completion-claim-check.test.zsh   # needs sh, jq and git
```
