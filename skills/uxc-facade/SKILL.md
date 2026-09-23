---
name: uxc-facade
description: "This skill should be used when the user invokes /uxc-facade or asks to package, harden, or reuse an MCP, OpenAPI, GraphQL, gRPC, or JSON-RPC interface through UXC; create or maintain a stable uxc link; reuse a daemon-backed stdio child; pin UXC for automation; or design a deterministic JSON CLI facade for another skill. Apply the facade contract without replacing service-specific identity checks. Do not use for ordinary one-off API calls, and hand Chrome DevTools-specific work to chrome-dev-mcp."
metadata:
  author: adonis
  version: "1.3.0"
---

# UXC Facade

Use UXC as a protocol adapter and stable JSON CLI facade. Do not turn it into a second service runtime, because UXC can prove transport but cannot validate which service instance answered.

Three parties share every facade. Use these names only:

- **Native host**: the client or host that registers the server natively (Cursor, Claude Code, Codex, a browser).
- **Owner skill**: the service-specific skill that owns endpoint identity, auth boundary, recovery, safe output, and final acceptance.
- **Binary owner**: the one skill that installs and updates the pinned `uxc` binary. It may be the owner skill or a named shared owner.

The native host may stay authoritative for services that require host-native tools, or become an explicit compatibility path when a measured shared facade is the owner skill's default. UXC success is transport proof, not task acceptance.

## Entry behavior

When the user invokes `/uxc-facade` without naming a target, return this contract unfilled. Do not install UXC, create a link, import configuration, or mutate files until a concrete target is in scope.

```text
UXC Facade Contract
- Owner skill:
- Native host role (authoritative | compatibility path | none):
- Protocol and host:
- Readiness operation:
- Allowed readiness output:
- Fixed link name:
- Binary owner (sole installer and updater):
- UXC install root:
- UXC version and official source:
- Digest or package-lock proof:
- Authentication owner:
- Shared mutable state:
- Exclusivity key, if needed:
- Idle TTL, if needed:
- Writable file root, if the server validates paths:
- Task acceptance action:
- Native compatibility acceptance, if retained:
```

If the contract cannot name a safe readiness operation or the task acceptance action, the facade is not ready to automate.

For Chrome DevTools, CDP, `list_pages`, correct-Chrome identity, or `/chrome-dev-mcp`, hand the task to `chrome-dev-mcp`. Apply this method only as its generic UXC design layer.

## Decide whether a facade is justified

Use the facade when at least one condition holds:

- repeated agent or automation calls need one stable command name and JSON envelope;
- an MCP stdio child is expensive and measured session reuse is valuable;
- multiple supported protocols need the same discovery and invocation workflow;
- installation provenance, link ownership, and sanitized readiness need an explicit contract.

Skip the facade when:

- the request is a one-off API call that UXC can execute directly;
- the native host registration already solves the complete task and no CLI consumer exists;
- the interface has no usable schema or discovery surface;
- a full SDK is required for streaming, callbacks, or protocol-specific features.

## Keep ownership explicit

| Layer       | Owns                                                                             | Must not claim                                     |
| ----------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| Native host | Registration, permissions, lifecycle, optional native tool exposure              | Service identity unless it validates it            |
| Owner skill | Endpoint identity, auth boundary, recovery policy, safe output, final acceptance | Generic UXC installation for every service         |
| UXC facade  | Protocol discovery, stable link, JSON envelope, optional daemon reuse            | Correct service instance or native-host acceptance |

Authentication stays with the native host, a credential provider, or the owner skill's configuration. Never copy secrets into skill text, command examples, link metadata, test output, or readiness reports.

## Build the facade

### Define the contract

1. Name the native host role and the owner skill.
2. Name the binary owner and its install root.
3. Select the least-privilege read operation and allowed output for readiness.
4. Record task acceptance separately from UXC readiness, and record native acceptance only when the owner skill retains it.

### Pin, install, link

A private install root isolates the binary only. The daemon socket, schema cache, and credentials live under `$HOME/.uxc` and are shared by every UXC version on the machine; UXC provides no per-owner daemon directory (verified on 0.17.0; re-check `uxc daemon --help` after upgrades). Therefore pin one UXC version per user, name its binary owner, and let consumers verify the version and digest but never install, replace, or update it. Never let two owner skills silently overwrite one shared `uxc` command, because a replaced binary changes daemon behavior for every consumer at once.

Keep link and readiness helpers in each owner skill. Keep the binary installer with the binary owner. Do not add an ownerless shared installer merely because several skills use UXC.

Run the sequence below with the contract values. Confirm every flag against the installed version with `uxc link --help` before execution.

