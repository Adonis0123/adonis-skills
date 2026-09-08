# Host configurations

All hosts use the same stdio command:

```text
/Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp -s user
```

## Cursor CLI

Cursor Agent reads MCP servers from the workspace `.cursor/mcp.json` or the user-level `$HOME/.cursor/mcp.json`. Merge the following server into the existing `mcpServers` object; do not replace other entries:

```json
{
  "mcpServers": {
    "kimi-cu": {
      "command": "/Applications/KimiCU.app/Contents/MacOS/kimi-cu",
      "args": ["mcp", "-s", "user"]
    }
  }
}
```

The commands below use `cursor-cli` as the Cursor Agent command. When it is a shell alias, run them in a fresh login shell or replace `cursor-cli` with the underlying executable:

```bash
cursor-cli mcp list
cursor-cli mcp list-tools kimi-cu
```

Expect `kimi-cu: ready` and the installed version's tool set (10 tools in the verified 0.5.10 baseline). If the server is configured but disabled or awaiting approval, approve only this server within existing authorization, then repeat the checks:

```bash
cursor-cli mcp enable kimi-cu
```

Finish with a model-level, read-only smoke test. The response must confirm that it completed both tool calls without reproducing window contents or other private screen data:

```bash
cursor-cli --print --mode ask \
  'Use only kimi-cu. Call list_apps, then call get_app_state with app=com.apple.finder and mode=ax. Do not modify the UI. Report only whether both tool calls completed and the target bundle id; do not repeat window contents.'
```

Treat `mcp list` as connection evidence, `mcp list-tools` as discovery evidence, and the completed two-call smoke as model/runtime evidence. Report `UNVERIFIED` if the model only describes or prints a tool call instead of emitting it.

## Grok

```bash
grok mcp add --scope user kimi-cu -- /Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp -s user
grok mcp doctor kimi-cu
```

## Codex

Register Kimi CU as fallback. Codex native Computer Use remains the first choice for desktop and cross-app work.

```bash
codex mcp add kimi-cu -- /Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp -s user
codex mcp get kimi-cu
```

## Claude Code

```bash
claude mcp add --scope user kimi-cu -- /Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp -s user
claude mcp get kimi-cu
```

## Hermes

Hermes uses its interactive MCP command because it records per-tool approval choices:

```bash
hermes mcp add kimi-cu --command /Applications/KimiCU.app/Contents/MacOS/kimi-cu --args mcp -s user
hermes mcp test kimi-cu
```

Review tool approval choices when prompted; grant only the tools needed for the authorized task. Do not automatically approve tools added by a later version or enable global `--yolo` mode.

## WorkBuddy desktop

Register Kimi CU as fallback. WorkBuddy native Browser / Computer Use remains the first choice for ordinary page and desktop interaction; use Chrome DevTools MCP for browser-internal diagnostics.

Merge this entry into `$HOME/.workbuddy/mcp.json`, preserving other servers:

```json
{
  "mcpServers": {
    "kimi-cu": {
      "type": "stdio",
      "command": "/Applications/KimiCU.app/Contents/MacOS/kimi-cu",
      "args": ["mcp", "-s", "user"]
    }
  }
}
```

Reload WorkBuddy after editing. Do not edit `$HOME/.workbuddy/.mcp.json`; that file is used by WorkBuddy's internal connector proxy.

WorkBuddy desktop and CodeBuddy CLI may have separate MCP configuration lifecycles. For an isolated CLI smoke test, pass the desktop config explicitly:

```bash
WORKBUDDY_CLI=/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy
"$WORKBUDDY_CLI" -p \
  --strict-mcp-config \
  --mcp-config "$HOME/.workbuddy/mcp.json" \
  --permission-mode default \
  --settings '{"permissions":{"allow":["ToolSearch","DeferExecuteTool","mcp__kimi-cu__list_apps","mcp__kimi-cu__get_app_state"]}}' \
  'Use kimi-cu to list apps, then read Calculator with get_app_state(mode=ax). Do not modify the UI.'
```

Use the host's configured model. If it prints tool markup, cannot discover deferred tools, or hangs, separate that observation from server health; do not assume an adapter defect without a second supported-model check. A model switch is a diagnostic option, not a permanent configuration change.

Official WorkBuddy references:

- <https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide>
- <https://www.workbuddy.ai/docs/cli/release-notes/v2.48.0>
