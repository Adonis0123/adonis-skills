---
name: weekly-report
description: Generate structured weekly reports from Git commit history across one or multiple repositories. Use when you need concise, project-grouped progress summaries for status reporting.
allowed-tools: Read, Write, Bash(git:*), Bash(python:*)
metadata:
  author: adonis
  version: "1.1.0"
---

# 周报生成技能

自动读取 Git 提交记录，按项目分组生成结构化周报。

## 快速路径

先复用用户本轮或已有配置中明确给出的日期、仓库、作者、保存位置和格式。已给定的值不再逐项确认；只在缺失且无法从当前仓库/配置可靠得出时询问。未指定日期时采用本周一至今天，报告中写明具体范围。日期统一使用 UTC+08:00，与日期工具一致；用户指定其他时区时先按该时区明确边界，不套用默认命令。

只读取所选仓库与日期范围。默认仅生成本地草稿；已有报告先读取并合并，保留手工补充和下周计划。提交、推送或对外发送仍须对应授权。

## 功能特性

- 自动读取 Git 提交记录
- 支持多仓库汇总
- 自动识别当前用户 (`git config user.name`)
- 按项目分组，生成结构化周报
- 过滤琐碎提交（typo、merge、format 等）
- 支持添加补充说明
- 周报统一存储在 `~/.weekly-reports/` 目录

## 使用方式

### 基本用法

在任意 Git 项目目录中执行：

```
/weekly-report
```

### 执行流程

1. **选择时间范围**
   - 本周 (显示具体日期，如 2026-01-06 ~ 2026-01-12)
   - 上周 (显示具体日期，如 2025-12-30 ~ 2026-01-05)
   - 前半年 (显示具体日期，如 2025-07-13 ~ 2026-01-13)
   - 自定义周报（输入周一日期）
   - 自定义时间段（输入起始日期，截止到今天）

   显示实际采用的日期范围。用户已指定“本周”“上周”或具体日期时直接换算并继续，不重复询问。

2. **选择仓库**（如已配置多仓库）
   - 用户未指定仓库且当前仓库不足以确定范围时，再显示已配置的仓库列表
   - 可多选要包含的仓库
   - 可添加当前目录为新仓库

3. **添加补充内容**（可选）
   - 使用用户已给出的额外工作内容；没有补充也可直接生成，不等待填写
   - 如：参与会议、技术分享等

4. **生成周报**
   - 读取选定仓库的 Git 提交（必须覆盖所有分支/远端跟踪分支，避免漏提交）
   - 按项目分组
   - 过滤琐碎提交
   - 生成 Markdown 格式周报
   - 在周报正文末尾自动追加"下周计划"模板（详见输出格式）
   - 周报保存到 `~/.weekly-reports/{year}/week-{week}.md`
   - 时间段报告保存到 `~/.weekly-reports/periods/{start_date}_to_{end_date}.md`

## Git 提交读取（重要）

优先调用本技能的 `src/git_analyzer.py`，其 `get_all_commits_from_repos` 接收仓库列表、开始日期、结束日期和可选作者正则。它覆盖本地及远端跟踪分支，支持 Git worktree，按 UTC+08:00 的提交时间选取整日并返回结构化记录。`author=None` 会按每个仓库的 Git name/email 自动匹配；身份缺失或仓库同名时必须报告，不能默默读取全员或覆盖某个仓库的结果。

手动读取时遵守相同合同：

```bash
# 关键点：
# - 用 --all 覆盖所有本地 refs（包含 remotes/origin/*）
# - 指定首末日时刻与时区，避免继承当前时刻或混入下一天
# - 作者联合正则需要 --extended-regexp；真实 name/email 先转义
# - NUL 分隔固定四字段，不能按 | 拆分含管道符的提交标题

AUTHOR_PATTERN="(your-name|your@email.com)"  # 或仅用你的 name/email
git log --all \
  --extended-regexp \
  --author="$AUTHOR_PATTERN" \
  --since="${START_DATE}T00:00:00+08:00" \
  --until="${END_DATE}T23:59:59+08:00" \
  --no-show-signature -z \
  --format='%H%x00%s%x00%an%x00%cI'
```

如果 `git branch -a` 看不到目标远端分支（说明本地没有对应的远端跟踪引用），需要先 `git fetch --all --prune`（在用户同意且网络可用时执行），否则无法读取到“本地不存在的分支”的提交。

Git 命令失败、仓库不可访问或作者未知属于 `UNVERIFIED`，不等于“本周没有提交”。只有成功查询且结果确实为空才能报告无记录。提交记录证明代码变更，不自动证明已上线、已验收或产生业务收益；这些状态只写用户提供或本轮核实的证据。

## 输出格式

周报采用层级列表结构，**必须包含日期范围标题**，按项目分组：

### 周报格式

```markdown
# 周报 (2026-01-06 ~ 2026-01-12)

项目名称

- 主要工作点（一个具体结果，保留关键术语）
  - 补充说明（可选）
- 另一个工作点

其他

- 不属于特定项目的工作内容

下周计划
项目名称

-
```

### 时间段报告格式

时间段报告**不追加**"下周计划"模板（因为不是周维度）。

```markdown
# 工作总结 (2025-07-13 ~ 2026-01-13)

项目名称

- 主要工作点（一个具体结果，保留关键术语）
  - 补充说明（可选）
- 另一个工作点

其他

- 不属于特定项目的工作内容
```

### "下周计划"模板规则

周报正文生成完毕后，在末尾追加"下周计划"区块：

1. 标题行固定为 `下周计划`（无 `#` 前缀，与项目名同级）
2. 从本周周报正文中提取所有出现过的项目名（不含"其他"），按原顺序列出
3. 每个项目名下放一行 `-` 作为占位符，方便用户后续填写
4. 如果用户在交互中主动提供了下周计划内容，直接填入对应项目下，不再使用占位符

### 示例输出

```markdown
# 周报 (2026-01-06 ~ 2026-01-12)

project-frontend

- 构建工具升级改造
- 核心功能开发流程跟进
  - 方案合理性优化
- 脚本国际化优化

project-backend

- 自定义类型化消息渲染
- 断线重连流程梳理

其他

- 新版国际化方案讨论

下周计划
project-frontend

- project-backend
-
```

## 配置文件

配置文件位于 `~/.weekly-reports/config.json`：

```json
{
  "repos": [
    {
      "name": "project-a",
      "path": "/home/user/projects/project-a"
    },
    {
      "name": "project-b",
      "path": "/home/user/projects/project-b"
    }
  ],
  "default_author": "auto",
  "output_format": "markdown"
}
```

## 总结原则

### 必须遵守

- **事实导向**：只总结实际完成的工作
- **简洁精炼**：每点表达一个具体结果，不为凑字数截断术语或删掉关键行为
- **重点突出**：过滤琐碎修改
- **按项目分组**：相同项目的工作归类
- **层级清晰**：用缩进表示从属关系

### 过滤规则

以下提交不会单独列出：

- 纯格式化/代码风格调整
- 简单的 typo 修复
- 依赖版本小幅更新
- Merge 提交
- 重复性的相似提交

详细格式规范见 [周报格式规范](references/WEEKLY_REPORT_FORMAT.md)

修改提取或保存逻辑后运行：

```bash
python3 <skill-dir>/scripts/test_git_analyzer.py
```
