# Glossary

Vocabulary for git worktrees and when they may be removed. Use these terms exactly in reports; avoid the listed synonyms.

**Repository**:
A git repository, identified by its main worktree (the folder whose `.git` is a directory).
_Avoid_: project, repo folder

**Worktree**:
An extra checkout of a Repository (a git linked worktree). It belongs to its Repository and is never a Repository of its own.
_Avoid_: sub-project, branch folder, clone

**Activity**:
The newest of: the last commit, the last checkout or commit recorded in the worktree's HEAD log, the modification time of any uncommitted file, and the last activity a tool (Orca) recorded. Opening a folder or running `git status` is not Activity.
_Avoid_: last used, last opened

**Stale worktree**:
A Worktree with no Activity for the threshold (default 7 days), no uncommitted changes, not locked, not pinned in a tool, and whose HEAD is reachable from some ref. Only Stale worktrees are removed.
_Avoid_: expired, dead, abandoned

**Blocker**:
A reason a Worktree is kept: `main`, `locked`, `missing`, `unreadable`, `dirty`, `pinned`, `unsaved-head` (detached HEAD on no ref), `recent`.
_Avoid_: error, warning

**Request**:
The pull or merge request for a Worktree's branch on its host (GitHub, cnb.cool, GitLab), with state `open`, `merged`, `closed`, `none` (no request) or `unknown` (the host could not be asked).
_Avoid_: PR status, MR status

**Prune**:
Dropping git's record of a Worktree whose folder no longer exists. It never touches a folder that exists, so it runs on every scan.
_Avoid_: cleanup, gc
