---
name: weekly-report
description: Generate structured weekly reports from Git commit history across one or multiple repositories. Use when you need concise, project-grouped progress summaries for status reporting.
metadata:
  author: adonis
  version: "1.1.2"
---

# 周报生成技能

自动读取 Git 提交记录，按项目分组生成结构化本地周报草稿。

## 快速路径

- 复用用户本轮或 `~/.weekly-reports/config.json` 中已明确给出的日期、仓库、作者、保存路径与格式，避免对已知参数重复确认；仅在缺失且无法从当前仓库或配置可靠得出时询问。
- 未指定日期时默认取 `UTC+08:00` 本周一至今天（与 `src/date_utils.py` 一致），并在标题中标明具体范围；用户指定其他时区时先按该时区换算首末时刻，避免直接套用 `+08:00` 边界。
- 提交记录查询为只读操作，优先直接执行脚本或等价 `git log` 提取真实记录；若目标路径已有草稿，先读取再合并，以免丢失手工补充、待确认状态与“下周计划”。
- 默认仅写入本地草稿（不自动执行 `git commit`、`git push` 或对外发送），因为修改仓库历史或向外部发送汇报需要用户明确授权。

## 功能特性

- 自动读取本地及远端跟踪分支的 Git 提交记录（原生支持 Git worktree）
- 支持多仓库汇总并自动识别当前作者（`git config user.name` / `user.email`）
- 过滤琐碎提交并按项目分组合并条目
- 合并写入 `~/.weekly-reports/` 时保留已有手工备注与“下周计划”

## 使用方式

### 基本用法

在任意 Git 项目目录中执行，或直接用自然语言要求生成周报：

```
/weekly-report
```

- `/weekly-report` 可直接在 Claude Code、Antigravity（`agy`）、Grok 与 Cursor 中使用；在 Codex 中使用 `$weekly-report`；在 Hermes、WorkBuddy、pi 等宿主中也支持对应的技能触发方式。
- Frontmatter 故意不声明 Claude Code 专属的 `allowed-tools`（如 `Read`、`Write`、`Bash(...)`），以免在 Antigravity、Codex、Cursor 等宿主里触发权限解析差异。各宿主直接使用自身原生工具完成流程即可（例如在 `agy` 中通过 `read_file` 读配置与旧草稿、`run_command` 运行分析脚本或只读 `git` 查询、`write_file`/`edit_file` 写入本地草稿）。

### 执行流程

1. **确定时间范围**
   - 本周（如 `2026-01-06 ~ 2026-01-12`）
   - 上周（如 `2025-12-30 ~ 2026-01-05`）
   - 前半年（如 `2025-07-13 ~ 2026-01-13`）
   - 自定义周报（输入周一日期）或自定义时间段（输入起始日期，截止到今天）
   - 在输出中写明实际采用的日期范围；用户已指明“本周”“上周”或具体日期时直接换算继续。

2. **确定仓库范围**
   - 优先使用用户本轮指定的仓库；否则读取 `~/.weekly-reports/config.json` 的 `repos`，或用 `git rev-parse --show-toplevel` 解析当前工作区根目录（支持 Git worktree）。
   - 仅当配置中存在多仓库且当前上下文不足以确定范围时，列出已配置仓库供多选或确认是否纳入当前目录。

3. **纳入补充工作（可选）**
   - 用户已提供会议、技术分享等非代码工作时归入 `其他`；未提供则直接生成，不暂停等待。

4. **提取提交并保存草稿**
   - 读取所有本地与远端跟踪分支的真实提交并过滤琐碎改动。
   - 若目标草稿已存在，先读取原文件内容后再合并写入，保留原有手工说明与下周计划。
   - 周报保存为 `~/.weekly-reports/{year}/week-{week:02d}.md`（例如 `2026/week-02.md`，ISO 周数两位补零，末尾附“下周计划”）。
   - 时间段报告保存为 `~/.weekly-reports/periods/{start_date}_to_{end_date}.md`（跨周汇总，不附“下周计划”）。

## Git 提交读取

优先调用本技能自带的只读分析器 `src/git_analyzer.py`（支持 CLI 直接运行，也支持导入 `get_all_commits_from_repos`），以保持跨仓库、时区与作者边界规则一致：

```bash
python3 <skill-dir>/src/git_analyzer.py --start "$START_DATE" --end "$END_DATE"
# 需要显式指定仓库或作者正则时可追加：--repo /path/to/repo --author "$AUTHOR_PATTERN"
```

未传 `--repo` 或 `--author` 时，脚本会读取 `~/.weekly-reports/config.json` 中的 `repos` 与 `default_author`（缺失配置时回退当前目录与自动识别）；省略 `--start`/`--end` 时默认取 `UTC+08:00` 本周一至今天。

