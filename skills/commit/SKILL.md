---
name: commit
description: Generate conventional commit messages with emoji prefixes from staged changes. Use when you need to draft, refine, or execute standardized commit messages quickly.
metadata:
  author: adonis
---

# Commit Message Generator

根据暂存的代码变更自动生成符合 Conventional Commits 规范的提交信息，并自动添加对应的 emoji 前缀。

## 使用场景

- 用户执行 `/commit` 命令
- 用户请求生成提交信息
- 用户需要帮助编写符合规范的 commit message

## 工作流程

### 1. 检查暂存状态

执行 `git status` 查看当前暂存的文件变更。如果没有暂存的文件，提示用户先使用 `git add` 添加文件。

### 2. 分析代码变更

执行 `git diff --cached` 获取暂存的代码差异，分析变更内容：

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

使用 HEREDOC 格式执行 git commit：

```bash
git commit -m "$(cat <<'EOF'
✨ feat(auth): add user login feature
EOF
)"
```

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

- 不要提交包含敏感信息的文件（.env、credentials 等）
- 提交前确保代码通过 lint 和类型检查
- 一次提交只做一件事，保持提交的原子性
- 提交信息要准确反映变更内容，关注"为什么"而非"做了什么"

## 参考资源

详细的提交规范和项目配置，参考：
- **`references/commit-convention.md`** - 完整的提交规范文档
- **`references/commit-examples.md`** - 提交信息示例
