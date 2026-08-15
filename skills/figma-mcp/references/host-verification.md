# Host verification

Read this reference only for installation, authentication recovery, host discovery, or multi-host acceptance. The supported endpoint is `https://mcp.figma.com/mcp`.

Before running commands, confirm the host remains listed in Figma's current MCP Catalog. These examples cover Codex, Claude Code, and Cursor. Do not adapt them to an unlisted client.

The registration is account-neutral. Keep the exact server identifier and endpoint when the user changes accounts; only the current host surface's OAuth grant changes. Do not create per-account MCP entries.

## Codex

Prefer the official Figma plugin in the Codex app. For the Codex CLI, use its native remote-server registration and OAuth commands:

```bash
codex mcp add figma --url https://mcp.figma.com/mcp
codex mcp login figma
codex mcp get figma
```

Do not add the server twice when the current Codex surface already exposes the official Figma plugin. App plugin authentication and CLI MCP authentication may have separate lifecycles; verify the surface actually under test.

## Claude Code

Prefer Figma's official Claude Code plugin:

```bash
claude plugin install figma@claude-plugins-official
```

For manual user-scoped registration:

```bash
claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp
claude mcp login figma
claude mcp get figma
```

Claude may also expose a managed `claude.ai Figma` connector. Use the exact identifier shown by `claude mcp list` when authenticating that connector. Do not create a duplicate manual entry solely to rename it.

## Cursor

Prefer Figma's official Cursor plugin by running `/add-plugin figma` in Cursor Agent chat. For an existing manual server, use the exact identifier from the native status command:

```bash
agent mcp list
agent mcp login <exact-figma-identifier>
agent mcp list-tools <exact-figma-identifier>
```

Cursor may expose the CLI as `cursor-cli` while its help text names the executable `agent`. Use the installed command without changing its MCP configuration schema. Merge the official URL into the existing user or workspace configuration; never replace other servers.

## Run the real acceptance

When no account was named, use one fresh read-only session per host with this prompt:

```text
只读验收：必须真实调用 Figma MCP 的 whoami 一次；接受当前已认证帐号，不要访问任何 Figma 文件，不要输出姓名、邮箱、plan、ID 或其他身份详情。工具成功完成只回答 FIGMA_MCP_OK；工具未暴露、需要登录或调用失败只回答 FIGMA_MCP_FAIL。
```

When the user named an account, add the target only to the ephemeral prompt and require the model to compare privately. Never persist the target in MCP configuration or skill files.

Require all five signals:

1. The official server is discovered by the host.
2. Figma tools are discovered.
3. The model issues a real `whoami` call.
4. The final sentinel agrees with the tool trace.
5. Captured output contains no private identity or file data.

For the Account result, use `CURRENT` when no target was named and the real call completed. Use `MATCH` only for an explicit target that was privately matched.

An OAuth callback, `Connected` status, or tool list is not a substitute for the real call. Report provider, plan, quota, and model-adapter failures separately from registration failures.

## Official references

- <https://developers.figma.com/docs/figma-mcp-server/>
- <https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/>
- <https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/>
