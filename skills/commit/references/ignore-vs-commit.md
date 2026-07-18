# Ignore vs Commit Gate

Before staging any path, classify every candidate — especially `??` untracked paths. Wrong classification either leaks secrets/noise into history, or leaves teammates re-hitting the same junk files.

## Default IGNORE

Do **not** stage. If the pattern is missing from `.gitignore` (and is not intentionally tracked by this repo), append a **minimal** pattern and leave the file unstaged.

| Category | Typical patterns |
| --- | --- |
| Secrets / private | `.env`, `.env.*` (except `.env.example` / `.env*.example`), `*.pem`, `*.key`, credentials, tokens, cookies, private keys, certificates with secrets |
| Dependencies | `node_modules/`, `.venv/`, `venv/`, `vendor/`, `__pycache__/`, `.pnpm-store/` |
| Build / cache | `dist/`, `build/`, `.next/`, `out/`, `coverage/`, `.turbo/`, `.cache/`, `*.tsbuildinfo`, `*.log` |
| OS / editor noise | `.DS_Store`, `Thumbs.db`, `*.swp` |
| Local-only runtime | Machine-local agent/session state that is not project source |

Prefer patterns that match the **class** of file (e.g. `.env*` with an exception for examples) over one-off absolute paths, unless the repo already uses path-specific ignores.

## Default COMMIT

Stage with an explicit path when the path is in the chosen commit scope:

- Source, tests, docs, and shared team configs
- Updates to `.gitignore` / `.gitattributes` themselves
- Lockfiles when the repo already tracks them (`pnpm-lock.yaml`, `package-lock.json`, etc.)
- Generated files **only if** this repo already tracks that path by convention (e.g. a committed `skills-index.json`)

## Ask when ambiguous

- Large binaries / media not clearly part of the product
- IDE dirs (`.vscode/`, `.idea/`) — some teams commit shared settings
- Generated artifacts with no clear track/ignore convention
- Anything that looks like personal machine state but might be intentional project tooling

## Actions

1. **Should-ignore + untracked + missing pattern** → append a minimal pattern to `.gitignore`, do **not** stage the junk file. Prefer including the `.gitignore` fix in this commit (or a tiny `chore` commit) so the same noise does not reappear for teammates.
2. **Should-ignore + already tracked** → stop and warn. Suggest `git rm --cached -- <path>` plus a `.gitignore` entry. Do **not** silently rewrite history for tracked secrets; escalate to the user.
3. **Should-commit** → `git add -- <path>` only for paths in scope.
4. Never use bare `git add .` / `git add -A` to skip classification.
5. After updating `.gitignore`, re-check `git status --short` so ignored paths disappear from candidates before message generation.

## Tell the user (required, not silent)

Never silently drop paths. Whenever you ignore something, skip staging it, or edit `.gitignore`, **tell the user in the same turn** (before or with the commit result — not only if they ask):

- **What**: path or pattern (e.g. `.env`, `node_modules/`)
- **Why**: short reason (secret, dependency dir, build artifact, OS noise, …)
- **What you did**: e.g. “did not stage”; “appended `X` to `.gitignore`”; “left already-tracked file alone and need your call on `git rm --cached`”
- **What will be committed**: if `.gitignore` itself is part of this commit, say so explicitly

If several paths share one reason, group them in one short list. If nothing was ignored, no extra section is needed.

## Why this gate exists

Commit skills are the last automated checkpoint before history. Classifying early keeps diffs reviewable, prevents secret leaks, and turns recurring untracked noise into a durable `.gitignore` fix instead of a repeated “skip this file” decision.
