[English](./README.md) | 中文

# reply-language

一个 Claude Code hook 插件，让 agent 给用户看的回复保持你设定的语言。工具调用多、轮次长的时候，回复常常不知不觉变成英文；本插件在回合结束时发现这种情况，让 agent 把回复重写一遍。

**首版只支持中文（`zh`）。** `REPLY_LANGUAGE` 设成其他值时，插件什么都不做。

## 做什么

- **Stop hook**：最终回复主要不是目标语言时，拦下一次结束，理由类似 "This reply is mostly not in Chinese. Rewrite it in Chinese (code, commands, paths and technical terms may stay as they are)…"。agent 重写后的重试会放行，所以每轮最多拦一次。别的 Stop hook 拦下后的重试照常判定。
- **PostToolUse hook**：用户已经看到的最近一段进度说明主要不是目标语言时，往 agent 上下文里加一条提醒。它从不拦截，每段说明只判一次。提醒会晚一次工具调用才出现，因为一条回复要等它的工具调用跑完才写进 transcript（会话记录）。

只统计正文。先去掉代码块、行内代码、URL 和路径，所以满是命令和文件名的中文回复也能通过。在剩下的文字里，满足任一条就判不合格：

1. 拉丁字母 ≥ 60（进度说明为 30），且拉丁字母 > 3 × 汉字数；
2. 仅 `zh`：假名（平假名、片假名）≥ 20（进度说明为 10），且假名 ≥ 0.5 × 汉字数。日文正文的假名比汉字多；中文回复里引用一个日文词或一句日文，假名只有几个，汉字很多，会通过。

任何异常、缺字段或回复太短都放行（exit 0、无输出）。不联网，不调用模型。

## 安装

```text
/plugin marketplace add Adonis0123/adonis-skills
/plugin install reply-language@adonis-skills
```

需要 `PATH` 里有 `python3`。

## 配置

| 变量                         | 含义                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `REPLY_LANGUAGE`             | 目标语言。`zh`（`zh-CN`、`zh_CN` 也算）。未设置或不支持：插件什么都不做。不读 Claude Code 的 `language` 设置。 |
| `REPLY_LANGUAGE_CHECK_STATE` | 可选，每个会话的状态目录。默认 `$CLAUDE_PLUGIN_DATA`，没有则 `$TMPDIR/reply-language`。                        |

在启动 Claude Code 的环境里设置 `REPLY_LANGUAGE`，或写进 `settings.json`：

```json
{
  "env": {
    "REPLY_LANGUAGE": "zh"
  }
}
```

关掉插件：取消 `REPLY_LANGUAGE`，或在 `/plugin` 里停用。

### 新增语言

语言写在 `scripts/reply-language-check.py` 顶部的 `LANGUAGES` 表里，一行一个：语言代码、英文名、本语言文字的正则，以及可选的「对手文字」（另一种语言和它共用字符时用来区分，比如中文对日文假名）。加一种语言就是加一行，再在 `tests/` 里补用例。阈值只用中文校准过。

## Codex（手动接线）

Codex 的 Stop hook 收到的字段相同（`last_assistant_message`、`stop_hook_active`、`session_id`），所以 Stop 检查在 Codex 里也能用。克隆本仓库后，在 `~/.codex/hooks.json` 里加一条 Stop：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "REPLY_LANGUAGE=zh python3 /path/to/adonis-skills/plugins/reply-language/scripts/reply-language-check.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- 如果你的 Codex 版本把 hook 放在功能开关后面，在 `~/.codex/config.toml` 里打开（`[features]` 下 `hooks = true`）。新 hook 第一次运行前，Codex 可能要你确认信任。
- 只接 Stop。PostToolUse 提醒读的是 Claude Code 的 transcript 格式。
- 没有 `CLAUDE_PLUGIN_DATA` 时，状态写到 `$TMPDIR/reply-language`。

不支持 Cursor。

## 限制

- 规则是启发式的：两种文字都很少的回复（很短的回答、几乎全是代码）不判定。
- 很短的中文回复里整句引用日文，可能被拦（汉字少于约 40 个、假名 20 个以上）。把引文放进反引号或代码块即可，代码不参与统计。
- 怎么重写由 agent 决定；插件每轮最多拦一次，第二次仍不合格的回复会直接结束本轮。
- PostToolUse 提醒最多读 transcript 末尾 4 MB。

## 测试

```bash
zsh plugins/reply-language/tests/reply-language-check.test.zsh   # 需要 python3 和 jq
```
