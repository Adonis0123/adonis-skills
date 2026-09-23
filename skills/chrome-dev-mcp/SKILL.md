---
name: chrome-dev-mcp
description: "This skill should be used when the user invokes /chrome-dev-mcp or asks for Chrome DevTools MCP, CDP, list_pages/select_page, UXC packaging for Chrome DevTools, DOM snapshots, Console, Network, Performance, Lighthouse, heap analysis, browser-internal debugging, connection recovery, or correct-Chrome validation across Claude Code, Codex, Grok/Grok002, Hermes, or WorkBuddy. Use it when the evidence is Chrome-specific, needs Lighthouse, a full trace, or heap data, or when the caller has no page session yet; a page already open in ego-browser keeps its own Console and request diagnosis. Establish or recover the shared managed connection and prove it with a real list_pages call. Do not use it for ordinary navigation, form filling, scraping, or desktop UI unless browser-internal signals are required. It is not a page-acceptance entry point: a passing readiness or list_pages check proves the connection only, and product-page verification stays with the calling task."
metadata:
  author: adonis
  version: "1.5.0"
---

# Chrome Dev MCP

Collect browser-internal evidence (snapshots, Console, Network, Performance, Lighthouse, heap) from one identity-checked Chrome through the shared `chrome-dev-mcp-cli`. Every agent on the machine reuses one daemon-backed MCP child, so the rules below exist to keep that shared session healthy and to keep your claims honest.

Everything a page task needs is in this file. Read a reference only when its trigger below applies; the `uxc-facade` skill is a packaging method and is not needed to run a task.

## Get a proven connection

Run helpers with `zsh` from this skill's directory (under `bash` they abort with `A: unbound variable`).

| Invocation                     | Command                                          | On success                                                                 |
| ------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `/chrome-dev-mcp` with no task | `zsh scripts/uxc-readiness.zsh`                  | Reply only `CHROME_DEV_MCP_READY`                                          |
| Any page task                  | `zsh scripts/uxc-readiness.zsh --private-result` | Keep the `list_pages` JSON private and use it to pick the numeric `pageId` |

Both run one real shared `list_pages` and check the UXC envelope and the tool result (`data.isError`). A page task runs only the private mode, once; do not run the sanitized mode first.

If readiness prints `STATUS=ERROR`:

1. Except for `link_contract_mismatch` (step 3), run `zsh scripts/ensure-connection.zsh --recover` once, then repeat the same readiness command once. The post-recovery JSON is your page list.
2. `ERROR_CLASS=exclusive_key_busy` means another MCP session holds the browser. If this session called host-native Chrome DevTools tools (for example `mcp__chrome-devtools__*`), that session is the holder: stop using them. Otherwise another agent is mid-call; the single retry above is enough.
3. `ERROR_CLASS=link_contract_mismatch` means the shared launcher was generated for a different copy of this skill (for example an installed copy while you run from a repository checkout). Recovery cannot fix it. Read the bound copy with `grep -o "UXC_LINK_SKILL_PATH='[^']*'" "$(command -v chrome-dev-mcp-cli)"` and rerun the helpers from that directory. Do not rerun `setup-uxc-link.zsh` to repoint the launcher: it is shared by every agent and fails closed on a foreign contract by design.
4. Still failing: report the one failing layer (`ERROR_CLASS` or `REASON`) and one next action. `WRONG_PROFILE`, `WRONG_BINARY`, or `NOT_CHROME` fail closed; read [references/profile-identity.md](references/profile-identity.md).

Never run `uxc daemon stop`, restart, or kill UXC, Chrome, or MCP processes to recover: the daemon and browser are shared, so this cuts off other agents' sessions. Never loop on retries, scan ports, read `DevToolsActivePort`, attach to another browser, call `uxc` directly, or fall back to `npx`/`@latest`. Do not substitute Playwright, Computer Use, or raw CDP for a failed connection; their evidence comes from a different browser session. If `chrome-dev-mcp-cli` is missing, run `zsh scripts/setup-uxc-link.zsh` once (it installs the launcher only when the pinned owned UXC is present and refuses foreign links); if that fails, report `NATIVE_COMPAT_REQUIRED`. Use host-native `chrome-devtools` only when the user explicitly asks for native compatibility, and label that mode.

## Pick the target page

- Take `pageId` from this turn's `list_pages`, never from an earlier turn. Other agents open, close, and navigate tabs, so ids shift: re-run `list_pages` and match by URL before each batch of writes, after recovery, and after any navigation.
- The page list is the text at `data.content[0].text`, one tab per line as `<id>: <title> (<url>) [selected]`. Match on the URL inside the last parentheses, not the title; a host/port prefix match is enough when the user gave no path.
- Pass `pageId=<id>` to every page-scoped call. Do not rely on `select_page` state.
- If the requested tab is not in the list, it belongs to another browser or profile. Say so. Open the URL with `new_page` only when it needs no existing login state; otherwise ask the user to open it in the managed Chrome.
- Never print the page list or unrelated URLs, titles, body text, cookies, or tokens.

