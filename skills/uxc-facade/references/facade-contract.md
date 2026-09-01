# UXC facade contract

Use this reference when designing or reviewing a UXC-backed wrapper skill. Fill the contract before writing an installer or link helper.

## Reusable contract

```text
UXC Facade Contract
- Owner skill:
- Native authority or compatibility path:
- Protocol and host:
- Readiness operation:
- Allowed readiness output:
- Fixed link name:
- UXC binary owner (sole installer and updater):
- UXC install root:
- UXC version and official source:
- Digest or package-lock proof:
- Authentication owner:
- Shared mutable state:
- Exclusivity key, if needed:
- Idle TTL, if needed:
- Task acceptance action:
- Native compatibility acceptance, if retained:
```

If the contract cannot identify a safe readiness operation or the task acceptance action, the facade is not ready to automate.

## Discovery and link skeleton

Confirm the exact syntax against the installed UXC version before execution.

```bash
uxc "<host>" -h
uxc "<host>" <operation> -h
uxc link <link-name> "<host>" --skill <skill-name>
<link-name> <readiness-operation> <safe-arguments>
```

For an existing MCP configuration, inspect the import plan before changing state:

```bash
uxc config import mcp --dry-run
```

Use `--schema-url`, credential providers, or injected environment only when the target protocol requires them. Keep secret values outside committed skill content and reports.

## Evidence layers

| Evidence                         | Proves                              | Does not prove           |
| -------------------------------- | ----------------------------------- | ------------------------ |
| UXC discovery                    | Schema or tool visibility           | Successful execution     |
| Linked readiness call            | Adapter transport and JSON envelope | Correct service instance |
| Daemon metadata across two calls | Intended session reuse              | Task acceptance          |
| Service-specific real operation  | Task-level acceptance               | Native compatibility     |
| Native real tool call, if kept   | Host compatibility                  | Shared-path acceptance   |

Store only bounded booleans, reason codes, counts, and versions. A readiness check should parse the UXC envelope, decide success, discard the payload, and print the minimum status needed for diagnosis.

## Link ownership rules

- Refuse to overwrite a non-UXC executable with the intended link name.
- Refuse to replace an existing UXC link that targets a different owner or host.
- Treat the wrapper target, daemon-exclusive key, idle TTL, skill owner, and skill path as one exact link contract.
- Leave an exact existing contract untouched; do not invoke a forced relink for idempotency.
- Keep the native MCP or API registration unchanged unless the user explicitly asks to migrate it.

## Binary ownership rules

- Prefer a service-private install root when owner skills may require different UXC versions.
- When several skills share one binary, name one binary owner as the sole installer and updater; consumers may verify it but must not install, replace, or update it.
- Before installation, inspect any existing target without executing a foreign file when provenance is unknown.
- Fail closed on a symlink, foreign owner, digest mismatch, or version conflict. Never silently replace a shared `uxc` command.

The service-specific skill always owns its link and readiness helpers. It also owns a private binary installer; only an intentionally shared binary moves that installer to the explicitly named binary-owner skill.

## Version update checklist

1. Verify the release in the official UXC repository.
2. Confirm the binary owner and install root, then update its version pin and published digests or package lock.
3. Recreate the managed link only if its contract changed.
4. Run discovery, sanitized readiness twice, reuse proof if applicable, and task acceptance. Run native compatibility only when retained by the service contract.
5. Record unsupported platforms or skipped hosts as `UNVERIFIED`.

Do not use an unpinned moving tag in unattended automation. Do not infer daemon reuse from a faster second call. Do not expose raw readiness data merely to prove the adapter works.
