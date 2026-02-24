# Language-Specific Grep Patterns

Patterns are organized by rule ID. Use `git diff --cached` output as primary input;
fall back to `grep -nE` on staged files when line-level scanning is needed.

## SEC-001: Hardcoded secrets

```bash
# JS/TS
grep -nEi "(password|passwd|secret|api_key|apikey|token|auth)\\s*[:=]\\s*['\"][^'\"]{4,}" -- "*.ts" "*.js" "*.tsx" "*.jsx"
# Python
grep -nEi "(password|passwd|secret|api_key|apikey|token|auth)\\s*=\\s*['\"][^'\"]{4,}" -- "*.py"
# Java
grep -nEi "(password|passwd|secret|apiKey|token|auth)\\s*=\\s*\"[^\"]{4,}\"" -- "*.java"
# Go
grep -nEi "(password|passwd|secret|apiKey|token|auth)\\s*[:=]\\s*\"[^\"]{4,}\"" -- "*.go"
# Config
grep -nEi "(password|passwd|secret|api_key|apikey|token|auth)\\s*[:=]\\s*['\"]?[^'\"\\s]{4,}" -- "*.env" "*.yaml" "*.yml" "*.json" "*.toml"
```

## SEC-002: Private key content

```bash
# All files
grep -nE "-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----" -- "*"
```

## SEC-003: SQL string concatenation

```bash
# JS/TS — template literal or concatenation
grep -nE "(SELECT|INSERT|UPDATE|DELETE|DROP).*\\$\\{|['\"]\\s*\\+.*sql|sql.*\\+\\s*['\"]" -- "*.ts" "*.js" "*.tsx" "*.jsx"
# Python — f-string or format
grep -nE "f['\"].*?(SELECT|INSERT|UPDATE|DELETE|DROP)|\\.(format|%)" -- "*.py"
# Java — string concat in query
grep -nE "(Statement|execute|prepareStatement).*\\+" -- "*.java"
# Go — fmt.Sprintf with SQL
grep -nE "fmt\\.Sprintf.*?(SELECT|INSERT|UPDATE|DELETE|DROP)" -- "*.go"
```

## SEC-004: Insecure URL (http://)

```bash
# All source files — exclude localhost and 127.0.0.1
grep -nE "http://" -- "*.ts" "*.js" "*.tsx" "*.jsx" "*.py" "*.java" "*.go" | grep -Ev "(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)"
```

## SEC-005: eval/exec calls

```bash
# JS/TS
grep -nE "\\beval\\s*\\(|new\\s+Function\\s*\\(" -- "*.ts" "*.js" "*.tsx" "*.jsx"
# Python — compile() is excluded (used legitimately by re.compile, etc.)
grep -nE "\\b(eval|exec)\\s*\\(" -- "*.py"
# Java (reflection-based)
grep -nE "Runtime\\.getRuntime\\(\\)\\.exec|ProcessBuilder" -- "*.java"
```

## STR-001: console.log residual

```bash
# JS/TS
grep -nE "\\bconsole\\.(log|debug|info|warn)\\b" -- "*.ts" "*.js" "*.tsx" "*.jsx"
# Python — apply only to non-CLI files
# If file path contains scripts/, cli/, scaffold/, or __main__, mark N/A
grep -nE "\\bprint\\s*\\(" -- "*.py"
# Go
grep -nE "\\bfmt\\.Print(ln|f)?\\b" -- "*.go"
```

**STR-001 Python exemption**: Before reporting a `print()` match, check if the file path contains `scripts/`, `cli/`, `scaffold/`, or contains `if __name__ == "__main__"`. If yes, mark the finding as N/A — CLI scripts legitimately use `print()` for user output.

## STR-002: TODO/FIXME/HACK markers

```bash
# All source files — only in added lines from diff
grep -nEi "\\b(TODO|FIXME|HACK|XXX)\\b" -- "*.ts" "*.js" "*.tsx" "*.jsx" "*.py" "*.java" "*.go"
```

## STR-003: Major dependency upgrade

