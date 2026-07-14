---
name: review-prompt-composer
description: "Compose a copy-ready prompt or prompt-plus-attachments package for an external team or AI agent to independently review Git changes and run repository-defined checks. Use for committed ranges, staged changes, unstaged tracked changes, untracked files, or the entire uncommitted working tree. Support reviewers through a proven shared working tree, an accessible ref, an inline patch, or an automatically generated repository-external attachment package. Prompt generation only: do not use for same-repository review/fix/re-review loops or returned-feedback validation; use agentic-review-handoff for those. Never run tests, modify reviewed code, commit, stage, stash, push, or send the handoff."
metadata:
  author: adonis
  version: "1.3.0"
---

# Review Prompt Composer

把任意 Git 状态下的改动组装成可直接复制的审核提示词。接收方无法访问当前工作区且材料不适合内联时，自动生成仓库外附件包。不得仅因为改动尚未提交、存在未跟踪文件或 patch 太大而拒绝生成。

## 工作流

### 1. 锁定唯一审核范围

先运行以下只读命令：

```bash
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
```

将用户请求映射为一个严格范围：

| 用户语义 | 规范范围 | 包含 | 明确排除 |
|---|---|---|---|
| “当前改动”“本地改动”“全部未提交改动” | `all-uncommitted` | staged + unstaged tracked + untracked | 无 |
| “仅暂存” | `staged-only` | index 中的 staged changes | unstaged、untracked |
| “仅未暂存” | `unstaged-only` | tracked working tree 相对 index 的变化 | staged、untracked |
| “仅未跟踪” | `untracked-only` | `git ls-files --others --exclude-standard` 返回的文件 | staged、unstaged tracked |
| 分支或 commits | `ref-range` | 用户指定或确认的 ref 范围 | 范围之外的工作区状态 |

用户已经明确范围时直接采用，不要再让用户确认文件数量。不得把 untracked 自动并入 `unstaged-only`。若范围真的含糊且不同解释会改变内容，才询问用户。

需要基线时优先采用用户给出的 ref。未给出时，只能使用实际存在的 upstream 或仓库默认分支作为候选；候选会改变范围时先确认。将 ref 解析为真实 SHA，最终提示词不得保留 `<base>`、`<sha>` 等占位符。

### 2. 收集范围证据

| 范围 | 只读证据命令 |
|---|---|
| `all-uncommitted` | `git diff HEAD --stat`、`git diff HEAD --name-status`、`git diff HEAD --binary`，再收集 `git ls-files --others --exclude-standard` |
| `staged-only` | `git diff --cached --stat`、`git diff --cached --name-status`、`git diff --cached --binary` |
| `unstaged-only` | `git diff --stat`、`git diff --name-status`、`git diff --binary` |
| `untracked-only` | `git ls-files --others --exclude-standard`，逐个读取范围内文件；需要 patch 时使用 `git diff --no-index --binary -- /dev/null "$file"` |
| `ref-range` 分支 | `git log --oneline "$base".."$head"`、`git diff --find-renames "$base"..."$head" --stat`、完整 diff |
| `ref-range` commits | 对每个真实 SHA 运行 `git show --find-renames --stat "$sha"` 和完整 show |

`git diff --no-index` 发现差异时退出码为 1，这是正常结果。二进制、空文件、符号链接、文件模式变化等不能靠文字摘要代替，必须通过共享工作区、可访问 ref 或附件完整交付。

从本轮命令输出和文件内容建立逐项改动清单。每项至少包含仓库根相对路径、Git 状态和证据支持的具体变化。diff 很大时可按模块概括，但不得跳过 rename、delete、binary 或公开接口变化。

### 3. 先执行敏感信息门禁

在把 remote、diff、patch、附件、日志、路径或背景写入提示词或附件前，检查凭据、私钥、token、cookie、`.env` 内容、带认证信息的 URL、内部地址、个人数据及其他不应交给接收方的信息。

