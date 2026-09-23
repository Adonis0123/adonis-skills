---
name: commit
description: Generate read-only emoji-prefixed Conventional Commit messages or create focused local commits from staged changes or a clear user-authorized unstaged scope.
metadata:
  author: adonis
---

# Commit

这个 skill 的产出是一次范围正确的本地提交（或一条只读生成的消息）。三件事决定成败：选对变更集、消息符合 emoji + Conventional Commits、报告与 Git 实际结果一致。不 push。

## 1. 先分流模式

- **message-only**：用户只要生成、推荐或改写 commit message。只读 `git status`、`git diff --cached`、`git diff` 和必要文件；不 `git add`、不 `git commit`、不改 `.gitignore` 或其他工作树/index。默认分析 staged changes；用户点名另一组 unstaged/untracked 变更时只分析该范围，并说明 staged 内容被排除。范围不唯一时只说明需要选哪组。
- **execute-commit**：用户明确要求提交。才进入下面的 stage、Ignore vs Commit 和 commit 流程。

## 2. 确定提交范围（execute-commit）

第一次探测合并成一次调用：

```bash
git status --short --branch && git diff --cached --stat
```

按顺序判断：

| 状态                                        | 做法                                                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有 staged，用户没点名别的范围               | 只提交 staged。unstaged 不自动加入，报告里提醒仍未提交的文件。                                                                                                                     |
| 有 staged，但用户授权的是另一组路径         | 停下报告范围错位。不提交已有 staged，不 stage 新范围，不替用户 unstage；请用户选择或拆分 index。                                                                                   |
| 无 staged，只有一个 unstaged/untracked 文件 | 看该文件 diff 或内容，无敏感风险就 `git add -- <path>` 后继续，不要求用户再跑一次。                                                                                                |
| 无 staged，多个文件                         | 用户点名的范围，或本会话刚完成、目的单一且能从 diff 核对的变更集，就是提交范围，不需要用户再说“全部提交”。无法归属的既有修改先排除；范围仍不唯一才询问，不凭同目录推断同属本任务。 |
| 什么都没有                                  | 告诉用户没有可提交内容。                                                                                                                                                           |

用户要求拆成多个提交时，每个提交各自用明确路径 stage，逐个完成下面的流程。

### stage 边界

- 只用 `git add -- <path...>`。把 `git status` 的全部条目批量喂给 `git add`（如 `--pathspec-from-file`）等同 `git add -A`，同样跳过了逐项分类；除非用户明确要求提交全部变更，否则不用。
- 路径名或 diff 像 `.env`、credential、token、cookie、private key、secret、证书或私密数据时，停下请用户确认。
- 变更混有多个无关目的时，停下询问是否拆分。
- **Ignore vs Commit**：候选里有 `??` untracked、依赖/构建/缓存/OS 噪音或疑似密钥时，先读 `references/ignore-vs-commit.md` 再分类；该忽略的补 `.gitignore` 且不 stage，已跟踪的密钥停下上报。候选全是已跟踪的源码/文档改动时不用读它。
- 忽略不能静默：凡跳过 stage、改了 `.gitignore`、或因 ignore 规则没纳入的路径，当轮告诉用户路径/pattern、原因、做了什么。

## 3. 写提交信息

用 `git diff --cached` 看已确定范围的内容，再写消息：

1. 用户给了消息就原样使用。
2. 仓库有自己的提交约定（`commitlint` 配置、`CONTRIBUTING`、`AGENTS.md`/`CLAUDE.md` 中的规定）时服从仓库。
3. 否则用 `emoji type(scope): subject`。emoji 只能取下表对应项，并由你写进消息；不要依赖 hook 自动补 emoji，没有这类 hook 的仓库会留下格式不一的历史。

| type     | emoji | 用于                       |
| -------- | ----- | -------------------------- |
| feat     | ✨    | 新功能                     |
| fix      | 🐛    | Bug 修复                   |
| docs     | 📝    | 仅文档                     |
| style    | 🎨    | 不改语义的格式调整         |
| refactor | ♻️    | 非新功能、非修复的代码调整 |
| perf     | ⚡️    | 性能                       |
| test     | ✅    | 测试                       |
| build    | 🏗️    | 构建系统或依赖             |
| ci       | 👷    | CI 配置和脚本              |
| chore    | 🔧    | 其他杂项（配置、同步等）   |

- header ≤ 250 字符；scope 可选，取模块、功能或目录名；subject 用祈使句、首字母小写、不加句号。
- body 可选，写“为什么”，每行 ≤ 300 字符。例：`🐛 fix(payment): handle zero-amount refunds`。

## 4. 提交与核对

- 提交前完成仓库要求的、与改动相关的验证。纯文档通常只查格式、链接或生成索引；代码或配置有影响时才加 lint、类型检查和测试。本会话对同一内容已通过的结果可以复用；内容变了或仓库要求重跑就重跑。
- 用 HEREDOC 提交，保留 hooks：

```bash
git commit -m "$(cat <<'EOF'
✨ feat(auth): add user login feature
EOF
)"
```

- 不用 `--no-verify` 或 `HUSKY=0`，除非用户明确要求。
- hook 失败时提交没有生成：修根因，重新 stage，再建一个新提交（不是 `--amend`）；没成功就不报告成功。
- 修复边界：修复是机械的才直接做——hook 输出已写明改法，或是格式化/lint autofix，且改动不改变代码行为和文字含义（如删一个 hook 点名的标记）。直接修了也要在报告里写明改了哪一行、为什么。修复需要判断（改逻辑、改文案、删用户的实质内容、动提交范围外的文件）时，先报告 hook 输出和拟定改法，等用户确认；这时提交仍未生成，照实说。
- hook 可能改写文件（如 lint-staged 格式化）。如果改写了已提交路径，重跑受影响的聚焦验证。
- 提交后一次核对，报告以这次输出为准（hook 可能改写了 subject）：

```bash
git status --short --branch && git log -1 --format='%h %s'
```

## 5. 报告

给出：提交 hash 和实际 subject、跑过的检查、仍未提交的文件，以及本次 Ignore vs Commit 处理过的路径（忽略了什么、为什么、是否改了 `.gitignore`）。
