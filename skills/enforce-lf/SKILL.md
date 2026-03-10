---
name: enforce-lf
description: "Enforce consistent LF line endings across platforms with a four-layer guard: .gitattributes, .editorconfig, Prettier endOfLine, and lint-staged pre-commit formatting. Targets pnpm + Prettier + simple-git-hooks projects."
metadata:
  author: adonis
  version: "1.0.0"
---

# Enforce LF Line Endings

在 pnpm + Prettier + simple-git-hooks 项目中一键部署四层跨平台 LF 行尾守卫，确保 Windows/macOS/Linux 协作时行尾始终为 LF。

## 四层守卫概览

| 层级 | 文件 | 作用 | 触发时机 |
|------|------|------|----------|
| 1 | `.gitattributes` | Git 层：checkout/commit 时强制 LF | `git checkout` / `git add` |
| 2 | `.editorconfig` | 编辑器层：新建/保存文件时使用 LF | 文件编辑 |
| 3 | `.prettierrc.json` | 格式化层：`prettier --write` 时转换为 LF | 手动或自动格式化 |
| 4 | `package.json` (lint-staged + simple-git-hooks) | 提交层：pre-commit 钩子自动格式化 | `git commit` |

## 适用范围

- 使用 **pnpm** 作为包管理器的项目
- 已有或即将使用 **Prettier** 的项目
- 已有或即将使用 **simple-git-hooks** 的项目
- 支持 monorepo（Turborepo / pnpm workspaces）和单体项目

## 执行流程

### 1. 前置检查

在项目根目录确认以下条件：

- 存在 `package.json`
- 使用 pnpm（存在 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`）
- 如果条件不满足，告知用户此 skill 的适用范围，询问是否继续

### 2. 自动检测项目参数

从现有代码推断以下变量，用于配置模板：

- **indent_size**: 检查现有 `.editorconfig`、`.prettierrc.json` 或 `package.json` 中的 `tabWidth`，默认 `2`
- **lint-staged glob**: 扫描项目中的文件类型，构建 glob 模式，默认 `*.{ts,tsx,js,mjs,jsx,json,css,md}`
- **现有 pre-commit 命令**: 读取 `package.json` 中 `simple-git-hooks.pre-commit`，用于后续合并

### 3. 配置四层守卫

#### 层 1：`.gitattributes`

**目标内容**（追加到文件顶部）：

```
# Force LF line endings for all text files
* text=auto eol=lf
```

**合并策略**：
- 读取现有 `.gitattributes`（如果存在）
- 检查是否已包含 `* text=auto eol=lf`，已有则跳过
- 没有则在文件顶部追加上述两行 + 空行分隔

#### 层 2：`.editorconfig`

**目标内容**：

```ini
root = true

[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
indent_style = space
indent_size = {indent_size}
trim_trailing_whitespace = true
```

**合并策略**：
- 如果不存在 `.editorconfig`，直接创建
- 如果已存在，读取内容：
  - 确保 `[*]` section 包含 `end_of_line = lf`
  - 保留已有的其他设置（`indent_size`、`indent_style` 等）
  - 仅补充缺失的字段，不覆盖已有值

#### 层 3：`.prettierrc.json`

**目标内容**（合并到现有配置）：

```json
{
  "endOfLine": "lf"
}
```

**合并策略**：
- 读取项目根目录 `.prettierrc.json`（如果存在），合并 `"endOfLine": "lf"`，保留其他字段
- 如果不存在，创建仅含 `endOfLine` 的配置文件
- **monorepo 子目录**：检查 `apps/*/` 和 `packages/*/` 下是否有独立的 `.prettierrc.json`，同样合并 `endOfLine`
- 如果项目使用 `.prettierrc`（YAML 格式）或 `prettier.config.js` 等其他格式，告知用户手动添加 `endOfLine: "lf"` 配置

#### 层 4：`package.json`（lint-staged + simple-git-hooks）

**目标配置**（合并到根 `package.json`）：

```json
{
  "devDependencies": {
    "lint-staged": "^16.3.2",
    "prettier": "^3.8.1",
    "simple-git-hooks": "^2.13.1"
  },
  "simple-git-hooks": {
    "pre-commit": "pnpm lint-staged && {existing_pre_commit_commands}"
  },
  "lint-staged": {
    "{lint_staged_glob}": "prettier --write --end-of-line lf"
  }
}
```

**合并策略**：
- **devDependencies**: 仅添加缺失的依赖，不覆盖已有版本
- **simple-git-hooks.pre-commit**:
  - 如果已有 pre-commit 命令，将 `pnpm lint-staged` 追加到前面（用 `&&` 连接）
  - 如果已包含 `lint-staged`，不重复添加
  - 如果不存在 `simple-git-hooks` 字段，创建完整配置
- **lint-staged**:
  - 如果已存在 lint-staged 配置，合并 prettier 规则
  - 如果已有 prettier 规则，确保包含 `--end-of-line lf` 参数
- **限制**：此 skill 仅处理 `package.json` 内的 lint-staged 配置，不处理独立的 `.lintstagedrc` 文件。如果检测到独立配置文件，告知用户手动迁移

### 4. 安装依赖并激活 hooks

```bash
pnpm install
pnpm exec simple-git-hooks
```

`pnpm install` 会自动安装新增的 devDependencies。`simple-git-hooks` 命令将 `package.json` 中的 hook 配置写入 `.git/hooks/`。

### 5. 验证清单

逐项检查以下内容并向用户报告结果：

1. `.gitattributes` 包含 `* text=auto eol=lf`
2. `.editorconfig` 的 `[*]` section 包含 `end_of_line = lf`
3. `.prettierrc.json` 包含 `"endOfLine": "lf"`
4. `package.json` 中 `lint-staged` 配置的 prettier 命令包含 `--end-of-line lf`
5. `package.json` 中 `simple-git-hooks.pre-commit` 包含 `lint-staged`
6. `.git/hooks/pre-commit` 文件存在且可执行

可选的端到端测试：

```bash
# 创建一个测试文件，验证 pre-commit hook 能正常触发
echo "test" > /tmp/lf-test.txt && git add /tmp/lf-test.txt 2>/dev/null
git commit --allow-empty -m "test: verify pre-commit hook"
```

## 注意事项

- 首次配置后，建议运行 `prettier --write --end-of-line lf .` 对全仓库做一次格式化，统一存量文件
- 如果项目已有 Husky 而非 simple-git-hooks，此 skill 不适用，需手动适配
- 对于二进制文件（图片、字体等），`.gitattributes` 的 `text=auto` 会自动识别并跳过
