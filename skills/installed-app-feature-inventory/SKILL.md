---
name: installed-app-feature-inventory
description: "Use when listing a Mac app's real features from the install."
license: MIT
metadata:
  author: Adonis0123
---

# Installed app feature inventory

Use when the user asks to check, on this machine, what an installed desktop app can actually do. Public articles are contrast only. Local files win.

## Steps

1. Resolve three names separately: bundle id, on-disk `.app`, and the System Events process name. The menu title, the process name, and the bundle id often differ. Use the process that owns the `.app`, not the localized menu title.
2. Decide whether a document window is on screen. A running process, or an accessibility tree that is only the menu bar, is not an open window.
3. If there is no document window, stop trying to `activate` or switch to the app. A tray-resident process stays at zero windows, and raising it flashes the user's screen. Read the bundle instead.
4. Inventory in three tiers and label every row with its tier:
   - **Registry** — a machine-readable manifest that has an explicit status field. Only a ready or enabled status counts as registered.
   - **Package** — feature directories or `SKILL.md` (or the app's equivalent) on disk. Present on disk is not the same as registered.
   - **UI copy** — localization files (`.po`, `.strings`). A shipped string proves the copy exists, not that the control was opened or entitled for this account.
5. Walk the feature directory even when a registry lists a subset. Do not report the registry count as the full set.
6. In the write-up, lead with the version and the evidence source. If the product has both a command surface and task skills, put them in separate tables. Say what was not opened.

## Pitfalls

- Do not treat a clicked in-app guide flag as proof an invite, login, or entitlement succeeded. The flag only records the click.
- Do not copy a web writeup's feature list into the local inventory. If the package has no file for that integration, mark it unverified on this machine.

## App notes

- 剪映专业版 macOS：[references/jianying-pro-macos.md](references/jianying-pro-macos.md)
