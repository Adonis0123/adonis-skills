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
A temporary landing place for new files; it only receives, and every tidy run empties it into Categories. Two kinds exist: the **Download Inbox** (the OS Downloads folder, used by every app) and the **Capture Inbox** (`00_inbox`, screenshots and screen recordings).
_Avoid_: to-sort folder, temp folder

**Workbench**:
The desktop; holds only files currently being worked on and is never a storage location.
_Avoid_: desktop archive

**Archive**:
Material the owner explicitly retired but wants to keep, stored by year in `90_archive`.
_Avoid_: backup, old files

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
An OS-provided user folder (Desktop, Downloads, Documents, Pictures, Movies/Videos, Music). Default Folders are kept in place because apps recreate them; only the owner's own files are moved out of them.

## Operations

**Plan**:
A reviewed list of items to move or trash, each with source, destination and reason, written before anything moves.

**Manifest**:
The per-run record of what actually moved: original path, destination, content hash and reason; used for verification and rollback.
_Avoid_: log, record
