# Windows

Read this before any run on Windows or from WSL. SKILL.md points here for every Windows-specific step. Save-location settings are in `app-defaults.md` > Windows.

Confidence labels: **official** = vendor documentation; **community** = forums, blogs, user reports, not vendor-confirmed; **inferred** = reasoned from how the system works, not checked against a source. Re-check community and inferred rows on the user's machine before acting.

## Running the engine

- Natively, run `py -3 "<skill dir>\scripts\file_tidy.py" ...` when the launcher exists. From WSL, `python3` on `/mnt/<x>/...` paths also works, but WSL reaches Windows drives over 9P, which is several times slower for hashing and tens of times slower for many small files; at terabyte scale prefer native.
- `init` takes the same `assets/default-config.json` as other platforms: `init --root <Root> --config <edited config>`, dry-run first, then `--apply`.

## Paths

- Configs and Plans may keep Windows paths (`D:\Files`). Under WSL the script converts `X:\...` to `/mnt/x/...`, so the same files work from both sides.
- Config paths may use `%VAR%` (`%USERPROFILE%\Desktop`). Under WSL the script takes `%VAR%` from the environment; `%USERPROFILE%` falls back to the only real Windows profile under `/mnt/c/Users`, or to what `cmd.exe` reports when there are several. A path that still cannot be expanded is skipped with a `WARN config: ...` line in the dry-run; replace it with the full path before `--apply`.
- UNC paths (`\\server\share`) are refused under WSL, because their drive cannot be determined. Symlinked parents are resolved before the protection checks.
- The Root must not sit under a drive's top-level system folder (`Users`, `ProgramData`, `Program Files`, `Windows`); the engine refuses to write there. Pick a plain folder on a data drive, for example `D:\Files`, or `%USERPROFILE%\Files` on a single-drive machine.

## Probing the machine

`scripts/windows/probe-locations.ps1` prints read-only JSON of Known Folders, Chromium download folders, Steam libraries, chat data folders and Xbox capture settings; unknown values are `null`. Use it during Setup to fill `outside_root`, and after each run to compare with `app_settings`.

- From WSL: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "<skill dir>/scripts/windows/probe-locations.ps1")"`
- Natively: `powershell -NoProfile -ExecutionPolicy Bypass -File "<skill dir>\scripts\windows\probe-locations.ps1"`

Copy every non-null value of the probe's `known_folders` into the config's `known_folders` list. Windows calls Default Folders "Known Folders" and lets users redirect them to another drive or into OneDrive; listing them makes the engine protect the redirected locations too (never moved whole, nor any folder holding them; their contents may move).

## Shortcuts

Moving a folder leaves dead Desktop and Start-menu shortcuts. `scripts/windows/shortcuts.ps1` lists the shortcuts that point into a folder, and with `-To <new> -Apply` retargets those whose new target exists.

- From WSL: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "<skill dir>/scripts/windows/shortcuts.ps1")" -From "<Windows path>"`
- Natively: `powershell -NoProfile -ExecutionPolicy Bypass -File "<skill dir>\scripts\windows\shortcuts.ps1" -From "<dir>"`
- Run it before the Plan to list affected shortcuts, and after the move with `-From <old> -To <new> -Apply`.
- For a path with non-ASCII characters (for example `D:\Games\游戏`), pass it as UTF-8 base64 so no console codepage can alter it: `-FromBase64 "$(printf '%s' '<old>' | base64 -w0)"`, and `-ToBase64` the same way. The script refuses a path containing `?`, the mark of characters lost on the way in.

## Localized Category names

`naming` only records the user's choice; you write the Category ids. An example for `"zh"` (adjust to the user's wording, keep the prefixes):

| `en` id         | `zh` example |
| --------------- | ------------ |
| `00_inbox`      | `00_收件箱`  |
| `10_personal`   | `10_个人`    |
| `20_work`       | `20_工作`    |
| `30_finance`    | `30_财务`    |
| `40_media`      | `40_媒体`    |
| `80_installers` | `80_安装包`  |
| `90_archive`    | `90_归档`    |
| `99_sensitive`  | `99_敏感`    |

