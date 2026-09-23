# Display asleep / lock screen → Orca TUI log

When the user asks to **look at** Orca / Claude Code (Kimi CU or `computer_use`) and also says **允许抢焦点 / 我没在操作 / 你要智能一点**.

This does **not** replace process+CPU+mtime (`SKILL.md` §1–4). It is the look-at-screen path.

## Order

1. `system_profiler SPDisplaysDataType` — if `Display Asleep: Yes`, window capture will fail (`could not create image`). One `caffeinate -u -t 4` if focus is allowed; then **one** full-display shot.
2. Full display is lock screen (date + large clock + Touch ID / Enter Password) → **stop**. Do not click, type, or unlock. Mention that the display was woken. Finish from TUI log.
3. Unlocked → at most **one** Orca window capture. Electron ScreenCaptureKit may still fail (`px_capture_unavailable`). Fail once → log; do **not** click window-center / re-raise / swap Kimi `mode=image`.
4. Do not pass cua-driver `window_id` to Kimi. Kimi `app` = bundle id (`com.stablyai.orca`); `mode` only `full|image|ax`.

## TUI log

Newest dir under `~/Library/Application Support/orca/terminal-history/` whose name contains the repo. Read `output.log` (it keeps growing). `checkpoint.json` `lastTitle` can lag.

| Tail | Verdict |
|------|---------|
| `Gallivanting…` / hooks, duration climbing | still working |
| `Baked for …` + `❯` | **done, waiting for you** |
| permission / question prompt | stuck on input |

If the next user message is `锁屏`, use the dedicated `lock_screen` path — not `computer_use`.
