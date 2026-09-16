# UXC HTTP facade for Ardot

Use the `uxc-facade` skill for the generic decision and packaging contract. This reference keeps only Ardot-specific ownership, pins, link, and acceptance details.

## What UXC contributes

[UXC](https://github.com/holon-run/uxc) discovers and invokes MCP HTTP tools through one JSON CLI. For Ardot it exposes a fixed linked command, stores OAuth tokens in the local credential store, and returns a structured envelope.

UXC is an adapter, not an Ardot editor. It does not replace endpoint identity checks, safe output policy, or design-task acceptance.

```text
linked CLI
  -> pinned owned UXC
  -> OAuth credential + binding
  -> https://ardot.tencent.com/mcp
```

## Provenance

Pins live in `scripts/lib/uxc-release.zsh`:

- official repository: `https://github.com/holon-run/uxc`
- release: `v0.22.0`
- asset and binary SHA-256 digests for Linux GNU/musl and Apple Darwin

Run `zsh scripts/install-uxc.zsh --manifest` to inspect pins without downloading. The installer writes `uxc.ardot-mcp.manifest` beside the binary. Later checks validate that manifest and the binary digest before execution.

This skill is the binary owner. Future UXC-backed skills on the same user must either consume this pin or explicitly migrate the whole machine; the daemon under `$HOME/.uxc` is shared.

## Why no daemon exclusivity

Ardot is MCP over HTTP. There is no local stdio child that owns mutable browser state. Skip `--daemon-exclusive` and idle-TTL overrides unless a measured HTTP session reuse requirement appears later.

## Acceptance layers

1. Binary and link ownership gates.
2. Sanitized readiness via `search_style_guide` (no design mutation, no `fileUrl` required).
3. Task acceptance via the requested Ardot operation (`open_design`, `fetch_editor_state`, `batch_edit`, and so on).
4. Native compatibility only when the user keeps host-native Ardot MCP in scope.

Store only bounded booleans, reason codes, counts, and versions in readiness output. Discard style-guide candidates, file contents, screenshots, and tokens unless the user asked for them.
