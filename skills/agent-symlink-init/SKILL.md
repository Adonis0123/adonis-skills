---
name: agent-symlink-init
description: "Initialize or migrate agent-skill symlinks in any repository for Claude Code, Codex, Cursor, and Antigravity (agy) / Gemini setups. Use when a project needs `.claude/skills` linked to `.agents/skills`, `AGENTS.md` linked to `CLAUDE.md`, checks for `GEMINI.md` or `.agents/skills.json`, migration away from `.ruler`-based AI rules, or removal of legacy `sync-llm-skills` copy/sync setups. Trigger on requests about Claude, Codex, Cursor, or Antigravity (`agy`) / Gemini skill symlinks, AGENTS/CLAUDE/GEMINI rule links, `.claude/skills` setup, replacing copied skill folders with symlinks, or cleaning old ruler/sync automation."
metadata:
  author: Adonis
---

# Agent Symlink Init

Set up or migrate a repository to the symlink-based agent-skill layout.

## Outcomes

- Make `.agents/skills` the source of truth across hosts (Codex, Cursor, and Antigravity (`agy`), which natively discovers `.agents/skills/*/SKILL.md` and optional `.agents/skills.json` from the repository root).
- Ensure `.claude/skills` points at the repository's `.agents/skills` directory, without creating `.gemini/skills` symlinks inside the repository because Antigravity already reads `.agents/skills/*/SKILL.md` natively.
- Ensure `AGENTS.md` is a symlink to `CLAUDE.md` when `CLAUDE.md` exists, which also covers Antigravity (`agy`) since it natively discovers `AGENTS.md` (and optional `GEMINI.md`) at the repository root.
- Preserve any existing non-symlink `GEMINI.md` or `.agents/skills.json` unless the user explicitly requested consolidating `GEMINI.md` into `CLAUDE.md`/`AGENTS.md`.
- Remove obsolete ruler or sync automation only when it is actually present and the user explicitly requested that migration.
- Keep the migration idempotent and non-destructive.

## Detect Before Editing

Confirm the requested repository or project root before editing. For a Git repository, use `git rev-parse --show-toplevel` and work from that root within the authorized scope. Do not require `.git` to be a directory: worktrees and separate Git directories use a `.git` file. A `package.json` alone does not prove a Git root.

For a non-Git project, use the root explicitly identified by the user; if it is unclear, ask for the target directory. Perform only the requested filesystem setup and report that Git tracking checks are unavailable.

Inspect these paths first:

- `.agents/skills`
- `.agents/skills.json`
- `.claude/skills`
- `CLAUDE.md`
- `AGENTS.md`
- `GEMINI.md`
- the .ruler directory
- the sync-llm-skills.ts script under the scripts directory
- `package.json`
- `.gitignore`

Account for Antigravity (`agy`) discovery and file safety before changing anything:

- Antigravity natively discovers `.agents/skills/*/SKILL.md` and `AGENTS.md` from the repository root (as well as optional `.agents/skills.json` and `GEMINI.md`). Keeping `.agents/skills` as the source of truth and `AGENTS.md -> CLAUDE.md` already covers Antigravity alongside Claude Code, Codex, and Cursor, so do not create `.gemini/skills` symlinks inside repositories (redundant links add maintenance noise without changing discovery).
- Inspect `GEMINI.md` and `.agents/skills.json` alongside `CLAUDE.md` and `AGENTS.md`. Never overwrite or delete an existing non-symlink `GEMINI.md` or `.agents/skills.json` because they can hold Antigravity-specific project instructions or skill settings—unless the user explicitly requested consolidating `GEMINI.md` into `CLAUDE.md`/`AGENTS.md`.

Classify the work into these modules:

1. `symlink-init`
   Run when `.claude/skills` is missing or does not point at the repository's `.agents/skills` directory, or when `AGENTS.md` should point to `CLAUDE.md` but does not.
2. `migrate-from-ruler`
   Offer when a .ruler directory exists or `package.json` still contains ruler-related scripts or `postinstall` fragments. Run only when the user's request includes migrating/removing ruler.
3. `migrate-from-sync`
   Offer when legacy copy-based sync automation exists. A `--sync-llm` flag alone is not proof: inspect the referenced script/function. If it only ensures `.claude/skills -> .agents/skills`, it already implements the target symlink model and must remain.

Detection identifies candidates; it does not authorize every module. Run `symlink-init` alone when that is all the user requested. Before deleting `.ruler`, sync scripts, or package scripts, require a request that clearly authorizes that migration and name the exact removal set. Preserve or back up untracked/otherwise hard-to-recover content before replacement or deletion.

