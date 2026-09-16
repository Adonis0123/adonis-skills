---
name: ardot-mcp
description: "This skill should be used when the user invokes /ardot-mcp or asks to package Ardot MCP through UXC, set up ardot-mcp-cli, complete Ardot OAuth for UXC, run sanitized Ardot readiness, open or inspect Ardot design files via a fixed CLI facade, or keep Grok/Claude native Ardot MCP as a compatibility path. Own Ardot endpoint identity, OAuth boundary, safe output, and task acceptance. Use uxc-facade for the generic packaging method. Do not use for one-off Ardot calls already solved by the native host MCP tools."
metadata:
  author: adonis
  version: "1.0.0"
---

# Ardot MCP

Use the managed `ardot-mcp-cli` facade for Ardot design-file work from a deterministic JSON CLI. This skill owns the Ardot endpoint, OAuth credential/binding, sanitized readiness, and task acceptance. Keep host-native Ardot MCP (for example Grok `ardot-remote`) as an explicit compatibility path, not the default shared CLI path.

This skill is the **binary owner** for pinned UXC `0.22.0`. The UXC daemon under `$HOME/.uxc` is shared per user; do not let another skill silently install a different UXC version on the same machine. Use `uxc-facade` for the generic packaging method.

## Keep the user contract simple

Let the user remember `/ardot-mcp`. Handle install, OAuth handoff, link repair, and readiness internally. With no additional task, return only `ARDOT_MCP_READY` after sanitized readiness. On failure, report one failing layer and one required action.

## Execute the slash entry

Treat `/ardot-mcp` without a task as readiness-only. Treat the same invocation with a design task as readiness-plus-task.

Invoke every helper with `zsh` (for example `zsh scripts/uxc-readiness.zsh`). Under `bash`, `set -u` and `${0:A:h}` abort with `A: unbound variable`.

1. For readiness-only, run `zsh scripts/uxc-readiness.zsh` from this skill. It calls shared `search_style_guide`, discards catalog candidates, and prints only bounded status fields.
2. For readiness-plus-task, run `zsh scripts/uxc-readiness.zsh --private-result` once, keep the JSON private, and reuse that current-turn proof before design operations.
3. If readiness reports missing OAuth or auth failure, run the OAuth handoff in [references/oauth-and-binding.md](references/oauth-and-binding.md), then retry readiness once.
4. If the managed CLI is absent, install and link only through this skill's scripts. Do not fall back to an unowned `uxc` on `PATH`.
5. Use host-native Ardot MCP only when the user explicitly requests `native` compatibility or approves it after a blocker. Mark that mode `NATIVE_COMPAT`.
6. Claim a design task `VERIFIED` only after the requested Ardot operation completes. Readiness alone is transport proof.

## Preserve the runtime invariant

```text
managed ardot-mcp-cli
  -> pinned owned UXC 0.22.0
  -> UXC OAuth credential + binding for ardot.tencent.com/mcp
  -> Ardot MCP HTTP endpoint
```

Fixed values:

| Item                     | Value                                            |
| ------------------------ | ------------------------------------------------ |
| Endpoint                 | `https://ardot.tencent.com/mcp`                  |
| Link name                | `ardot-mcp-cli`                                  |
| Credential / binding id  | `ardot-mcp`                                      |
| Default scope            | `mcp:use`                                        |
| Default install/link dir | `${XDG_DATA_HOME:-$HOME/.local/share}/ardot-mcp` |
| Binary owner             | `ardot-mcp`                                      |

HTTP MCP has no expensive stdio child, so this skill does **not** set `--daemon-exclusive`. Session reuse metadata may still appear; do not invent exclusivity keys.

## Setup sequence

Run only after the user authorizes local install and OAuth:

1. `zsh scripts/install-uxc.zsh`
2. `zsh scripts/setup-uxc-link.zsh`
3. OAuth start/complete from [references/oauth-and-binding.md](references/oauth-and-binding.md)
4. `zsh scripts/uxc-readiness.zsh` twice for install acceptance

`zsh scripts/install-uxc.zsh --manifest` prints pins without downloading.

## Route by task semantics

Use this skill for:

- Installing or repairing the Ardot UXC facade and OAuth binding.
- Shared CLI discovery and sanitized readiness across agents.
- Design tasks that should go through `ardot-mcp-cli` instead of ad-hoc native tools.

For one-off inspection already connected in the current host's native Ardot MCP, stay on the native tools unless the user asked for the shared CLI facade.

Typical task operations after readiness:

```bash
ardot-mcp-cli -h
ardot-mcp-cli open_design fileUrl='https://ardot.tencent.com/file/<id>'
ardot-mcp-cli fetch_editor_state fileUrl='https://ardot.tencent.com/file/<id>' includeSchema=false includeGeneralEditInstructions=false
ardot-mcp-cli batch_read fileUrl='https://ardot.tencent.com/file/<id>'
```

Confirm parameter names with `ardot-mcp-cli <operation> -h`. Never print OAuth tokens, raw readiness catalogs, or unrelated design payloads unless the user asked for that data.

## Report acceptance

| Status            | Proven by                                              |
| ----------------- | ------------------------------------------------------ |
| `FACADE_READY`    | Owned binary + link contract gates passed              |
| `TRANSPORT_READY` | Sanitized `search_style_guide` through `ardot-mcp-cli` |
| `TASK_ACCEPTANCE` | Requested Ardot operation completed                    |
| `NATIVE_COMPAT`   | Host-native Ardot MCP call, only when retained         |

Mark unproved layers `UNVERIFIED` and name one next action. Read [references/uxc-facade.md](references/uxc-facade.md) for ownership, pins, and evidence boundaries.
