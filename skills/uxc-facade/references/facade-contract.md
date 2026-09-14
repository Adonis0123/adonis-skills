# UXC facade evidence and maintenance

Read this reference when reviewing the evidence behind a UXC-backed wrapper skill or updating its pinned UXC version. The contract template, command sequence, and ownership gates live in `SKILL.md`; do not restate them here.

## Evidence layers

| Evidence                         | Proves                              | Does not prove           |
| -------------------------------- | ----------------------------------- | ------------------------ |
| UXC discovery and passed gates   | Schema or tool visibility           | Successful execution     |
| Linked readiness call            | Adapter transport and JSON envelope | Correct service instance |
| Daemon metadata across two calls | Intended session reuse              | Task acceptance          |
| Owner skill real operation       | Task-level acceptance               | Native compatibility     |
| Native real tool call, if kept   | Host compatibility                  | Shared-path acceptance   |

Store only bounded booleans, reason codes, counts, and versions. A readiness check should parse the UXC envelope, decide success, discard the payload, and print the minimum status needed for diagnosis.

Treat the wrapper target, exclusivity key, idle TTL, owner skill, and skill path as one exact link contract. A link whose contract differs in any field is a different link and fails the link gate.

## Version update checklist

1. Verify the release in the [official UXC repository](https://github.com/holon-run/uxc) and read its changelog for flag or filesystem changes.
2. Confirm the binary owner and install root, then update its version pin and published SHA256 or package lock. Remember that the daemon under `$HOME/.uxc` is shared by every consumer, so the whole machine moves to the new version at once.
3. Recreate the managed link only if its contract changed.
4. Run `uxc daemon status` and require `version_mismatch=false`; restart the daemon with `uxc daemon restart` if the old owner process is still serving.
5. Run discovery, sanitized readiness twice, reuse proof if applicable, and task acceptance. Run native compatibility only when retained by the owner skill.
6. Record unsupported platforms, including native Windows, and skipped hosts as `UNVERIFIED`.

Do not use an unpinned moving tag in unattended automation. Do not expose raw readiness data merely to prove the adapter works.
