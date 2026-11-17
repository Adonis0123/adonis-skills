[English](./README.md) | 中文

# reply-language

一个 Claude Code 和 Codex 用的 hook 插件。它让 agent 给用户看的回复保持你的语言。装上就生效。目标语言依次取 `REPLY_LANGUAGE`、Claude Code 的 `language` 设置、系统语言。

**首版只支持中文（`zh`）。** 目标语言是其他语言时，插件什么都不做。

## 遇到的场景

工具调用多、会话长时，agent 的回复会不知不觉变成英文。规则写明要中文也一样。作者实测，进度说明里英文一度占 25–32%。

## 为什么要用

- 回合结束时发现最终回复语言不对，让 agent 重写。
- 进度说明语言不对时提醒一次，早点拉回来。
- 代码、命令、路径和 URL 不计入。
- 满是术语的中文回复照样通过。

## 怎么做到的

- **Stop hook**：最终回复主要不是目标语言时，拦下一次结束。agent 重写后的重试会放行，所以每轮最多拦一次。别的 Stop hook 拦下后的重试照常判定。
- **PostToolUse hook**：最近一段进度说明不是目标语言时，往 agent 上下文里加一条提醒。它从不拦截，每段说明只判一次。提醒会晚一次工具调用才出现。回复要等工具调用跑完，才写进 transcript（会话记录）。它只认 Claude Code 的 transcript 格式，在 Codex 里什么都不做。

只统计正文。先去掉代码块、行内代码、URL 和路径。在剩下的文字里，满足任一条就判不合格：

1. 拉丁字母 ≥ 60（进度说明为 30），且拉丁字母 > 3 × 汉字数；
2. 仅 `zh`：假名（平假名、片假名）≥ 20（进度说明为 10），且假名 ≥ 0.5 × 汉字数。日文正文的假名比汉字多。中文回复引用一个日文词或一句日文，假名很少，会通过。

目标语言取下面第一个有值的来源，后面的来源不再读。取到的值不支持时，也不会往下找：

1. `REPLY_LANGUAGE`。设成 `off` 或 `none` 表示关闭。
2. Claude Code 的 `language` 设置。依次读 `<cwd>/.claude/settings.local.json`、`<cwd>/.claude/settings.json`、`${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json`。`cwd` 取自 hook 输入。设置值是自由文本，`简体中文`、`中文`、`Chinese`、`zh-CN` 都算 `zh`。读不了的文件会跳过。
3. 系统语言。macOS 取 `defaults read -g AppleLanguages` 的第一项。其他系统或读取失败时，取 `LC_ALL`、`LC_MESSAGES`、`LANG` 中第一个有值的。

任何异常、缺字段或回复太短都放行（exit 0、无输出）。不联网，不调用模型。

## 会拦什么

目标语言为中文时：

| 回复                                  | 结果           |
| ------------------------------------- | -------------- |
| 最终回复主要是英文                    | 拦一次结束     |
| 最终回复是日文                        | 拦一次结束     |
| 进度说明主要是英文                    | 提醒一次，不拦 |
| 带英文术语、代码、路径和 URL 的中文   | 放行           |
| 很短的回复（`OK, done. Tests pass.`） | 放行，太短不判 |

## 被拦下时 agent 会看到

最终回复被拦时：

```text
This reply is mostly not in Chinese. Rewrite it in Chinese (code, commands, paths and technical terms may stay as they are) before ending the turn, and write the rest of this turn's progress notes in Chinese too.
```

进度说明的提醒：

```text
The last progress note shown to the user was mostly not in Chinese. Write user-facing text in Chinese (code, commands, paths and technical terms may stay as they are), starting with the next sentence.
```

## 安装

Claude Code（2.1.292 及以上）一条命令：

```bash
claude plugin install reply-language --marketplace Adonis0123/adonis-skills
```

Codex：

```bash
codex plugin marketplace add Adonis0123/adonis-skills
codex plugin add reply-language@adonis-skills
```

Codex 默认跳过没信任的插件 hook。打开 Codex，运行 `/hooks`，信任这个插件的 hook。脚本改了之后要再确认一次。Codex 里只有 Stop 检查生效。

需要 `PATH` 里有 `python3`。支持 macOS、Linux 和 WSL，不支持原生 Windows。

## 配置

| 变量                         | 含义                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `REPLY_LANGUAGE`             | 目标语言 `zh`（`zh-CN`、`zh_CN` 也算）。优先于 `language` 设置和系统语言。`off` 或 `none` 关闭插件。 |
| `REPLY_LANGUAGE_CHECK_STATE` | 可选，每个会话的状态目录。默认 `$CLAUDE_PLUGIN_DATA`，没有则 `$TMPDIR/reply-language`。              |

多数人不用配置。Claude Code 的 `language` 设成 `简体中文`，或系统语言是中文，就够了。要显式指定，在启动 Claude Code 的环境里设置，或写进 `settings.json`：

```json
{
  "env": {
    "REPLY_LANGUAGE": "zh"
  }
}
```

### 新增语言

语言写在 `scripts/reply-language-check.py` 顶部的 `LANGUAGES` 表里，一行一个。每行有语言代码、英文名、本语言文字的正则，以及可选的「对手文字」。对手文字是和它共用字符的另一种语言，比如中文对日文假名。加一种语言就是加一行，再在 `tests/` 里补用例。`language` 设置里的自由文本靠 `CHINESE_NAMES` 映射，新语言的名称加在它旁边。阈值只用中文校准过。

## 停用

```bash
claude plugin disable reply-language@adonis-skills
```

只想在某个会话或项目里关掉，设 `REPLY_LANGUAGE=off`。

Codex 里运行 `codex plugin remove reply-language@adonis-skills`。也可以在 `~/.codex/config.toml` 的 `[plugins."reply-language@adonis-skills"]` 下写 `enabled = false`。

不支持 Cursor。

## 限制

- 启发式判断。两种文字都很少的回复（短回答、几乎全是代码）不判定。
- 很短的中文回复引用整句日文，可能被拦。大约是 40 个汉字以内配 20 个以上假名。把引用放进反引号或代码块即可，代码不计入。
- 怎么重写由 agent 决定。每轮最多拦一次，第二次语言不对的回复会直接结束回合。
- PostToolUse 提醒最多读 transcript 的最后 4 MB。
- 在 Codex 里也按同样顺序取语言，所以会读 Claude Code 的 `language` 设置。

## 测试

```bash
zsh plugins/reply-language/tests/reply-language-check.test.zsh   # 需要 python3 和 jq
```
