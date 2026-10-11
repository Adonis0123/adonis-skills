---
name: file-tidy
description: "Organize a person's own files on macOS, Linux or Windows into one numbered Root (default ~/Files): empty Downloads and screenshot Inboxes, clear the desktop, file personal, work, finance, media, installer and sensitive files into Categories, find duplicate files, and point app save locations at the Inboxes. Use when the user asks, in any language (e.g. 整理文件/桌面/下载、去重), to tidy, sort, dedupe or file their Desktop, Downloads, home folder, documents or data drives, set default download or screenshot folders, repeat the scheme on a new computer, or undo a previous tidy. Every run is planned, verified, reversible and never deletes. Not for code repositories, cloud documents, photo-library management or disk-space analysis alone."
metadata:
  author: adonis
  version: "1.3.0"
---

# File Tidy

Keep a person's own files in one Root, grouped into numbered Categories, with every new file arriving through an Inbox. Read [references/glossary.md](references/glossary.md) first and use its terms in plans and reports, so the user sees the same words every run.

`TIDY=<this skill's directory>/scripts/file_tidy.py` is the engine (Python 3.9+, standard library only). It never decides where a file belongs: you decide, the user reviews, and the script moves, verifies and records. Use absolute paths for the script and for every plan entry, because the script may run from any working directory.

On Windows or WSL, read [references/windows.md](references/windows.md) before the first step; it covers how to run the engine, path forms, drives and Windows-only tools.

## Hard rules

Each rule protects something that is hard to get back.

- Never delete. The tool removes nothing. Byte-identical duplicates and installers of apps that are already installed go to the OS trash with the `trash` action, or to the Quarantine with the `quarantine` action where the trash is unsafe (Windows: see windows.md > Duplicates and quarantine). Never replace duplicates with hard links: backup tools copy them back into separate files, and an edit through one name changes all of them. Only the owner empties the trash or the Quarantine, after checking the result.
- Never open or print anything headed for the Sensitive Zone. Classify identity scans, passwords, tokens, keys and credentials by name, type and location alone, because their contents would end up in the transcript.
- Never move App Data, Code Roots or Notes, and never move or trash a Default Folder itself; move only the owner's files out of it. Apps recreate these folders and expect their own data to stay put. As a backstop the script refuses the home folder, Default Folders, system and app-data folders, the Root's `_system` folder and anything under `outside_root` in the config (Windows: see windows.md > What never moves).
- Keep original file names so the owner can still search for them. Name new directories by the config `naming`: `"en"` (default) is lowercase English. If the user wants another language, set `naming` and write the Category ids in it yourself, keeping the two-digit prefixes because they fix the sort order (example table in windows.md > Localized Category names). Any path an app, game, terminal or script uses stays English without spaces, because many programs break on non-ASCII paths.
- Nothing moves before a Plan dry-run passes. Ask the user to confirm the Plan unless they already authorized the run. Always show `trash`, `quarantine` and uncertain items separately, because those are the ones the user must judge.

## Locate the Root and config

1. Root is `$FILE_TIDY_ROOT` if set, else `~/Files`.
2. Config is `<Root>/_system/config.json`. If it is missing, this is a first run: go to Setup.
3. The config lists Categories (purpose and children), the precedence order, Inbox paths, `outside_root` directories (Notes, Code Roots, App Data), `app_settings` to re-check, `naming`, and optional `drives` (what each drive is for, used to decide where large or app-owned things go). The Root need not be on the system drive. Windows: see windows.md > Paths for path forms and where the Root may not go.

## Setup (first run on a machine)

1. Start from `assets/default-config.json` on every platform. With more than one drive, ask the user what each drive is for and record it in `drives`. Change Categories only if the user asks; keep the two-digit prefixes and the gaps so later Categories fit in between.
2. `python3 "$TIDY" init --root <Root> --config <edited config>` (dry-run), then add `--apply`. Windows: see windows.md > Running the engine.
3. Fill `outside_root` with the machine's real Notes, Code Roots and App Data directories. Windows: see windows.md > Probing the machine.
4. Point save locations at Inboxes following [references/app-defaults.md](references/app-defaults.md) and record each app in `app_settings`.
5. Write a one-page `<Root>/README.md` for humans: the Category table and "new files arrive in Downloads and the Capture Inbox".

## Tidy run

