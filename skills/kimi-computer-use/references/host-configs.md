# Host configurations

All hosts use the same stdio command:

```text
/Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp -s user
```

## Cursor CLI

Cursor CLI (`cursor-agent`) reads MCP servers from the user-level `$HOME/.cursor/mcp.json` or a workspace `.cursor/mcp.json`. Prefer the user-level file unless the user names a workspace. Merge the following server into the existing `mcpServers` object; do not replace other entries:

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

```bash
cursor-agent mcp list
cursor-agent mcp list-tools kimi-cu
```

Expect `kimi-cu: ready` and the installed version's tool set, including `list_apps` and `get_app_state`. If the server is configured but disabled or awaiting approval, approve only this server within existing authorization, then repeat the checks:

```bash
cursor-agent mcp enable kimi-cu
```

Finish with a model-level, read-only smoke test. The response must confirm that it completed both tool calls without reproducing window contents or other private screen data:

```bash
cursor-agent --print --mode ask \
  'Use only kimi-cu. Call list_apps, then call get_app_state with app=com.apple.finder and mode=ax. Do not modify the UI. Report only whether both tool calls completed and the target bundle id; do not repeat window contents.'
```

Treat `mcp list` as connection evidence, `mcp list-tools` as discovery evidence, and the completed two-call smoke as model/runtime evidence. Report `UNVERIFIED` if the model only describes or prints a tool call instead of emitting it.

## Grok

```bash
grok mcp add --scope user kimi-cu -- /Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp -s user
grok mcp doctor kimi-cu
```

## Codex

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

Hermes exposes the server's tools as `mcp__kimi_cu__<tool>`, for example `mcp__kimi_cu__get_app_state`. Its own `computer_use` tool accepts `som` / `vision` modes; `kimi-cu` does not.

## WorkBuddy desktop

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
  'Use only kimi-cu. Call list_apps, then call get_app_state with app=com.apple.finder and mode=ax. Do not modify the UI. Report only whether both tool calls completed.'
```

WorkBuddy may expose MCP tools through deferred dispatch; the `ToolSearch` and `DeferExecuteTool` allowances above cover that narrowly. Do not switch the whole session to bypass-permissions mode.

Use the host's configured model. If it prints tool markup, cannot discover deferred tools, or hangs, separate that observation from server health; do not assume an adapter defect without a second supported-model check. A model switch is a diagnostic option, not a permanent configuration change.

Official WorkBuddy reference: <https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide>
