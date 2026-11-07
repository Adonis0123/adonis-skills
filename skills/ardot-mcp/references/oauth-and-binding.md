# Ardot OAuth and binding

## Defaults

| Item          | Value                            |
| ------------- | -------------------------------- |
| Endpoint      | `https://ardot.tencent.com/mcp`  |
| Credential id | `ardot-mcp`                      |
| Binding id    | `ardot-mcp`                      |
| Scope         | `mcp:use`                        |
| Redirect URI  | `http://127.0.0.1:8788/callback` |

Host-native Grok/Claude OAuth tokens are **not** automatically shared with UXC. Complete UXC OAuth even when the native host is already authorized.

## Agent-friendly login

From this skill directory, prefer the helpers:

```bash
zsh scripts/oauth-start.zsh
# user opens authorization_url, approves, pastes full callback URL
zsh scripts/oauth-complete.zsh --session-id <session_id> --authorization-response '<callback-url>'
```

Equivalent raw commands using the owned binary:

```bash
"$ARDOT_MCP_LINK_DIR/uxc" auth oauth start ardot-mcp \
  --endpoint https://ardot.tencent.com/mcp \
  --redirect-uri http://127.0.0.1:8788/callback \
  --scope mcp:use

"$ARDOT_MCP_LINK_DIR/uxc" auth oauth complete ardot-mcp \
  --session-id <session_id> \
  --authorization-response 'http://127.0.0.1:8788/callback?code=...&state=...'
```

Omit `--client-id` by default so UXC can attempt dynamic client registration. If the provider rejects DCR, rerun with an explicit client id from Ardot.

## Binding

```bash
zsh scripts/setup-auth-binding.zsh
```

This creates or refreshes the binding that maps `https://ardot.tencent.com/mcp` to credential `ardot-mcp`. Validate with:

```bash
"$ARDOT_MCP_LINK_DIR/uxc" auth binding match https://ardot.tencent.com/mcp
```

## Recovery

```bash
"$ARDOT_MCP_LINK_DIR/uxc" auth oauth info ardot-mcp
"$ARDOT_MCP_LINK_DIR/uxc" auth oauth refresh ardot-mcp
"$ARDOT_MCP_LINK_DIR/uxc" auth oauth logout ardot-mcp
```

Never copy tokens into skill text, transcripts, readiness output, or commits.