1. **Scan** the Inboxes, the Workbench and any directory the user named: `python3 "$TIDY" scan <dirs...> --hash`. Equal `sha256_tree` values mean byte-identical content, even under different names.
2. **Classify** every top-level item. A directory that forms one coherent unit moves whole; a mixed directory is split item by item.
   - Apply the config `precedence`: the Sensitive Zone beats finance, finance beats work and personal, and those beat media. Anything about money goes to finance. Media holds only creative work and reusable assets.
   - When the name says nothing (`Screenshot …png`, `IMG_1234.jpg`, `report.csv`), look at the content before giving up: view images, read the first lines of text, CSV and documents, and use metadata such as the download source or creation date. Skip this for Sensitive Zone candidates. The Capture Inbox deserves the effort because the user expects it to end up empty.
   - Installers: check the installed apps (`/Applications` and `~/Applications`, the package manager, or Program Files on Windows). If the same app and version is installed, remove the installer with `trash` or `quarantine`; otherwise move it to the installers Category.
   - Duplicates: run `python3 "$TIDY" dupes <dirs...> [--min-size N]` for a report of byte-identical files (it skips hard links and `_quarantine`, and moves nothing). Decide per group: keep the copy in the better location and remove the others. Treat a Live Photo's HEIC and same-name MOV as one pair, since one without the other is broken. Exclude thumbnail caches from phone-maker PC backup suites (such as `.thumbnails` or `thumb`) before judging; they look like duplicates but the backup tool owns them. Judge a whole game or app folder as one unit, never file by file; uninstall a game through its platform first, then remove what remains.
   - The Archive takes only what the user explicitly retired.
   - If an item is still unclear after looking, leave it where it is and list it with what you saw. A wrong guess is harder to find later than a file left in the Inbox.
3. **Check references.** Moving a file breaks every absolute path that points at it: shell profiles, `.env` files and project configs (cloud service-account keys are the usual case), agent configs and symlinks, launch agents, shortcuts, and video-editor projects. Before writing the Plan, search for each source path in the shell profiles, `~/.config`, the Code Roots, the Notes and the agent config folders, for example `rg -l --hidden -F "<source path>" ~/.zshrc ~/.config <code roots>`. An item referenced by active config either stays put, or the report lists the exact reference to update after the move. Media referenced by a video-editor project stays put unless the user agrees to relink it. Put cloud-sync client folders, desktops managed by an organizer tool, and game saves under `outside_root` instead of moving them, because their owners treat a move as a delete or lose track of the files. Windows: see windows.md > Shortcuts for listing and fixing shortcuts.
4. **Write the Plan** to `<Root>/_system/plans/<YYYYMMDD>-<topic>.json`:

   ```json
   {
     "root": "~/Files",
     "items": [
       {
         "src": "~/Downloads/invoice-0003.pdf",
         "dest": "30_finance/invoices/company/2026/invoice-0003.pdf",
         "reason": "company invoice"
       },
       {
         "src": "~/Downloads/SomeApp.dmg",
         "action": "trash",
         "reason": "SomeApp.app 2.1 is installed"
       }
     ]
   }
   ```

   `dest` is relative to the Root (or absolute) and is the full target path, not a parent directory. When one item goes inside another item's destination, list the enclosing item first.

5. **Dry-run** with `python3 "$TIDY" apply <plan>`. It rejects existing destinations, destinations that differ only in letter case, nested sources and protected paths. Fix every error; never work around one by deleting. Each `WARN` about a relative link means the moved directory would break that link: treat the directory as uncertain.
6. **Confirm and apply.** Show the Plan as a table grouped by Category, with `trash` and `quarantine` items and their evidence listed separately. After approval, run `apply <plan> --apply`.
7. **Verify.** On success the command prints the Manifest path, and every entry has `"verified": true`. On failure it prints the error, the Manifest path and how many items moved; report that state and stop, because the Manifest can roll back what already moved. Re-scan the Inboxes and the Workbench and say what is left and why.
   Cross-volume copies are checked by content SHA-256; same-volume moves are checked by metadata (names, sizes, mtimes, link targets), since a rename does not change content and this keeps large moves fast. Each Manifest entry records which (`"verify": "stat"` or `"sha256"`), and rollback checks the same way.
8. Re-check `app_settings` and report any app whose save location drifted.

## Undo

Run `python3 "$TIDY" rollback <Root>/_system/manifests/<stamp>.json` as a dry-run, then add `--apply`. Items are restored newest first, each re-verified just before it moves. Rollback stops if an item changed since the move or its original path is now occupied, so it never overwrites newer work. If the user has emptied the trash, or restored an item from it by hand, since the run, add `--skip-missing` to restore everything else. On Linux each trashed item sits directly in `Trash/files` with a freedesktop `Trash/info/<name>.trashinfo`, so the desktop trash can also restore it; rollback deletes that `.trashinfo` after restoring the item. On macOS the script moves items into a `file-tidy-<stamp>` folder in `~/.Trash` and writes no Put Back record, so Finder's "Put Back" does not work for them; use rollback instead.

## Report

State:

- how many items moved into each Category
- the items sent to trash or Quarantine, with their total size (neither is emptied)
- the items left for the user, with what you saw and why they stayed
- the Manifest path
- references found to moved paths, and which were updated
- app settings that were changed or have drifted
- anything not verified

## Platform notes

| Platform        | Trash for removed items                                                    | Engine                                           | Read                                  |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| macOS           | OS Trash (`trash`)                                                         | `python3`                                        | app-defaults.md > macOS               |
| Linux           | freedesktop Trash (`trash`)                                                | `python3`                                        | app-defaults.md > Policy              |
| Windows and WSL | same-drive Quarantine (`quarantine`); `trash` is refused on Windows drives | `py -3` natively, or `python3` from WSL (slower) | windows.md, app-defaults.md > Windows |
