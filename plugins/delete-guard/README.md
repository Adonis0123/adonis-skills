English | [中文](./README.zh-CN.md)

# delete-guard

A hook plugin for Claude Code and Codex that denies shell commands which delete files an agent cannot get back, and points the agent to the trash instead.

## Scenario

You run the agent with full permissions so it does not stop to ask. If it then deletes the wrong directory with `rm -rf`, the files are gone for good. A file moved to the trash can still be restored.

## Why use it

- It stops recursive deletes and history-discarding git commands before they run.
- The deny reason names a trash command that works on this system, so the agent can redo the step safely.
- Deletes inside temp directories still run, so normal cleanup is not slowed down.

It guards against accidents only. It is not a sandbox: `eval` of a variable, a Python or Node one-liner that deletes files, and anything else it cannot read statically still run.

## Why we built it

[cc-safety-net](https://github.com/kenryu42/cc-safety-net) covers similar ground, but two gaps mattered here:

- Even in its Paranoid mode it allows `find . -name "*.bak" -exec rm {} \;`. delete-guard denies it.
- Its deny message is fixed English text and cannot tell the agent to use the trash. delete-guard names `trash`, `trash-put` or `gio trash` depending on the system.

## How it works

A `PreToolUse` hook on the `Bash` tool runs `scripts/delete-guard.py` before every shell command. The script parses the command the way a shell would and checks each part:

- `;` `&&` `||` `|` `&` and newlines split commands; `$(...)`, backticks, unquoted heredoc bodies and the string given to `bash -c` / `sh -c` / `zsh -c` / `eval` are checked too.
- Relative paths are resolved against every directory the command may run in (`cd X && …`, `env -C`, `sudo -D`).
- A recursive delete passes only when every target resolves inside `/tmp`, `/private/tmp`, `/var/folders`, `/private/var/folders` or `$TMPDIR`. A target it cannot resolve (a variable, brace expansion, `xargs` input) counts as outside.

Every error, missing field or non-shell tool allows the call (exit 0, no output). Standard library only, no network, no model call.

## What it blocks

| Command                               | Result                                |
| ------------------------------------- | ------------------------------------- |
| `rm -rf src/old`                      | Denied: suggests the trash command    |
| `find . -name "*.bak" -exec rm {} \;` | Denied: suggests the trash command    |
| `git reset --hard`, `git clean -fd`   | Denied: suggests `git stash` first    |
| `rm -rf /tmp/build`                   | Allowed: inside a temp directory      |
| `trash src/old`, `rm a.txt`           | Allowed: recoverable or not recursive |

Also denied: every spelling of recursive `rm` (`-R`, `--recursive`, `/bin/rm`, `sudo rm`, `xargs rm -r`), `find -delete`, `git checkout -- <path>`, `git checkout .`, `git restore` without `--staged`, `git stash drop` and `git stash clear`.

## What the agent sees

Every reason opens with `[delete-guard] ` and is written in Chinese. On macOS, for `rm -rf src/old` (it says the command recursively deletes a path outside the temp directories, which cannot be recovered, and to use `trash <路径>` instead):

```text
[delete-guard] 这条命令会递归删除临时目录以外的路径（src/old），删了找不回。改用 `trash <路径>`，删进废纸篓可找回。（目前只为 macOS 和 Linux（含 WSL）给出替代命令，其他系统欢迎提 PR：https://github.com/Adonis0123/adonis-skills）
```

The suggested command depends on the system:

| System                 | Suggestion                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- |
| macOS                  | `trash <path>` (built into recent macOS)                                         |
| Linux, including WSL   | `trash-put <path>` (trash-cli) when it exists, else `gio trash <path>`           |
| No trash command found | `mv <path> /tmp/` to move it into a temp directory, or ask the user to delete it |

For git commands the reason says to save changes with `git stash` first, or ask the user to confirm.

## Install

Claude Code (2.1.292 or later), one command:

```bash
claude plugin install delete-guard --marketplace Adonis0123/adonis-skills
```

Codex:

```bash
codex plugin marketplace add Adonis0123/adonis-skills
codex plugin add delete-guard@adonis-skills
```

Codex skips plugin hooks until you trust them: open Codex, run `/hooks` and trust delete-guard's hook. Codex asks again after the script changes.

Requires `python3` on `PATH`. Supports macOS, Linux and WSL; native Windows is not supported.

## Configure

| Variable         | Meaning                      |
| ---------------- | ---------------------------- |
| `DELETE_GUARD=0` | Turn the guard off entirely. |

## Turning it off

```bash
claude plugin disable delete-guard@adonis-skills
```

In Codex, run `codex plugin remove delete-guard@adonis-skills`, or set `enabled = false` under `[plugins."delete-guard@adonis-skills"]` in `~/.codex/config.toml`.

## Limitations

- It reads commands statically. Deletes hidden in a variable passed to `eval`, or in another language's one-liner, still run.
- It checks only the shell tool. File edits through other tools are not covered.
- A denied command is not run; the agent has to pick another way.

## Tests

```bash
zsh plugins/delete-guard/tests/delete-guard.test.zsh   # needs python3 and jq
```
