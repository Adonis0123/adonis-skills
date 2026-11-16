[English](./README.md) | 中文

# bash-prompt-guard

一个 Claude Code hook 插件，拒绝 Claude Code 权限检查解析不了的 Bash 命令。Claude Code 把每条 Bash 命令当 bash 解析；有几类写法会让检查弹确认框，bypass 模式下也弹，无人值守的会话（或后台 subagent）就一直等着没人点。直接拒绝代价更小：agent 马上拿到原因，改写命令重来。

## 拒绝哪些写法

| 写法                                           | 例子                                | 理由里给的改法                                                                               |
| ---------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| zsh 专用写法：参数展开标志、修饰符、通配限定符 | `${(f)"$(cmd)"}`、`${f:t}`、`*(N)`  | 改成 bash 也能读的写法（`xargs`、`while IFS= read -r f; do …; done < <(cmd)`）或写成脚本文件 |
| `rm` / `rmdir` 和多行内联脚本在同一条命令里    | `rm -rf a; bash -c '<换行>…'`       | 删除单独一次调用，目标写字面量路径                                                           |
| Claude Code 当作关键路径的 `rm` 目标           | `rm -f $D/*.png`、`rm -rf "$(cmd)"` | 写成 `"${D:?}"/*.png`；命令替换先单独跑，再删它打印出的路径                                  |
| 没配对的 `$(`                                  | `grep "[a-z$(]"`                    | 用单引号，或在双引号里写 `\$(`                                                               |
| bash 不认识的 `${`                             | `grep "frame ${size(x)}"`           | 单引号加 `grep -F '…'`，或写 `\${`                                                           |

shell 不展开的文字不检查：单引号字符串、反斜杠转义、注释，以及带引号 heredoc（`<<'EOF'`）的正文。每条拒绝理由都以 `[bash-prompt-guard] ` 开头，以 `Fix: …` 给出改法。

任何异常、缺字段或非 Bash 工具都放行（exit 0、无输出）。超过 512,000 字符的命令不检查直接放行，保证扫描在 5 秒超时内完成。不联网，不调用模型。

## 安装

```text
/plugin marketplace add Adonis0123/adonis-skills
/plugin install bash-prompt-guard@adonis-skills
```

需要 `PATH` 里有 `python3`。

## 配置

| 变量                  | 含义           |
| --------------------- | -------------- |
| `BASH_PROMPT_GUARD=0` | 完全关闭检查。 |

也可以在 `/plugin` 里停用插件。

## 限制

- 规则来自 Claude Code 实际弹过的确认框；新版 Claude Code 能解析更多写法后，个别规则可能不再需要，新出现的弹框写法要加规则才覆盖。
- 只检查 Claude Code 的 Bash 工具，不管其他宿主的 shell 工具。
- 被拒的命令不会执行，需要 agent 改写。

## 测试

```bash
zsh plugins/bash-prompt-guard/tests/bash-prompt-guard.test.zsh   # 需要 python3 和 jq
```
