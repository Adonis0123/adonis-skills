# Capability bootstrap and installation guidance

Use this reference only when an audit capability is missing, failed, or present only in configuration. The goal is to restore useful evidence safely without assuming a particular machine, operating system, browser profile, port, or agent client.

## Gap protocol

1. **Discover first.** Use the current client's native tool/plugin/MCP listing. Record the capability, discovered adapter name, status, and version when exposed.
2. **Prove readiness.** Require discovery, handshake, and one harmless real call. A config entry, installed package, enabled extension, or natural-language success message is not enough.
3. **Decide whether the gap blocks the audit.** If a fallback can answer the question, continue and mark the missing layer. If the user explicitly requires the tool or the evidence cannot be obtained otherwise, offer an installation card.
4. **Ask before mutation.** Installing a package/extension, editing user or project client configuration, enabling remote debugging, connecting to a signed-in browser, or restarting shared tooling requires explicit authorization.
5. **Validate after installation.** Restart only when the client requires it, then repeat discovery, handshake, and a harmless call. Record the actual server/client version and any remaining coverage gap.

Use this installation card:

```text
Missing capability: <capability, not guessed product name>
Why it matters: <specific evidence it would unlock>
Fallback available now: <what can still be measured, or none>
Official option: <tool and official documentation URL>
Proposed change: <package/config/extension/browser setting affected>
Privacy and side effects: <browser data exposure, new profile, reload/restart, downloads>
Acceptance call: <one harmless real call>
Authorization required: yes
```

If the user declines installation, continue with the fallback and mark the blocked metrics `UNVERIFIED`.

## Chrome DevTools internals

Use Chrome DevTools MCP when the audit needs traces, Network/DOM details, Coverage, Memory, emulation, or browser metrics and the current client has no equivalent capability.

Upstream requirements currently include a Node.js LTS release, npm, and current stable Chrome. Reopen the upstream guide before copying exact commands because client setup and flags change.

Portable MCP configuration:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

Current upstream client examples:

```text
Claude Code: claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest
Codex CLI:   codex mcp add chrome-devtools -- npx chrome-devtools-mcp@latest
Grok CLI:    grok mcp add chrome-devtools npx chrome-devtools-mcp@latest
```

Cursor CLI uses the same `mcp.json` configuration as the editor. After authorization, put the portable configuration above in project-scoped `.cursor/mcp.json` or the documented user-scoped location; the current CLI does not need a skill-specific wrapper. Verify the configured server rather than assuming the file was loaded:

```text
cursor-agent mcp list
cursor-agent mcp list-tools chrome-devtools
```

Do not invent a debugging port or browser executable. By default, Chrome DevTools MCP can launch a dedicated Chrome profile. Connecting to an existing signed-in Chrome requires an explicit privacy decision and the upstream connection flow; prefer the current automatic connection flow when supported instead of assuming a fixed port.

For internal or sensitive targets, discuss `--no-performance-crux`, `--no-usage-statistics`, header redaction, and an isolated profile before installation. These flags reduce specific exposures but do not turn browser tooling into a complete security boundary.

Acceptance:

1. the client lists the server/tools;
2. the MCP server completes a handshake;
3. `list_pages` or its discovered equivalent returns a real page list;
4. a sanitized public page can produce a small snapshot or performance trace;
5. the tool is still treated as unavailable for the private target until profile/authorization parity is confirmed.

Official sources:

- https://github.com/ChromeDevTools/chrome-devtools-mcp
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/SECURITY.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md
- https://cursor.com/docs/cli/mcp
- https://cursor.com/docs/context/model-context-protocol

## Structured browser interaction

If no authenticated browser driver exists, prefer a client-native browser capability. Playwright MCP is a portable alternative for accessibility snapshots and structured interactions, but its default isolated browser does not inherit a user's signed-in state.

Portable configuration from the current official Playwright MCP installation guide:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

Its browser downloads on first use. Connecting to an existing Chrome profile or using stored authentication changes the privacy boundary; propose it explicitly and follow upstream documentation rather than embedding a profile path in this skill.

Acceptance: navigate to a public test page, obtain an accessibility snapshot, perform one harmless action, and re-snapshot the resulting state.

Official source: https://playwright.dev/mcp/

## Computer Use

Computer Use is usually a host-native capability, not one universal package that this skill can install. Discover the current client's visual-control capability first. If none exists:

- use structured browser tools for DOM-accessible controls;
- ask the user to perform a narrowly specified DevTools/Recorder step when visual UI access is essential;
- use a user-provided screenshot or recording as `SCREEN_OBSERVED` evidence;
- mark inaccessible visual-only paths `blocked` or `UNVERIFIED`.

Do not recommend an unrelated automation package and call it Computer Use. If the client offers an official plugin or extension marketplace, link to that client's current official installation page.

## Chrome Recorder

Chrome Recorder is built into Chrome DevTools; it is not a separate extension. Open DevTools, then use **More tools → Recorder**, or open the Command Menu and choose **Show Recorder panel**. If the agent cannot operate DevTools UI, give the user the shortest manual steps and import the sanitized recording afterward when supported.

Acceptance: record a harmless public-page flow, replay it once, confirm the final assertion, then use **Measure performance** only if a trace is required.

Official source: https://developer.chrome.com/docs/devtools/recorder/

## React localization

React Scan and React DevTools Profiler are optional localization tools, not prerequisites for a browser performance audit.

For a read-only audit, prefer an already-installed profiler or React Scan's isolated CLI/browser route. The current React Scan CLI entry is:

```text
npx -y react-scan@latest <authorized-http-or-https-url>
```

The React Scan `init` command edits the application and installs a dependency. Do not run it during a read-only audit. Do not inject React Scan into production source, install a browser extension, or reload a sensitive signed-in target without authorization. Run only the smallest suspect interaction and retain a clean instrumentation-off baseline.

Acceptance: confirm a React commit/render signal on a safe target, repeat the same action with instrumentation off, and discard the instrumented timing as `MEASUREMENT_POLLUTION` if it materially changes the flow.

Official source: https://github.com/aidenybai/react-scan

## No-install fallback table

| Missing capability           | Continue with                                                            | Mandatory caveat                               |
| ---------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| DevTools trace               | PerformanceObserver, browser timing APIs, visual flow, source inspection | no trace call tree, heap, or full attribution  |
| Authenticated browser driver | Computer Use or user-driven steps                                        | pixels are not quantitative timing evidence    |
| Computer Use                 | structured browser tools or user-provided recording                      | visual-only controls may remain blocked        |
| Recorder                     | manually specified deterministic journey                                 | repeatability artifact is absent               |
| React Scan/Profiler          | browser trace plus source ownership                                      | React subtree attribution remains a hypothesis |
| Python 3                     | manual Markdown report contract                                          | deterministic ledger validation unavailable    |

Missing tools reduce coverage, not honesty. Never convert a fallback into evidence it cannot produce.
