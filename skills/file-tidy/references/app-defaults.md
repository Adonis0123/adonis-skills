# App Save Locations

Goal: every app keeps writing to a Default Folder or an Inbox, so new files never land in the Root's Categories or on the Workbench by accident. Prefer leaving defaults alone; change only apps that write to the Workbench (desktop).

Record each checked app in `<Root>/_system/config.json` under `app_settings` as `{ "app", "expected", "how" }` so later runs can re-check it.

## Policy

| Source                                                         | Expected location                     | Why                                                                                           |
| -------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Browsers (Chrome and other Chromium browsers, Safari, Firefox) | Download Inbox (OS default Downloads) | Already the default; app updates and new profiles keep it. Do not enable "ask where to save". |
| OS screenshots and screen recordings                           | Capture Inbox                         | The OS default is the desktop, which turns the Workbench into storage.                        |
| Chat or meeting apps that save screen recordings               | Capture Inbox                         | Same reason.                                                                                  |
| Chat apps' received-file storage                               | Leave as is (App Data)                | Moving it usually relocates the whole chat database. "Save as" already goes to Downloads.     |

## macOS

Screenshots and screen recordings share one setting:

```bash
mkdir -p ~/Files/00_inbox
defaults write com.apple.screencapture location ~/Files/00_inbox
killall SystemUIServer
defaults read com.apple.screencapture location   # verify
```

UI equivalent: Cmd-Shift-5 → Options → Save to → Other Location.

Chromium-family browsers store the download directory per profile in `<profile>/Preferences` under `download.default_directory`; a missing key means the OS Downloads folder. Edit only through the browser UI (Settings → Downloads) or with the browser fully quit, otherwise the browser overwrites the file on exit. Do not use the `DownloadDirectory` enterprise policy: it locks the setting and shows "managed by your organization".

Apps that keep settings in encrypted stores (for example many chat apps) can only be changed in their own settings UI. Check the result by recording a short clip or saving a file and confirming where it lands.

## Windows

Not yet defined. Decide the Root location and the PowerShell equivalents in a dedicated session before running on Windows. `scripts/file_tidy.py` runs there with `py -3`, except for the `trash` action: list duplicates and installed-app installers for the user instead.
