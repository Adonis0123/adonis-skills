---
name: chrome-dev-mcp
description: "Use this skill whenever the user invokes /chrome-dev-mcp or asks for Chrome DevTools MCP, CDP, list_pages/select_page, UXC packaging for Chrome DevTools, DOM snapshots, Console, Network, Performance, Lighthouse, browser-internal debugging, connection recovery, or correct-Chrome validation across Claude Code, Codex, Grok/Grok002, Hermes, or WorkBuddy. Establish or recover the registered connection and prove it with a real list_pages call. Do not use it for ordinary navigation, form filling, scraping, or desktop UI unless browser-internal signals are required."
metadata:
  author: adonis
  version: "1.0.0"
---

# Chrome Dev MCP

Use the host's registered `chrome-devtools` MCP server for browser-internal evidence. Keep host registration authoritative; use bundled scripts only for deterministic recovery and optional UXC diagnostics.

Require a host-registered `chrome-devtools` MCP server. Optional deterministic recovery uses a locally configured safe wrapper and launcher; Chrome's optional UXC facade pins UXC 0.17.0.

## Keep the user contract simple

Let the user remember only `/chrome-dev-mcp`. Handle connection checks, recovery, profile gates, and UXC internally. With no additional task, return only `CHROME_DEV_MCP_READY` after the real tool call. On failure, report one failing layer and one required action.

## Execute the slash entry

Treat `/chrome-dev-mcp` as a readiness action.

1. Call the registered `chrome-devtools` MCP `list_pages` tool immediately.
2. On success, return `CHROME_DEV_MCP_READY` or continue the requested browser-internal work.
3. If the tool is absent, diagnose host discovery. A shell helper cannot register a missing MCP tool.
4. If server startup or `list_pages` fails, run `scripts/ensure-connection.zsh --recover` from this skill, then retry `list_pages` exactly once in the same host.
5. Claim `VERIFIED` only after the real tool call completes. Never expose page URLs, titles, body text, cookies, tokens, or unrelated target data.

Use `/chrome-dev-mcp` in Claude Code and Grok, `$chrome-dev-mcp` in Codex, and preload `chrome-dev-mcp` in Hermes when deterministic selection is needed.

## Preserve the runtime invariant

Keep one chain:

```text
host-native chrome-devtools MCP
  -> user-configured safe wrapper
  -> identity-checked loopback Chrome
  -> pinned chrome-devtools-mcp runtime
```

Require the safe wrapper to validate its configured endpoint, WebSocket address, browser process, and intended profile before exposing the MCP runtime. Let the wrapper launch only the configured isolated profile when the endpoint is absent. Never scan ports, read `DevToolsActivePort`, attach to a remote endpoint, or silently fall back to another browser.

Treat skill discovery, MCP discovery, server handshake, tool discovery, endpoint identity, and a real tool call as separate layers.

## Route by task semantics

Use this skill for:

- DOM or accessibility snapshots and in-page JavaScript evidence.
- Console, Network, Performance, Lighthouse, or heap diagnostics.
- Chrome DevTools MCP/CDP connectivity and correct-profile diagnosis.
- Multi-host discovery and real-tool-call acceptance.

Use the host's native Chrome/browser capability for ordinary navigation and form filling. Use native Computer Use for browser chrome, macOS windows, and cross-app work. Do not substitute Playwright, Computer Use, raw CDP, or another browser layer for missing DevTools MCP when the requested evidence is browser-internal.

## Start with runtime proof

1. Call `list_pages` before using any page index from an earlier turn.
2. Select the target page from the current result. Ask only when the target cannot be resolved safely.
3. Take a fresh text snapshot before element work.
4. Collect only the requested internal signals.
5. After interaction, take a new snapshot and refresh the relevant Console or Network evidence.

Do not echo unrelated page data. A successful handshake is not proof of attachment; a completed `list_pages` call is the minimum runtime proof.

## Recover by failed layer

### Tool absent

Read [references/host-verification.md](references/host-verification.md). Repair host discovery before diagnosing the browser endpoint.

### Startup or tool call failed

Run `scripts/ensure-connection.zsh --recover` from this skill, then retry the host's real `list_pages` once. The helper reads the one-time local configuration produced by `scripts/configure-local.zsh`; it does not depend on shell aliases or login-shell startup.

If identity validation reports the wrong browser or profile, fail closed. Read [references/profile-identity.md](references/profile-identity.md). Never close or restart an existing browser without explicit authorization.

## Use UXC only as a facade

Read [references/uxc-facade.md](references/uxc-facade.md) when the user explicitly asks for UXC or a failed native call needs transport isolation. UXC exposes the same wrapper as a deterministic JSON-first CLI and may reuse its stdio child through a local daemon. It does not replace host registration, correct-browser validation, or per-host `list_pages` acceptance.

Use `uxc-facade` for the generic packaging contract. This skill remains the owner of Chrome identity, connection recovery, safe payload handling, and final `list_pages` acceptance.

Reuse `scripts/install-uxc.zsh` for the pinned UXC binary and its owner manifest. Keep Chrome-specific linking in `scripts/setup-uxc-link.zsh` and payload-stripping acceptance in `scripts/uxc-readiness.zsh`. Never execute an unowned `uxc`, accept a PATH fallback, or overwrite a managed link whose exact contract differs.

## Handle concurrency

Allow concurrent reads of the shared endpoint. Before any write, run `list_pages` and `select_page` again. Do not let two agents modify the same tab. Use separate isolated browsers for truly parallel write tasks.

## Report acceptance

For multi-host validation, report each host independently:

| Host | MCP discovery | Tools discovered | Real `list_pages` | Result |
| ---- | ------------- | ---------------- | ----------------- | ------ |

Use `VERIFIED` only after the real tool call. Otherwise report `UNVERIFIED` or the explicit external blocker.