Update `precedence` and `inboxes.capture` to the new ids. Children used by apps or scripts stay English.

## Drive roles

With more than one drive, ask the user what each drive is for and record it in the config `drives`, so later runs know where large or app-owned things belong. The table is one common layout (an example), not a requirement.

| Role     | Typical drive                                                | Contains                                                                      | Confidence |
| -------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------- |
| System   | `C:`                                                         | Windows, `%USERPROFILE%`, App Data, apps that refuse other drives             | inferred   |
| Root     | `<drive>:` with the most free space or `%USERPROFILE%\Files` | The numbered Root                                                             | inferred   |
| Games    | `<drive>:` (SSD preferred)                                   | Platform libraries (`SteamLibrary`, `XboxGames`, WeGame) and standalone games | inferred   |
| App data | `<drive>:\appdata\<app>`                                     | Chat data moved by the user, e.g. `<data drive>:\appdata\wechat`              | community  |
| Backup   | external or second drive                                     | Additive backups only (see Backups)                                           | inferred   |

## What never moves on Windows

Probe these and list every hit under `outside_root` before planning. Moving them breaks the app, loses saves, or is synced as a deletion.

| Item                                                       | How to detect                                                                                                               | Why                                                                                                                             | Confidence | Source                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------ |
| Game saves                                                 | `%USERPROFILE%\Documents\My Games`, `%USERPROFILE%\Saved Games`, `%APPDATA%`, `%LOCALAPPDATA%`                              | Saves do not move with the game folder                                                                                          | inferred   | —                                                |
| Platform game libraries                                    | `libraryfolders.vdf`, `SteamLibrary`, `.GamingRoot`, `XboxGames`, `WindowsApps`, `MicrosoftGame.config`                     | Only the platform may move them (see Moving games)                                                                              | community  | https://wpreset.com/what-is-the-gamingroot-file/ |
| Chat data                                                  | `WeChat Files`, `xwechat_files`, `Tencent Files`, WeCom data path (probe output)                                            | Database plus files; user-only move                                                                                             | community  | see Chat apps                                    |
| Cloud sync folders                                         | Cloud sync or netdisk clients (for example OneDrive, Dropbox, Baidu Netdisk)                                                | Moving out is synced as a delete on every device. Pause sync first                                                              | inferred   | —                                                |
| Video-editor projects                                      | Project or draft folders of Premiere, DaVinci Resolve, Jianying/CapCut                                                      | Projects reference media by path                                                                                                | community  | —                                                |
| Desktop organizer folders                                  | An organizer tool that takes over the desktop (for example Fences, DeskGo)                                                  | The tool owns the desktop layout; tidy inside its boxes breaks it. Ask the user to turn it off first                            | inferred   | —                                                |
| System folders                                             | `Windows`, `Program Files`, `ProgramData`, `Users` (outside a real profile; `Default` and `Public` do not count), `AppData` | Owned by Windows and apps; the engine refuses them as source and destination                                                    | inferred   | —                                                |
| `_quarantine`, `$Recycle.Bin`, `System Volume Information` | Drive root                                                                                                                  | System or tool-owned; the engine refuses `_quarantine` and anything inside it as a source (use `rollback`)                      | inferred   | —                                                |
| Redirected Known Folders                                   | Probe `known_folders` (Desktop, Documents, Pictures, Screenshots moved to another drive or into OneDrive)                   | Copy into the config `known_folders`; the engine then refuses to move them or any folder holding them, but moves their contents | inferred   | —                                                |

Also note, without changing: Photos app only indexes the Pictures library (moved photos vanish from it unless the folder is added); System Restore and BitLocker status (`manage-bde -status`, read-only) before moving between drives. Confidence: inferred.

## Moving games

Uninstalling unwanted games: uninstall in the platform first, then `quarantine` the leftover folder.