```bash
# 1. Pin and install (official installer verifies the published SHA256 by default; never pass --no-verify)
curl -fsSL https://raw.githubusercontent.com/holon-run/uxc/main/scripts/install.sh | bash -s -- -v vX.Y.Z -d "<install-root>"
#    Alternative when a Rust toolchain is the provenance policy (cargo writes <install-root>/bin/uxc; point UXC_ROOT there):
cargo install uxc --version X.Y.Z --root "<install-root>"

# 2. Pass both ownership gates (script below), then confirm one daemon version per user
uxc daemon status        # require version_mismatch=false before claiming TRANSPORT_READY

# 3. Discover before linking
uxc "<host>" -h
uxc "<host>" <operation> -h

# 4. Create the fixed link; add daemon flags only for shared mutable state
uxc link <link-name> "<host-or-stdio-command>" --skill <owner-skill> \
  [--daemon-exclusive <key>] [--daemon-idle-ttl <seconds>] [--force]

# 5. Sanitized readiness through the link
<link-name> <readiness-operation> <safe-arguments>
```

`--daemon-idle-ttl 0` disables idle reaping; use it only when retention is explicitly required and verified. Use `--force` only to replace a link whose exact contract changed; never use it for idempotency. Add `--schema-url`, `--credential`, or `--inject-env NAME={{secret}}` only when the protocol requires them, and keep secret values outside committed content. Native Windows is unsupported by UXC; record it as `UNVERIFIED`.

For an existing MCP configuration, preview the import before changing state with `uxc config import mcp --dry-run`.

### Pass both ownership gates

Before install, link, or readiness, prove two gates so an incomplete contract is never mistaken for permission to overwrite state. Keep the facade `UNVERIFIED` until both pass.

- **Binary gate**: the pinned binary exists, is not a symlink, has an owner file naming the binary owner, matches the recorded digest, and reports the pinned version. Check the digest before executing it, so an unknown file never runs.
- **Link gate**: the link is absent, or it is a UXC shortcut whose owner skill and host target match the contract exactly.

Use the fill-in script in [references/ownership-gates.md](references/ownership-gates.md). Leave an exact existing link untouched, and keep the native registration unchanged unless the user explicitly asks to migrate it.

### Reuse only measured state

Use `--daemon-exclusive` only when the endpoint owns shared mutable state, such as one stdio child. Give idle sessions a finite TTL unless retention is explicitly required and verified.

The daemon is one per user and serves every facade on the machine. Never run `uxc daemon stop` or `restart`, or kill its children, to recover one facade: that cuts off every other consumer mid-call. Only the binary owner restarts it, during an authorized version update.

UXC does not negotiate MCP `roots`. A server that validates file paths against roots falls back to its own default (for example, only the child's temporary directory), so record that writable root in the contract instead of letting callers guess paths.

Prove reuse with metadata, never with timing, because a faster second call can come from caching or a warm host:

```bash
uxc daemon status                       # record mcp_reuse_hits
<link-name> <readiness-operation> <safe-arguments>
<link-name> <readiness-operation> <safe-arguments>
uxc daemon sessions                     # expect one stdio session for this command, reuse-eligible
uxc daemon status                       # expect mcp_reuse_hits increased and mcp_stdio_sessions unchanged
```

### Verify in layers

1. Prove UXC discovery for the intended operation and pass both ownership gates.
2. Prove one sanitized transport call through the fixed link. For MCP, `"ok": true` only means UXC delivered the call; the tool's own failure arrives as `data.isError: true` inside a successful envelope. Readiness and task checks must require both.
3. If reuse matters, prove the second call reused the intended daemon session.
4. Run the owner skill's real operation separately; run native-host acceptance only when that compatibility path is in scope.

Return bounded status fields only. Discard URLs, titles, body content, credentials, cookies, tokens, and raw tool payloads unless the user explicitly requested safe data from them.

## Report the result

| Status            | Proven by                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `FACADE_READY`    | Discovery succeeded and both ownership gates passed                                        |
| `TRANSPORT_READY` | One sanitized call through the fixed link, no `data.isError`, and `version_mismatch=false` |
| `SESSION_REUSED`  | Second call plus `uxc daemon sessions` and `mcp_reuse_hits` metadata                       |
| `TASK_ACCEPTANCE` | The owner skill's real operation completed                                                 |
| `NATIVE_COMPAT`   | Native-host real call, reported only when the owner skill retains that path                |

Mark any required but unproved layer `UNVERIFIED` and name one next action. Never collapse them into one generic success claim. Consumer skills may rename these statuses to their own vocabulary but must keep the layers separate.

Read [references/facade-contract.md](references/facade-contract.md) for the evidence table and version update checklist. Use the [official UXC repository](https://github.com/holon-run/uxc) as the source of truth for current commands and supported protocols.
