---
name: branch-creator
description: "Create safe Git feature or hotfix branches with concise names. Use this whenever the user asks to create a branch, start work on a new feature or fix, wants a `feat/...` or `hotfix/...` branch name, asks for a short branch slug from a task description, or wants help before beginning local Git work. Default to recommending the branch name and command first, then create only after user confirmation. Do not push, commit, rebase, or create PRs."
metadata:
  author: adonis
  version: "1.0.0"
---

# Branch Creator

Create a local Git branch with a short, readable name:

- `feat/<short-slug>` for normal feature work
- `hotfix/<short-slug>` for urgent fixes or production-impacting repairs

The skill exists to prevent vague branch names, shell-hostile characters, and accidental Git state changes. Branch creation changes the local checkout, so the default workflow is propose first, create after confirmation.

## Trigger Examples

Use this skill when the user says things like:

- "帮我创建一个分支做支付成功页修复"
- "起个 feat 分支，做 pricing table cleanup"
- "new branch for login redirect fix"
- "hotfix branch for failed billing confirmation"
- "我要开始做这个功能，先建分支"

Do not use this skill for:

- committing, pushing, opening PRs/MRs, or finishing branches
- renaming or deleting existing branches
- complex release branching strategy design

## Decision Rules

### Prefix

Pick one prefix:

- Use `feat/` for new features, non-urgent product changes, refactors tied to a feature, UI improvements, and planned work.
- Use `hotfix/` for urgent fixes, production breakages, release-blocking fixes, payment/auth/data-loss fixes, or when the user explicitly says hotfix.

If both are plausible, recommend one and ask for confirmation. Do not silently use `hotfix/` just because the task is a bug; reserve it for urgency or release pressure.

### Slug

Generate the part after the slash from the user's task:

- Use lowercase English words.
- Use hyphens between words.
- Keep it short: usually 2-5 words.
- Prefer domain nouns plus the specific change, for example `paid-success-timeout`, `pricing-country-gate`, `login-redirect`.
- Drop filler words like `add`, `update`, `fix`, `new`, `page`, `feature` unless they carry useful meaning.
- Avoid issue numbers unless the user provided one and clearly wants it included.

Safe character set:

- letters `a-z`
- numbers `0-9`
- hyphen `-`
- one slash between prefix and slug

Avoid spaces, uppercase letters, underscores, dots, quotes, emoji, shell metacharacters, consecutive slashes, trailing dots, and Git-reserved sequences such as `..` or `@{`.

## Workflow

### 1. Inspect Repository State

Before proposing or creating a branch, verify the local Git context:

```bash
git rev-parse --show-toplevel
git status --short --branch
git branch --show-current
```

If the directory is not a Git repository, stop and tell the user.

If the working tree has changes, do not block by default. Explain that creating a branch keeps those changes in the checkout, then continue with the propose-first workflow.

### 2. Propose Branch Name

Output:

```text
Recommended branch: feat/example-slug
Command: git switch -c feat/example-slug
Reason: <brief reason for prefix and slug>
```

If the user's intent is too vague to name the branch well, ask one concise question. Good branch names depend on small scope; if the task description is broad, ask the user to split or name the first slice.

### 3. Validate Before Creation

Before creating the branch, validate the exact candidate name:

```bash
git check-ref-format --branch <branch-name>
git show-ref --verify --quiet refs/heads/<branch-name>
git ls-remote --exit-code --heads origin <branch-name>
```

Interpretation:

- `git check-ref-format --branch` must succeed.
- If the local branch already exists, offer to switch to it with `git switch <branch-name>` instead of creating it.
- If the remote branch already exists, warn the user and ask whether to track or choose another name.
- If there is no `origin` remote, skip the remote existence check and say so.

### 4. Confirm, Then Create

Default behavior:

1. Recommend the branch name and command.
2. Ask the user to confirm.
3. After confirmation, run:

```bash
git switch -c <branch-name>
```

Treat an explicit user instruction like "直接创建" or "create it now" as confirmation only when the branch name is already unambiguous and all validation checks pass.

Never push, commit, rebase, merge, delete branches, or create a PR/MR as part of this skill.

### 5. Report Result

After successful creation, report:

- created branch name
- previous branch
- current branch
- whether the working tree had pre-existing changes

Example:

```text
Created branch: feat/paid-success-timeout
Previous branch: main
Current branch: feat/paid-success-timeout
Note: your existing working-tree changes moved with the checkout.
```

If creation fails, quote the failing command and the relevant error line, then suggest the smallest safe next step.

## Examples

| User intent | Branch |
| --- | --- |
| "做一个登录跳转修复" | `feat/login-redirect` |
| "hotfix: paid success smoke timeout" | `hotfix/paid-success-timeout` |
| "pricing 页面国家货币 gate" | `feat/pricing-currency-gate` |
| "修一下 billing confirmation 线上失败" | `hotfix/billing-confirmation` |
| "add local skill install docs" | `feat/local-skill-docs` |

## Quality Bar

A good result is boring and predictable:

- The branch name is short enough to type.
- The prefix communicates urgency correctly.
- The name passes Git's branch-name validation.
- The user sees the command before the checkout changes.
- No remote or history-changing command runs unless the user separately asks for it.
