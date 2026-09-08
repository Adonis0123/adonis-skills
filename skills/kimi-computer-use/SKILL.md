---
name: kimi-computer-use
description: This skill should be used when the user asks to install, configure, upgrade, repair, or diagnose Kimi Computer Use (kimi-cu), especially for Cursor CLI, Grok, WorkBuddy, Claude Code, Codex, or Hermes MCP clients.
metadata:
  author: adonis
  version: "0.2.1"
---

# Kimi Computer Use

Use Kimi Computer Use as one local MCP service shared by multiple agent hosts. Keep the executable MCP registration in each host's native config; keep shared operating guidance in this skill.

Maintain this skill in the `adonis-skills` repository at `skills/kimi-computer-use/`. Treat installed copies as distribution targets: update the repository source, then synchronize the intended hosts through their configured skill installation mechanism. A readable file or symlink proves availability, not that an existing session loaded it. Verify discovery separately from MCP registration and runtime calls.

## Safety boundary

- Confirm before sending messages, buying, deleting, publishing, changing account settings, or taking another consequential UI action.
- Never bypass macOS TCC, Gatekeeper, authentication, password, Touch ID, or CAPTCHA prompts.
- Ask the user to complete Kimi account login and macOS Privacy & Security toggles when the UI requires them.
- Prefer read-only inspection before interaction. Refresh app state after every UI-changing action.

## Verify the installation

1. Verify the signed app exists:

   ```bash
   test -x /Applications/KimiCU.app/Contents/MacOS/kimi-cu
   codesign --verify --deep --strict /Applications/KimiCU.app
   spctl --assess --type execute -vv /Applications/KimiCU.app
   defaults read /Applications/KimiCU.app/Contents/Info CFBundleShortVersionString
   ```

2. Check the background service and permissions:

   ```bash
   /Applications/KimiCU.app/Contents/MacOS/kimi-cu service-status
   /Applications/KimiCU.app/Contents/MacOS/kimi-cu xpc-ping
   ```

3. Treat `xpc-ping` as the permission source of truth. Do not infer Accessibility or Screen Recording permission from a generic CLI doctor command.

4. If installation is missing, use the official Kimi Code plugin flow: update Kimi Code, open `Plugins`, choose `official`, and install `Kimi Computer Use`. Do not install an unverified binary from a reposted script.

## Register MCP clients

Use the exact executable and arguments below:

```text
/Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp -s user
```

Apply host-native registration from [references/host-configs.md](references/host-configs.md). Do not replace all host configs with one symlinked file: their schemas and lifecycle commands differ.

Cursor CLI reads its native user or workspace MCP configuration. Merge the `kimi-cu` entry into the existing JSON instead of replacing the file, then use Cursor's own `mcp list` and `mcp list-tools` commands before attempting a model smoke test.

Registration does not make Kimi CU the default for every host:

- Codex desktop and cross-app work prefer Codex native Computer Use; use Kimi CU only as fallback or when the user explicitly requests it.
- WorkBuddy ordinary browser, desktop, and cross-app work prefer WorkBuddy native capabilities; use Kimi CU only when native Computer Use is unavailable or insufficient.
- Browser internals such as DOM, Console, Network, and Performance belong to Chrome DevTools MCP, not Kimi CU.

## Operate through MCP

1. When the target app is already named, call `get_app_state` directly; call `list_apps` only when the process identity is unknown.
2. Call `get_app_state` with `mode: "ax"` for text and accessibility-first inspection; use the visual mode only when layout or pixels are necessary.
3. Use the smallest action that can achieve the requested result.
4. Call `get_app_state` again after every mutation and verify the observable result.
5. Report `UNVERIFIED` when a host discovers the MCP server but its selected model does not emit a real tool call.

### get_app_state contract (hard)

Hermes tool name: `mcp__kimi_cu__get_app_state`.

| Field  | Required                                                  | Wrong                                                    |
| ------ | --------------------------------------------------------- | -------------------------------------------------------- |
| `app`  | bundle id from `list_apps` (example: `com.google.Chrome`) | display name `Google Chrome`, product name, window title |
| `pid`  | integer from `list_apps`                                  | omit both `app` and `pid`                                |
| `mode` | only `full` / `image` / `ax`                              | `som` / `vision` (those are Hermes `computer_use`)       |

Smoke:

1. `list_apps`
2. `get_app_state` with `app=com.apple.finder` and `mode=ax` (or a known pid)

If three consecutive tool calls fail, Hermes may temporarily mark the MCP server unreachable and refuse retries for about one minute. That is client circuit-breaking after bad args, not proof that Kimi CU permissions are down. Wait for the cooldown and retry with valid args; re-check with `hermes mcp test kimi-cu` if needed.

Do not mass-kill `kimi-cu` processes. Many belong to other hosts (Codex/ChatGPT app-server, Grok). Keep the PPID 1 `kimi-cu service` helper and Hermes `mcp_stdio_watchdog` chain.

The verified 0.5.10 baseline exposes `list_apps`, `get_app_state`, `click`, `type_text`, `press_key`, `scroll`, `set_value`, `perform_secondary_action`, `select_text`, and `drag`. Read the live tool schema after future upgrades rather than treating this count as a permanent compatibility limit.

## Diagnose failures

Work from the service outward:

1. Re-run `service-status` and `xpc-ping`.
2. Run the host's native MCP status/test command.
3. Confirm the host reports the installed version's tool set, including the two read-only smoke tools.
4. Run a read-only smoke test: `list_apps`, then `get_app_state` for a harmless app.
5. Separate three states in the report:
   - server connected;
   - tools discovered;
   - model actually emitted and completed a tool call.
6. If the error is `no target app` or `mode must be full, image, or ax`, fix the tool arguments first — do not restart the OS service.
7. If Hermes reports `MCP server 'kimi-cu' is unreachable after 3 consecutive failures`, treat it as a temporary client fuse after bad calls; wait/retry with valid args rather than reinstalling the app.

For Cursor CLI, `mcp list` proves server readiness and `mcp list-tools kimi-cu` proves tool discovery. Neither proves that the selected model emitted a tool call; run the read-only CLI smoke from the host reference and inspect the completed call before reporting end-to-end success. If `cursor-cli` is a shell alias, validate it in a fresh login shell or invoke the underlying Cursor Agent executable directly.

If the first two pass but the third fails, test one other officially supported host model before declaring a model-adapter incompatibility. Do not rewrite a working MCP config to compensate for model output that merely prints tool-call markup as text.

WorkBuddy may expose MCP tools through deferred dispatch. In that case, allow `ToolSearch` and `DeferExecuteTool` narrowly for the session; do not switch the whole session to bypass-permissions mode. See the verified smoke command in the host reference.

## Upgrade

Follow [references/maintenance.md](references/maintenance.md) for the official unattended upgrade, signature and permission checks, fresh-session version proof, affected-host reconnection and source distribution. Existing sessions may report `Transport closed`; reconnect rather than mass-killing processes. Keep installed version, standalone server success and per-host model acceptance as separate evidence.
