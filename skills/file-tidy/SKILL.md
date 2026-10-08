---
name: file-tidy
description: "Organize a person's own files into one numbered Root such as ~/Files on macOS, Linux or Windows: empty the Downloads and screenshot Inboxes, clear the desktop Workbench, file scattered personal, work, finance, media, installer and sensitive files into Categories, and point app save locations at the Inboxes so it stays tidy. Use whenever the user asks to tidy, sort, clean up or file their Desktop, Downloads, home folder or personal documents in any language, to set default download or screenshot folders, to set up the same filing scheme on a new computer, or to undo a previous tidy run. Every run writes a reviewed Plan, moves with content-hash verification, keeps a rollback Manifest and never deletes. Not for code repositories, cloud or Feishu documents, photo-library management, or disk-space analysis alone."
metadata:
  author: adonis
  version: "1.1.0"
---

# File Tidy

Keep a person's own files in one Root, grouped into numbered Categories, with every new file arriving through an Inbox. Read [references/glossary.md](references/glossary.md) first and use its terms in plans and reports.

`TIDY=<this skill's directory>/scripts/file_tidy.py` is the engine (Python 3.9+, standard library; on Windows run it with `py -3`). It never decides where a file belongs. You decide, the user reviews, and the script moves, verifies and records. Use absolute paths for the script and for every plan entry.

## Hard rules

Each rule protects something that is hard to get back.

- Never delete. Byte-identical duplicates and installers of apps that are already installed may go to the OS trash with the `trash` action (macOS and Linux only; on Windows leave them and list them). Everything else is moved.
- Never open or print anything that is headed for the Sensitive Zone. Identity scans, passwords, tokens, keys and credentials are classified by name, type and location alone, because their contents would end up in the transcript.
- Never move App Data, Code Roots or Notes. Never move or trash a Default Folder itself (Desktop, Downloads, Documents, Pictures, Movies, Music); move only the owner's files out of it. Apps recreate these folders and expect their own data to stay put. As a backstop the script refuses the home folder, Default Folders, `~/Library` (`AppData` on Windows), the Root's `_system` folder, and anything listed under `outside_root` in the config.
- Keep original file names so the owner can still search for them. Name new directories in lowercase English; use another language only for a leaf directory that is never used from a terminal and has no good English name.
- Nothing moves before a Plan dry-run passes. Ask the user to confirm the Plan unless they already authorized the run. Always show `trash` items and uncertain items separately.

## Locate the Root and config

1. Root is `$FILE_TIDY_ROOT` if set, else `~/Files`.
2. Config is `<Root>/_system/config.json`. If it is missing, this is a first run: go to Setup.
3. The config lists Categories (purpose and children), the precedence order, Inbox paths, `outside_root` directories (Notes, Code Roots, App Data) and `app_settings` to re-check.

## Setup (first run on a machine)

1. Start from `assets/default-config.json`. Adjust Categories only if the user asks; keep the two-digit prefixes and the gaps.
2. `python3 "$TIDY" init --root <Root>` (dry-run), then add `--apply`.
3. Fill `outside_root` in the new config with the machine's real Notes, Code Roots and App Data directories.
4. Point save locations at Inboxes following [references/app-defaults.md](references/app-defaults.md) and record each app in `app_settings`.
5. Write a one-page `<Root>/README.md` for humans: the Category table and "new files arrive in Downloads and 00_inbox".

## Tidy run

1. **Scan** the Inboxes, the Workbench and any directory the user named: `python3 "$TIDY" scan <dirs...> --hash`. Equal `sha256_tree` values mean byte-identical content, even under different names.
2. **Classify** every top-level item. A directory that forms one coherent unit moves whole; a mixed directory is split item by item.
   - Apply the config `precedence`: the Sensitive Zone beats finance, finance beats work and personal, and those beat media. Anything about money goes to finance. Identity documents, passwords, tokens, keys and credential files go to the Sensitive Zone. Media holds only creative work and reusable assets.
   - When the name says nothing (`Screenshot …png`, `IMG_1234.jpg`, `report.csv`, `Screen Recording …mov`), look at the content before giving up: view images, read the first lines of text, CSV and documents, and use metadata such as the download source or creation date. Skip this for Sensitive Zone candidates. Captures in the Capture Inbox are worth this effort because the user expects that inbox to end up empty.
   - Installers: check `/Applications` and `~/Applications` (or Program Files on Windows). If the same app and version is installed, use `trash`; otherwise move the installer to the installers Category.
   - Duplicates: keep the copy in the better location and `trash` the others.
   - The Archive takes only what the user explicitly retired.
   - If the item is still unclear after looking, leave it where it is and list it with what you saw. A wrong guess is harder to find later than a file left in the Inbox.
3. **Check references.** Moving a file breaks every absolute path that points at it: shell profiles, `.env` files and project configs (credential files such as cloud service-account keys are the usual case), agent configs and symlinks, launch agents, and media projects in video editors. Before writing the Plan, search for each source path in the shell profiles, `~/.config`, the Code Roots and Notes, and the agent config folders, for example `rg -l --hidden -F "<source path>" ~/.zshrc ~/.config <code roots>`. An item referenced by active config either stays where it is, or the Plan's report lists the exact reference to update after the move. Media referenced by a video-editor project stays put unless the user agrees to relink it.
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

5. **Dry-run** with `python3 "$TIDY" apply <plan>`. It rejects existing destinations, destinations that differ only in letter case, nested sources, and protected paths. Fix every error; never work around one by deleting. Each `WARN` about a relative link means the moved directory would break that link: treat the directory as uncertain.
6. **Confirm and apply.** Show the Plan as a table grouped by Category, with `trash` items and their evidence listed separately. After approval, run `apply <plan> --apply`.
7. **Verify.** On success the command prints the Manifest path, and every entry has `"verified": true`. On failure it prints the error, the Manifest path and how many items moved. Report that state and stop; the Manifest can roll back what already moved. Re-scan the Inboxes and the Workbench and say what is left and why.
8. Re-check `app_settings` and report any app whose save location drifted.

## Undo

Run `python3 "$TIDY" rollback <Root>/_system/manifests/<stamp>.json` as a dry-run, then add `--apply`. Items are restored newest first, and each one is re-verified just before it moves. Rollback stops if an item changed since the move or if its original path is now occupied. If the user has emptied the trash since the run, add `--skip-missing` to restore everything else. On macOS, Finder's "Put Back" does not work for items this script trashed; use rollback instead.

## Report

State:

- how many items moved into each Category
- the items sent to trash, with their total size (the trash is not emptied)
- the items left for the user, with what you saw and why they stayed
- the Manifest path
- references found to moved paths, and which were updated
- app settings that were changed or have drifted
- anything not verified