- 不输出疑似 secret 的原值；只报告受影响的仓库相对路径和风险类型。
- 不输出带用户名、密码或 token 的 remote URL。
- 能安全脱敏且不破坏审核时，用 `[REDACTED: reason]` 明示。
- 脱敏会破坏审核完整性时停止，要求用户选择安全交付方式。

附件脚本也会执行高置信度检查，但只是纵深防御，不能替代本步骤。

### 4. 选择接收方访问模式

按以下顺序选择一个真实可用的模式，不要询问用户是否允许保存大型附件：

1. **共享工作区**：仅当用户明确说明，或当前编排环境能证明接收方会访问同一个仓库根和工作区时使用。给出与严格范围匹配的只读命令。不能仅因接收方是“另一个 AI/agent”就假设共享。
2. **可访问 ref**：接收方能 fetch/checkout 且 ref 确实包含全部范围内容时使用。写入精确 base/head SHA。不得把本地 branch 当作远端可访问证据，也不得自行 push。
3. **内联 patch**：没有共享工作区或可访问 ref，全部材料均为可完整 patch 表示的文本，总内联载荷不超过 64 KiB，且已通过敏感信息门禁时使用。少量未跟踪文本可使用完整 `--no-index` patch；空文件、符号链接或无法完整表示的文件不能内联。
4. **附件包**：总内联载荷超过 64 KiB、包含二进制或不可完整 patch 表示的文件，或未跟踪材料不适合可靠内联时自动使用。无需请求保存许可。

没有共享证据时，默认生成可跨环境交付的内联材料或附件，而不是假设共享工作区。

### 5. 自动构建附件包

附件模式必须调用本 skill 的 `scripts/build_review_handoff.py`，不要手工拼接包。先定位当前 `SKILL.md` 所在目录，再运行：

```bash
python3 <skill-directory>/scripts/build_review_handoff.py \
  --repo "$repo" \
  --scope all-uncommitted \
  --check-command "pnpm test"
```

将 `--scope` 替换为步骤 1 得到的 `all-uncommitted`、`staged-only`、`unstaged-only` 或 `untracked-only`。每条可靠的仓库检查命令各传一次 `--check-command`；没有可靠命令时省略。默认输出到系统临时目录下的 `review-prompt-composer/`，也可用 `--output-dir` 指定一个尚不存在的仓库外目录。

脚本保证：

- 不修改 index、工作区、HEAD、`.gitignore`、`.git/info/exclude` 或仓库配置。
- `tracked.patch` 使用 binary-capable Git patch；范围包含未跟踪文件时生成 `untracked-files.tar.gz`。
- `unstaged-only` 遇到 partially staged 文件时额外生成 `prerequisite-staged.patch`，它只用于重建 unstaged patch 的基线，必须在提示词中标为“非审核范围”。
- `manifest.md` 记录 HEAD、严格范围、状态计数、SHA-256、应用顺序和检查命令。
- 检测到高置信度敏感材料时，在写出附件前失败，且不打印 secret 原值。

读取脚本输出的 JSON 和 `manifest.md`，将附件文件名、SHA-256、起始 HEAD 和应用顺序写进提示词。提示词外向用户列出附件的绝对本地路径，并提醒将整个目录与提示词一起交付。不得把仓库外本机绝对路径写给接收方；生成也不等于发送，仍不得自行外发。

`ref-range` 不使用该脚本：可访问 ref 直接提供精确命令；不可访问且需要跨环境交付时，根据实际范围生成等价的仓库外 patch 包，并遵守同一安全门禁。

### 6. 写出待验证目标

把核心断言写成需要审核方主动证伪的目标或不变量，而不是既定事实。

- 用户明确说明预期时，标为“用户声明的待验证目标”。
- 只能从 diff 推断且不同解释会改变审核重点时，先确认。
- 用户声明与证据冲突时先指出冲突，不把错误断言写入提示词。

示例：“用户声明的待验证目标：本次仅重构文件边界，不产生运行时行为变化；请主动寻找反例。”

### 7. 从仓库证据确定检查命令

读取适用的 `AGENTS.md`、仓库文档、包管理脚本和 CI 配置，找出与改动相关的 test、lint、typecheck 或 build 命令。保持包管理器和参数原样。

