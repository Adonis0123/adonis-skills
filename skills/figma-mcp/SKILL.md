---
name: figma-mcp
description: "Use this skill whenever the user invokes /figma-mcp or asks to install, authenticate, switch accounts, recover, or verify the official Figma MCP server across Codex, Claude Code, or Cursor. Keep registration account-neutral and each supported host's OAuth flow authoritative. Use whoami for readiness, named-account, recovery, write, and multi-host checks; for a current-account single-host read-only task, let the first requested official read prove tool and auth readiness without a redundant identity call. Never copy OAuth tokens between hosts."
metadata:
  author: adonis
  version: "1.2.0"
---

# Figma MCP

Use the official remote Figma MCP server through each supported host's native registration. The endpoint is `https://mcp.figma.com/mcp`; authentication belongs to the host's OAuth flow.

## Keep the user contract simple

Let the user remember only `/figma-mcp`. Handle host discovery, OAuth state, account identity, and readiness internally. With no additional task, accept the host's currently authenticated Figma account and return only `FIGMA_MCP_READY` after a real `whoami` tool call. For a current-account, single-host, read-only file or node task, skip a separate identity probe and let the first requested official read prove that its tool and OAuth grant work. When the user names an account, require a private match before readiness. On failure, report one failing layer and one required action.

Use `/figma-mcp` in Claude Code and Cursor, and `$figma-mcp` in Codex.

## Choose the cheapest valid proof

Classify an explicit invocation by its payload before calling a tool.

1. For readiness-only, a named account, an account switch, recovery, a write, or multi-host acceptance, call the host-registered Figma MCP `whoami` once. Inspect the result privately and require a private match when the user named an account.
2. For a single-host read-only file or node task where the user accepts the current account, first load the official operation skill, then execute the first requested harmless read. Its success proves server discovery, tool availability, and authentication for that task; do not add a separate `whoami` call.
3. On readiness-only success, return `FIGMA_MCP_READY`. On task success, continue the requested work without emitting identity details.
4. If the required tool is absent, diagnose native host discovery before changing authentication.
5. If the server requires authentication, use the host's native login command or plugin UI. Let the user complete passwords, passkeys, Touch ID, 2FA, CAPTCHA, or any other credential challenge.
6. After successful authentication or recovery, retry `whoami` exactly once. If the original request was the read-only fast path, retry its requested read only after that post-recovery identity and authentication proof succeeds.

Use `VERIFIED` only after the proof required for that path completes. Server configuration, an OAuth browser page, a successful callback, and tool discovery are separate evidence layers.

## Preserve the remote invariant

Keep one chain per host:

```text
supported host's native Figma registration
  -> https://mcp.figma.com/mcp
  -> that host's OAuth grant
  -> current or explicitly requested Figma account
  -> real whoami or requested read call, according to the proof path
```

The endpoint and account may be common, but OAuth credentials remain per host. Never copy tokens, credential caches, cookies, or browser profiles between Codex, Claude Code, Cursor, or another client. Do not add a local proxy or shared wrapper merely to imitate a shared runtime.

Only clients listed in Figma's MCP Catalog may connect. Treat Grok, Hermes, WorkBuddy, and any other unlisted client as unsupported unless Figma's current official catalog explicitly includes it. Do not work around the catalog with a proxy or borrowed client identity.

## Keep registration account-neutral

Share only the skill and official server registration. Never store a default Figma account, email, account alias, token, cookie, browser profile, or OAuth callback in the skill, MCP configuration, environment variables, or repository files.

- With no account named, keep the existing OAuth grant. Use `whoami` when identity is part of the proof path; do not inspect identity for the current-account single-host read-only fast path.
- With an account named, compare privately and switch only when the current host is a mismatch.
- Switching accounts must preserve the existing server identifier, endpoint, scope, and unrelated MCP entries.
- App plugins and CLI registrations may have separate OAuth lifecycles even on the same machine. Switch and verify only the surface the user is actually using.

Account switching changes authentication state, not MCP configuration. Do not add a duplicate Figma server, rewrite the shared endpoint, or create one configuration per person merely to change accounts.

## Route by task semantics

Use this skill for:

- Official Figma MCP installation, OAuth, connection recovery, and multi-host acceptance.
- Readiness and private account-identity checks with `whoami`, plus current-account single-host read-only fast-path proof through the requested official read.
- Diagnosing the difference between server discovery, tool discovery, authentication, and a real tool call.

For Figma design reads and writes, load the official task skill that owns the operation before calling its tool. In particular, load `figma-use` before every `use_figma` call and honor any stricter prerequisite named by a Figma tool. Test write workflows in a duplicate or disposable file, never an important working file.

Do not use Figma MCP for ordinary web browsing, desktop navigation, generic screenshots, or non-Figma files.

## Authenticate safely

Read [references/authentication.md](references/authentication.md) when login is required, the wrong account is connected, or the user explicitly asks to use Computer Use for the OAuth UI.

Prefer the host's native OAuth command or plugin UI. Computer Use may assist only with already-visible, non-secret UI after the user explicitly authorizes the target account. It must stop for credential entry, passkeys, Touch ID, 2FA, CAPTCHA, consent ambiguity, or an account not clearly matching the requested identity.

Never print `whoami` payloads in readiness reports. Reduce identity checks to `CURRENT`, `MATCH`, `MISMATCH`, or `UNVERIFIED`.

## Recover by failed layer

### Tool absent or server missing

Read [references/host-verification.md](references/host-verification.md). Merge the official remote server into the host's native configuration; never replace the whole configuration.

### Authentication required

Run only that host's native login flow, then retry `whoami` once. If recovery interrupted a current-account read-only task, retry its requested read after `whoami` succeeds. A login in one host does not prove another host is authenticated.

### Switch account or recover from a mismatch

Read [references/authentication.md](references/authentication.md). If the user did not name a target account, do not switch automatically. With an explicit target account, fail closed on mismatch, clear only that host surface's Figma OAuth grant, authenticate again, and rerun `whoami`. Preserve the server registration and unrelated MCP entries. Do not sign out of the user's whole browser or Figma desktop session.

### Tool call failed after authentication

Recheck current host status and Figma's official known-issues guidance. Separate provider, plan, rate-limit, client compatibility, and file-permission failures from MCP registration failures.

## Handle concurrency

Allow concurrent `whoami` and unrelated read-only calls. Before a write, refresh the target file and node context. Do not let two agents modify the same Figma file or node concurrently unless the workflow has an explicit coordination mechanism and the user approved it.

## Report acceptance

For multi-host validation, report each host independently:

| Host | Server discovered | Tools discovered | Proof call | Account | Result |
| ---- | ----------------- | ---------------- | ---------- | ------- | ------ |

For this multi-host table, use `WHOAMI` in the Proof call column for every host. Use `CURRENT` in the Account column only when that identity proof completed without a named target, and `MATCH` only after privately matching an explicit target. Otherwise report `MISMATCH`, `UNVERIFIED`, or the exact external blocker.

Do not manufacture a multi-host table for the current-account single-host read-only fast path. When a status line is useful for that task, report `Proof call: REQUESTED_READ` and `Account: NOT_READ` outside this table because identity was deliberately not inspected.
