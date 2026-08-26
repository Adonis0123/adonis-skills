---
name: agent-symlink-init
description: "Initialize or migrate agent-skill symlinks in any repository. Use when a project needs `.claude/skills` linked to `.agents/skills`, `AGENTS.md` linked to `CLAUDE.md`, migration away from `.ruler`-based AI rules, or removal of legacy `sync-llm-skills` copy/sync setups. Trigger on requests about Claude/Codex skill symlinks, AGENTS/CLAUDE symlinks, `.claude/skills` setup, replacing copied skill folders with symlinks, or cleaning old ruler/sync automation."
metadata:
  author: Adonis
---

# Agent Symlink Init

Set up or migrate a repository to the symlink-based agent-skill layout.

## Outcomes

- Make `.agents/skills` the source of truth.
- Ensure `.claude/skills` points at the repository's `.agents/skills` directory.
- Ensure `AGENTS.md` is a symlink to `CLAUDE.md` when `CLAUDE.md` exists.
- Remove obsolete ruler or sync automation only when it is actually present and the user explicitly requested that migration.
- Keep the migration idempotent and non-destructive.

## Detect Before Editing

Work only from the repository root. Require either `.git/` or `package.json`.

Inspect these paths first:

- `.agents/skills`
- `.claude/skills`
- `CLAUDE.md`
- `AGENTS.md`
- the .ruler directory
- the sync-llm-skills.ts script under the scripts directory
- `package.json`
- `.gitignore`

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
4. Create or refresh the symlink:

```bash
ln -sfn ../.agents/skills .claude/skills
```

5. Unless the user narrowed the request to `.claude/skills` only, if `CLAUDE.md` exists, ensure `AGENTS.md` points to it:
   - If `AGENTS.md` is a regular file, back it up before replacing it

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

- `package.json` for stale ruler or sync commands
- `.gitignore` for duplicate or contradictory entries
- `git diff --stat` or equivalent to summarize the migration

## Report Back

Return:

1. Which modules ran
2. Which files were created, updated, backed up, or removed
3. Verification results
4. Any follow-up action the user should consider, such as reinstalling dependencies if `postinstall` behavior changed