## Call the CLI correctly

```bash
chrome-dev-mcp-cli --timeout-ms 15000 take_snapshot pageId=3
chrome-dev-mcp-cli evaluate_script pageId=3 waitForStableDom=false 'function=() => document.title'
chrome-dev-mcp-cli list_network_requests pageId=3 pageSize=20 'resourceTypes:=["fetch","xhr"]'
chrome-dev-mcp-cli navigate_page pageId=3 type=url url='http://localhost:3000/x' timeout=30000
chrome-dev-mcp-cli <operation> -h        # live schema wins over this file
```

- Arguments are `key=value`, or `key:=<json>` for arrays and objects. There are no `--pageId`/`--json` flags and no `call` subcommand.
- `--timeout-ms` is a global flag and goes before the operation. `navigate_page` and `new_page` have their own 10-second navigation timeout: pass `timeout=30000` for dev servers. A navigation timeout often means a slow `load` event, not a failed page; take a snapshot before retrying.
- `"ok": true` only means UXC delivered the call. The operation failed if `data.isError` is true; read `data.content[0].text` for the reason.
- Use `waitForStableDom=false` for read-only `evaluate_script`. Take a fresh snapshot before element work and after each interaction; `uid`s change when the DOM changes. Re-read Console and Network after an interaction too, because earlier lists do not include what the interaction triggered.

## Write artifacts to the runtime temp root

Screenshots, snapshots, traces, heap snapshots, and saved bodies go under `"$(getconf DARWIN_USER_TEMP_DIR)"` (the MCP child's `os.tmpdir()`, `/var/folders/.../T/`). The runtime rejects `/tmp`, host scratchpads, and repository paths with `is not within any of the configured workspace roots`. Always pass `filePath` for screenshots, because the inline image is truncated and unusable; `format=jpeg` saves with a `.jpeg` extension. Copy the file elsewhere afterwards if needed, and return the path with a bounded summary. Never add `--allow-unrestricted-paths`. If that directory is also denied, stop trying other paths and report the artifact `UNVERIFIED`.

## Collect Network evidence

1. `list_network_requests` with the fresh `pageId`; pick the failing request's `reqid`.
2. `get_network_request pageId=<id> reqid=<reqid>` returns status, headers, and body inline. Use `responseFilePath=` under the runtime temp root only for a large body. Read only the fields the task needs.
3. A missing body does not mean the request failed or returned nothing; Chrome may not retain bodies of failed, redirected, or streamed responses. Report the status and headers, mark the body unavailable, and never replay a request with side effects to get it.

## Keep a time budget

Readiness bounds its `list_pages` at 45 seconds. Allow one recovery and one retry per invocation. Keep a routine diagnosis within about 90 seconds of tool time; when the budget is spent or a call fails, report what you have and mark the rest `UNVERIFIED`. Performance traces and Lighthouse state their own durations, so skip `--timeout-ms` for them.

## Share the browser safely

Calls are serialized by the runtime and no cross-agent lock exists for multi-step writes to one tab. When another agent may own the tab, report `UNVERIFIED` instead of racing it. Real pointer, keyboard, focus, and screen-recording sequences share one desktop cursor, so serialize them across agents. The daemon exclusive key is a browser ownership guard: do not remove it, invent per-agent keys, or kill its holder.

## Report honestly

`CHROME_DEV_MCP_READY` and `list_pages` prove the connection only. Claim a task `VERIFIED` only after the requested snapshot, Console, Network, Performance, or interaction call itself returned without `data.isError`. Product-page acceptance stays with the calling task.

Invoke as `/chrome-dev-mcp` in Claude Code and Grok, `$chrome-dev-mcp` in Codex; preload `chrome-dev-mcp` in Hermes for deterministic selection.

## Read only when needed

| Trigger                                                                      | Reference                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Wrong browser, profile, or login context                                     | [references/profile-identity.md](references/profile-identity.md)   |
| Installing or relinking UXC, the runtime chain, isolated-browser parallelism | [references/uxc-facade.md](references/uxc-facade.md)               |
| Upgrading Chrome DevTools MCP, UXC, or this skill                            | [references/maintenance.md](references/maintenance.md)             |
| Multi-host acceptance, process-count checks, native compatibility rollback   | [references/host-verification.md](references/host-verification.md) |
