---
name: review-prompt-composer
description: "Compose a self-contained, copy-ready prompt for an external team or AI agent to independently review a specific git change set and run repository-defined checks. Use when users want a portable review brief with context, an evidence-backed change inventory, exact change-access or inline-patch instructions, review focus, test commands, and required output. Prompt generation only: do not use for same-repository review/fix/re-review loops or returned-feedback validation; use agentic-review-handoff for those. Never run tests, modify reviewed code, push changes, or send the prompt."
metadata:
  author: adonis
  version: "1.1.0"
---

# Review Prompt Composer

把一组 Git 改动组装成一段自包含、可直接复制的审核提示词，交给外部团队或 AI agent 独立审核并运行仓库定义的检查。

假设接收方不共享本轮对话、当前工作区或 `.review-handoff/` 产物。先保证接收方能够取得待审代码，再生成改动清单、待验证目标、审核重点、测试命令和输出要求。对方无法取得改动时，停止生成不可执行的提示词并说明缺少什么。

## 工作流

### 1. 确定审核范围

先运行以下只读命令，确认仓库、分支、HEAD 和工作区状态：

```bash
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
```

明确用户要审核的唯一范围：工作区全部改动、仅已暂存改动、某分支相对基线的全量 diff，或特定 commits。不要把不同范围静默混在一起。

需要基线时优先采用用户明确给出的 ref。用户未给出时，只能把实际存在的 upstream 或仓库默认分支作为候选；若不同候选会改变审核范围，先请用户确认。解析为真实 ref 和 SHA 后再写入提示词，最终提示词不得保留 `<base>`、`<sha>` 等占位符。

### 2. 收集完整证据

根据范围运行对应命令。工作区可能同时包含已暂存、未暂存和未跟踪文件，必须分别收集，不能只选其中一种状态。

| 范围 | 证据命令 |
|---|---|
| 未暂存改动 | `git diff --stat` + `git diff --name-status` + `git diff` |
| 已暂存改动 | `git diff --cached --stat` + `git diff --cached --name-status` + `git diff --cached` |
| 未跟踪文件 | `git ls-files --others --exclude-standard`，再逐个读取文本文件；需要 patch 证据时运行 `git diff --no-index -- /dev/null "$file"` |
| 分支全量 diff | `git log --oneline "$base"..HEAD` + `git diff --find-renames "$base"...HEAD --stat` + `git diff --find-renames "$base"...HEAD` |
| 特定 commits | 对每个实际 SHA 运行 `git show --find-renames --stat "$sha"` + `git show --find-renames "$sha"` |

`git diff --no-index` 发现差异时退出码为 1，这是正常结果。二进制文件不能靠文本清单完成审核；记录路径和类型，并在改动获取方式中要求提供相应文件或可访问 ref。

逐项从本次命令输出和文件内容中建立改动清单。每项至少包含仓库根相对路径和可核对的具体变化；无法从证据中确认的内容不得写成事实。diff 很大时可以按模块概括，但不要跳过状态、重命名、删除或公开接口变化。

### 3. 通过改动获取门禁

为接收方选择一种真实可用的获取方式：

1. **可访问 ref**：接收方能访问包含全部改动的远端 branch 或 commits。写入精确的 base/head SHA 和 checkout/diff 命令。不要因为本地存在 branch 就假设它已推送；未经用户授权不得 push。
2. **内联 patch**：改动尚未形成可访问 ref，但文本 patch 体积适合复制且已通过敏感信息检查。把完整 patch 放入提示词，明确接收方应按 patch 审核；不要再要求接收方在新 clone 中运行看不到内容的 `git diff`。
3. **随附产物**：仅当用户确认会把指定 patch 或二进制文件一并交给接收方时使用。写入准确文件名、用途和校验值，不得引用只存在于本机且不会随提示词交付的路径。

如果三种方式都不成立，停止并向用户说明：当前改动不可被外部接收方访问，需要可访问 ref、可内联 patch，或明确会随附的产物。不要生成表面完整但无法执行的审核提示词。

### 4. 确定待验证目标

把核心断言写成**待验证目标或不变量**，而不是既定事实，要求审核方主动尝试证伪。

