---
name: disk-tidy
description: "Free disk space on a developer's Mac (Linux partly) when the disk is nearly full: measure where the space went across build output, package-manager caches, app data, AI agent data, old tool versions and worktrees, fan the read-only survey out to subagents, merge it into a tiered cleanup list, clean only what the user approves, and report the real gain from free space before and after. Use whenever the user says the disk or SSD is (almost) full, asks what is eating space, what can be cleaned or deleted to free space, or why free space keeps shrinking, in any language, Chinese included. Hands organizing personal files to file-tidy and removing git worktrees to worktree-tidy. Not for organizing files without a space problem, a single known cache command, or system files that need sudo."
metadata:
  author: adonis
  version: "1.0.0"
---

# Disk Tidy

Find out where a nearly full disk went, then free space without losing anything the owner still needs. You measure and propose; the user decides per item; you clean and prove the gain.

`TIDY=<this skill's directory>/scripts/disk_tidy.py` (Python 3.9+, standard library only) does the parts that must be exact: free space, well-known locations, and build output that is safe to delete. Use absolute paths.

## Ground rules

Each rule protects something that is hard to get back.

- Survey read-only. Nothing is deleted, moved or emptied before the user picks it from the cleanup list. A cleanup the user approved stays within what they picked.
- Never empty the Trash, and say so. Apps and user files go to the Trash so the owner can put them back; the space returns only when the owner empties it.
- Never open credential, token, cookie or chat content. Judge app data, profiles and session folders by name, size and date. If a config points at a key file (for example `GOOGLE_APPLICATION_CREDENTIALS`), report the path, never the contents, and leave the file where it is.
- Check what is in use right before deleting: process working directories (`lsof -d cwd`), the binary each running session executes, and dev servers. Keep any version a running process uses, the version a launcher links to, and the one before it.
- Delete build output only when git ignores it (`git check-ignore`). A folder that merely looks like a cache but is tracked or outside git is real work until shown otherwise.
- Prefer each tool's own cleaner (`uv cache prune`, `pnpm store prune`, `npm cache clean --force`, `brew cleanup`, in-app storage managers) over `rm`, because it knows what is still referenced.
- `du` overstates what deletion frees: APFS clones (pnpm, uv and Next.js copy files that way) and hard links are counted once per path. Quote `du` sizes as estimates and report only the `free` difference as the result.

## Workflow

### 1. Snapshot

Run `python3 "$TIDY" free --note before-cleanup`. Every call is appended to `~/.local/state/disk-tidy/free.jsonl` and compared with the previous snapshot, so "it shrank again since last time" gets a measured answer; when there is no earlier snapshot, say the weekly change cannot be computed. Start `du -xhd1 ~ | sort -hr | head -30` in the background: it can take many minutes on a large home and tells you which top-level folders to look into.

macOS has no `timeout` command. Bound a slow `du` with `perl -e 'alarm shift; exec @ARGV' 300 du -sk <dir>`, or run it in the background, rather than letting one scan stall the survey.

### 2. Survey in slices

Split the survey by owner so slices don't overlap. With subagents available, run the slices in parallel, each read-only and each told to return a table of path, size, what it is, tier, how to clean, and risk, listing only items above about 500 MB. Without subagents, do the slices in turn.

| Slice                          | Covers                                                                                                                                                                                                             | Start with                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Build output and dev caches    | `.next`, `.turbo`, `node_modules/.cache` (webpack, babel, Remotion), Cargo `target` and similar under the code folders; package-manager caches; toolchains; Docker                                                 | `python3 "$TIDY" artifacts <code roots> --out <scratch>/artifacts.json`, `python3 "$TIDY" known` |
| Apps and system                | `~/Library/Application Support`, `Containers`, `Group Containers`, `Caches`, `/Applications` with last-used dates (`mdls -name kMDItemLastUsedDate`), iOS backups, local snapshots (`tmutil listlocalsnapshots /`) | `known` rows of tier B                                                                           |
| AI agent data and repositories | each agent home (`~/.claude*`, `~/.codex*`, `~/.grok*`, `~/.cursor`, ...): sessions by month, upgrade leftovers, old CLI versions; repository and worktree sizes, last commit, unpushed work                       | `ls -la` first: shared folders are often symlinks and must not be counted twice                  |
| The owner's files              | Downloads, Desktop, Documents, Movies, large files, duplicates, installers                                                                                                                                         | the file-tidy skill, if installed: its `scan` and `dupes` are read-only                          |

[references/hotspots.md](references/hotspots.md) lists where space usually hides on a developer machine and how each place is cleaned; read it before writing the slice prompts.

### 3. Look for growth that will come back

A pile of near-identical items with consecutive dates means something keeps recreating them. Clearing it without stopping the cause only buys time. Examples: dozens of copies of one package in the uv cache (an MCP server launched with `uvx` or `uv tool run` and no pinned version), hundreds of `marketplace-upgrade-*` folders, a `.next/dev` that grows with every dev session. Find the source (agent MCP configs, launch agents, the tool's settings) and report it with the cleanup item. Say plainly when the source is gone and the pile is only history.

### 4. Merge into one list

Merge the slices, drop paths two slices both counted, and sort by size into tiers:

- **A, rebuildable**: caches and build output that tools recreate on demand; old tool versions nothing runs.
- **B, owner decides**: data with value or side effects: chat media, sessions, Docker images, rendered videos, app profiles, unused apps, worktrees, repositories not touched for months.
- **C, keep**: in use, irreplaceable, or owned by the system.

Show A and B as tables with size, what is lost, and the risk, with an A total that is honest about clones. Ask which groups to clean; the host's question tool with multi-select works well here.

### 5. Clean what was picked

- **Build output**: `python3 "$TIDY" clean <artifacts.json>` as a dry run, then `--yes`. It deletes only known build-output folder names that git ignores and that no process works in, re-checks each just before deletion, and prints the free-space gain.
- **Caches**: the tool's own cleaner from the hotspots list.
- **Old versions and leftovers**: list exact targets with sizes, check running binaries (`lsof -p <pid>` for each session) and launcher links, keep current and previous, then delete. Re-run each tool's `--version` afterwards.
- **Worktrees**: the worktree-tidy skill. Removing worktrees frees less than `du` suggests because `node_modules` is cloned.
- **Apps**: quit check with `pgrep`, then move the `.app` and its own Library folders (Application Support, Containers, Group Containers, Caches, Preferences, Saved Application State, matched by bundle id) to the Trash through Finder: `osascript -e 'tell application "Finder" to delete {POSIX file "<path>", ...}'`. Finder may answer `-15260` (busy); wait a few seconds and retry. Confirm each path is gone.
- **In-app data** (WeChat, Feishu, WeCom, Chrome site storage): tell the user where the app's storage manager is; do not delete these folders behind the app's back.
- **The owner's files**: the file-tidy skill, with its Plan and dry run.

A step that fails stops that group; report it instead of working around it.

### 6. Report

- free space before and after (`free --note after-cleanup`), and the gain per group where it was measured
- what is in the Trash and its size, and that it frees space only once emptied
- anything that will grow back and its cause
- what stayed (B items not picked, blocked items and why) and the next candidates
- anything not verified, such as sizes `du` could not read without sudo

## Boundaries

- Organizing files without a space problem belongs to file-tidy; this skill only hands it the owner's-files slice.
- System folders that need sudo, Time Machine, and APFS snapshots are reported, not touched.
- On Linux the build-output, cache and agent slices apply as written; app data lives in `~/.config`, `~/.local/share` and `~/.cache` instead of `~/Library`. Windows is not covered.