If the user explicitly names only one link, narrow `symlink-init` to that link. For example, “only initialize `.claude/skills`” must not create or replace `AGENTS.md`; report the other link as an optional follow-up instead.

## Execute `symlink-init`

1. Ensure `.agents/skills` exists:

```bash
mkdir -p .agents/skills
```

2. Ensure `.claude` exists:

```bash
mkdir -p .claude
```

3. If `.claude/skills` is a regular directory or file instead of a symlink, preserve it before replacing it:
   - Prefer a backup named **.claude/skills.bak**
   - If that backup path already exists, choose a timestamped backup name
4. Create or refresh the symlink (do not create `.gemini/skills` inside the repository, since Antigravity reads `.agents/skills/*/SKILL.md` directly):

```bash
ln -sfn ../.agents/skills .claude/skills
```

5. Unless the user narrowed the request to `.claude/skills` only, if `CLAUDE.md` exists, ensure `AGENTS.md` points to it:
   - If `AGENTS.md` is a regular file, back it up before replacing it
   - Leave any existing non-symlink `GEMINI.md` or `.agents/skills.json` untouched unless the user explicitly asked to consolidate `GEMINI.md` into `CLAUDE.md`/`AGENTS.md` (if explicitly requested, preserve unique content in `CLAUDE.md` or a backup before replacing or removing `GEMINI.md`)

```bash
ln -sfn CLAUDE.md AGENTS.md
```

6. Update `.gitignore`:
   - **Remove** any .claude/skills and AGENTS.md ignore entries if they exist. These symlinks must be tracked by git so that collaborators get them on clone.
   - Remove any associated comments (e.g. `# Agent skills (symlinked)`, `# START Ruler Generated Files`).
   - Do not add new ignore entries for the symlinks.

## Execute `migrate-from-ruler`

Run this module only when ruler artifacts still exist and the user requested ruler migration/removal.

1. Remove the .ruler directory.
2. Edit `package.json`:
   - Remove scripts whose keys clearly belong to ruler automation, such as `ruler:apply` or `ruler:check`
   - Remove only the ruler-related fragment from `postinstall`
   - Remove `postinstall` entirely if nothing remains
3. Edit `.gitignore`:
   - Remove ruler-specific ignore entries (e.g. ruler block comments, `/CLAUDE.md`, `/AGENTS.md` if they were ruler-generated ignores)
   - Do not re-add `/AGENTS.md` to `.gitignore` — the symlink must be tracked by git
4. Do not delete `CLAUDE.md` unless the user explicitly asks. The goal is to replace the automation mechanism, not to discard the current source-of-truth document.

## Execute `migrate-from-sync`

Run this module only when legacy copy/sync automation is present and the user requested sync migration/removal. Do not run it against a current symlink helper merely because its CLI flag is named `--sync-llm`.

1. Remove the sync-llm-skills.ts file under `scripts/` if it exists.
2. Edit `package.json`:
   - Remove `scripts["skills:sync:llm"]`
   - Remove only the `--sync-llm` flag from `skills:test:local` if the rest of the command is still valid
   - Remove sync-related fragments from `postinstall`
   - Remove `postinstall` entirely if nothing remains
3. Edit `.gitignore`:
   - Remove the .claude/skills ignore entry and any associated comments — the symlink must be tracked by git, not ignored
   - The old ignore was for copy-based sync artifacts; symlinks should be committed
4. Leave `.agents/skills` contents in place. Migrate the linkage model, not the skill payload itself.

## Editing Rules

- Make the smallest safe change set.
- Preserve unrelated `package.json` scripts.
- When cleaning `postinstall`, remove only the obsolete command fragment and keep remaining commands in order.
- Skip modules whose signals are absent.
- If the repository already matches the target layout, report that no migration is needed instead of rewriting files.

## Verify

Run lightweight checks after editing:

```bash
test -L .claude/skills && readlink .claude/skills
test -f CLAUDE.md && test -L AGENTS.md && readlink AGENTS.md
```

Also inspect:

- `.gemini/skills` is absent (no redundant repo-local symlink created for Antigravity)
- Any pre-existing non-symlink `GEMINI.md` or `.agents/skills.json` remains intact unless `GEMINI.md` consolidation was explicitly requested
- `package.json` for stale ruler or sync commands
- `.gitignore` for duplicate or contradictory entries
- `git diff --stat` or equivalent to summarize the migration

## Report Back

Return:

1. Which modules ran
2. Which files were created, updated, backed up, or removed
3. Verification results
4. Any follow-up action the user should consider, such as reinstalling dependencies if `postinstall` behavior changed
