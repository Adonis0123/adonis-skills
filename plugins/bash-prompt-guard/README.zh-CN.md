[English](./README.md) | 中文

# bash-prompt-guard

一个 Claude Code hook 插件。它拒绝 Claude Code 权限检查解析不了的 Bash 命令。这样无人值守的会话不会卡在确认框上。

## 遇到的场景

无人值守的会话或后台 subagent，会卡在 Bash 确认框上干等。Claude Code 把每条 Bash 命令当 bash 解析。有几类写法会让权限检查弹确认框。bypass 模式下也照样弹，可没人去点。

## 为什么要用

- 直接拒绝比干等代价小。
- agent 马上拿到原因，改写命令重来。
- 每条理由都用 `Fix: …` 给出改法。
- 夜里跑的任务和后台任务不会停住。

## 怎么做到的

`Bash` 工具的 `PreToolUse` hook 会在每条命令执行前运行 `scripts/bash-prompt-guard.py`，按下表检查写法。

| 写法                                                              | 例子                                | 理由里给的改法                                                                               |
| ----------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| zsh 专用写法：参数展开标志、修饰符、通配限定符                    | `${(f)"$(cmd)"}`、`${f:t}`、`*(N)`  | 改成 bash 也能读的写法（`xargs`、`while IFS= read -r f; do …; done < <(cmd)`）或写成脚本文件 |
| `rm` / `rmdir` 和多行内联脚本在同一条命令里                       | `rm -rf a; bash -c '<换行>…'`       | 删除单独一次调用，目标写字面量路径                                                           |
| Claude Code 当作关键路径的 `rm` 目标                              | `rm -f $D/*.png`、`rm -rf "$(cmd)"` | 写成 `"${D:?}"/*.png`；命令替换先单独跑，再删它打印出的路径                                  |
| 没配对的 `$(`                                                     | `grep "[a-z$(]"`                    | 用单引号，或在双引号里写 `\$(`                                                               |
| bash 不认识的 `${`                                                | `grep "frame ${size(x)}"`           | 单引号加 `grep -F '…'`，或写 `\${`                                                           |
| `$(...)` 里在 `&&`、`\|\|`、`;`、`\|` 或换行后接 `( … )` 子 shell | `c=$(a \|\| (b && c))`              | 改用 `{ …; }`（`$(a \|\| { b && c; })`），或拆成几条命令                                     |

shell 不展开的文字不检查：单引号字符串、反斜杠转义、注释，以及带引号 heredoc（`<<'EOF'`）的正文。

任何异常、缺字段或非 Bash 工具都放行（exit 0、无输出）。超过 512,000 字符的命令不检查直接放行，保证扫描在 5 秒超时内完成。不联网，不调用模型。

## 会拦什么

| 命令                              | 结果                            |
| --------------------------------- | ------------------------------- |
| `for f in *(N); do echo $f; done` | 拦下，zsh 专用的通配限定符      |
| `rm -f $D/*.png`                  | 拦下，提示写成 `"${D:?}"/*.png` |
| `grep "[a-z$(]" file`             | 拦下，`$(` 没配对               |
| `grep -F '${size(x)}' file`       | 放行，单引号里不展开            |
| `ls \| xargs -n1 echo`            | 放行                            |

## 被拦下时 agent 会看到

每条理由以 `[bash-prompt-guard] ` 开头，以 `Fix: …` 结尾。执行 `for f in *(N); do echo $f; done` 时：

```text
[bash-prompt-guard] The command uses zsh-only syntax: a parameter flag `${(f)...}`, a modifier `${f:t}` or a glob qualifier `*(N)`. Claude Code parses commands as bash, so it cannot check this one and asks for confirmation ("Dangerous rm operation not ruled out"), even under bypass permissions, which stalls an unattended run. Fix: rewrite it in syntax bash also reads, for example `git diff --name-only --diff-filter=d | xargs pnpm exec eslint --fix` or `while IFS= read -r f; do ...; done < <(cmd)`. For a long sequence, write it to a script file and run `bash <script>` or `zsh <script>`.
```

## 安装

Claude Code（2.1.292 及以上）一条命令：

```bash
claude plugin install bash-prompt-guard --marketplace Adonis0123/adonis-skills
```

只支持 Claude Code。它防的确认框来自 Claude Code 的权限检查，所以没有 Codex 清单。Codex 仍能从这个 marketplace 装上它并运行 hook，但这不是支持的用法。

需要 `PATH` 里有 `python3`。支持 macOS、Linux 和 WSL，不支持原生 Windows。

## 配置

| 变量                  | 含义           |
| --------------------- | -------------- |
| `BASH_PROMPT_GUARD=0` | 完全关闭检查。 |

## 停用

```bash
claude plugin disable bash-prompt-guard@adonis-skills
```

## 限制

- 规则来自 Claude Code 实际弹过的确认框。新版 Claude Code 能解析更多写法后，个别规则可能不再需要。新出现的弹框写法要加规则才覆盖。
- 只检查 Claude Code 的 Bash 工具，不管其他宿主的 shell 工具。
- 被拒的命令不会执行，需要 agent 改写。

## 测试

```bash
zsh plugins/bash-prompt-guard/tests/bash-prompt-guard.test.zsh   # 需要 python3 和 jq
```
