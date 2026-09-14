---
name: chrome-dev-mcp
description: "This skill should be used when the user invokes /chrome-dev-mcp or asks for Chrome DevTools MCP, CDP, list_pages/select_page, UXC packaging for Chrome DevTools, DOM snapshots, Console, Network, Performance, Lighthouse, heap analysis, browser-internal debugging, connection recovery, or correct-Chrome validation across Claude Code, Codex, Grok/Grok002, Hermes, or WorkBuddy. Use it when the evidence is Chrome-specific, needs Lighthouse, a full trace, or heap data, or when the caller has no page session yet; a page already open in ego-browser keeps its own Console and request diagnosis. Establish or recover the shared managed connection and prove it with a real list_pages call. Do not use it for ordinary navigation, form filling, scraping, or desktop UI unless browser-internal signals are required. It is not a page-acceptance entry point: a passing readiness or list_pages check proves the connection only, and product-page verification stays with the calling task."
metadata:
  author: adonis
  version: "1.4.0"
---

# Chrome Dev MCP

Use the managed `chrome-dev-mcp-cli` facade for browser-internal evidence. It reuses one identity-checked MCP child instead of starting one child per agent session. Keep host-native registration only as an explicit compatibility and rollback path.

Require the locally configured safe wrapper, launcher, and pinned UXC 0.17.0 facade. Never silently fall back to a host-native server because doing so recreates the per-session runtime fan-out this skill is designed to avoid.

For runtime or skill upgrades, follow [references/maintenance.md](references/maintenance.md): check versions, preserve rollback, stage, activate, verify real operations and process reuse, then synchronize hosts. Ordinary page tasks do not load this maintenance workflow.

## Keep the user contract simple

Let the user remember only `/chrome-dev-mcp`. Handle connection checks, recovery, profile gates, shared-session reuse, and explicit `pageId` routing internally. With no additional task, return only `CHROME_DEV_MCP_READY` after sanitized shared readiness. When the same invocation includes a page task, use the readiness-plus-task fast path below instead of discarding a `list_pages` result that the task immediately needs. On failure, report one failing layer and one required action.

## Execute the slash entry

Treat `/chrome-dev-mcp` without a task as a readiness-only action. Treat the same invocation with a page task as readiness-plus-task.

Invoke every helper with `zsh` (for example `zsh scripts/uxc-readiness.zsh`). Under `bash`, `set -u` and `${0:A:h}` abort with `A: unbound variable`.

1. For readiness-only, run `zsh scripts/uxc-readiness.zsh` from this skill. It performs a real shared `list_pages` call, discards the page payload, and returns only `CHROME_DEV_MCP_READY` on success.
2. For readiness-plus-task, run `zsh scripts/uxc-readiness.zsh --private-result`. This strict mode validates the configured binary/link ownership contract, prepends the managed binary directory ahead of inherited `PATH`, calls shared `list_pages` exactly once, and returns its JSON only to the agent. Keep the result private and reuse that same current-turn result as both transport proof and fresh numeric `pageId` resolution. Do not run the payload-discarding mode first or call the linked CLI directly.
3. If either path reports a connection or wrapper failure, run `zsh scripts/ensure-connection.zsh --recover`, then retry exactly once with the same path: `zsh scripts/uxc-readiness.zsh` for readiness-only, or `zsh scripts/uxc-readiness.zsh --private-result` for readiness-plus-task. The latter post-recovery JSON is the fresh result for the task.
4. If the CLI, shell, or required response type is unavailable, report `NATIVE_COMPAT_REQUIRED`; do not start a native server automatically.
5. Use host-native `chrome-devtools` only when the user explicitly requests `native` compatibility or approves it after that blocker. Mark that mode because it adds one runtime per host session.
6. A successful `list_pages` proves readiness, not the requested page operation. Claim the task `VERIFIED` only after its Console, Network, snapshot, interaction, or other requested command independently completes.
7. Never expose the private page list or unrelated page URLs, titles, body text, cookies, tokens, or target data.

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

Ordinary navigation, form filling, and page acceptance follow the caller's browser routing (for example ego-browser, or the host's native browser when no browser is specified); this skill only supplies browser-internal evidence. An existing ego-browser page keeps its own Console, exception, request, and basic metric diagnosis; switch here for Lighthouse, a full performance trace, heap analysis, or a user-specified Chrome tab. Use native Computer Use for browser chrome, macOS windows, and cross-app work. Do not substitute Playwright, Computer Use, raw CDP, or another browser layer for missing DevTools evidence when the requested evidence is browser-internal.

## Start with runtime proof

1. Before using any page ID from an earlier turn, obtain shared `list_pages` or reuse the eligible readiness-plus-task result from this turn.
2. Reuse one current-turn result only when no recovery, navigation, or target ambiguity occurred after it. Otherwise refresh `list_pages` before resolving the target. Ask only when the fresh result cannot resolve the target safely.
3. Pass the fresh numeric `pageId` to every page-scoped command. Do not rely on shared `select_page` state.
4. Take a fresh text snapshot before element work.
5. Collect only the requested internal signals.
6. After interaction, take a new snapshot and refresh the relevant Console or Network evidence.

