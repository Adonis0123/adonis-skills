---
name: kimi-computer-use
description: "Install, register, diagnose, or upgrade Kimi Computer Use (kimi-cu) MCP for Cursor CLI, Grok, WorkBuddy, Claude Code, Codex, or Hermes; fix kimi-cu tool-call errors such as 'no target app' or 'mode must be full, image, or ax'; or look at and verify a running macOS app UI through kimi-cu, such as checking whether a window matches a design. Not for general desktop automation, messaging, or purchasing, and not a replacement for a host's native Computer Use."
metadata:
  author: adonis
  version: "0.4.0"
---

# Kimi Computer Use

Kimi Computer Use (MCP server name `kimi-cu`) is one local macOS MCP service shared by several agent hosts. Keep the executable registration in each host's native config; keep the shared operating rules in this skill. Below, `kimi-cu` names the server and "Cursor CLI" means the `cursor-agent` executable.

## Safety boundary

- Confirm before sending messages, buying, deleting, publishing, changing account settings, or taking another consequential UI action.
- Never bypass macOS TCC, Gatekeeper, authentication, password, Touch ID, or CAPTCHA prompts.
- Ask the user to complete Kimi account login and macOS Privacy & Security toggles when the UI requires them.
- Prefer read-only inspection before interaction. Refresh app state after every UI-changing action.

## Verify the installation

Run the routine check first; add the signature checks only after an install or upgrade:

```bash
# routine check
/Applications/KimiCU.app/Contents/MacOS/kimi-cu service-status
/Applications/KimiCU.app/Contents/MacOS/kimi-cu xpc-ping
defaults read /Applications/KimiCU.app/Contents/Info CFBundleShortVersionString

# install/upgrade-time only
codesign --verify --deep --strict /Applications/KimiCU.app
spctl --assess --type execute -vv /Applications/KimiCU.app
```

Treat `xpc-ping` as the permission source of truth: it prints `accessibility=` and `screenRecording=` from the service itself. Do not infer Accessibility or Screen Recording permission from a host's generic doctor command.

`kimi-cu` has no help command. Unknown subcommands print `unknown command`, unknown flags are ignored, and `kimi-cu upgrade` executes immediately, so never probe subcommands with `--help`.

If the app is missing, use the official Kimi Code plugin flow: update Kimi Code, open `Plugins`, choose `official`, and install `Kimi Computer Use`. Do not install a binary from a reposted script; it bypasses the signature the checks above rely on.

## Register MCP clients

Every host uses the same stdio command:

```text
/Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp -s user
```

Per-host config paths, registration commands, status commands, and the read-only model smoke live in [references/host-configs.md](references/host-configs.md); open only the section for the requested host. Merge the `kimi-cu` entry into the host's existing config and do not point several hosts at one symlinked file: their schemas and reload lifecycles differ.

## Operate through MCP

1. When the target app is already named, call `get_app_state` directly; call `list_apps` only when the process identity is unknown.
2. Call `get_app_state` with `mode: "ax"` for text and accessibility-first inspection; use `image` or `full` only when layout or pixels matter.
3. Use the smallest action that achieves the requested result.
4. Call `get_app_state` again after every mutation and verify the observable result.
5. When the user asks you to look at or verify a running UI, your own completed `get_app_state` result is the evidence. A UI check that ends with zero `kimi-cu` tool calls is `UNVERIFIED`: a host can connect the server and list its tools while the model still never emits a call, and a description from code, memory, or a design file is not an observation of the screen.

### get_app_state arguments

Wrong values here produce `no target app` or `mode must be full, image, or ax`. Both look like permission failures but are argument errors.

| Field  | Required                                                  | Wrong                                                    |
| ------ | --------------------------------------------------------- | -------------------------------------------------------- |
| `app`  | bundle id from `list_apps` (example: `com.google.Chrome`) | display name `Google Chrome`, product name, window title |
| `pid`  | integer from `list_apps`                                  | omit both `app` and `pid`                                |
| `mode` | only `full` / `image` / `ax`                              | `som` / `vision` (those are Hermes `computer_use`)       |

Read-only smoke for every host: `list_apps`, then `get_app_state` with `app=com.apple.finder` and `mode=ax`.

Compare a host's discovered tool set with the live schema instead of a fixed count; a different count after an upgrade is not by itself a failure.

Do not mass-kill `kimi-cu` processes: one `kimi-cu service` helper runs at PPID 1 and each host owns its own `kimi-cu mcp` children, so a sweep breaks other hosts' sessions. Reconnect the affected host instead.

### Choose when to use Kimi CU

Registration does not make `kimi-cu` the default:

- Codex desktop and cross-app work prefer Codex native Computer Use; use `kimi-cu` only as fallback or on explicit request.
- WorkBuddy browser, desktop, and cross-app work prefer WorkBuddy native capabilities; use `kimi-cu` only when native Computer Use is unavailable or insufficient.
- Browser internals such as DOM, Console, Network, and Performance belong to Chrome DevTools MCP, not `kimi-cu`.

## Diagnose failures

Fast path: if the error text is `no target app` or `mode must be full, image, or ax`, fix the tool arguments per the table above and retry the read-only `get_app_state` call. If a client fuse is active, wait for its cooldown before this retry. Stop only after the corrected call completes successfully; that proves the tested call path works, not every host or permission. If the corrected call still fails, continue the layered checks below. If the retry cannot run, report runtime verification as `UNVERIFIED`. An argument error alone does not prove the service is healthy.

Otherwise work from the service outward:

1. Re-run `service-status` and `xpc-ping`.
2. Run the host's native MCP status or test command from the host reference.
3. Confirm the host discovers the installed tool set, including `list_apps` and `get_app_state`.
4. Run the read-only smoke.
5. Separate three states in the report:
   - server connected;
   - tools discovered;
   - model actually emitted and completed a tool call.
6. If Hermes reports `MCP server 'kimi-cu' is unreachable after 3 consecutive failures`, treat it as a client fuse, not evidence of its root cause. Attribute it to bad arguments only when the preceding failed calls show those errors; otherwise keep the cause unresolved. Wait for the cooldown, retry with valid arguments, and re-check with `hermes mcp test kimi-cu` if the retry fails. Do not infer permission health from the fuse message.

If states one and two pass but three fails, test one other officially supported host model before declaring a model-adapter incompatibility. Do not rewrite a working MCP config to compensate for a model that prints tool-call markup as text.

## Upgrade

Check and upgrade in place with `/Applications/KimiCU.app/Contents/MacOS/kimi-cu upgrade </dev/null`; it prints installed versus latest, and EOF keeps an unattended prompt from hanging. For signature and permission rechecks, fresh-session version proof, host reconnection, and source distribution, follow [references/maintenance.md](references/maintenance.md). Existing sessions may report `Transport closed` after an upgrade; reconnect them. Keep installed version, standalone server success, and per-host model acceptance as separate evidence.
