---
name: chrome-dev-mcp
description: "This skill should be used when the user invokes /chrome-dev-mcp or asks for Chrome DevTools MCP, CDP, list_pages/select_page, UXC packaging for Chrome DevTools, DOM snapshots, Console, Network, Performance, Lighthouse, browser-internal debugging, connection recovery, or correct-Chrome validation across Claude Code, Codex, Grok/Grok002, Hermes, or WorkBuddy. Establish or recover the shared managed connection and prove it with a real list_pages call. Do not use it for ordinary navigation, form filling, scraping, or desktop UI unless browser-internal signals are required."
metadata:
  author: adonis
  version: "1.1.0"
---

# Chrome Dev MCP

Use the managed `chrome-dev-mcp-cli` facade for browser-internal evidence. It reuses one identity-checked MCP child instead of starting one child per agent session. Keep host-native registration only as an explicit compatibility and rollback path.

Require the locally configured safe wrapper, launcher, and pinned UXC 0.17.0 facade. Never silently fall back to a host-native server because doing so recreates the per-session runtime fan-out this skill is designed to avoid.

## Keep the user contract simple

Let the user remember only `/chrome-dev-mcp`. Handle connection checks, recovery, profile gates, shared-session reuse, and explicit `pageId` routing internally. With no additional task, return only `CHROME_DEV_MCP_READY` after sanitized shared readiness. On failure, report one failing layer and one required action.

## Execute the slash entry

Treat `/chrome-dev-mcp` as a readiness action.

1. Run `scripts/uxc-readiness.zsh` from this skill. It performs a real shared `list_pages` call but discards the page payload.
2. On success, return `CHROME_DEV_MCP_READY` or continue through the managed `chrome-dev-mcp-cli` command.
3. If readiness reports a connection or wrapper failure, run `scripts/ensure-connection.zsh --recover`, then retry shared readiness exactly once.
4. If the CLI, shell, or required response type is unavailable, report `NATIVE_COMPAT_REQUIRED`; do not start a native server automatically.
5. Use host-native `chrome-devtools` only when the user explicitly requests `native` compatibility or approves it after that blocker. Mark that mode because it adds one runtime per host session.
6. Claim `VERIFIED` only after the requested shared tool call completes. Never expose unrelated page URLs, titles, body text, cookies, tokens, or target data.

Use `/chrome-dev-mcp` in Claude Code and Grok, `$chrome-dev-mcp` in Codex, and preload `chrome-dev-mcp` in Hermes when deterministic selection is needed.

## Preserve the runtime invariant

Keep one default chain:

```text
managed chrome-dev-mcp-cli
  -> pinned UXC daemon and one reusable stdio session
  -> user-configured safe wrapper
  -> identity-checked loopback Chrome
  -> pinned chrome-devtools-mcp runtime
```

Require the safe wrapper to validate its configured endpoint, WebSocket address, browser process, and intended profile before exposing the MCP runtime. Let the wrapper launch only the configured isolated profile when the endpoint is absent. Never scan ports, read `DevToolsActivePort`, attach to a remote endpoint, or silently fall back to another browser.

Treat skill discovery, shared transport discovery, server handshake, tool discovery, endpoint identity, and a real tool call as separate layers. Host-native MCP discovery is a compatibility-only layer.

## Route by task semantics

Use this skill for:

- DOM or accessibility snapshots and in-page JavaScript evidence.
- Console, Network, Performance, Lighthouse, or heap diagnostics.
- Chrome DevTools MCP/CDP connectivity and correct-profile diagnosis.
- Multi-host discovery and real-tool-call acceptance.

Use the host's native Chrome/browser capability for ordinary navigation and form filling. Use native Computer Use for browser chrome, macOS windows, and cross-app work. Do not substitute Playwright, Computer Use, raw CDP, or another browser layer for missing DevTools evidence when the requested evidence is browser-internal.

## Start with runtime proof

1. Call shared `list_pages` before using any page ID from an earlier turn.
2. Resolve the target from the current result. Ask only when the target cannot be resolved safely.
3. Pass the fresh numeric `pageId` to every page-scoped command. Do not rely on shared `select_page` state.
4. Take a fresh text snapshot before element work.
5. Collect only the requested internal signals.
6. After interaction, take a new snapshot and refresh the relevant Console or Network evidence.

Do not echo unrelated page data. A successful handshake is not proof of attachment; a completed `list_pages` call is the minimum runtime proof.

## Recover by failed layer

### Shared CLI absent

Run `scripts/setup-uxc-link.zsh` only after confirming the pinned owned UXC binary is installed. Fail closed on a foreign link or binary. Do not substitute `npx`, `@latest`, or auto-connect.

### Startup or tool call failed

Run `scripts/ensure-connection.zsh --recover` from this skill, then retry `scripts/uxc-readiness.zsh` once. The helper reads the one-time local configuration produced by `scripts/configure-local.zsh`; it does not depend on shell aliases or login-shell startup.

If identity validation reports the wrong browser or profile, fail closed. Read [references/profile-identity.md](references/profile-identity.md). Never close or restart an existing browser without explicit authorization.

## Keep UXC as the default facade

Read [references/uxc-facade.md](references/uxc-facade.md) for installation, ownership, reuse, and acceptance details. UXC exposes the safe wrapper as a deterministic JSON-first CLI and reuses its stdio child through a local daemon. It replaces eager native registration as the normal execution path, but it does not replace correct-browser validation.

Use `uxc-facade` for the generic packaging contract. This skill remains the owner of Chrome identity, connection recovery, explicit `pageId` routing, safe payload handling, and real-call acceptance.

Reuse `scripts/install-uxc.zsh` for the pinned UXC binary and its owner manifest. Keep Chrome-specific linking in `scripts/setup-uxc-link.zsh` and payload-stripping acceptance in `scripts/uxc-readiness.zsh`. Never execute an unowned `uxc`, accept a PATH fallback, or overwrite a managed link whose exact contract differs.

## Handle concurrency

The wrapper enables `--experimentalPageIdRouting`. Pass a fresh `pageId` to every page-scoped read or write so one agent cannot change another agent's selected-page context. Different page IDs route safely, but the runtime serializes individual tool calls and does not guarantee parallel execution. No cross-agent transaction lock exists for multi-step writes to one tab; report that case `UNVERIFIED` and stop when ownership is unclear. Use separate isolated browsers for truly parallel writes that cannot share a tab safely.

Shared UXC does not negotiate workspace roots. Write screenshots, snapshots, traces, or heap data only to an OS temporary path first, return the path and a bounded summary, then move the artifact only after its contents and destination are validated. Never add `--allow-unrestricted-paths`. If the host must render native content blocks, use explicit native compatibility mode.

## Report acceptance

For multi-host validation, report each host independently:

| Host | Skill discovery | Shared transport | Real `list_pages` | Native compat | Result |
| ---- | --------------- | ---------------- | ----------------- | ------------- | ------ |

Use `VERIFIED` only after the real shared tool call. Report native compatibility separately and leave it `NOT_USED` on the healthy default path. Otherwise report `UNVERIFIED` or the explicit external blocker.
