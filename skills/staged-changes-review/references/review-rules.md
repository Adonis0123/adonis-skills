# Review Rules

## 0. Profile Activation

Rule categories active per project profile (detected in Step 0.5):

| Profile | SEC | REACT | PERF | ASYNC | STR | LOGIC/BREAK | BIZ | REPO |
|---------|-----|-------|------|-------|-----|-------------|-----|------|
| react-nextjs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| react-app | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ (001-007) |
| python-generic | ✓ | — | — | — | ✓ | ✓ | ✓ | ✓ (001-006) |
| generic | ✓ | — | — | — | ✓ | ✓ | ✓ | ✓ (001-006) |

REACT-* and PERF-* rules must be **skipped** (marked N/A) for python-generic and generic profiles. REPO-007 requires react-nextjs or react-app; REPO-008 requires react-nextjs only.

## 1. File Classification

Staged files are classified into priority tiers. Process files in P0 → P3 order; skip P4.

| Priority | Description | Glob Patterns |
|----------|-------------|---------------|
| P0 | Secrets & credentials | `*.env`, `*.pem`, `*.key`, `*credentials*`, `*secret*` |
| P1 | Source code (business logic) | `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.py`, `*.java`, `*.go`, `*.rs` |
| P2 | Config & infra | `*.json`, `*.yaml`, `*.yml`, `*.toml`, `Dockerfile`, `*.tf`, `*.sql` |
| P3 | Documentation & styles | `*.md`, `*.css`, `*.scss`, `*.less` |
| P4 | Generated / vendored (skip) | `*.lock`, `dist/*`, `build/*`, `node_modules/*`, `*.min.js`, `*.map` |

## 2. Deterministic Rules (grep-driven)

Match = report. No subjective judgment needed.

### SEC-001: Hardcoded secrets

- **Description**: Hardcoded passwords, API keys, tokens, or secret strings
- **Severity**: CRITICAL
- **Applies to**: All source & config files (P0-P2)
- **See**: `language-patterns.md` SEC-001

### SEC-002: Private key content

- **Description**: Private key material embedded in source files
- **Severity**: CRITICAL
- **Applies to**: All files
- **See**: `language-patterns.md` SEC-002

### SEC-003: SQL string concatenation

- **Description**: SQL queries built via string concatenation or template literals
- **Severity**: HIGH
- **Applies to**: P1 source files
- **See**: `language-patterns.md` SEC-003

### SEC-004: Insecure URL (http://)

- **Description**: Non-localhost HTTP URLs in source code
- **Severity**: HIGH
- **Applies to**: P1 source files
- **See**: `language-patterns.md` SEC-004

### SEC-005: eval/exec calls

- **Description**: Dynamic code execution via eval, exec, or equivalents
- **Severity**: HIGH
- **Applies to**: P1 source files
- **Note (Python)**: `re.compile()`, `compile()` from builtins are **not** in scope — only `eval` and `exec` are checked for Python files.
- **See**: `language-patterns.md` SEC-005

### STR-001: console.log residual

- **Description**: Leftover console.log/print debug statements
- **Severity**: LOW
- **Applies to**: P1 source files
- **Exemption (Python `print`)**: Mark N/A if the file path contains `scripts/`, `cli/`, `scaffold/`, or `__main__` — CLI and scaffold scripts legitimately use `print()` for output.
- **See**: `language-patterns.md` STR-001

### STR-002: TODO/FIXME/HACK markers

- **Description**: Newly added TODO, FIXME, or HACK comments
- **Severity**: LOW
- **Applies to**: P1 source files
- **See**: `language-patterns.md` STR-002

### STR-003: Major dependency upgrade

