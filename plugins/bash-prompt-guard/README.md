English | [中文](./README.zh-CN.md)

# bash-prompt-guard

A Claude Code hook plugin that denies Bash commands Claude Code's permission check cannot parse, so an unattended session does not stall on a confirmation prompt.

## Scenario

Claude Code reads every Bash command as bash. A few command shapes make its permission check ask for confirmation, even under bypass permissions. An unattended session, or a background subagent, then waits on a prompt nobody answers.

## Why use it

- Denying is cheaper than waiting: the agent gets the reason at once and rewrites the command.
- Every reason says how to rewrite the command (`Fix: …`).
- Overnight and background runs keep going.

## How it works

A `PreToolUse` hook on the `Bash` tool runs `scripts/bash-prompt-guard.py` before every command and checks it against the shapes below.

| Shape                                                                         | Example                             | Fix the reason suggests                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| zsh-only syntax: parameter flags, modifiers, glob qualifiers                  | `${(f)"$(cmd)"}`, `${f:t}`, `*(N)`  | bash-readable syntax (`xargs`, `while IFS= read -r f; do …; done < <(cmd)`) or a script file |
| `rm` / `rmdir` in the same command as a multi-line inline script              | `rm -rf a; bash -c '<newline>…'`    | run the removal as its own call with literal paths                                           |
| `rm` targets Claude Code treats as critical paths                             | `rm -f $D/*.png`, `rm -rf "$(cmd)"` | `"${D:?}"/*.png`; run the substitution first, then remove the literal path                   |
| A `$(` that never closes                                                      | `grep "[a-z$(]"`                    | single quotes, or `\$(` inside double quotes                                                 |
| A `${` bash does not read as a parameter expansion                            | `grep "frame ${size(x)}"`           | `grep -F '…'` with single quotes, or `\${`                                                   |
| A `( … )` subshell after `&&`, `\|\|`, `;`, `\|` or a newline inside `$(...)` | `c=$(a \|\| (b && c))`              | a `{ …; }` group (`$(a \|\| { b && c; })`), or separate commands                             |

Text the shell does not expand is ignored: single-quoted strings, backslash escapes, comments and the bodies of quoted heredocs (`<<'EOF'`).

Every error, missing field or non-Bash tool allows the call (exit 0, no output). Commands over 512,000 characters are allowed unchecked, so the scan stays inside the 5 s timeout. No network, no model call.

## What it blocks

| Command                           | Result                                  |
| --------------------------------- | --------------------------------------- |
| `for f in *(N); do echo $f; done` | Denied: zsh-only glob qualifier         |
| `rm -f $D/*.png`                  | Denied: suggests `"${D:?}"/*.png`       |
| `grep "[a-z$(]" file`             | Denied: unclosed `$(`                   |
| `grep -F '${size(x)}' file`       | Allowed: single quotes are not expanded |
| `ls \| xargs -n1 echo`            | Allowed                                 |

## What the agent sees

Every reason opens with `[bash-prompt-guard] ` and ends with `Fix: …`. For `for f in *(N); do echo $f; done`:

```text
[bash-prompt-guard] The command uses zsh-only syntax: a parameter flag `${(f)...}`, a modifier `${f:t}` or a glob qualifier `*(N)`. Claude Code parses commands as bash, so it cannot check this one and asks for confirmation ("Dangerous rm operation not ruled out"), even under bypass permissions, which stalls an unattended run. Fix: rewrite it in syntax bash also reads, for example `git diff --name-only --diff-filter=d | xargs pnpm exec eslint --fix` or `while IFS= read -r f; do ...; done < <(cmd)`. For a long sequence, write it to a script file and run `bash <script>` or `zsh <script>`.
```

## Install

Claude Code (2.1.292 or later), one command:

```bash
claude plugin install bash-prompt-guard --marketplace Adonis0123/adonis-skills
```

Claude Code only: the prompts it prevents come from Claude Code's permission check. There is no Codex manifest. (Codex can still install it from this marketplace and runs its hook, but that is not a supported setup.)

Requires `python3` on `PATH`. Supports macOS, Linux and WSL; native Windows is not supported.

## Configure

| Variable              | Meaning                      |
| --------------------- | ---------------------------- |
| `BASH_PROMPT_GUARD=0` | Turn the guard off entirely. |

## Turning it off

```bash
claude plugin disable bash-prompt-guard@adonis-skills
```

## Limitations

- It follows the prompts Claude Code showed in practice; a Claude Code release that parses more shapes may make a rule unnecessary, and new prompt shapes are not covered until a rule is added.
- It checks only the Bash tool in Claude Code. Other hosts' shell tools are not covered.
- A denied command is not run; the agent has to rewrite it.

## Tests

```bash
zsh plugins/bash-prompt-guard/tests/bash-prompt-guard.test.zsh   # needs python3 and jq
```
