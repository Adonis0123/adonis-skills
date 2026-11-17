[English](./README.md) | 中文

# completion-claim-check

一个 Claude Code 和 Codex 用的 hook 插件。agent 说“已完成”却拿不出证据时，拦它一次。

## 遇到的场景

agent 说“已完成”，回复里却没有任何验证证据。它没写跑了哪些命令、结果如何，也没标出哪些没验证。

## 为什么要用

- 回合一结束就能发现没核实的“已完成”。
- agent 多一次机会补上命令和结果。
- 没验证的部分，它可以标成 `UNVERIFIED`。
- 每轮最多拦一次，不会来回打转。

## 怎么做到的

agent 要结束回合时，`Stop` hook 运行 `scripts/completion-claim-check.sh`。下面几条都满足才拦：

1. 本轮还没被 Stop hook 拦过（`stop_hook_active` 未设置）。
2. 当前目录是 git 工作区，且有未提交改动（`git status --porcelain`）。
3. 最后一条回复声称完成，比如 `已完成`、`改完`、`已修复`、`搞定`、`done`、`fixed`、`all set`。`未完成`、`not done yet` 这类否定说法不算。
4. 回复里没有证据。证据词包括 `验证`、`测试`、`test`、`pytest`、`pnpm`、`PASS`、`FAIL`、`UNVERIFIED`、`exit code`，或一个代码块。

脚本按输入字段自动识别宿主。Claude Code 和 Codex 用 snake_case 字段，Grok Build 用 camelCase。脚本两种都读。旧 hook 文件传的 `--agent claude|codex|grok` 仍然兼容。

任何异常都放行（exit 0、无输出）。`git status` 超过 3 秒就放弃。不联网，不调用模型。

## 会拦什么

| 回复和工作区                                | 结果         |
| ------------------------------------------- | ------------ |
| `已完成修改。`，有未提交改动                | 拦一次       |
| `All done, the bug is fixed.`，有未提交改动 | 拦一次       |
| `Done. Ran pnpm test: all green`            | 放行，有证据 |
| `改完了，浏览器部分 UNVERIFIED`             | 放行，已标注 |
| 工作区干净时说 `已完成`，或回复 `还未完成`  | 放行         |

## 被拦下时 agent 会看到

```text
你说已完成，但工作区有未提交改动，回复里没有验证证据。补上验证命令和结果，或把没验证的项标成 UNVERIFIED。
```

在 Codex 里，这段理由会作为续写提示，agent 会再回复一次。

## 安装

Claude Code（2.1.292 及以上）一条命令：

```bash
claude plugin install completion-claim-check --marketplace Adonis0123/adonis-skills
```

Codex：

```bash
codex plugin marketplace add Adonis0123/adonis-skills
codex plugin add completion-claim-check@adonis-skills
```

Codex 默认跳过没信任的插件 hook。打开 Codex，运行 `/hooks`，信任这个插件的 hook。脚本改了之后要再确认一次。

需要 `PATH` 里有 `sh`、`jq` 和 `git`。有 `perl` 时用它给 `git status` 限时。缺 `jq` 或 `git` 时 hook 什么都不做。支持 macOS、Linux 和 WSL，不支持原生 Windows。

## 配置

| 变量                             | 含义                                      |
| -------------------------------- | ----------------------------------------- |
| `COMPLETION_CHECK=0`             | 完全关闭检查。                            |
| `COMPLETION_CHECK_GIT_TIMEOUT=3` | `git status` 超过这么多秒就放弃，并放行。 |

## 停用

```bash
claude plugin disable completion-claim-check@adonis-skills
```

Codex 里运行 `codex plugin remove completion-claim-check@adonis-skills`。也可以在 `~/.codex/config.toml` 的 `[plugins."completion-claim-check@adonis-skills"]` 下写 `enabled = false`。

## 限制

- 靠关键词判断。换个说法声称完成或给证据，可能判错。
- 不在 git 仓库里，或工作区干净时，从不拦。
- 只检查有没有提到证据，不检查证据真假。

## 测试

```bash
zsh plugins/completion-claim-check/tests/completion-claim-check.test.zsh   # 需要 sh、jq 和 git
```