- **Description**: Major version bump in dependency files
- **Severity**: LOW
- **Applies to**: `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `*.gradle`
- **See**: `language-patterns.md` STR-003

### STR-004: Debugger residual

- **Description**: Leftover debugger statements
- **Severity**: LOW
- **Applies to**: P1 source files
- **See**: `language-patterns.md` STR-004

### ASYNC-001: await without try-catch

- **Description**: await expression not wrapped in try-catch
- **Severity**: MEDIUM
- **Applies to**: JS/TS files
- **See**: `language-patterns.md` ASYNC-001

### ASYNC-002: Promise without .catch

- **Description**: Promise chain without .catch() or equivalent error handler
- **Severity**: MEDIUM
- **Applies to**: JS/TS files
- **See**: `language-patterns.md` ASYNC-002

### SEC-006: dangerouslySetInnerHTML without sanitization

- **Description**: `dangerouslySetInnerHTML` used without `DOMPurify.sanitize()` — XSS risk
- **Severity**: HIGH
- **Applies to**: `.tsx`, `.jsx` files
- **Profile**: react-nextjs, react-app only
- **See**: `language-patterns.md` SEC-006

### SEC-007: Server Action missing auth/validation

- **Description**: `"use server"` directive present without `auth()` / `session()` / `z.parse()` / `schema.parse()` — unauthorized access risk
- **Severity**: HIGH
- **Applies to**: `.ts`, `.tsx` files
- **Profile**: react-nextjs only
- **See**: `language-patterns.md` SEC-007

## 2b. React/Next.js Rules (profile: react-nextjs / react-app)

Skip this entire section if profile is `python-generic` or `generic`.

### REACT-001: Hook called in condition or loop

- **Description**: React Hook called inside an `if`, `while`, or `for` block — violates Rules of Hooks
- **Severity**: HIGH
- **Applies to**: `.tsx`, `.jsx`, `.ts` files
- **Profile**: react-nextjs, react-app only
- **See**: `language-patterns.md` REACT-001

### REACT-002: Unstable key in list rendering

- **Description**: `.map()` uses array `index` or `Math.random()` as React `key` — causes reconciliation issues
- **Severity**: MEDIUM
- **Applies to**: `.tsx`, `.jsx` files
- **Profile**: react-nextjs, react-app only
- **See**: `language-patterns.md` REACT-002

### REACT-003: addEventListener without cleanup

- **Description**: `addEventListener` inside `useEffect` without a `return () => removeEventListener` cleanup — causes memory leaks
- **Severity**: MEDIUM
- **Applies to**: `.tsx`, `.jsx`, `.ts` files
- **Profile**: react-nextjs, react-app only
- **See**: `language-patterns.md` REACT-003

## 2c. Repository Convention Rules (REPO)

Rules that enforce repository-level conventions defined in `.ruler/*.md`. All rules in this section are deterministic (grep/name-status driven).

### REPO-001: Direct edit of generated root files

- **Description**: `CLAUDE.md` or `AGENTS.md` was directly modified — these files are generated by `pnpm ruler:apply` from `.ruler/*.md` sources
- **Severity**: HIGH
- **Applies to**: Root `CLAUDE.md`, `AGENTS.md`
- **Logic**: Check `git diff --cached --name-status` for `M` status on `CLAUDE.md` or `AGENTS.md` **without** any `.ruler/*.md` file also being modified in the same commit
- **See**: `language-patterns.md` REPO-001

### REPO-002: README language pair missing (new file)

- **Description**: A new `README.md` or `README.zh-CN.md` was added without its language counterpart
- **Severity**: HIGH
- **Applies to**: Any directory containing a new README file
- **Logic**: Check `git diff --cached --name-status` for `A` (added) README files. For each new `README.md`, verify `README.zh-CN.md` exists in the same directory (staged or on disk), and vice versa
- **See**: `language-patterns.md` REPO-002

### REPO-003: README language pair not synced (modification)

- **Description**: `README.md` was modified but its `README.zh-CN.md` counterpart was not (or vice versa)
- **Severity**: MEDIUM
- **Applies to**: Any directory containing both README variants
- **Logic**: Check `git diff --cached --name-status` for `M` (modified) README files. If `README.md` is modified in a directory, check that `README.zh-CN.md` in the same directory is also staged, and vice versa
- **See**: `language-patterns.md` REPO-003

### REPO-004: Generated artifact without source change

- **Description**: A generated output file was modified without its source also being changed — likely a manual edit that will be overwritten
- **Severity**: HIGH
- **Applies to**: `apps/web/src/generated/skills-index-lite.json`, `apps/web/src/generated/skills-detail-index.json`
- **Logic**: Check `git diff --cached --name-status` for modification of either generated index file without any `skills/*/SKILL.md` file also being modified
- **See**: `language-patterns.md` REPO-004

### REPO-005: Skill frontmatter naming format violation

- **Description**: The `name` field in `SKILL.md` frontmatter does not follow lowercase hyphen-case convention
- **Severity**: MEDIUM
- **Applies to**: `skills/*/SKILL.md` files in staged changes
- **Logic**: Extract the `name:` value from staged SKILL.md frontmatter; verify it matches `^[a-z0-9]+(-[a-z0-9]+)*$`
- **See**: `language-patterns.md` REPO-005

### REPO-006: Skill change without index update

- **Description**: A `skills/*/SKILL.md` file was added or modified but generated index files were not regenerated
- **Severity**: HIGH
- **Applies to**: `skills/*/SKILL.md`
- **Logic**: Check `git diff --cached --name-status` for any `skills/*/SKILL.md` change (A or M) without either `apps/web/src/generated/skills-index-lite.json` or `apps/web/src/generated/skills-detail-index.json` being staged
- **See**: `language-patterns.md` REPO-006

### REPO-007: Web direct localStorage usage

- **Description**: Direct `window.localStorage` or `localStorage.` access in web app code — should use `useLocalStorageState` from ahooks instead
- **Severity**: MEDIUM
- **Applies to**: `apps/web/src/**/*.ts`, `apps/web/src/**/*.tsx`
- **Profile**: react-nextjs, react-app only
- **Logic**: Grep staged diff new lines for `localStorage\.` or `window\.localStorage` in web app files
- **See**: `language-patterns.md` REPO-007

### REPO-008: Web non-token shadow usage

- **Description**: Raw `box-shadow` value used instead of clay shadow tokens (`--shadow-clay-raised`, `--shadow-clay-inset`, `--shadow-clay-floating`)
- **Severity**: LOW
- **Applies to**: `apps/web/src/**/*.css`, `apps/web/src/**/*.tsx`, `apps/web/src/**/*.ts`
- **Profile**: react-nextjs only
- **Logic**: Grep staged diff new lines for `box-shadow:` that do not reference `var(--shadow-clay` tokens
- **See**: `language-patterns.md` REPO-008

## 3. Semantic Rules (closed-question)

Answer each question per file with: **YES** (issue found + evidence), **NO**, or **N/A** (rule not applicable).

### LOGIC-001: Null/undefined access risk

- **Question**: Is there a null pointer or undefined access risk in the changed code?
- **Severity**: HIGH
- **Answer format**: YES/NO/N/A + file:line + evidence snippet

### LOGIC-002: Loop/array boundary error

- **Question**: Do loop or array operations have boundary errors (off-by-one, empty array)?
- **Severity**: MEDIUM
- **Answer format**: YES/NO/N/A + file:line + evidence snippet

### LOGIC-003: Incomplete branch coverage

- **Question**: Do conditional branches cover all expected cases (missing else, unhandled enum)?
- **Severity**: MEDIUM
- **Answer format**: YES/NO/N/A + file:line + evidence snippet

### LOGIC-004: Incomplete error handling

- **Question**: Is error handling incomplete (swallowed exceptions, missing catch, unchecked return)?
- **Severity**: MEDIUM
- **Answer format**: YES/NO/N/A + file:line + evidence snippet

### LOGIC-005: Resource leak

- **Question**: Are opened resources (files, connections, listeners) properly released?
- **Severity**: MEDIUM
- **Answer format**: YES/NO/N/A + file:line + evidence snippet

### BREAK-001: Public API signature change

- **Question**: Does this change modify a public API signature (function params, return type, route)?
- **Severity**: HIGH
- **Answer format**: YES/NO/N/A + file:line + before/after signature

### BREAK-002: Removed/renamed public export

- **Question**: Does this change delete or rename a publicly exported symbol?
- **Severity**: HIGH
- **Answer format**: YES/NO/N/A + symbol name + file:line

### BREAK-003: DB schema without migration

- **Question**: Does this change modify a database schema without a corresponding migration file?
- **Severity**: HIGH
- **Applies only if**: The diff includes files matching `migration*`, `schema*`, `*.sql`, or ORM model files (e.g., `models/`, `prisma/schema.prisma`). Mark N/A if no such files are in the staged diff.
- **Answer format**: YES/NO/N/A + schema file + migration check result

### PERF-001: Sequential await waterfall

- **Question**: Are there multiple independent `await` expressions that could be parallelized with `Promise.all()`?
- **Severity**: MEDIUM
- **Profile**: react-nextjs, react-app only. Mark N/A for other profiles.
- **Answer format**: YES/NO/N/A + file:line + evidence snippet showing sequential awaits

### BREAK-004: Environment variable rename

- **Question**: Does this change rename or remove an environment variable?
- **Severity**: HIGH
- **Applies only if**: The diff includes `.env*` or `config.*` files, or source files that reference `process.env`. Mark N/A if no environment variable files are in the staged diff.
- **Answer format**: YES/NO/N/A + variable name + file:line

## 3b. Business Impact Rules (BIZ)

BIZ 规则检查**用户可感知的行为变更**，与 LOGIC（代码正确性）和 BREAK（兼容性）互补。BIZ 规则为纯语义规则，需通过 `git show HEAD:<path>` 获取变更前版本，对比暂存版本进行 before/after 行为分析。

Answer each question per file with: **YES** (issue found + before/after behavior), **NO**, or **N/A** (rule not applicable).

### BIZ-001: 默认值/初始状态变更

- **Question**: 此变更是否修改了用户可见的默认值、初始状态或预设配置？
- **Severity**: HIGH
- **适用启发**: 涉及 `default`、`initial`、`fallback`、硬编码数字赋值给 state/config
- **Answer format**: YES/NO/N/A + file:line + 变更前行为 + 变更后行为 + 影响场景

### BIZ-002: 条件分支行为路径变更

- **Question**: 此变更是否修改了业务条件判断，导致特定用户群体的执行路径发生变化？
- **Severity**: HIGH
- **适用启发**: diff 中条件表达式修改，且条件涉及用户属性（plan、role、subscription 等）
- **Answer format**: YES/NO/N/A + file:line + 变更前行为 + 变更后行为 + 影响场景

### BIZ-003: 金额/计费/配额计算逻辑变更

- **Question**: 此变更是否修改了与金额、价格、计费、配额、次数限制相关的计算逻辑或常量？
- **Severity**: HIGH
- **适用启发**: 涉及 `price`、`cost`、`quota`、`limit`、`credit`、`usage`、`billing` 等变量
- **Answer format**: YES/NO/N/A + file:line + 变更前行为 + 变更后行为 + 影响场景

### BIZ-004: 用户可见文案/提示变更

- **Question**: 此变更是否修改了用户可见的文案内容（错误提示、按钮文本、引导文案），且非纯 i18n key 重命名？
- **Severity**: MEDIUM
- **适用启发**: diff 中字符串字面量变更、`<Trans>` 内容变更、错误消息修改
- **Answer format**: YES/NO/N/A + file:line + 变更前行为 + 变更后行为 + 影响场景

## 4. Severity Mapping

| Severity | Rule IDs | Action |
|----------|----------|--------|
| CRITICAL | SEC-001, SEC-002 | Block commit |
| HIGH | SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, REACT-001, LOGIC-001, BREAK-001~004, BIZ-001, BIZ-002, BIZ-003, REPO-001, REPO-002, REPO-004, REPO-006 | Strongly recommend fix |
| MEDIUM | ASYNC-001, ASYNC-002, REACT-002, REACT-003, PERF-001, LOGIC-002~005, BIZ-004, REPO-003, REPO-005, REPO-007 | Recommend fix |
| LOW | STR-001~004, REPO-008 | Informational |

## 5. Conclusion Rules

The report conclusion is determined by the highest severity found:

| Highest Severity | Conclusion Template |
|------------------|-------------------|
| CRITICAL | `⛔ 阻断: 存在严重问题，强烈建议修复后再提交` |
| HIGH | `⚠️ 警告: 存在高风险问题，建议修复后再提交` |
| MEDIUM or LOW | `✅ 通过(有建议): 未发现阻断性问题` |
| None | `✅ 通过: 审查完毕，未发现问题` |
