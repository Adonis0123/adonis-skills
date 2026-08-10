# UXC stdio facade

Read this reference only when the user explicitly asks about UXC or a failed native MCP call needs transport isolation.

Use the `uxc-facade` skill for the generic decision and packaging contract. This reference contains only the Chrome-specific ownership, pin, link, and acceptance details.

## What UXC contributes

[UXC](https://github.com/holon-run/uxc) provides one discovery and invocation interface across OpenAPI, MCP, GraphQL, gRPC, and JSON-RPC. For MCP stdio, it can expose a fixed linked command, return a JSON envelope, and reuse the child session through its local daemon.

UXC is an adapter, not a browser, CDP implementation, second Chrome runtime, or host-registration replacement.

```text
linked CLI
  -> pinned UXC daemon
  -> configured safe MCP wrapper
  -> identity-checked Chrome
```

## Why this skill keeps a separate contract

UXC also publishes a generic `chrome-devtools-mcp-skill` that favors package `@latest`, browser auto-connect, and optional fallbacks. Those defaults are useful for general discovery, but they do not prove a specific wrapper, runtime version, endpoint, or profile identity.

Keep this skill host-first and fail-closed:

- preserve native MCP registration for every host;
- link UXC only to the same safe wrapper;
- never use `@latest`, auto-connect, alternate endpoint discovery, or isolated fallback inside this facade;
- treat UXC success as transport evidence, not native-host acceptance;
- require a separate real `list_pages` call in each host.

## Reusable provenance

The pin lives in `scripts/lib/uxc-release.zsh` and currently records:

- official repository: `https://github.com/holon-run/uxc`;
- release: `v0.17.0`;
- official macOS release assets for Apple Silicon and Intel;
- SHA-256 digests published by the GitHub release;
- SHA-256 digests of the extracted binaries.

Run `scripts/install-uxc.zsh --manifest` to inspect the pins without downloading. The installer records the owner, release, platform, asset digest, and binary digest beside the installed binary. Later checks validate that private manifest and the pinned binary digest before executing `uxc`; an unowned binary, forged manifest, symlink, or digest mismatch fails closed.

Keep this installer with the Chrome skill; future UXC-backed skills should apply the `uxc-facade` contract and own their exact version, digest, platform policy, link, and acceptance helper because endpoint identity and safe output differ by service.

## Install, link, and validate

After the user authorizes local installation:

1. Run `scripts/install-uxc.zsh`.
2. Run `scripts/setup-uxc-link.zsh`.
3. Run `scripts/uxc-readiness.zsh` twice from the installed skill.

The first readiness call may create a daemon session. The immediate second call should report `DAEMON_SESSION_REUSED=YES`. The helper discards the `list_pages` payload and prints only bounded status fields.

Use a finite idle TTL so an unused MCP child is reaped. Treat the configured daemon-exclusive key as an ownership boundary, not session identity; UXC's lifecycle contract defines stdio identity from endpoint, auth fingerprint, injected environment fingerprint, and runtime family.

Never log raw linked-command output for `list_pages`. `STATUS=READY` proves only the facade; it does not prove native-host acceptance.
