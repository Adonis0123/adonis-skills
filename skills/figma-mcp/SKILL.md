---
name: figma-mcp
description: "Use this skill whenever the user invokes /figma-mcp or asks to install, authenticate, switch accounts, recover, or verify the official Figma MCP server across Codex, Claude Code, Cursor, or Grok Build. Keep registration account-neutral and each supported host's OAuth flow authoritative. Use whoami for readiness, named-account, recovery, write, and multi-host checks; for a current-account single-host read-only task, let the first requested official read prove tool and auth readiness without a redundant identity call. Never copy OAuth tokens between hosts."
metadata:
  author: adonis
  version: "1.4.0"
---

# Figma MCP

Use the official remote server `https://mcp.figma.com/mcp` through each host's native registration. Authentication belongs to that host's OAuth flow. The user only remembers `/figma-mcp` (`$figma-mcp` in Codex); handle host discovery, OAuth state, identity, and readiness internally. On failure, report one failing layer and one required action.

## Pick the proof before calling a tool

Most invocations are `/figma-mcp <figma URL> <UI task>` on the current account in one host. That is the read-only fast path: the first requested official read proves server discovery, tool availability, and authentication, so a separate `whoami` only adds a round trip.

| Invocation payload                                                       | Proof                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------- |
| Figma URL or `fileKey`, current account, one host, read-only             | First requested read (below); no `whoami`                |
| Bare `/figma-mcp` (readiness only)                                       | One `whoami`; reply only `FIGMA_MCP_READY`               |
| Named account, account switch, recovery, write, or multi-host acceptance | One `whoami`; compare privately when an account is named |
| File needed but no URL/`fileKey`                                         | Stop; ask for the URL (`FILE_ACCESS: UNVERIFIED`)        |

On task success, continue the requested work; do not emit `FIGMA_MCP_READY` or identity details mid-task. Server configuration, an OAuth page, a callback, and a tool list are separate evidence layers; none of them replaces the required call.

## Read-only fast path

1. Parse the URL: `/design/:fileKey/:name?node-id=1-2` gives nodeId `1:2`; `/design/:fileKey/branch/:branchKey/...` uses `branchKey` as `fileKey`; `/make/:key` uses nodeId `0:1` with `get_design_context` only; `/board/` is FigJam and uses `get_figjam`.
2. Choose the first read. To confirm access or list pages, use `get_metadata` (no prerequisite). For implementation, load `figma-design-to-code` first (the Figma plugin's `/figma-design-to-code`, or MCP resource `skill://figma/figma-design-to-code/SKILL.md`), then call `get_design_context`. If a design-to-code workflow skill is already driving the task, it owns the workflow; this skill only supplies the proof and read rules.
3. Match node IDs to the tool. Instance sublayer IDs such as `I10:20;30:40` are accepted only by `get_design_context` and `get_metadata`. `get_screenshot`, `get_variable_defs`, and `download_assets` require a plain `123:456` ID, so pass the instance root (`10:20`, the part after `I` and before the first `;`) or a non-instance ancestor instead of retrying the same ID.
4. If the read returns forbidden or not-found, stop. A Figma-originated error already proves tools and auth, so add at most one `whoami`, and only when no read reached Figma. Report `FILE_ACCESS: UNVERIFIED` with the one missing item (URL, share permission, or plan feature). Do not probe other files. A node ID copied from docs or memory that is not found was usually deleted or re-created; re-derive it from the user's current URL or the parent's `get_metadata` rather than guessing.
5. If the tool is absent or the server requires authentication, recover by layer (below), then retry the requested read directly; its success is the post-recovery proof.

When a status line helps, report `Proof call: REQUESTED_READ` and `Account: NOT_READ`.

The official MCP exposes no file-comments tool. When the task needs design review comments, say so at the start instead of treating it as an auth failure; the REST comments endpoint needs a separate personal access token that the user owns. Never echo or store such a token.

## Tool prerequisites

| Tool                                                  | Prerequisite                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `get_design_context`                                  | Load `figma-design-to-code` first                                                                             |
| `use_figma`                                           | Load `figma-use` first (`/figma-use`, or `skill://figma/figma-use/SKILL.md`)                                  |
| `create_new_file`, `generate_diagram`, shader/plugin  | `whoami` for `planKey`; pass it only as a tool parameter, never in visible text; ask when several plans exist |
| `get_metadata`, `get_screenshot`, `get_variable_defs` | None; `get_metadata` without a `node-id` lists the file's pages                                               |

Honor any stricter prerequisite in the tool description. Test writes in a duplicate or disposable file, never an important working file. Before a write, refresh the target node context, and do not let two agents modify the same file or node without an approved coordination mechanism.

In Grok Build, Figma tools are namespaced `Figma__<tool>` behind `use_tool`. One `search_tool` query that names every tool you need is enough; do not search per tool.

Do not use Figma MCP for ordinary web browsing, desktop navigation, generic screenshots, or non-Figma files.

## Hosts and credentials

Supported hosts must appear in Figma's current MCP Catalog (<https://www.figma.com/mcp-catalog/>). As of 2026-09 that includes Claude Code, Codex, Cursor, and Grok. Treat Hermes, WorkBuddy, and any other client missing from the catalog as unsupported: fail closed, name a supported host, and never work around the catalog with a proxy, shared wrapper, or borrowed client identity.

Keep one chain per host: native registration, the official endpoint, that host's OAuth grant, the current or explicitly requested account, then the path's proof call. OAuth credentials stay per host. Never copy tokens, credential caches, cookies, or browser profiles between hosts.

Keep registration account-neutral. Never store a default account, email, alias, token, cookie, browser profile, or callback in the skill, MCP configuration, environment variables, or repository files. Switching accounts changes only the current host surface's OAuth grant; keep the server identifier, endpoint, scope, and unrelated MCP entries. App plugins and CLI registrations can hold separate grants, so switch and verify only the surface in use.

Never print `whoami` payloads. Reduce identity to `CURRENT`, `MATCH`, `MISMATCH`, or `UNVERIFIED`.

## Recover by failed layer

- Tool absent or server missing: read [references/host-verification.md](references/host-verification.md). Merge the official server into the host's native configuration; never replace the whole configuration.
- Authentication required: run only that host's native login or plugin Connect flow. Let the user complete passwords, passkeys, Touch ID, 2FA, CAPTCHA, or any credential challenge. Then retry `whoami` once on identity paths, or the requested read on the fast path. A login in one host proves nothing about another.
- Wrong account, account switch, or Computer Use help with OAuth UI: read [references/authentication.md](references/authentication.md). Without a named target, do not switch. With one, fail closed on mismatch and clear only the current surface's Figma grant; never sign out of the whole browser or Figma desktop session.
- Tool call failed after authentication: separate provider, plan, rate-limit, client-compatibility, and file-permission failures from registration failures, and check Figma's official known issues.

For multi-host acceptance, run the per-host prompt and report table in [references/host-verification.md](references/host-verification.md). Do not build that table for the single-host fast path.
