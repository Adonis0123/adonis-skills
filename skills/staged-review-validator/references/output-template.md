# Output Template

## 最小输入模板（用户先粘贴）

```markdown
## Staged Changes Review

### Issue 1
- 标题:
- 文件:
- 行号:
- 风险级别:
- 置信度:
- 问题描述:
- 原建议:
```

如果用户没有给出上述信息，先提示补充，再开始复核。

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

### 1. <问题标题>
- 文件位置: `<path>:<line>`
- 风险级别: <高/中/低>
- 置信度: <score>/100
- 裁决: <成立/不成立/待确认>
- 是否需要修改: <是/否/待补充>
- 证据:
  - <命令或代码定位证据 1>
  - <命令或代码定位证据 2>
- 最小改动建议:
  - <建议 1>
  - <建议 2>

## 下一步
1. <下一步 1>
2. <下一步 2>
```

## 示例（简版）

```markdown
### 2. [结构冗余] commit-examples.md 文件重复
- 文件位置: `skills/commit/examples/commit-examples.md`
- 风险级别: 中
- 置信度: 90/100
- 裁决: 成立
- 是否需要修改: 是
- 证据:
  - `find` 显示 `examples/` 与 `references/` 存在同名文件
  - `shasum -a 256` 显示哈希一致
- 最小改动建议:
  - 删除 `examples/commit-examples.md`
  - 保留 `references/commit-examples.md` 作为唯一来源
```
