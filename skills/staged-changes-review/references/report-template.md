# Report Template

## 1. Single Finding Format

Each finding MUST use this exact format:

```markdown
#### [ruleId] Finding title
- **Rule**: ruleId — rule description
- **File**: `path/to/file.ext:line`
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **Evidence**:
  ```
  <matched line or code snippet>
  ```
- **Suggestion**: <specific fix recommendation>
- **Fingerprint**: `{ruleId}:{file}:{line}`
```

For semantic rules (LOGIC/BREAK), also include the closed-question answer:

```markdown
#### [LOGIC-001] Null access risk in parseConfig
- **Rule**: LOGIC-001 — Null/undefined access risk
- **File**: `src/config.ts:42`
- **Severity**: HIGH
- **Answer**: YES
- **Evidence**:
  ```typescript
  const value = config.nested.prop; // config.nested may be undefined
  ```
- **Suggestion**: Add optional chaining: `config.nested?.prop`
- **Fingerprint**: `LOGIC-001:src/config.ts:42`
```

For BIZ rules, use before/after behavior comparison format:

```markdown
#### [BIZ-xxx] <发现标题>
- **Rule**: BIZ-xxx — <规则描述>
- **File**: `path/to/file.ext:line`
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **Answer**: YES | NO
- **变更前行为**: <旧版行为的具体描述>
- **变更后行为**: <新版行为的具体描述>
- **影响场景**: <哪些用户在什么场景下会感知差异>
- **Suggestion**: <确认是否为预期行为，或建议修复>
- **Fingerprint**: `{BIZ-xxx}:{file}:{line}`
```

## 2. Full Report Structure

```markdown
## 暂存变更审查报告

### 审查范围
- 文件总数: N / 审查文件: M (P4 files excluded)
- 项目 Profile: react-nextjs | react-app | python-generic | generic
- 确定性规则: 11 条 (+ 5 条 React/Next.js + 8 条 REPO，按 profile 激活) / 语义规则: 13 条 (+ 1 条 React，按 profile 激活)

### 影响范围
| 项目 | 详情 |
|------|------|
| 新增/修改导出符号 | `symbolA`（引用: 3 个文件）, `symbolB`（引用: 1 个文件）|
| API 路由变更 | `app/api/users/route.ts` |
| Server Action 变更 | `src/actions/auth.ts` |
| 环境变量变更 | `NEW_VAR`（新增）|
| 影响范围评估 | 中等（2 个导出符号变更，无 API 路由破坏）|

_若无显著影响范围变更，此 section 输出"无显著影响范围变更"。_

### 业务影响分析
| 变更文件 | BIZ 规则 | 行为变更摘要 |
|----------|---------|-------------|
| `path/to/file.ext` | BIZ-xxx | <行为变更的简要描述> |

_若无业务行为变更，输出"未检测到用户可感知的业务行为变更"。_

### 发现总览
| 严重度 | 数量 | 涉及规则 |
|--------|------|----------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 0 | — |

### 结论
{auto-selected from review-rules.md §5}

---

### CRITICAL 级别发现
{findings or "无"}

### HIGH 级别发现
{findings or "无"}

### MEDIUM 级别发现
{findings or "无"}

### LOW 级别发现
{findings or "无"}

---

### 文件审查矩阵
| 文件 | 优先级 | 发现数 | 最高严重度 |
|------|--------|--------|-----------|
| path/to/file1 | P1 | 2 | HIGH |
| path/to/file2 | P2 | 0 | — |
```

## 3. Output Budget

To keep reports actionable, enforce these limits per severity:

| Severity | Max Findings | If exceeded |
|----------|-------------|-------------|
| CRITICAL | Unlimited | Report all |
| HIGH | 5 | Report top 5, note "N more omitted" |
| MEDIUM | 5 | Report top 5, note "N more omitted" |
| LOW | 3 | Report top 3, note "N more omitted" |

When the budget is exceeded, prioritize findings by:
1. Unique rule IDs (prefer variety over duplicates)
2. Higher-priority files (P0 > P1 > P2 > P3)
3. Earlier line numbers within the same file
