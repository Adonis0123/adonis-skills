---
name: commit-push
description: Commit or push one focused, inspected Git change set with an emoji Conventional Commit message and verified remote delivery. Use for explicit commit-and-push requests or pushing existing local commits; excludes PR/MR, force-push, merge, rebase, tag, release, and deploy workflows.
metadata:
  author: adonis
---

# Commit Push

Create one focused local commit from staged changes or a clearly identified local change set, push the current branch, and verify the branch is no longer ahead of its upstream.

This skill has remote side effects. Treat the push as the boundary that needs explicit state checks, conservative defaults, and clear final reporting.

An explicit `$commit-push` invocation or an unambiguous request to commit and push authorizes one focused commit and one normal push to the inspected current branch/upstream, including `main` or `master`. Do not ask for a second protected-branch confirmation. This authorization never covers a different target, a broader change set, force-push, or any workflow listed under Boundaries.

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
- If there are no staged, unstaged, or untracked changes, inspect the branch relation. Push already-inspected expected commits when the branch is ahead; otherwise report that there is nothing to commit or push.

Automatic staging boundaries:

- Use exact pathspecs with `git add -- <path>` or `git add -- <path1> <path2>`. Do not use bare `git add .` or `git add -A` unless the user explicitly asked to commit all changes.
- Before staging unstaged files, inspect the relevant diff with `git diff -- <path>`; for untracked files, inspect the path and content type as needed.
- If a path or diff suggests secrets, credentials, cookies, private keys, local env files, certificates, or private user data, stop and ask before staging or committing.
- If the selected scope contains multiple unrelated concerns, stop and ask whether to split the commit.
- Before staging any unstaged or untracked candidate, read [references/ignore-gate.md](references/ignore-gate.md). It defines the required ignore, commit, ask, tracked-secret, and user-reporting branches.

After staging or when staged changes already existed, use `git diff --cached --stat` and `git diff --cached` to understand exactly what will be committed.

### 2. Check push safety

Identify the current branch and upstream from `git status --short --branch`.

Stop before committing or pushing when:

- the staged diff includes secrets, credentials, local env files, private keys, or generated files that look accidental (these should have been caught by the Ignore vs Commit gate — unstage and fix `.gitignore` before continuing)
- the staged diff contains unrelated work or is broader than the inspected, authorized scope; ask the user to choose or split the staged scope rather than silently unstaging their work
- the selected scope, current branch, upstream, or remote target is ambiguous, missing, or different from what the user authorized
- the user asked for PR/MR creation, release work, deployment, merge, rebase, or tag creation

An unrelated **unstaged** change is not by itself a blocker when the staged scope is already unambiguous and inspected. Leave it untouched and report it at the end.

If the branch has no upstream, plan to push with:

```bash
git push -u origin <branch>
```

Otherwise use:

```bash
git push
```

Verify the exact remote URL and destination before a first upstream push. Do not invent a remote or assume that `origin` is correct when it is absent or unexpected.

### 3. Verify before committing

Run the smallest relevant checks for the change when practical. Prefer project-specific commands from local docs or package scripts. If verification is skipped or blocked, say so before committing and include the reason in the final report.

Do not claim behavior is verified from code reading alone.

After the target is verified and before creating a new local commit, run the planned push as a preflight:

```bash
git push --dry-run
# or, for a verified first upstream:
git push --dry-run -u origin <branch>
```

If the preflight fails, do not create the commit; report `UNVERIFIED: push preflight failed` with the relevant error. A successful dry-run proves only that the preflight passed. It never proves delivery.

### 4. Commit

Generate an emoji-prefixed Conventional Commit subject from the staged diff:

```text
<emoji> <type>(optional-scope): <subject>
```

Common mappings: `✨ feat`, `🐛 fix`, `📝 docs`, `🎨 style`, `♻️ refactor`, `⚡️ perf`, `✅ test`, `🏗️ build`, `👷 ci`, and `🔧 chore`.

Use a HEREDOC-style commit command so emoji and multiline bodies are handled safely:

```bash
git commit -m "$(cat <<'EOF'
✨ feat(scope): concise subject
EOF
)"
```

Keep the commit focused. If staged changes contain multiple unrelated concerns, stop and ask whether to split the commit.

### 5. Push

After a successful commit, or when the branch already contains inspected expected commits to deliver, run the planned real push once. If it fails, do not retry automatically, duplicate the commit, rewrite history, or report delivery success. Report the exact failing command, the relevant error line, and the remaining ahead state, then suggest the smallest safe next step.

Never force-push unless the user explicitly asked for force push and the repository state has been inspected immediately before doing so.

### 6. Verify after push

Run:

```bash
git status --short --branch
git log -1 --oneline
```

Success requires both the real `git push` to exit successfully and `git status --short --branch` to show no `[ahead N]`. A dry-run, successful local commit, schedule state, or missing ahead marker without a successful real push is not delivery proof. If the command still shows ahead commits, do not report the push as complete.

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
