# Host verification

Read this reference only for configuration repair, skill discovery, native compatibility, or multi-host acceptance. Begin ordinary browser debugging with shared CLI readiness.

## Separate the layers

Verify the shared skill view and the host's eager-native state separately. On the normal path, `chrome-devtools` must be disabled or absent while `chrome-dev-mcp` remains discoverable.

Examples for hosts that expose configuration inspection:

```bash
claude mcp get chrome-devtools       # expect absent
codex mcp list                       # expect disabled
grok mcp list                        # expect disabled
hermes mcp list                      # expect disabled
```

Then run `scripts/uxc-readiness.zsh` twice. Require `SHARED_TRANSPORT=OK` and require the second call to report `DAEMON_SESSION_REUSED=YES`. Discovery never proves that the shared child attached to the intended Chrome; sanitized readiness does.

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
只读验收：必须通过 chrome-dev-mcp skill 的共享 CLI 真实调用 list_pages 一次；不要导航、点击，也不要输出页面 URL、标题或正文。成功只回答 CHROME_DEV_MCP_READY，共享调用失败只回答 CHROME_DEV_MCP_FAIL。不要自动回退到 native MCP。
```

Require all five signals:

1. The shared MCP handshake succeeds.
2. Shared CLI tools are discovered.
3. The model issues a real `list_pages` call.
4. The final sentinel agrees with the tool trace.
5. Captured output contains no page URL, title, body, cookie, or token.

Report provider or quota failures separately from shared transport failures. Test native compatibility only when explicitly requested; label it because it adds a per-session runtime.

## Use explicit native compatibility only as rollback

Treat `NATIVE_COMPAT_REQUIRED` as a blocker, not permission to change configuration. After user approval, restore or enable only the named host's saved `chrome-devtools` entry, use a fresh compatibility session for its real tool call, then return that host to disabled or absent. Do not rewrite unrelated MCP entries, do not use a moving `@latest` registration, and do not assume an already-open session hot-loads the restored tool.
