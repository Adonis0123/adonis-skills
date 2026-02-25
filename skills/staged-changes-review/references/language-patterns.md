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

## REPO-001: Direct edit of generated root files

```bash
# Check if CLAUDE.md or AGENTS.md is modified without .ruler/*.md changes
STAGED=$(git diff --cached --name-status)
HAS_GENERATED=$(echo "$STAGED" | grep -E "^M\t(CLAUDE|AGENTS)\.md$")
HAS_RULER=$(echo "$STAGED" | grep -E "^[AM]\t\.ruler/")
if [ -n "$HAS_GENERATED" ] && [ -z "$HAS_RULER" ]; then
  echo "REPO-001: Generated root file edited directly without .ruler/ source change"
  echo "$HAS_GENERATED"
fi
```

## REPO-002: README language pair missing (new file)

```bash
# Check for newly added README without its language counterpart
STAGED=$(git diff --cached --name-status)
echo "$STAGED" | grep -E "^A\t.*README(\.zh-CN)?\.md$" | while read -r status path; do
  dir=$(dirname "$path")
  if echo "$path" | grep -q "README\.zh-CN\.md$"; then
    PAIR="$dir/README.md"
  else
    PAIR="$dir/README.zh-CN.md"
  fi
  # Check both staged files and existing files on disk
  if ! echo "$STAGED" | grep -qF "$PAIR" && [ ! -f "$PAIR" ]; then
    echo "REPO-002: $path added without counterpart $PAIR"
  fi
done
```

## REPO-003: README language pair not synced (modification)

```bash
# Check for modified README without its counterpart also being modified
STAGED=$(git diff --cached --name-status)
echo "$STAGED" | grep -E "^M\t.*README(\.zh-CN)?\.md$" | while read -r status path; do
  dir=$(dirname "$path")
  if echo "$path" | grep -q "README\.zh-CN\.md$"; then
    PAIR="$dir/README.md"
  else
    PAIR="$dir/README.zh-CN.md"
  fi
  # Only flag if the pair file exists but is not staged
  if [ -f "$PAIR" ] && ! echo "$STAGED" | grep -qE "^[AM]\t$(echo "$PAIR" | sed 's/[.[\*^$()+?{|]/\\&/g')$"; then
    echo "REPO-003: $path modified but counterpart $PAIR not staged"
  fi
done
```

## REPO-004: Generated artifact without source change

```bash
# Check if skills-index.json is modified without SKILL.md source changes
STAGED=$(git diff --cached --name-status)
HAS_INDEX=$(echo "$STAGED" | grep -E "^M\t.*apps/web/src/generated/skills-index\.json$")
HAS_SKILL=$(echo "$STAGED" | grep -E "^[AM]\t.*skills/[^/]+/SKILL\.md$")
if [ -n "$HAS_INDEX" ] && [ -z "$HAS_SKILL" ]; then
  echo "REPO-004: skills-index.json modified without any skills/*/SKILL.md change"
fi
```

## REPO-005: Skill frontmatter naming format violation

```bash
# Extract name: field from staged SKILL.md files and validate format
git diff --cached --name-only | grep -E "^skills/[^/]+/SKILL\.md$" | while read -r f; do
  NAME=$(git diff --cached -- "$f" | grep -E "^\+name:" | head -1 | sed 's/^+name:\s*//' | tr -d '[:space:]')
  if [ -n "$NAME" ] && ! echo "$NAME" | grep -qE "^[a-z0-9]+(-[a-z0-9]+)*$"; then
    echo "REPO-005: $f has invalid name format: '$NAME' (expected lowercase hyphen-case)"
  fi
done
```

## REPO-006: Skill change without index update

```bash
# Check if any skills/*/SKILL.md changed without skills-index.json being staged
STAGED=$(git diff --cached --name-status)
HAS_SKILL=$(echo "$STAGED" | grep -E "^[AM]\t.*skills/[^/]+/SKILL\.md$")
HAS_INDEX=$(echo "$STAGED" | grep -E "apps/web/src/generated/skills-index\.json")
if [ -n "$HAS_SKILL" ] && [ -z "$HAS_INDEX" ]; then
  echo "REPO-006: skills/*/SKILL.md changed but skills-index.json not updated"
  echo "$HAS_SKILL"
fi
```

## REPO-007: Web direct localStorage usage

_Profile: react-nextjs, react-app only._

```bash
# Check for direct localStorage access in web app source (new lines only)
git diff --cached -- "apps/web/src/**/*.ts" "apps/web/src/**/*.tsx" | \
  grep -E "^\+" | grep -nE "(localStorage\.|window\.localStorage)" | \
  grep -v "useLocalStorageState"
```

If matched, report as MEDIUM finding. Recommend using `useLocalStorageState` from ahooks.

## REPO-008: Web non-token shadow usage

_Profile: react-nextjs only._

```bash
# Check for raw box-shadow values that don't use clay tokens (new lines only)
git diff --cached -- "apps/web/src/**/*.css" "apps/web/src/**/*.tsx" "apps/web/src/**/*.ts" | \
  grep -E "^\+" | grep -E "box-shadow:" | \
  grep -v "var(--shadow-clay"
```

If matched, report as LOW finding. Recommend using clay shadow tokens: `--shadow-clay-raised`, `--shadow-clay-inset`, or `--shadow-clay-floating`.