```bash
# Check diff for major version bumps (e.g., "^2.0.0" → "^3.0.0")
# Run on diff output rather than file grep
git diff --cached -- package.json requirements.txt go.mod Cargo.toml | grep -E "^\\+.*\"[0-9]+\\." | head -20
```

## STR-004: Debugger residual

```bash
# JS/TS
grep -nE "\\bdebugger\\b" -- "*.ts" "*.js" "*.tsx" "*.jsx"
# Python
grep -nE "\\b(breakpoint|pdb\\.set_trace|ipdb)\\s*\\(" -- "*.py"
# Java
grep -nE "System\\.out\\.print" -- "*.java"
```

## SEC-006: dangerouslySetInnerHTML without sanitization

_Profile: react-nextjs, react-app only._

```bash
# Step 1: Find dangerouslySetInnerHTML in new lines of staged diff
git diff --cached -- "*.tsx" "*.jsx" | grep -E "^\+" | grep "dangerouslySetInnerHTML"
```

If matched, **semantic verification** (Step 3): Read the surrounding context (up to 10 lines) and check if `DOMPurify.sanitize(` or `sanitizeHtml(` is used in the same expression. If sanitization is absent, report as HIGH finding.

## SEC-007: Server Action missing auth/validation

_Profile: react-nextjs only._

```bash
# Step 1: Find "use server" directive in new lines of staged diff
git diff --cached -- "*.ts" "*.tsx" | grep -E "^\+" | grep -E '"use server"|'"'"'use server'"'"
```

If matched, **semantic verification**: Read the function body (up to 20 lines after the directive) and check if any of the following are present:
- `auth()`, `getServerSession()`, `currentUser()`, `session()`
- `z.parse(`, `z.safeParse(`, `schema.parse(`, `validate(`

If none found, report as HIGH finding.

## REACT-001: Hook called in condition or loop

_Profile: react-nextjs, react-app only._

```bash
# Heuristic: Hook call appears after if/while/for on the same or next line
grep -nE "(if|while|for)\s*\(.*\)\s*\{?.*use[A-Z]|&&\s*use[A-Z][A-Za-z]+\(" -- "*.tsx" "*.jsx" "*.ts"
```

If matched, **semantic verification** (required — sampling limit: 5 matches): Read the full function body to confirm the Hook is inside a conditional block. Only report if confirmed.

## REACT-002: Unstable key in list rendering

_Profile: react-nextjs, react-app only._

```bash
# key={index}, key={i}, key={Math.random()}
grep -nE 'key=\{(index|i\b|Math\.random\(\))' -- "*.tsx" "*.jsx"
# Also catch: .map((item, index) => ... key={index}
grep -nE '\.map\s*\([^,)]+,\s*(index|i)\b[^)]*\).*key=\{(index|i\b)' -- "*.tsx" "*.jsx"
```

No semantic verification needed — grep match is sufficient to report MEDIUM finding.

## REACT-003: addEventListener without cleanup in useEffect

_Profile: react-nextjs, react-app only._

```bash
# Step 1: Find addEventListener in new lines of staged diff
git diff --cached -- "*.tsx" "*.jsx" "*.ts" | grep -E "^\+" | grep "addEventListener"
```

If matched, **semantic verification** (sampling limit: 5 matches): Read the enclosing `useEffect` block and check if a `return () =>` cleanup function containing `removeEventListener` exists. If no cleanup found, report as MEDIUM finding.

## ASYNC-001: await without try-catch

```bash
# JS/TS — await on a line not inside a try block
# Heuristic: lines with await that are not preceded by try { within 5 lines
grep -nE "\\bawait\\b" -- "*.ts" "*.js" "*.tsx" "*.jsx"
# Cross-reference: verify surrounding context for try-catch via Read tool
```

## ASYNC-002: Promise without .catch

```bash
# JS/TS — Promise chain or .then() without .catch()
grep -nE "\\.then\\s*\\(" -- "*.ts" "*.js" "*.tsx" "*.jsx"
# Cross-reference: check if .catch() exists on the same chain via Read tool
```
