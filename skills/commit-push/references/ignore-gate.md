# Ignore vs Commit Gate

Read this before staging any unstaged or untracked path.

## Classify every candidate

- **Ignore by default:** secrets (`.env` and `.env.*`, except `.env.example`), `node_modules/`, virtual environments, build/cache output (`.next/`, `dist/`, `coverage/`, `.turbo/`, `*.log`), OS noise (`.DS_Store`), and other local-only junk. Do not stage it. When the repository lacks the pattern, append the smallest suitable `.gitignore` entry and re-run `git status --short`.
- **Commit when in scope:** source, tests, docs, shared configuration, `.gitignore` changes, lockfiles already tracked by the repository, and generated files only when the repository tracks them by convention.
- **Ask when ambiguous:** large binaries or media, IDE directories such as `.vscode/` and `.idea/`, and generated artifacts whose ownership is unclear.
- **Stop for already-tracked sensitive or local-only paths:** warn the user and suggest `git rm --cached -- <path>` plus a matching `.gitignore` rule. Never silently untrack or commit a secret.

Prefer including a necessary `.gitignore` fix in the same focused commit, or in a separate tiny `chore` commit when it is a distinct concern.

## Report every ignore action

Never silently skip a candidate. In the same turn, report:

- path or pattern;
- why it was excluded;
- whether it was left unstaged or added to `.gitignore`.

Omit the ignore section only when nothing was excluded and `.gitignore` did not change.
