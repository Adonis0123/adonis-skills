---
name: commit
description: Generate emoji-prefixed Conventional Commit messages and focused local commits from staged changes or a single clear unstaged change.
metadata:
  author: adonis
---

# Commit Message Generator

根据明确的 Git 提交范围自动生成符合 Conventional Commits 规范的提交信息，并自动添加对应的 emoji 前缀。

## 使用场景

- 用户执行 `/commit` 命令，希望生成或执行一次聚焦的本地提交
- 用户请求生成提交信息
- 用户需要帮助编写符合规范的 commit message

## 工作流程

### 1. 检查 Git 状态和提交范围

执行：

```bash
git status --short --branch
```

先判断这次提交的来源：

- 如果已经有 staged changes，只分析和提交 staged changes。不要把 unstaged changes 自动加入提交；最终报告里提醒仍有未提交文件即可。
- 如果没有 staged changes，但只有一个明确的 unstaged 或 untracked 文件，且路径/内容没有明显敏感信息风险，先检查该文件变更，再自动执行 `git add -- <path>`，然后继续生成提交信息和提交。
- 如果没有 staged changes，且存在多个 unstaged/untracked 文件，只有在用户明确说“全部提交”或明确点名文件时才 stage 对应路径。否则停止并列出最小的 `git add -- <path>` 建议，让用户选择提交范围。
- 如果既没有 staged changes，也没有 unstaged/untracked changes，告诉用户当前没有可提交内容。

自动 stage 前必须遵守这些边界：

- 使用 `git add -- <path>` 或多个明确路径；不要用裸 `git add .`、`git add -A`，除非用户明确要求提交全部变更。
- 对单个 unstaged 文件，先用 `git diff -- <path>` 或必要的文件读取确认变更意图。对 untracked 文件，先确认文件名和内容类型合理。
- 如果文件名或 diff 暗示 `.env`、credential、token、cookie、private key、secret、证书、账号私密数据等敏感信息，停止并请用户确认，不要自动 stage 或提交。
- 如果变更看起来包含多个无关目的，停止并询问是否拆分提交。
- **Ignore vs Commit 门禁**（对每个候选路径，尤其 `??` untracked）：该忽略的先写进 `.gitignore` 再跳过 stage；该提交的才 `git add -- <path>`。细则见 `references/ignore-vs-commit.md`。
- **忽略必须说明**：凡跳过 stage、写入/修改 `.gitignore`、或因 ignore 规则未纳入本次提交的路径，不得静默处理。须在当轮明确告诉用户：路径/pattern、原因、做了什么（未 stage / 已改 `.gitignore` 等）。多条可按原因分组列表；无忽略则不必多写。

### 2. 分析代码变更

执行 `git diff --cached --stat` 和 `git diff --cached` 获取已确定提交范围的差异，分析变更内容：

- 识别变更的文件类型和位置
- 理解变更的目的（新功能、修复、重构等）
- 确定影响范围（scope）

### 3. 生成提交信息

根据分析结果生成符合规范的提交信息。

**消息格式：**
```
type(scope): subject
```

**允许的类型和对应 emoji：**

| 类型 | Emoji | 说明 | 示例 |
|------|-------|------|------|
| feat | ✨ | 新功能 | `✨ feat: add user authentication` |
| fix | 🐛 | Bug 修复 | `🐛 fix: resolve login timeout` |
| docs | 📝 | 文档变更 | `📝 docs: update API documentation` |
| style | 🎨 | 代码风格 | `🎨 style: format code with prettier` |
| refactor | ♻️ | 代码重构 | `♻️ refactor: extract common utils` |
| perf | ⚡️ | 性能优化 | `⚡️ perf: optimize database queries` |
| test | ✅ | 测试相关 | `✅ test: add unit tests for auth` |
| build | 🏗️ | 构建系统 | `🏗️ build: update webpack config` |
| ci | 👷 | CI 配置 | `👷 ci: add GitHub Actions workflow` |
| chore | 🔧 | 其他变更 | `🔧 chore: update dependencies` |

### 4. 执行提交

如果用户只要求“生成 commit message”，只输出候选消息，不执行提交。

如果用户要求执行提交，使用 HEREDOC 格式执行 git commit：

```bash
git commit -m "$(cat <<'EOF'
✨ feat(auth): add user login feature
EOF
)"
```

提交后执行：

```bash
git status --short --branch
git log -1 --oneline
```

向用户报告提交 hash、提交信息、已执行的检查、仍然未提交的文件，以及本次 **Ignore vs Commit** 处理过的路径（忽略了什么、为何忽略、是否改了 `.gitignore`）。

## 提交信息编写规则

### Header 规则

- 格式：`emoji type(scope): subject`
- Header 最大长度：250 字符
- type 必须是允许的类型之一
- scope 可选，表示影响范围
- subject 使用祈使句，首字母小写，不加句号

### 类型选择指南

- **feat**: 添加新功能或新特性
- **fix**: 修复 bug 或问题
- **docs**: 仅文档变更（README、注释等）
- **style**: 不影响代码含义的变更（格式化、空格等）
- **refactor**: 既不是新功能也不是修复的代码变更
- **perf**: 提升性能的代码变更
- **test**: 添加或修改测试
- **build**: 影响构建系统或外部依赖的变更
- **ci**: CI 配置文件和脚本的变更
- **chore**: 其他不修改 src 或 test 文件的变更

### Scope 建议

根据项目结构选择合适的 scope：

- 按模块：`auth`、`api`、`ui`、`db`
- 按功能：`login`、`payment`、`search`
- 按目录：`components`、`hooks`、`utils`

## 注意事项

- 不要提交包含敏感信息的文件（.env、credentials 等）；缺 ignore 规则时先补 `.gitignore`
- 提交前确保代码通过 lint 和类型检查
- 一次提交只做一件事，保持提交的原子性
- 提交信息要准确反映变更内容，关注"为什么"而非"做了什么"

## 参考资源

详细的提交规范和项目配置，参考：
- **`references/ignore-vs-commit.md`** - 忽略 vs 提交门禁（`.gitignore` 与 stage 决策）
- **`references/commit-convention.md`** - 完整的提交规范文档
- **`references/commit-examples.md`** - 提交信息示例
