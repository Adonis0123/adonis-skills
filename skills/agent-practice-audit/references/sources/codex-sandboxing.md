---
slug: codex-sandboxing
title: Sandbox
publisher: OpenAI
url: https://learn.chatgpt.com/docs/sandboxing.md
fetchedAt: 2026-10-31
lastVerifiedAt: 2026-10-31
linkStatus: ok
finalUrl:
---

# Sandbox

## Summary

- The sandbox sets technical limits on what the agent and the commands it spawns can do during local runs.
- Sandbox and approval policy are separate controls: one sets boundaries, the other decides when to stop and ask.
- Enforcement is OS-native: Seatbelt on macOS, a native sandbox or WSL2 on Windows, and `bubblewrap` on Linux.
- Three modes exist: read-only, workspace-write (the usual default) and danger-full-access with no filesystem or network limits.
- Approval policies are on-request or never; the older untrusted option is retired.
- Approvals can be reviewed by the user or, for eligible requests, an automatic reviewer agent; the sandbox boundary stays the same.
- Full access means danger-full-access plus never asking; the lower-risk preset pairs workspace-write with on-request approvals.
- Extra writable roots and command-prefix rules offer narrower exceptions than turning the sandbox off.
- Some Linux distributions need an AppArmor profile for `bubblewrap`; disabling the restriction globally is a weaker fallback.

## Cited quotes

- "the lower-risk local automation preset is sandbox_mode = "workspace-write" together with approval_policy = "on-request"" (safe-low-risk-preset)
