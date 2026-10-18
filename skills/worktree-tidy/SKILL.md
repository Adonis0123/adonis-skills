---
name: worktree-tidy
description: "Find and remove stale git worktrees across one or many repositories: prune records of worktrees whose folder is gone, report every linked worktree with its idle days, uncommitted changes and pull/merge request state (GitHub, cnb.cool, GitLab), and remove clean ones the user confirms (idle by default, with an explicit recent-only exception), keeping their branches unless the request is merged or closed. Use when the user asks, in any language, to clean up, list, audit or prune git worktrees, or when a sidebar such as Orca shows too many worktrees. Not for deleting branches without worktrees, cleaning build caches, or removing whole repositories."
metadata:
  author: adonis
  version: "1.0.0"
---

# Worktree Tidy

Keep the number of git worktrees down without losing work. Read [references/glossary.md](references/glossary.md) first and use its terms in reports.

`TIDY=<this skill's directory>/scripts/worktree_tidy.py` is the engine (Python 3.9+, standard library only). It decides what is Stale from facts; you show the report, the user chooses, the script removes and checks again before each removal.

## Hard rules

- Remove only what the script reports as `removable`, and only after the user confirms the list. Exception: the user may explicitly choose hand-removal of a worktree whose `blockers` is exactly `["recent"]`; pass `--allow-recent` only for those paths. This bypasses only the idle threshold, never any other Blocker, alone or combined with `recent`. The script still re-assesses blockers and checks dirty and non-regenerable ignored files immediately before removal. `remove` without `--yes` is a dry run; pass `--yes` only after confirmation.
- Never use `git worktree remove --force`, `rm -rf` on a worktree, or a tool's own delete command (Orca's `worktree rm` also deletes branches). The script uses plain `git worktree remove`; tools such as Orca drop the worktree from their sidebar on their next scan.
- Removing a worktree keeps its branch. Pass `--delete-branch` only when the user asked for it; the script still deletes a branch only when its Request is `merged` or `closed` and its tip is reachable from another branch, tag or remote-tracking ref (`branchSaved`). It re-checks this immediately before deletion; otherwise it keeps the branch and reports `branchError`.
- Non-regenerable ignored files block removal (`ignored`), because plain `git worktree remove` can silently delete ignored files. Never discard them to make a worktree removable.
- Never commit, stash or discard changes to make a worktree removable. A `dirty` worktree is reported for the user to handle.

## Workflow

1. Scan. With no arguments the script scans the repository of the current folder, or the roots in the config file.

   ```bash
   python3 "$TIDY" scan                       # human-readable report
   python3 "$TIDY" --json scan --root ~/code  # first-level repositories under a folder
   python3 "$TIDY" scan --repo . --no-remote  # skip pull/merge request lookups (faster)
   ```

   Every scan first prunes records of worktrees whose folder is gone; `--no-prune` only reports them.

2. Report to the user, grouped by Repository: how many are removable, which are kept and why (each Blocker), and which branches could be deleted. Lead with the removable count.
3. Remove what the user confirms, first as a dry run, then for real:

   ```bash
   python3 "$TIDY" remove <path>...                          # dry run
   python3 "$TIDY" remove <path>... --yes                    # keep branches
   python3 "$TIDY" remove <path>... --delete-branch --yes    # also delete merged/closed branches
   ```

   For an explicitly confirmed recent-only worktree, add `--allow-recent` to both the dry run and the real removal. Keep other paths in a separate invocation without that flag. A path that has become Stale is still allowed; a path that gained another Blocker is refused. Branch deletion rules are unchanged.

   Exit code 1 means at least one path failed; report each `error` as given.

## Configuration

Optional `$XDG_CONFIG_HOME/worktree-tidy/config.json` (default `~/.config/worktree-tidy/config.json`):

```json
{ "roots": ["~/code", "~/work"], "repos": ["~/notes"], "days": 7, "orca": true }
```

- `roots`: scan every first-level folder whose `.git` is a directory. `repos`: extra repositories (a worktree path resolves to its main repository).
- `days`: idle days before a worktree is Stale (`--days` overrides). `orca: false` (or `--no-orca`) stops reading Orca.

## How facts are found

- **Activity** never uses the index file: `git status`, editors and Orca refresh it without anyone working. The script runs `git --no-optional-locks status`, so scanning is not Activity.
- **Orca** (optional): when the `orca` CLI is found (`$WORKTREE_TIDY_ORCA`, `PATH`, or the macOS app bundle), its `isPinned` and `lastActivityAt` per worktree are read. Nothing is written to Orca.
- **Requests** are looked up by the branch's upstream name (or local name) through the host CLI chosen from the `origin` URL: `gh` (GitHub), `cnb` (cnb.cool has no branch filter, so it pages through the signed-in user's requests updated since 30 days before the branch's newest commit; other people's branches report `none`), `glab` (GitLab). A missing or failing CLI gives `unknown`, which never allows deleting a branch. Squash merges leave a branch "not fully merged" in git, so a completed Request and a tip saved on another ref are both required.
- A detached worktree is removable only when its HEAD commit is on some branch, tag or remote ref.

## Prevent the pile-up

Worktrees made for a one-off look at a pull request should live in a temporary folder and be removed with `git worktree remove` when the review ends; `scan` catches the rest.

## JSON facts

Every linked worktree includes `shortHead` (first 7 HEAD characters), `subject` (HEAD commit subject),
`dirtyFiles` (up to 10 paths counted by `dirty`), `ignored` (non-regenerable ignored path count),
`ignoredFiles` (up to 10 such paths), `branchSaved` and `unpushed`.
Missing folders use empty strings/lists, zero ignored paths, false `branchSaved`, and null `unpushed`.
`unpushed` counts HEAD commits on no remote-tracking ref, i.e. work that exists only on this machine;
it is null when the repository has no remote refs or the count cannot be read. No fetch is performed.
`branchSaved` is true when every commit of the branch is also on another branch, tag or remote ref
(`git rev-list <branch> --not --exclude=<branch> --branches --tags --remotes` is empty); detached HEAD uses any containing ref.
`branchDeletable` requires removable, a completed Request, and `branchSaved`.

One status call reads dirty and ignored paths without optional locks. Collapsed ignored directories
count as one path. Any path segment in the following list is regenerable, including collapsed directories:

```text
node_modules dist build out .next .nuxt .output .svelte-kit .turbo .vite .cache
.parcel-cache coverage .nyc_output storybook-static .vercel .wrangler target
__pycache__ .pytest_cache .mypy_cache .ruff_cache .venv venv .tox .gradle
.dart_tool Pods DerivedData .expo .angular generated test-results playwright-report
```

The path prefix `.husky/_/` (husky's hook shims) is also regenerable, as are files named `.DS_Store` or
`next-env.d.ts` or ending in `.log`, `.pyc`, `.tsbuildinfo`. Add more in the config with `"regenerable": ["name", "path/prefix/"]`
(a list; entries containing `/` are path prefixes, a folder ending in `/` or one generated file such as
`packages/prisma/src/enums.ts`; the rest folder names).

Secrets are never regenerable: `.env`, `.env.*`, `id_rsa*`, `id_ed25519*` and files ending in `.pem`, `.key`,
`.p12`, `.pfx`, `.keystore`, `.jks` block removal even inside a regenerable folder. Collapsed regenerable
folders are walked for them (up to 5000 entries), except dependency folders: `node_modules .venv venv Pods
.gradle DerivedData .cache target .git`.

All other ignored paths add the `ignored` Blocker and prevent removal. `remove` checks dirty and ignored
paths again right before `git worktree remove`, after any request lookup.