| Source                     | How to identify                                                                 | How to move                                                                                                                                                                                                                                                                                                                                                                                                                                              | Verify                                      | Confidence | Source                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steam                      | `steamapps`, `libraryfolders.vdf`                                               | Add a library on the target drive, then move each game. Menu names differ by client version: new client Settings > Storage, then the game's Properties > Installed Files > Move install folder; old client Settings > Downloads > Steam Library Folders, then Properties > Local Files > Move Install Folder (official). Do not hand-edit `libraryfolders.vdf`; the default library under the Steam install cannot be renamed as a whole (both inferred) | Verify integrity of game files; launch once | official   | https://help.steampowered.com/en/faqs/view/4BD4-4528-6B2E-8327 https://www.howtogeek.com/269515/how-to-move-a-steam-game-to-another-drive-without-re-downloading-it/ |
| WeGame                     | WeGame install path in its settings                                             | Settings > add download path; for already installed games use "add game manually" or full-disk scan after moving. League of Legends: reinstall instead; the path must not contain Chinese characters or spaces. ACE anti-cheat errors: run repair first                                                                                                                                                                                                  | WeGame repair; launch once                  | community  | https://www.lenovo.com.cn/wiki/article-159785.html                                                                                                                   |
| EA app                     | EA app library                                                                  | Uninstall, then reinstall at the new location (EA community team statement). Optional community tip to avoid re-downloading: start the install into the new folder, pause, copy the old files in, resume (unverified)                                                                                                                                                                                                                                    | EA app repair; launch once                  | community  | https://forums.ea.com/discussions/ea-app-general-discussion-en/how-to-move-games-to-another-drive/12192837                                                           |
| Xbox app / Microsoft Store | `.GamingRoot` at drive root, `XboxGames`, `WindowsApps`, `MicrosoftGame.config` | Only Xbox app > Manage > Move; older titles may need "Advanced management features" enabled first. Never move by hand (inferred)                                                                                                                                                                                                                                                                                                                         | Launch once                                 | community  | https://www.pcworld.com/article/623123/how-to-install-or-move-xbox-pc-games-to-any-folder.html https://wpreset.com/what-is-the-gamingroot-file/                      |
| Standalone (no launcher)   | Folder with the game `.exe`, no platform markers                                | Move the whole folder with `apply`, then `shortcuts.ps1 -From <old> -To <new> -Apply`                                                                                                                                                                                                                                                                                                                                                                    | Launch once; check saves and mods           | inferred   | —                                                                                                                                                                    |

Platform UI steps: if the host provides a Computer Use style tool, tell the user first and then click through; otherwise give the user the click path. Confidence: inferred.

## Chat apps

The rows below use chat apps common in China (WeChat, QQ, WeCom) as examples; other chat apps work the same way: the user migrates by hand and the agent only gives the steps.

Policy: **the user does every step by hand; the agent only gives the steps and checks results.** Reason: the data is a live database with no vendor migration guide, and a mistake loses chat history. No official Tencent documentation exists; everything below is community.

| Fact                                                                                                                                                                                            | Confidence           | Source                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| WeChat 4.x and QQNT do not migrate old data when the storage path changes; the new folder gets an empty structure                                                                               | community            | https://www.zhihu.com/tardis/jm/ans/2019907569150379973 https://www.bilibili.com/opus/1087991288539643906 |
| The app creates its own subfolder under the chosen folder (WeChat `xwechat_files`, QQ `Tencent Files`), so choose the parent, e.g. `<data drive>:\appdata\wechat`                               | community            | https://gitcode.csdn.net/6aa0e2141a35784c8420a0cb.html                                                    |
| WeChat 3.x `WeChat Files` has a different layout from 4.x and cannot be copied in; use "import old records" at first 4.x login. Import copies, so space doubles until the old folder is removed | community            | https://www.v2ex.com/t/1123577 https://www.zhihu.com/tardis/jm/ans/2037541908017313320                    |
| WeCom: no reliable guide. `HKCU\Software\Tencent\WXWork\Properties` `DataLocationPath` may be read, never edited. A greyed-out button may be company policy                                     | community / inferred | —                                                                                                         |

