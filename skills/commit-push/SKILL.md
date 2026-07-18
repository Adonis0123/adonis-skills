---
name: commit-push
description: Commit a focused local change set with an emoji Conventional Commit message, safely stage a clear unstaged scope when needed, then push the current branch to its remote. Use when the user asks to "commit and push", "commit push", "submit and push", "push my committed change", or wants a local commit finalized on the remote. Do not create pull requests, merge requests, releases, tags, rebases, or deployment changes.
metadata:
  author: adonis
---

# Commit Push

Create one focused local commit from staged changes or a clearly identified local change set, push the current branch, and verify the branch is no longer ahead of its upstream.

This skill has remote side effects. Treat the push as the boundary that needs explicit state checks, conservative defaults, and clear final reporting.

## Workflow

### 1. Inspect repository state

Run:

```bash
git status --short --branch
```

Stop if the directory is not a Git repository.

Determine the commit scope:

- If staged changes already exist, use only the staged changes. Do not automatically add remaining unstaged changes; report them at the end if they remain.
- If there are no staged changes but there is exactly one clear unstaged or untracked file, inspect that file first, then stage it with `git add -- <path>` when it is safe.
- If there are no staged changes and the user named specific files, or the current agent turn just produced a clearly related set of files with no unrelated dirty files, inspect those paths and stage them with `git add -- <path>...`.
- If there are no staged changes and the unstaged/untracked files look ambiguous, unrelated, or broader than the active task, stop and ask which files to stage. Provide exact `git add -- <path>` suggestions.
- If there are no staged changes and no unstaged/untracked changes, report that there is nothing to commit.

Automatic staging boundaries:

- Use exact pathspecs with `git add -- <path>` or `git add -- <path1> <path2>`. Do not use bare `git add .` or `git add -A` unless the user explicitly asked to commit all changes.
- Before staging unstaged files, inspect the relevant diff with `git diff -- <path>`; for untracked files, inspect the path and content type as needed.
- If a path or diff suggests secrets, credentials, cookies, private keys, local env files, certificates, or private user data, stop and ask before staging or committing.
- If the selected scope contains multiple unrelated concerns, stop and ask whether to split the commit.
- **Ignore vs Commit gate** (every candidate path, especially `??` untracked):
  - **Default IGNORE** (do not stage; if the pattern is missing, append a minimal entry to `.gitignore` first): secrets (`.env` / `.env.*` except `.env.example`), `node_modules/`, venvs, build/cache (`.next/`, `dist/`, `coverage/`, `.turbo/`, `*.log`), OS noise (`.DS_Store`), and other local-only junk.
  - **Default COMMIT** when in scope: source/tests/docs/shared configs, `.gitignore` updates themselves, lockfiles the repo already tracks, generated files only if this repo already tracks them by convention.
  - **Ask** when ambiguous: large binaries/media, IDE dirs (`.vscode/`, `.idea/`), unclear generated artifacts.
  - Already-tracked paths that should be ignored: stop and warn; suggest `git rm --cached -- <path>` + `.gitignore` — do not silently untrack secrets.
  - Prefer shipping the `.gitignore` fix in the same focused commit (or a tiny `chore` commit) so teammates do not re-hit the same noise. Re-run `git status --short` after editing `.gitignore`.
  - **Tell the user about ignores (required)**: never silently skip paths. When you do not stage something, add/edit `.gitignore`, or leave paths out of the commit because they should be ignored, report in the same turn: path/pattern, short why, and what you did. Group related paths; skip this section only when nothing was ignored.

After staging or when staged changes already existed, use `git diff --cached --stat` and `git diff --cached` to understand exactly what will be committed.

### 2. Check push safety

Identify the current branch and upstream from `git status --short --branch`.

Stop and ask before committing or pushing when:

- the current branch is `main`, `master`, `develop`, `release`, `test`, `prerelease`, or another protected/default-looking branch
- the staged diff includes secrets, credentials, local env files, private keys, or generated files that look accidental (these should have been caught by the Ignore vs Commit gate — unstage and fix `.gitignore` before continuing)
- the working tree contains unrelated unstaged changes that could be confused with the staged change
- the user asked for PR/MR creation, release work, deployment, merge, rebase, or tag creation

Protected/default branch confirmation is separate from staging. You may stage an exact, already-inspected scope first, but do not commit or push on a protected/default-looking branch until the user explicitly confirms that branch and push target.

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
- any Ignore vs Commit actions: what was ignored, why, and whether `.gitignore` changed

If the repo uses a generated index or validation workflow, mention the commands that were run and their result.

## Boundaries

Do not create PRs/MRs, merge branches, rebase, tag, release, deploy, land changes, or handle QA gates as part of this skill. Those are separate delivery workflows.
