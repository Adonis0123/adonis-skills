# Glossary

Vocabulary for where a person's own files live on a personal computer, what they are grouped by, and how new files arrive. Use these terms exactly; avoid the listed synonyms.

## Places

**Root**:
The single directory that holds every organized user file (default `~/Files`).
_Avoid_: vault, library, data folder

**Category**:
A first-level directory of the Root with a two-digit prefix (for example `30_finance`); the prefix fixes sort order and leaves gaps for future Categories.
_Avoid_: section, bucket, top folder

**Inbox**:
A temporary landing place for new files; it only receives, and every tidy run empties it into Categories. Two kinds exist: the **Download Inbox** (the OS Downloads folder, used by every app) and the **Capture Inbox** (`00_inbox`, or the `00` Category in the language `naming` sets; screenshots and screen recordings).
_Avoid_: to-sort folder, temp folder

**Workbench**:
The desktop; holds only files currently being worked on and is never a storage location.
_Avoid_: desktop archive

**Archive**:
Material the owner explicitly retired but wants to keep, stored by year in `90_archive`.
_Avoid_: backup, old files

**Quarantine**:
A `_quarantine` directory at the top of a drive that holds duplicates and leftovers removed by a tidy run, on the same drive so nothing is copied. It is used where the OS trash is unsafe, such as Windows drives, whose Recycle Bin permanently drops files over its size cap. The owner deletes it after confirming nothing is missing. Unlike the Archive, nothing in it is meant to be kept.
`quarantine` (lowercase, code font) is the Plan action that moves an item there; **Quarantine** is the `_quarantine` folder itself.
_Avoid_: recycle bin, archive

**Sensitive Zone**:
The separate Category (`99_sensitive`) for identity documents, passwords, tokens, keys and credentials, so it can be encrypted or excluded from backup as one unit.
_Avoid_: private folder, personal folder

## Outside the Root

**Notes**:
Writing the owner authors (Markdown notes, knowledge base); lives in its own notes directory, not in the Root.

**Code Roots**:
Directories that hold source repositories; organized by repository ownership, not by the Root.

**App Data**:
Directories an application creates and manages itself (photo libraries, editor projects, chat storage, app folders inside Documents, system Library folders); never moved by a tidy run.

**Default Folder**:
An OS-provided user folder (Desktop, Downloads, Documents, Pictures, Movies/Videos, Music, and on Windows also Saved Games, Contacts, Favorites, Links, 3D Objects, Searches), the same names under `~/OneDrive/` when OneDrive backs them up, and every path in the config's `known_folders` (Windows: see windows.md > Probing the machine). Default Folders are kept in place because apps recreate them; only the owner's own files are moved out of them.

## Operations

**Plan**:
A reviewed list of items to move, trash or quarantine, each with source, destination and reason, written before anything moves.

**Manifest**:
The per-run record of what actually moved: original path, destination, tree hash, how it was verified (`verify`: `stat` for same-volume moves, which are verified by metadata because content is unchanged by a rename; `sha256` for cross-volume copies and for older Manifests without the field) and reason; used for verification and rollback.
_Avoid_: log, record