只记录命令，不替接收方运行，也不声称命令当前已通过。预期必须可核对，例如“退出码为 0、无失败用例”。需要凭据、服务或特定环境时列出前置条件。找不到可靠命令时说明查阅过的来源和证据不足，不凭记忆编造。

### 8. 生成固定结构

用实际值替换全部占位内容。按访问模式只保留一种获取方式。

    ````markdown
    # 审核任务：<仓库与改动的一句话定位>

    ## 背景与范围

    仓库：`<repo>`
    起始版本：`<实际 HEAD 或 base SHA>`
    审核范围：`<规范范围及明确排除项>`
    访问模式：`<共享工作区 / 可访问 ref / 内联 patch / 附件包>`
    改动动机：<1-3 句>

    **用户声明的待验证目标：<可证伪的不变量>。请主动寻找反例。**

    ## 获取待审改动

    <唯一可执行的工作区命令、ref 命令、完整内联 patch，或附件清单、SHA-256 与 manifest 应用顺序>

    ## 改动清单（N 项）

    1. **<改动主题>**：`<仓库根相对路径>` — <状态与证据支持的具体变化>
    2. ...

    ## 审核重点

    - <围绕待验证目标的反例检查>
    - <边界、回归和公开接口风险>

    ## 检查命令

    依次运行并贴出完整输出：

    ```bash
    <来自仓库文档、脚本或 CI 的精确命令>
    ```

    预期：<每条命令可核对的退出状态或结果；不要声称已在本地通过>。

    ## 输出要求

    1. 给出总体结论：通过 / 有保留通过 / 阻塞。
    2. 按严重程度列出发现，并附仓库根相对路径、行号或 diff hunk 证据。
    3. 对改动清单逐项标注核对结果。
    4. 列出每条检查命令的实际结果；未运行时说明原因。
    ````

没有可靠检查命令时可删除“检查命令”小节，但必须说明证据来源和无法确定的原因。附件模式必须明确 `prerequisite-staged.patch` 是否只是基线材料，避免接收方把 staged 内容误报为 `unstaged-only` finding。

### 9. 自包含检查

- [ ] 接收方能通过唯一获取方式取得完整审核范围。
- [ ] 范围和排除项严格，未把 untracked 混入 `unstaged-only`。
- [ ] partially staged 的 unstaged-only 基线依赖已交付且标为非审核范围。
- [ ] staged、unstaged、untracked、rename、delete、binary 状态均未遗漏。
- [ ] 每个事实、路径、SHA 和命令都有本轮证据。
- [ ] 没有引用本轮对话、不会交付的本机路径或未替换占位符。
- [ ] 待验证目标是可证伪声明，不是预设结论。
- [ ] 没有泄露 secret、凭据、私有数据或带凭据的 remote URL。

## 输出规则

默认在聊天中输出一个四反引号 Markdown 块，使内部代码块仍可整体复制。共享工作区、可访问 ref 和小型内联模式不写文件；大型、二进制或不可完整内联的跨环境改动自动生成仓库外附件包，不再次询问保存许可。

提示词后只补充交付动作：附件模式列出本地附件路径并提醒一起发送；审核结果回来后，可使用 `agentic-review-handoff` 验证反馈并跟进修复。

## Guardrails

- 只生成提示词和必要的仓库外附件；不运行被审核仓库的测试，不修改被审核代码，不 commit、stage、unstage、stash、push 或发送 handoff。
- staged、unstaged 和 untracked 都是一等范围；不得要求用户先提交、暂存、stash 或 push。
- 不得仅因 patch 超过 64 KiB、含二进制或含未跟踪文件而停止；跨环境自动构建附件。
- 不得为附件修改 ignore 文件或仓库配置；所有附件必须位于仓库外。
- 不把本地 branch/commit 当成外部可访问证据，也不把“另一个 agent”当成共享工作区证据。
- 不省略无法内联的改动；只有缺少安全交付方式时才停止并说明阻塞项。
- 不为填满模板而编造背景、命令、预期结果、文件变化或审核结论。
