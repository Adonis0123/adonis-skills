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

Run `scripts/windows/probe-locations.ps1` first; it prints the current save locations as JSON and changes nothing. Compare it with `app_settings`. `scripts/file_tidy.py` runs with `py -3`; use the `quarantine` action; `trash` is refused for items on Windows drives (see `windows.md`). "Agent via Computer Use" means: if the host provides a Computer Use style tool, tell the user it will take the mouse and keyboard, then click through the settings UI; otherwise give the user the click path to do it themselves.

| Source                                                                                                      | Expected location                                     | How to change                                                                                                                 | Who                    | Confidence | Source                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Screenshots (Win+PrtScn, Snipping Tool auto-save)                                                           | Capture Inbox                                         | Known Folder `{B7BEDE81-DF94-4682-A7D8-57A52620B86F}`: Explorer > Pictures > Screenshots > Properties > Location > Move       | Agent via Computer Use | community  | https://www.howtogeek.com/797229/how-to-change-where-screenshots-are-saved-on-windows/ |
| Xbox Game Bar recordings (`Videos\Captures`)                                                                | Capture Inbox                                         | Same Properties > Location > Move on the Captures folder                                                                      | Agent via Computer Use | inferred   | —                                                                                      |
| NVIDIA App / ShadowPlay recordings                                                                          | Capture Inbox                                         | NVIDIA App > Settings > Recordings / Screenshots location                                                                     | Agent via Computer Use | inferred   | —                                                                                      |
| Chrome, Edge and other Chromium browsers                                                                    | Download Inbox (default Downloads)                    | Browser Settings > Downloads, per profile. Do not edit `download.default_directory` in `Preferences`; the browser rewrites it | Agent via Computer Use | inferred   | —                                                                                      |
| Cloud sync or netdisk clients with their own download folder (for example OneDrive, Dropbox, Baidu Netdisk) | Download Inbox or a dedicated folder outside the Root | App settings > download path                                                                                                  | Agent via Computer Use | inferred   | —                                                                                      |
| Chat app data (for example WeChat, QQ, WeCom)                                                               | Leave as is, or move by the user only                 | See `windows.md` > Chat apps                                                                                                  | User only              | community  | see `windows.md`                                                                       |
