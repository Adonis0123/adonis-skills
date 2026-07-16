---
name: review-prompt-composer
description: "Compose one repository-local, copy-ready Markdown prompt for another team or AI agent to review Git changes in the same working tree. Use for committed ranges, staged changes, unstaged tracked changes, untracked files, or all uncommitted changes when the reviewer can read the same repository and index. Persist prompts under $repo_root/.review-handoff/prompts/ with branch-aware naming, 24-hour expiration, strict scope evidence, and a Review-Prompt-ID that agentic-review-handoff can resolve later. Prompt generation only: do not use when the receiver lacks working-tree access; do not run tests, modify reviewed code, commit, stage, stash, push, send the prompt, or duplicate reviewed code. Use agentic-review-handoff for returned-feedback validation and review-fix-re-review loops."
metadata:
  author: adonis
  version: "2.0.0"
---

# Review Prompt Composer

Generate one authoritative Markdown review prompt inside the current repository. Treat the shared working tree as the only source of reviewed code; never duplicate changes into delivery artifacts.

## Workflow

### 1. Resolve repository identity and scope

Run:

```bash
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status --short
```

Map the request to exactly one scope:

| User intent | Canonical scope | Includes | Excludes |
|---|---|---|---|
| current/local/all uncommitted changes | `all-uncommitted` | staged + unstaged tracked + untracked | nothing |
| staged only | `staged-only` | index changes | unstaged + untracked |
| unstaged only | `unstaged-only` | tracked working tree relative to index | staged + untracked |
| untracked only | `untracked-only` | `git ls-files --others --exclude-standard` | tracked changes |
| branch or commits | `ref-range` | resolved requested refs | other working-tree state |

Use the user's explicit scope without another confirmation. Ask only when different interpretations materially change the reviewed files. Do not fold untracked files into `unstaged-only`.

This skill requires the receiver to read the same repository and working tree. If that premise is false, stop because the requested delivery mode is unsupported.

### 2. Collect scope evidence

Use read-only evidence:

| Scope | Commands |
|---|---|
| `all-uncommitted` | `git diff HEAD --stat`, `git diff HEAD --name-status`, `git diff HEAD`, `git ls-files --others --exclude-standard` |
| `staged-only` | `git diff --cached --stat`, `git diff --cached --name-status`, `git diff --cached` |
| `unstaged-only` | `git diff --stat`, `git diff --name-status`, `git diff` |
| `untracked-only` | `git ls-files --others --exclude-standard`, then read each in-scope file |
| branch range | `git log --oneline "$base".."$head"`, `git diff --find-renames "$base"..."$head" --stat`, full diff |
| commits | `git show --find-renames --stat "$sha"` and full show for every resolved SHA |

If the selected scope is empty, stop without writing a prompt. Build an evidence-backed inventory with repository-relative paths, Git status, and concrete changes. Include rename, delete, binary, mode, and public-contract changes; do not invent intent.

### 3. Gate sensitive prompt content

Before writing repository paths, summaries, logs, remotes, or background into the prompt, inspect the material for credentials, private keys, tokens, cookies, `.env` values, credential-bearing URLs, internal addresses, personal data, and other content the receiver should not receive.

- Never print a suspected secret value.
- Report only the repository-relative path and risk type.
- Redact only when review completeness remains intact.
- Stop when safe redaction would invalidate the review.

Shared-worktree access does not weaken this gate.

### 4. Define falsifiable objectives and checks

Write the central claim as a target the reviewer must try to disprove. Label user-supplied intent as `用户声明的待验证目标`. If diff evidence conflicts with the claim, report the conflict before composing the prompt.

Read applicable `AGENTS.md`, repository docs, package scripts, and CI configuration to find exact test, lint, typecheck, or build commands. Record commands and observable expected results; do not run them or claim they pass. Omit the checks section when reliable commands cannot be established, and state why.

### 5. Compose the prompt body

Create this body with actual evidence. Include `{{REVIEW_PROMPT_ID}}` exactly once; the writer replaces it atomically.

````markdown
# 审核任务：<repository and change summary>

## 工作区与范围

仓库：`<absolute repository root>`
分支：`<actual branch>`
起始 HEAD：`<actual SHA>`
审核范围：`<canonical scope>`
明确排除：<actual exclusions>
生成时状态：

```text
<exact git status --short output>
```

开始审核前运行：

```bash
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short
```

仓库、HEAD 或状态清单不一致时，停止并报告提示词已失效。

## 待验证目标

**用户声明的待验证目标：<falsifiable invariant>。请主动寻找反例。**

## 改动清单

1. `<repository-relative path>` — <Git status and evidence-backed change>

## 审核重点

- <counterexample and regression focus>
- <boundary, security, compatibility, or public-contract risks>

## 检查命令

```bash
<exact repository-defined commands>
```

预期：<observable result; never claim it already passed>。

## 输出要求

审核结果第一行必须原样返回：

Review-Prompt-ID: `{{REVIEW_PROMPT_ID}}`

1. 给出总体结论：通过 / 有保留通过 / 阻塞。
2. 按严重程度列出发现，并附仓库相对路径、行号或 diff hunk 证据。
3. 对改动清单逐项标注核对结果。
4. 列出每条检查命令的实际结果；未运行时说明原因。
````

Remove the checks section when it is unsupported. Do not leave any other placeholder in the final body.

### 6. Persist through the writer

Locate this skill's directory, save the composed body to a repository-external temporary UTF-8 file with an available file-writing tool, then run:

```bash
python3 <skill-directory>/scripts/write_review_prompt.py \
  --repo "$repo_root" \
  --scope all-uncommitted \
  --body-file "$temporary_body"
```

Use the canonical scope from step 1. The script:

- ensures `$GIT_COMMON_DIR/info/exclude` contains `/.review-handoff/` without duplicates;
- archives expired prompts for the current branch without deleting them;
- writes under `.review-handoff/prompts/active/<branch_slug>/`;
- derives prompt `branch_slug` by lowercasing, replacing `/` and `\` with `-`, replacing remaining non-`[a-z0-9._-]` runs with `-`, and trimming punctuation;
- uses local `YYYY-MM-DD_HH-mm-<scope_slug>.md` names with collision suffixes;
- writes UTC `created_at` and `expires_at` values with a 24-hour lifetime;
- replaces the prompt ID token and verifies the artifact stays ignored;
- fails before final output on malformed bodies or high-confidence sensitive content.

Read the JSON result, delete the temporary body, then read the final prompt file completely. Verify its path, ID, scope, HEAD, expiration, required headings, and absence of unresolved tokens before reporting success.

### 7. Return the artifact

Do not duplicate the full prompt in chat. Return only:

- a clickable absolute path to the authoritative Markdown file;
- `prompt_id`, canonical scope, and expiration;
- a short instruction to open and copy the file to the reviewer;
- any non-destructive archive warnings from the writer.

When feedback returns, invoke `agentic-review-handoff`; it can resolve the echoed `Review-Prompt-ID` and validate findings against current code.

## Guardrails

- Write only the prompt artifact and the repository-local exclude entry needed to hide `.review-handoff/`.
- Never modify reviewed source, tests, configs, index, HEAD, tracked ignore files, or repository configuration.
- Never run checks, commit, stage, unstage, stash, push, or send the prompt.
- Never overwrite an active or archived prompt; create a collision suffix.
- Never delete expired or malformed prompts automatically.
- Never assume a prompt summary proves a reviewer finding.
