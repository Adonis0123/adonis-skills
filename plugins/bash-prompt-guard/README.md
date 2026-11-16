English | [中文](./README.zh-CN.md)

# bash-prompt-guard

A Claude Code hook plugin that denies Bash commands Claude Code's permission check cannot parse. Claude Code reads every Bash command as bash; a few shapes make that check ask for confirmation even under bypass permissions, and an unattended session (or a background subagent) then waits on a prompt nobody answers. Denying is cheaper: the agent gets the reason at once and rewrites the command.

## What it denies

| Shape                                                            | Example                             | Fix the reason suggests                                                                      |
| ---------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| zsh-only syntax: parameter flags, modifiers, glob qualifiers     | `${(f)"$(cmd)"}`, `${f:t}`, `*(N)`  | bash-readable syntax (`xargs`, `while IFS= read -r f; do …; done < <(cmd)`) or a script file |
| `rm` / `rmdir` in the same command as a multi-line inline script | `rm -rf a; bash -c '<newline>…'`    | run the removal as its own call with literal paths                                           |
| `rm` targets Claude Code treats as critical paths                | `rm -f $D/*.png`, `rm -rf "$(cmd)"` | `"${D:?}"/*.png`; run the substitution first, then remove the literal path                   |
| A `$(` that never closes                                         | `grep "[a-z$(]"`                    | single quotes, or `\$(` inside double quotes                                                 |
| A `${` bash does not read as a parameter expansion               | `grep "frame ${size(x)}"`           | `grep -F '…'` with single quotes, or `\${`                                                   |

Text the shell does not expand is ignored: single-quoted strings, backslash escapes, comments and the bodies of quoted heredocs (`<<'EOF'`). Every deny reason opens with `[bash-prompt-guard] ` and ends with `Fix: …`.

Every error, missing field or non-Bash tool allows the call (exit 0, no output). Commands over 512,000 characters are allowed unchecked, so the scan stays inside the 5 s timeout. No network, no model call.

## Install

```text
/plugin marketplace add Adonis0123/adonis-skills
/plugin install bash-prompt-guard@adonis-skills
```

Requires `python3` on `PATH`.

## Configure

| Variable              | Meaning                      |
| --------------------- | ---------------------------- |
| `BASH_PROMPT_GUARD=0` | Turn the guard off entirely. |

You can also disable the plugin with `/plugin`.

## Limitations

- It follows the prompts Claude Code showed in practice; a Claude Code release that parses more shapes may make a rule unnecessary, and new prompt shapes are not covered until a rule is added.
- It checks only the Bash tool in Claude Code. Other hosts' shell tools are not covered.
- A denied command is not run; the agent has to rewrite it.

## Tests

```bash
zsh plugins/bash-prompt-guard/tests/bash-prompt-guard.test.zsh   # needs python3 and jq
```
