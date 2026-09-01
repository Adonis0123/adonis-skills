---
name: uxc-facade
description: "This skill should be used when the user invokes /uxc-facade or asks to package, harden, or reuse an MCP, OpenAPI, GraphQL, gRPC, or JSON-RPC interface through UXC; create or maintain a stable uxc link; reuse a daemon-backed stdio child; pin UXC for automation; or design a deterministic JSON CLI facade for another skill. Apply the facade contract without replacing service-specific identity checks. Do not use for ordinary one-off API calls, and hand Chrome DevTools-specific work to chrome-dev-mcp."
metadata:
  author: adonis
  version: "1.1.0"
---

# UXC Facade

Use UXC as a protocol adapter and stable JSON CLI facade. Do not turn it into a second service runtime.

The service-specific skill stays authoritative for endpoint identity, safety, execution routing, and final acceptance. Native registration may remain authoritative for services that require host-native tools, or become an explicit compatibility path when a measured shared facade is the service-specific default. UXC success is transport proof, not task acceptance.

## Entry behavior

When the user invokes `/uxc-facade` without naming a target, return the contract template from [references/facade-contract.md](references/facade-contract.md). Do not install UXC, create a link, import configuration, or mutate files until a concrete target is in scope.

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

| Layer                  | Owns                                                                             | Must not claim                                     |
| ---------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| Native host or client  | Registration, permissions, lifecycle, optional native tool exposure              | Service identity unless it validates it            |
| Service-specific skill | Endpoint identity, auth boundary, recovery policy, safe output, final acceptance | Generic UXC installation for every service         |
| UXC facade             | Protocol discovery, stable link, JSON envelope, optional daemon reuse            | Correct service instance or native-host acceptance |

Authentication stays with the native client, credential provider, or service-specific configuration. Never copy secrets into skill text, command examples, link metadata, test output, or readiness reports.

## Build the facade

### Define the contract

1. Name the native authority and the service-specific owner.
2. Name the UXC binary owner, which is the sole installer and updater, and its install root.
3. Select the least-privilege read operation and allowed output for readiness.
4. Record task acceptance separately from UXC readiness, and record native acceptance only when the service contract retains it.

### Make execution deterministic

1. Inspect the host and operation with UXC before linking.
2. Pin an official release for automation; record provenance and verify published digests when downloading a standalone binary.
3. Verify the configured install root before writing. Fail closed on a foreign binary or version conflict; never let two owner skills silently overwrite one shared `uxc` command.
4. Choose one fixed link name and fail closed if an existing command or link has foreign ownership.

If several skills intentionally share one binary, name one binary owner. That owner is the sole installer and updater; consumers verify the version and digest but never install, replace, or update it. Otherwise, each owning skill uses a service-private install root and carries the exact pin, digest, platform policy, and readiness operation it tests.

Do not add shared scripts or an ownerless installer merely because several skills use UXC. Keep link and readiness helpers in each service-specific skill. Keep a private binary installer there too, or, for an intentionally shared binary, keep only that installer with the named binary-owner skill.

### State ownership gates in every design

Include both ownership gates in every packaging answer so implementers cannot mistake an incomplete contract for permission to overwrite state:

- Binary gate: fail closed on a symlink, foreign or unknown owner, digest mismatch, or version conflict.
- Link gate: fail closed on a non-UXC command, foreign link owner, or owner/host target mismatch.

Keep the facade `UNVERIFIED` until both gates can identify an existing target as owned and compatible.

### Reuse only measured state

Use daemon-backed exclusivity only when the endpoint owns shared mutable state, such as one stdio child. Give idle sessions a finite TTL unless retention is explicitly required and verified. Prove reuse with two sanitized readiness calls and daemon/session metadata, not timing alone.

### Verify in layers

1. Prove UXC discovery for the intended operation.
2. Prove one sanitized transport call through the fixed link.
3. If reuse matters, prove the second call reused the intended daemon session.
4. Run the service-specific real operation separately; run native-host acceptance only when that compatibility path is in scope.

Return bounded status fields only. Discard URLs, titles, body content, credentials, cookies, tokens, and raw tool payloads unless the user explicitly requested safe data from them.

## Report the result

Use four statuses: `FACADE_READY`, `TRANSPORT_READY`, `SESSION_REUSED`, and `TASK_ACCEPTANCE`. Add `NATIVE_COMPAT` only when the service retains that path. Mark any required but unproved layer `UNVERIFIED` and name one next action. Never collapse them into one generic success claim.

Read [references/facade-contract.md](references/facade-contract.md) for the reusable template, command skeleton, and update checklist. Use the [official UXC repository](https://github.com/holon-run/uxc) as the source of truth for current commands and supported protocols.
