# Review Rules

## 0. Profile Activation

Rule categories active per project profile (detected in Step 0.5):

| Profile | SEC | REACT | PERF | ASYNC | STR | LOGIC/BREAK |
|---------|-----|-------|------|-------|-----|-------------|
| react-nextjs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| react-app | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| python-generic | ✓ | — | — | — | ✓ | ✓ |
| generic | ✓ | — | — | — | ✓ | ✓ |

REACT-* and PERF-* rules must be **skipped** (marked N/A) for python-generic and generic profiles.

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

## 4. Severity Mapping

| Severity | Rule IDs | Action |
|----------|----------|--------|
| CRITICAL | SEC-001, SEC-002 | Block commit |
| HIGH | SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, REACT-001, LOGIC-001, BREAK-001~004 | Strongly recommend fix |
| MEDIUM | ASYNC-001, ASYNC-002, REACT-002, REACT-003, PERF-001, LOGIC-002~005 | Recommend fix |
| LOW | STR-001~004 | Informational |

## 5. Conclusion Rules

The report conclusion is determined by the highest severity found:

| Highest Severity | Conclusion Template |
|------------------|-------------------|
| CRITICAL | `⛔ 阻断: 存在严重问题，强烈建议修复后再提交` |
| HIGH | `⚠️ 警告: 存在高风险问题，建议修复后再提交` |
| MEDIUM or LOW | `✅ 通过(有建议): 未发现阻断性问题` |
| None | `✅ 通过: 审查完毕，未发现问题` |
