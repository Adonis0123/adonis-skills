# Commit Convention 完整规范

> 说明：下述工具链与版本为示例配置（来自当前项目），请在其他项目中按实际技术栈与规范要求调整。

本项目使用 Conventional Commits 规范，配合 Husky 和 Commitlint 进行自动化校验。

## 工具链

| 工具 | 版本 | 用途 |
|------|------|------|
| husky | ^9.1.7 | Git hooks 管理 |
| lint-staged | ^15.2.10 | 暂存文件检查 |
| @commitlint/cli | ^19.8.1 | 提交消息格式校验 |
| @jannajs/lint | 3.1.3 | 提交消息 emoji 自动添加 |
| @jannajs/git-guards | ^0.0.8 | 合并守卫 |

## 提交消息格式

```
[emoji] type(scope): subject

body

footer
```

### Header 解析正则

```javascript
/^(?:([^\w\s]{1,2})\s+)?(\w+)(?:\((.*)\))?: (.*)$/
```

### 规则限制

- `header-max-length`: 250 字符
- `body-max-line-length`: 300 字符

## Emoji 映射表

| 类型 | Emoji | Unicode | 示例 |
|------|-------|---------|------|
| feat | ✨ | U+2728 | `✨ feat: add new feature` |
| fix | 🐛 | U+1F41B | `🐛 fix: resolve bug` |
| docs | 📝 | U+1F4DD | `📝 docs: update readme` |
| style | 🎨 | U+1F3A8 | `🎨 style: format code` |
| refactor | ♻️ | U+267B | `♻️ refactor: optimize structure` |
| perf | ⚡️ | U+26A1 | `⚡️ perf: improve performance` |
| test | ✅ | U+2705 | `✅ test: add unit tests` |
| build | 🏗️ | U+1F3D7 | `🏗️ build: update dependencies` |
| ci | 👷 | U+1F477 | `👷 ci: update workflows` |
| chore | 🔧 | U+1F527 | `🔧 chore: update configs` |

## Emoji 自动处理逻辑

`@jannajs/lint emojify` 会自动处理 emoji：

1. 如果消息已有正确 emoji，保持不变
2. 如果消息有错误 emoji，自动替换为正确的
3. 如果消息没有 emoji，自动添加

## 合并守卫规则

`@jannajs/git-guards merge` 检测并阻止不规范的合并：

- **黑名单检查**: 禁止从 `test`、`origin/test` 分支合并
- **当前分支检查**: 禁止创建当前分支的合并提交

**合并消息解析规则**:
```javascript
/Merge branch '(.+?)'/i
/Merge remote-tracking branch '(.+?)'/i
```

## Pre-commit 钩子

提交前会执行以下检查：

1. **lint-staged** - 对暂存文件执行:
   - `prettier --write --ignore-unknown` - 代码格式化
   - `eslint --flag unstable_ts_config --fix` - ESLint 检查

2. **typecheck:preview** - TypeScript 类型检查
   - 运行 `tsgo --noEmit` 进行快速类型校验

## 跳过钩子

```bash
# 临时跳过（不推荐）
HUSKY=0 git commit -m "message"

# 或使用 --no-verify
git commit --no-verify -m "message"
```