- 用户明确说明预期时，标注为“用户声明的待验证目标”，并检查它是否与 diff 明显冲突。
- 需要从 diff 推断且不同解释会改变审核重点时，先向用户确认。
- 发现用户声明与证据冲突时，先指出冲突，不要把错误断言直接放进提示词。

示例：“用户声明的待验证目标：本次仅重构文件边界，不产生运行时行为变化；请尝试找出任何反例。”

### 5. 从仓库证据确定检查命令

读取适用范围内的 `AGENTS.md`、仓库文档、包管理脚本和 CI 配置，找出与改动相关的测试、lint、typecheck 或 build 命令。优先采用仓库明确记录的命令，保持包管理器和参数原样。

不要替接收方运行这些命令，也不要声称它们当前已经通过。把预期写成可核对结果，例如“退出码为 0、无失败用例”；需要凭据、服务或特定环境时，明确列出前置条件。找不到可靠命令时说明证据不足，不要凭记忆编造。

### 6. 执行敏感信息门禁

在把 branch、remote、diff、patch、日志或背景写入提示词前，检查是否包含凭据、私钥、token、cookie、`.env` 内容、内部地址、个人数据或其他不应交给外部接收方的信息。

- 不输出疑似 secret 的原值来证明发现了它；只报告受影响的文件路径和风险类型。
- 不输出带用户名、密码或 token 的 remote URL。
- 可安全脱敏且不影响审核时，用 `[REDACTED: reason]` 明示脱敏位置。
- 脱敏会破坏审核完整性时停止生成，并让用户选择安全的交付方式。

### 7. 生成固定结构

使用以下结构，并用实际值替换全部占位内容。按获取方式保留“精确命令”或“完整 patch”之一；不要让接收方猜测如何取得改动。

    ````markdown
    # 审核任务：<仓库与改动的一句话定位>

    ## 背景与范围

    仓库：`<repo>`
    审核范围：`<实际 base/head SHA、commits 或 patch 范围>`
    改动动机：<1-3 句>

    **用户声明的待验证目标：<可证伪的不变量>。请主动寻找反例。**

    ## 获取待审改动

    <可直接复制的 checkout/diff 命令，或“以下 patch 即完整审核范围”的说明>

    ```diff
    <仅在使用内联 patch 时放入完整、已检查的 patch>
    ```

    ## 改动清单（N 项）

    1. **<改动主题>**：`<仓库根相对路径>` — <证据支持的具体变化>
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

没有可靠检查命令时可以删除“检查命令”小节，但必须说明查阅了哪些仓库来源以及为何无法确定命令。没有内联 patch 时删除空的 `diff` 代码块。

### 8. 自包含检查

输出前逐项检查，不满足就修正：

- [ ] 接收方能通过精确命令、内联 patch 或已确认随附的产物取得全部待审改动。
- [ ] 已覆盖范围内所有 staged、unstaged、untracked、rename、delete 和 binary 状态。
- [ ] 每个事实、路径、SHA 和命令都有本次读取到的证据。
- [ ] 没有引用本轮对话、`.review-handoff/` 或不会交付的本机路径。
- [ ] 没有未替换的占位符、模糊代词或需要接收方猜测的命令。
- [ ] 待验证目标被表述为需要主动证伪的声明，而不是预设结论。
- [ ] 没有泄露 secret、凭据、私有数据或带凭据的 remote URL。

## 输出规则

默认在聊天中输出一个用四个反引号包裹的 Markdown 块，使内部三反引号代码块仍可整体复制。仅当用户明确要求保存时才写文件。

提示词生成后只提醒用户：审核结果回来后，使用 `agentic-review-handoff` 验证反馈并跟进修复。

## Guardrails

- 只生成提示词；不运行被审核仓库的测试，不修改被审核代码，不 push，不发送提示词。
- 不把“本地 branch/commit 存在”当成“外部接收方可访问”的证据。
- 不省略无法传输的改动；缺少安全交付方式时停止并说明阻塞项。
- 不为填满模板而编造背景、命令、预期结果、文件变化或审核结论。