Steps for the user:

1. Quit the app completely, including the tray icon.
2. Back up the whole data folder and verify the copy (`file_tidy.py scan --hash` on both).
3. Change the path in the app's settings.
4. Quit the app again.
5. Copy the old data into the subfolder the app just created.
6. Log in to each account and check old chats, images and files.
7. `quarantine` the old folder and keep it for a month before the user deletes it.

## Duplicates and quarantine

The `quarantine` Plan action moves an item into `<drive>:\_quarantine\<stamp>\<path on that drive>` on the same drive, so nothing is copied and the move is instant. The engine refuses `trash` for items on Windows drives (`X:\` natively, `/mnt/x` under WSL) for the reason in the first row. It also refuses `_quarantine` as a source (use `rollback`) and as a destination except for the quarantine action itself.

| Practice                                                                                                                                                                                                                                                    | Confidence                            | Source                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Use `quarantine`, not `trash` (the engine refuses `trash` for items on Windows drives): the Recycle Bin's default cap is about 5–10% of the drive (Vista+: 10% of the first 40 GB plus 5% of the rest); oversized deletes from scripts can become permanent | official                              | https://devblogs.microsoft.com/oldnewthing/20140701-00/?p=603                                                                         |
| Per-drive cap is stored in `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\<guid>` `MaxCapacity` (read only)                                                                                                                      | inferred (observed on a test machine) | —                                                                                                                                     |
| Find exact duplicates with `file_tidy.py dupes`; the user picks which copy to quarantine                                                                                                                                                                    | inferred                              | —                                                                                                                                     |
| Do not deduplicate with hard links: NTFS only, same volume only, max 1023 links, backup tools copy each link, editing one changes all                                                                                                                       | official / community                  | https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-createhardlinka https://freefilesync.org/forum/viewtopic.php?p=20348 |
| Similar (not identical) images: suggest czkawka or dupeGuru to the user                                                                                                                                                                                     | community                             | https://github.com/qarmin/czkawka                                                                                                     |
| Sort photos by EXIF `DateTimeOriginal`: suggest exiftool                                                                                                                                                                                                    | official                              | https://exiftool.org/filename.html                                                                                                    |

## Backups

| Practice                                                                                                      | Confidence | Source                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| Do not use `robocopy /MIR` for backups: the target mirrors deletions, so an emptied source empties the backup | official   | https://learn.microsoft.com/windows-server/administration/windows-commands/robocopy |
| Back up additively (copy without purge) or with FreeFileSync versioning                                       | community  | https://freefilesync.org/forum/viewtopic.php?p=20348                                |
| Back up and verify before any cross-drive move of app data                                                    | inferred   | —                                                                                   |

## Pitfalls

| Pitfall                                                                                 | What to do                                                                                                                                                                                                                                                                    | Confidence | Source                                                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| Running from WSL over `/mnt/<drive>` uses 9P; many small files are tens of times slower | Run `py -3` natively on Windows. If run from WSL, `X:\...` paths in config and plans are converted to `/mnt/x/...`                                                                                                                                                            | community  | https://brainwagon.org/blog/2026_07_11_wsl2_filesystem_speed                  |
| Paths over 260 characters fail in native tools                                          | Report long paths to the user instead of skipping silently; use `\\?\` only inside scripts. Never change the registry: `LongPathsEnabled` is a system-wide HKLM setting that needs admin and only helps programs whose manifest declares `longPathAware`, so the user decides | official   | https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation |
| Cloud sync folders treat a move as a delete                                             | Pause sync, keep them in `outside_root`                                                                                                                                                                                                                                       | inferred   | —                                                                             |
| Moved game or app folders leave dead shortcuts                                          | `shortcuts.ps1` list, then `-Apply`                                                                                                                                                                                                                                           | inferred   | —                                                                             |