无法运行该脚本而手动执行 `git log` 时，沿用同一只读合同：

```bash
AUTHOR_PATTERN='(^your-name <|<your@email\.com>)'
git log --all \
  --extended-regexp \
  --author="$AUTHOR_PATTERN" \
  --since-as-filter="${START_DATE}T00:00:00+08:00" \
  --until="${END_DATE}T23:59:59+08:00" \
  --no-show-signature -z \
  --format='%H%x00%s%x00%an%x00%cI'
```

这些参数的设计原因如下（修改或手动执行时保留相同语义）：

- **`--all`**：覆盖未切出的本地分支与 `remotes/origin/*` 远端跟踪分支，以免只看当前分支漏掉已推送或分支上的开发工作。如果 `git branch -a` 看不到目标远端分支，本地尚无对应跟踪引用，可在用户同意且联网时先 `git fetch --all --prune`。
- **`--since-as-filter` 与显式 `+08:00` 首末时刻**：完整遍历可达提交后再按时间过滤，防止提交时间倒序时提前剪枝漏掉范围内祖先提交（大型仓库会稍慢，用于保证结果完整）；显式指定 `00:00:00+08:00` 到 `23:59:59+08:00` 避免仅传日期时继承当前时钟或受宿主 shell 时区影响。
- **转义且带边界的作者匹配**：`author=None`（或 `default_author: "auto"`）时会对每个仓库的 `git config user.name` / `user.email` 转义正则元字符并限定 `^name <` 或 `<email>` 边界，避免部分匹配到机器人账号或邮箱前缀相同的其他同事；身份双项缺失或出现不同路径同名目录时脚本会直接报错停止，以免默默拉取全员记录或静默覆盖同名项目。显式传入 `author` 时保留自定义扩展正则语义。
- **`-z` 与 `%x00` 固定四字段**：用 NUL 分隔字段，避免 commit 标题含 `|` 等符号时解析错位。
- **核查边界**：Git 命令失败、仓库不可访问或作者未知属于 `UNVERIFIED`，不等同于“本周没有提交”；只有查询成功且结果为空时才报告无记录。提交记录只证明代码变更，不自动证明已上线、已验收或业务收益，这类结论只写用户提供或本轮核实的证据。

## 输出格式

一级标题写明日期范围，方便按周归档并区分周报与跨周时间段总结；正文按项目分组，项目名顶格占一行，工作条目使用两空格缩进（子说明用四空格缩进），便于与 `src/storage.py` 合并草稿时的结构保持一致。

### 周报格式

```text
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

时间段报告不追加“下周计划”（非单周维度）：

```text
# 工作总结 (2025-07-13 ~ 2026-01-13)

项目名称
  - 主要工作点（一个具体结果，保留关键术语）
    - 补充说明（可选）
  - 另一个工作点

其他
  - 不属于特定项目的工作内容
```

### “下周计划”模板规则

周报正文生成完毕后，在末尾追加“下周计划”区块：

1. 标题行固定写 `下周计划`（不加 `#` 前缀，与项目名同级，方便 `src/storage.py` 拆分正文与计划）。
2. 按正文出现的项目顺序列出项目名（不含“其他”）。
3. 用户未提供下周计划时，每个项目名空一行后放单个 `-` 作占位符（防止 Markdown 解析器将紧接项目名的 `-` 当成二级标题下划线吞掉占位符）；用户已提供计划时直接用两空格缩进列表写入对应项目下。

### 示例输出

```text
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

-

project-backend

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

## 总结与过滤原则

### 编写原则

- **事实导向**：只写有提交记录或用户说明支撑的工作，避免由代码改动推断出未证实的上线或收益结论。
- **简洁精炼**：每条表达一个具体结果，保留关键技术术语，不为凑字数截断核心行为。
- **突出重点**：过滤琐碎修改并合并关联提交，避免低信号变更稀释主要交付。
- **项目与层级清晰**：按项目归类，用两空格与四空格缩进体现主从关系。

### 过滤规则

以下提交不单独列出（纯格式化或重复改动会掩盖真实交付；大规模重构等例外可按具体成果归纳）：

- 纯格式化/代码风格调整（`format`、`lint`、`style:`）
- 简单的 typo 修复（`fix typo`、`typo`）与 `update readme/changelog`
- `wip` 过程提交与 `merge branch` / `merge pull request`
- 依赖版本小幅更新及重复性的相似提交

详细归纳与合并示例见 [周报格式规范](references/WEEKLY_REPORT_FORMAT.md)。

修改提取或保存逻辑后运行回归测试，确认边界与存储合并未退化：

```bash
python3 <skill-dir>/scripts/test_git_analyzer.py
```
