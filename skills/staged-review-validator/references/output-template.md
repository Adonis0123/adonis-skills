# Output Template

## 最小输入模板（用户先粘贴）

```markdown
## 暂存变更审查报告

### Issue 1
- 标题: [ruleId] 问题标题
- 规则: ruleId — 规则描述
- 文件: path/to/file.ext:line
- 严重度: CRITICAL | HIGH | MEDIUM | LOW
- 问题描述: ...
- 原建议: ...
- 指纹: {ruleId}:{file}:{line}
```

如果用户没有给出上述信息，先提示补充，再开始复核。

**兼容说明**: 如果输入来自 v1 格式（使用"风险级别"和"置信度"而非"严重度"和"ruleId"），仍然接受，但在输出中统一转换为新格式。

---

## 固定输出模板（复核结果）

```markdown
## 复核结果总览
- 问题总数: <N>
- 成立: <N>
- 不成立: <N>
- 待确认: <N>
- 建议修改: <N>

## 逐条裁决

### 1. [ruleId] <问题标题>
- 规则: ruleId — 规则描述
- 文件位置: `<path>:<line>`
- 严重度: CRITICAL | HIGH | MEDIUM | LOW
- 裁决: <成立/不成立/待确认>
- 是否需要修改: <是/否/待补充>
- 证据:
  - <命令或代码定位证据 1>
  - <命令或代码定位证据 2>
- 最小改动建议:
  - <建议 1>
  - <建议 2>
- 指纹: `{ruleId}:{file}:{line}`

## 下一步
1. <下一步 1>
2. <下一步 2>
```

## 示例

```markdown
### 2. [SEC-003] SQL 字符串拼接风险
- 规则: SEC-003 — SQL queries built via string concatenation
- 文件位置: `src/db/query.ts:87`
- 严重度: HIGH
- 裁决: 成立
- 是否需要修改: 是
- 证据:
  - `git diff --cached -- src/db/query.ts` 显示第 87 行使用模板字符串拼接 SQL
  - `grep -n "query.*\${"  src/db/query.ts` 确认存在动态插值
- 最小改动建议:
  - 使用参数化查询替代字符串拼接
  - 改用 `db.query("SELECT * FROM users WHERE id = ?", [userId])`
- 指纹: `SEC-003:src/db/query.ts:87`
```
