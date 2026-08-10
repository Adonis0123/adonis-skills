# Host verification

Read this reference only for configuration repair, host discovery, or multi-host acceptance. Begin ordinary browser debugging with the MCP `list_pages` tool.

## Separate the layers

Run the discovery check for the host under test:

```bash
claude mcp get chrome-devtools
codex mcp get chrome-devtools
grok002 mcp doctor chrome-devtools
hermes mcp test chrome-devtools
```

Require the host to report the registered server, complete the handshake, and expose `list_pages` plus `select_page`. Discovery never proves that a model called a tool or that the server attached to the intended Chrome.

## Run optional runtime-lab checks

When `CHROME_DEV_MCP_LAB_DIR` names a trusted checkout, run from that directory:

```bash
./bin/doctor
./bin/test-startup
./bin/test-hosts
```

Keep cold-start tests isolated. Never close an existing browser to simulate recovery.

## Run the real acceptance

Use one fresh read-only session per host with this prompt:

```text
只读验收：必须真实调用 chrome-devtools 的 list_pages 一次；不要导航、点击，也不要输出页面 URL、标题或正文。成功只回答 CHROME_DEVTOOLS_OK，工具未暴露或调用失败只回答 CHROME_DEVTOOLS_FAIL。
```

Require all five signals:

1. MCP handshake succeeds.
2. Tools are discovered.
3. The model issues a real `list_pages` call.
4. The final sentinel agrees with the tool trace.
5. Captured output contains no page URL, title, body, cookie, or token.

Report provider or quota failures separately from MCP configuration failures.
