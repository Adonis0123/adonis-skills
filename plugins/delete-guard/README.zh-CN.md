[English](./README.md) | 中文

# delete-guard

一个 Claude Code 和 Codex 用的 hook 插件。它拦下会让文件找不回的删除命令，并让 agent 改用废纸篓。

## 遇到的场景

agent 开着全权限时，一条 `rm -rf` 删错目录，文件就找不回了。开全权限，是为了让它别停下来问。删进废纸篓的文件还能恢复。

## 为什么要用

- 递归删除和丢弃改动的 git 命令，在执行前就被拦下。
- 拒绝理由会给出本机能用的废纸篓命令。
- agent 可以照着重做这一步。
- 临时目录里的删除照常放行，不影响日常清理。

它只防误删，不是沙箱。`eval` 一个变量，或用 Python、Node 一行脚本删文件，照样会执行。其他读不出来的写法也一样。

## 为什么自己做

[cc-safety-net](https://github.com/kenryu42/cc-safety-net) 做的事类似，但有两处不够：

- 它的 Paranoid 档也放行 `find . -name "*.bak" -exec rm {} \;`。delete-guard 会拦下。
- 它的拒绝提示是固定英文，没法提示改用 trash。delete-guard 按系统给出 `trash`、`trash-put` 或 `gio trash`。

## 怎么做到的

`Bash` 工具的 `PreToolUse` hook 会在每条命令执行前运行 `scripts/delete-guard.py`。脚本按 shell 的规则拆开命令，逐段检查：

- 按 `;` `&&` `||` `|` `&` 和换行拆分命令。
- `$(...)`、反引号、不带引号的 heredoc 正文也会检查。
- 传给 `bash -c` / `sh -c` / `zsh -c` / `eval` 的字符串同样检查。
- 相对路径按命令可能所在的每个目录解析，包括 `cd X && …`、`env -C`、`sudo -D`。
- 递归删除的目标都在临时目录里才放行。
- 临时目录指 `/tmp`、`/private/tmp`、`/var/folders`、`/private/var/folders` 和 `$TMPDIR`。
- 解析不出的目标算在临时目录外，比如变量、花括号展开、`xargs` 输入。

任何异常、缺字段或非 shell 工具都放行（exit 0、无输出）。只用标准库，不联网，不调用模型。

## 会拦什么

| 命令                                  | 结果                       |
| ------------------------------------- | -------------------------- |
| `rm -rf src/old`                      | 拦下，提示用废纸篓命令     |
| `find . -name "*.bak" -exec rm {} \;` | 拦下，提示用废纸篓命令     |
| `git reset --hard`、`git clean -fd`   | 拦下，提示先 `git stash`   |
| `rm -rf /tmp/build`                   | 放行，目标在临时目录       |
| `trash src/old`、`rm a.txt`           | 放行，可恢复或不是递归删除 |

以下也会拦：

- 各种写法的递归 `rm`：`-R`、`--recursive`、`/bin/rm`、`sudo rm`、`xargs rm -r`。
- `find -delete`。
- `git checkout -- <路径>`、`git checkout .`。
- 不带 `--staged` 的 `git restore`。
- `git stash drop`、`git stash clear`。

## 被拦下时 agent 会看到

每条理由都以 `[delete-guard] ` 开头。在 macOS 上执行 `rm -rf src/old` 时：

```text
[delete-guard] 这条命令会递归删除临时目录以外的路径（src/old），删了找不回。改用 `trash <路径>`，删进废纸篓可找回。（目前只为 macOS 和 Linux（含 WSL）给出替代命令，其他系统欢迎提 PR：https://github.com/Adonis0123/adonis-skills）
```

建议的命令随系统变化：

| 系统             | 建议                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| macOS            | `trash <路径>`（新版 macOS 自带）                                           |
| Linux（含 WSL）  | 有 `trash-put`（trash-cli）用 `trash-put <路径>`，否则用 `gio trash <路径>` |
| 找不到废纸篓命令 | 改用 `mv <路径> /tmp/` 移到临时目录，或请用户自己删                         |

git 命令的理由是：先用 `git stash` 保存改动，或请用户确认。

## 安装

Claude Code（2.1.292 及以上）一条命令：

```bash
claude plugin install delete-guard --marketplace Adonis0123/adonis-skills
```

Codex：

```bash
codex plugin marketplace add Adonis0123/adonis-skills
codex plugin add delete-guard@adonis-skills
```

Codex 默认跳过没信任的插件 hook。打开 Codex，运行 `/hooks`，信任 delete-guard 的 hook。脚本改了之后要再确认一次。

需要 `PATH` 里有 `python3`。支持 macOS、Linux 和 WSL，不支持原生 Windows。

## 配置

| 变量             | 含义           |
| ---------------- | -------------- |
| `DELETE_GUARD=0` | 完全关闭检查。 |

## 停用

```bash
claude plugin disable delete-guard@adonis-skills
```

Codex 里运行 `codex plugin remove delete-guard@adonis-skills`。也可以在 `~/.codex/config.toml` 的 `[plugins."delete-guard@adonis-skills"]` 下写 `enabled = false`。

## 限制

- 它只静态读命令。藏在 `eval` 变量或其他语言一行脚本里的删除照样执行。
- 只检查 shell 工具，不管其他工具改文件。
- 被拒的命令不会执行，需要 agent 换个做法。

## 测试

```bash
zsh plugins/delete-guard/tests/delete-guard.test.zsh   # 需要 python3 和 jq
```