Do not echo unrelated page data. A successful handshake is not proof of attachment; a completed `list_pages` call is the minimum runtime proof.

## Keep a time budget

Readiness already bounds its single `list_pages` call at 45 seconds. Budget the rest so a diagnosis ends with a report instead of a timeout:

- Allow one recovery attempt and one retry per invocation. Do not loop on a busy Chrome or an exclusive-key conflict.
- Pass `--timeout-ms 15000` as a global flag before the operation name (`chrome-dev-mcp-cli --timeout-ms 15000 <operation> ...`); after the operation it is rejected as an unknown argument. Skip it when the operation states its own duration (a Performance trace, Lighthouse, or `new_page timeout=`).
- Keep a routine diagnosis within roughly 90 seconds of tool time. When the budget is spent or a call fails, report the evidence already collected and mark the missing part `UNVERIFIED` instead of retrying.

## Collect Network evidence

1. `chrome-dev-mcp-cli list_network_requests pageId=<id> pageSize=20`; add `'resourceTypes:=["fetch","xhr"]'` (JSON argument syntax) when the task is about API calls. Pick the `reqid` of the failing request.
2. `chrome-dev-mcp-cli get_network_request pageId=<id> reqid=<reqid>` returns status, headers, and the body inline. Use `responseFilePath=` only for a large body, and only inside a configured workspace root: the runtime rejects other paths, including OS temporary directories. Read only the fields the task needs.
3. A missing or empty body does not mean the request failed or returned nothing: Chrome may not retain the body of a failed, redirected, or streamed response. Report the status code and headers you have, state that the body was unavailable, and never replay a request with side effects to obtain it.

Confirm parameter names with `chrome-dev-mcp-cli <operation> -h`; the installed runtime's schema wins over this text.

## Recover by failed layer

### Shared CLI absent

Run `zsh scripts/setup-uxc-link.zsh` only after confirming the pinned owned UXC binary is installed. Fail closed on a foreign link or binary. Do not substitute `npx`, `@latest`, or auto-connect.

### Startup or tool call failed

Run `zsh scripts/ensure-connection.zsh --recover` from this skill, then retry the path-specific shared `list_pages` proof once. Use `zsh scripts/uxc-readiness.zsh` for readiness-only and `zsh scripts/uxc-readiness.zsh --private-result` for readiness-plus-task; retain the recovered private result for fresh `pageId` resolution. The helper reads the one-time local configuration produced by `scripts/configure-local.zsh`; it does not depend on shell aliases or login-shell startup.

If identity validation reports the wrong browser or profile, fail closed. Read [references/profile-identity.md](references/profile-identity.md). Never close or restart an existing browser without explicit authorization.

## Keep UXC as the default facade

Read [references/uxc-facade.md](references/uxc-facade.md) for installation, ownership, reuse, and acceptance details. UXC exposes the safe wrapper as a deterministic JSON-first CLI and reuses its stdio child through a local daemon. It replaces eager native registration as the normal execution path, but it does not replace correct-browser validation.

Use `uxc-facade` for the generic packaging contract. This skill remains the owner of Chrome identity, connection recovery, explicit `pageId` routing, safe payload handling, and real-call acceptance.

Reuse `scripts/install-uxc.zsh` for the pinned UXC binary and its owner manifest. Keep Chrome-specific linking in `scripts/setup-uxc-link.zsh`; `scripts/uxc-readiness.zsh` owns both payload-stripping readiness and the private-result task fast path. Never execute an unowned `uxc`, accept a PATH fallback, or overwrite a managed link whose exact contract differs.

## Handle concurrency

Use the installed `chrome-dev-mcp-cli` for every call. Its managed launcher fixes the working directory and invokes the owned binary by absolute path, so calls from different projects reuse one daemon session instead of competing for the same exclusive key. That key is a browser ownership guard, not a task lock: do not remove it, invent per-agent keys for the same browser, kill another session, or loop until it releases.

Pass a fresh `pageId` to every page-scoped read or write so one agent cannot change another agent's selected page. The runtime serializes tool calls and has no cross-agent transaction lock for multi-step writes to one tab; report that case `UNVERIFIED` and stop when ownership is unclear. Real pointer input has one shared cursor and foreground window, so serialize drag, keyboard, focus, and screen-recording sequences across the desktop.

Write screenshots, snapshots, traces, or heap data only to an OS temporary path first and return the path with a bounded summary. Never add `--allow-unrestricted-paths`. Flag details, `waitForStableDom`, legacy launcher repair, and isolated-browser parallelism → [references/uxc-facade.md](references/uxc-facade.md).

## Report acceptance

For multi-host validation, report each host independently:

| Host | Skill discovery | Shared transport | Real `list_pages` | Native compat | Result |
| ---- | --------------- | ---------------- | ----------------- | ------------- | ------ |

Use `VERIFIED` only after the real shared tool call. Report native compatibility separately and leave it `NOT_USED` on the healthy default path. Otherwise report `UNVERIFIED` or the explicit external blocker.

For multi-session installation or performance acceptance, also verify process count before and after concurrent calls: one shared MCP child with the same PID, not one child per host. Check OS parent processes as well as UXC sessions, because eager native children are invisible to UXC. Read [references/host-verification.md](references/host-verification.md) for residual-process handling.
