# Where space hides on a developer Mac

`python3 "$TIDY" known` measures the fixed locations below (the list lives in `assets/locations.json`; add a location there, not here). This page explains how to judge each kind. Sizes are from one real 926 GB machine that had 63 GB free, to show the order of magnitude, not a promise.

## Build output (usually the largest, tier A)

- **Next.js `.next`**: `.next/dev` grows with every dev session; one app reached 29 GB, all `.next` folders together about 100 GB. Turborepo `.turbo` and Cargo `target` add tens more. Every git worktree of a repository carries its own copy.
- Use `artifacts` and `clean`; they skip folders git does not ignore and packages where a process (a dev server, a build) runs. A folder named `.turbo` that git does not ignore is reported, not deleted.
- After a clean, the next dev start or build is slower once. The space comes back over time; mention that a repository with many worktrees regrows fastest.

## Package-manager caches (tier A)

- **uv** (`~/.cache/uv`): look inside `archive-v0` for many copies of one package. 87 copies of `analytics-mcp` (about 30 GB) came from an MCP config running `uv tool run analytics-mcp` without a version pin, recreated daily. `uv cache clean` freed 38 GB by its own count but only 7 GB of free space, because installed environments still shared the clones.
- **pnpm**: `~/Library/pnpm/store/v<N>`; only the store version the installed pnpm uses is live. Older store versions (for example `v3` next to `v10`) can go whole; prune the live one with `pnpm store prune`. Projects' `node_modules` are clones of the store, so the gain is less than the store size.
- **npm** `~/.npm` (`_npx` holds every package ever run with `npx`), Yarn, Bun, pip, Go, Cargo, Gradle, Maven, Homebrew: each has its own cleaner in the locations list.
- Browsers for test tools (Playwright, Puppeteer): keep the revisions projects pin, remove older ones.

## Tool versions and upgrade leftovers (tier A)

- Codex: `~/.codex*/.tmp/marketplaces/.staging/marketplace-upgrade-*` (250 folders, 24 GB) accumulates on every plugin upgrade; keep the newest per account and only clean while no upgrade runs (nothing modified in the last 30 minutes). `~/.codex/packages/standalone/releases` keeps every version; keep what `current` links to and the previous one.
- Claude Code (`~/.local/share/claude/versions`), Cursor agent, Grok (`~/.grok*/downloads`): a running session may still execute an older version. Read `lsof -p <pid>` for each running `claude`, `grok`, `codex`, `cursor-agent` process and keep those versions.
- Before deleting, search shell profiles, `~/.local/bin`, agent homes and launcher symlinks for the exact version paths.

## AI agent data (tier B)

- Session transcripts (`~/.codex*/sessions` by year/month, `~/.claude*/projects`, `~/.grok*/sessions`, `~/.cursor/chats`, Orca's Codex runtime sessions): deleting loses resume and history search. Offer "older than N days" with the size that frees.
- Agent homes often symlink `skills`, `plugins` and `hooks` to one shared folder; count each real folder once.
- Backups made by account switchers (for example `~/.cc-switch/backups`) are tier B: ask whether the migration they protect is settled.
- Generated images, visualizations and evaluation workspaces are the owner's output, tier B.
- Growth that is configured, not accidental: Claude Code keeps transcripts for `cleanupPeriodDays` (365 on one machine); Codex's `thread_history_*.sqlite` grows with every thread. Report the setting together with the size.
- Agent installers that keep every install: Hermes left one ~750 MB folder per install under `~/.hermes/installs`. Keep the one the launcher uses.

## Repositories and worktrees (tier B)

- Report per repository: total size, `.git` size, last commit, uncommitted changes, unpushed commits. Repositories untouched for 6+ months with nothing unpushed can be re-cloned later.
- Worktrees go to worktree-tidy. Many are blocked by ignored files that are not secrets but local generated output (`locales/`, `.lingui/`, `.debug/`); the owner can mark those regenerable in worktree-tidy's config.
- Rendered media in a project (`out/` of a video project) is finished work, tier B, even when git ignores it. Intermediate frames next to it (`out/frames*`, `vframes`) add 3-8 GB per render and are rebuildable once the final video exists; offer them separately from the finished files.
- Several full clones of one repository (`app`, `app2`, `app3`, ...) each carry their own `node_modules` and build output; ask which clones are still used before suggesting worktrees instead.
- `node_modules/.cache` holds webpack, babel-loader and Remotion caches (5.5 GB in one old app); `artifacts` reports it with the package that owns it.

## Apps and their data (tier B)

- Chat apps (WeChat, WeCom, Feishu/Lark, QQ, Telegram, Slack) keep media for years; 30 GB+ each is common. Clean through the app's storage manager, or uninstall an unused one with its data.
- Unused apps: `mdls -name kMDItemLastUsedDate`. A missing date does not mean never used. Uninstall moves the `.app` and its Library folders to the Trash (see SKILL.md, step 5).
- Docker Desktop: `Docker.raw` shows its maximum size in `ls`; `du` shows the real use. Contents are visible only with Docker running (`docker system df`).
- Claude desktop `vm_bundles` (11 GB) backs the local agent mode; it downloads again when used.
- Chrome: site storage under `Service Worker/CacheStorage` (deleting signs out of those sites), the on-device model `OptGuideOnDeviceModel`, and `com.google.Chrome.code_sign_clone` under `/private/var/folders` (grew from 10 to 21 GB in a week; quitting Chrome and restarting the Mac clears it).
- Alfred clipboard history can reach 8 GB and may contain secrets; offer the app's retention setting.

## Trash

Check `~/.Trash` first: an earlier cleanup may be sitting there (67 GB in the example). Only the owner empties it.
