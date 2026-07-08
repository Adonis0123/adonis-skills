---
name: commit-push
description: Commit staged Git changes with an emoji Conventional Commit message, then push the current branch to its remote. Use when the user asks to "commit and push", "commit push", "submit and push", "push my committed change", or wants a local commit finalized on the remote. Do not create pull requests, merge requests, releases, tags, rebases, or deployment changes.
metadata:
  author: adonis
---

# Commit Push

Create one focused local commit from staged changes, push the current branch, and verify the branch is no longer ahead of its upstream.

This skill has remote side effects. Treat the push as the boundary that needs explicit state checks, conservative defaults, and clear final reporting.

## Workflow

### 1. Inspect repository state

Run:

```bash
git status --short --branch
```

Stop if the directory is not a Git repository. If there are no staged changes, ask the user to stage files first unless they explicitly asked you to stage a known set of files.

Use `git diff --cached --stat` and `git diff --cached` to understand exactly what will be committed. Do not include unstaged files in the commit unless the user explicitly asked you to stage them.

### 2. Check push safety

Identify the current branch and upstream from `git status --short --branch`.

Stop and ask before committing or pushing when:

- the current branch is `main`, `master`, `develop`, `release`, `test`, `prerelease`, or another protected/default-looking branch
- the staged diff includes secrets, credentials, local env files, private keys, or generated files that look accidental
- the working tree contains unrelated unstaged changes that could be confused with the staged change
- the user asked for PR/MR creation, release work, deployment, merge, rebase, or tag creation

If the branch has no upstream, plan to push with:

```bash
git push -u origin <branch>
```

Otherwise use:

```bash
git push
```

### 3. Verify before committing

Run the smallest relevant checks for the change when practical. Prefer project-specific commands from local docs or package scripts. If verification is skipped or blocked, say so before committing and include the reason in the final report.

Do not claim behavior is verified from code reading alone.

### 4. Commit

Generate an emoji-prefixed Conventional Commit subject from the staged diff:

```text
<emoji> <type>(optional-scope): <subject>
```

Use these common mappings:

| Type | Emoji | Use for |
| --- | --- | --- |
| feat | ✨ | user-facing features |
| fix | 🐛 | bug fixes |
| docs | 📝 | documentation only |
| style | 🎨 | formatting or style-only code changes |
| refactor | ♻️ | behavior-preserving code restructuring |
| perf | ⚡️ | performance improvements |
| test | ✅ | tests |
| build | 🏗️ | build system or dependencies |
| ci | 👷 | CI configuration |
| chore | 🔧 | maintenance |

Use a HEREDOC-style commit command so emoji and multiline bodies are handled safely:

```bash
git commit -m "$(cat <<'EOF'
✨ feat(scope): concise subject
EOF
)"
```

Keep the commit focused. If staged changes contain multiple unrelated concerns, stop and ask whether to split the commit.

### 5. Push

After a successful commit, push the current branch. If `git push` fails, report the exact failing command and the relevant error line, then suggest the smallest safe next step.

Never force-push unless the user explicitly asked for force push and the repository state has been inspected immediately before doing so.

### 6. Verify after push

Run:

```bash
git status --short --branch
git log -1 --oneline
```

Success requires a real signal that the branch is no longer ahead of its upstream, such as `git status --short --branch` showing no `[ahead N]`. If the command still shows ahead commits, do not report the push as complete.

## Final Report

Report only the useful facts:

- commit hash and subject
- branch and push target
- verification commands and outcomes
- any remaining uncommitted files, skipped checks, or risks

If the repo uses a generated index or validation workflow, mention the commands that were run and their result.

## Boundaries

Do not create PRs/MRs, merge branches, rebase, tag, release, deploy, land changes, or handle QA gates as part of this skill. Those are separate delivery workflows.
