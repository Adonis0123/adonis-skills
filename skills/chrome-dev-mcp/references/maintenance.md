# Runtime and skill maintenance

Use this runbook for a requested Chrome DevTools MCP upgrade or a detected update that the user has authorized you to apply. Maintain instructions and helpers in `adonis-skills/skills/chrome-dev-mcp/`; installed copies are distribution targets. A version check alone is not an upgrade request. Within an authorized upgrade, complete routine reversible steps without repeated approval.

## Check and preserve

1. Record the installed exact runtime version, wrapper options, owned UXC pin, skill revision, and active shared child. Inspect the current upstream release notes and package requirements. Upgrade UXC only when its changes help this workflow or resolve an observed defect; evaluate its ownership hashes and session contract separately.
2. Preserve the current runtime, wrapper, skill files and focused working-tree diff. Use a task-specific evidence directory outside published skill source. Record rule hashes, host, model when known, commands, results and unverified boundaries; omit page payloads and credentials.
3. Install a candidate at an exact version in a separate staging directory. Verify package integrity through the package manager, required flags, page routing schema and filesystem restrictions before replacing the active runtime. Never switch the wrapper to a moving `@latest`, auto-connect, unrestricted paths or a different browser profile.

## Activate and verify

1. Replace the owned runtime using a recoverable swap. Update only flags required by the new version. Inspect the corresponding UXC session before replacing that child; allow active work to finish where feasible and report any interrupted calls. Keep browser windows and unrelated sessions running. Refresh only this endpoint's schema cache.
2. Run installed `scripts/uxc-readiness.zsh` twice. Require shared transport success and reuse on the second call. Read live schemas; confirm explicit `pageId` is required for page-scoped operations. Do not accept stale cached help as new-version proof.
3. Run at least three concurrent read-only calls from different working directories through `chrome-dev-mcp-cli`. Compare OS MCP processes with UXC sessions before and after: the shared child PID must remain stable and calls must reuse it. Inspect extra native children by parent host; follow [host-verification.md](host-verification.md), never a broad process-name kill.
4. On disposable background pages, verify explicit-page reads return the correct page, then verify a snapshot or another requested DevTools capability. Close only test pages you created. Keep real-pointer tests serialized across the desktop.
5. Compare equivalent workloads before claiming a speed improvement. Record warm versus cold calls separately. A few elapsed times are observations, not a benchmark. If required acceptance fails, retain evidence and restore the prior compatible runtime/wrapper rather than weakening identity or permissions.

## Deliver the reusable change

Run the focused repository regression tests and `pnpm skills:finalize -- skills/chrome-dev-mcp` from the source repository. Synchronize intended installed copies and verify content equality and host discovery. Keep current-session loading and actual per-host model calls separate; mark untested hosts `UNVERIFIED`.

Preserve the existing scheduler's role rather than creating another one. A scheduler that only checks Chrome versions should link to this full-validation workflow; changing it into an automatic upgrader is a separate scope decision. Report installed version, runtime acceptance, process count, distribution, rollback location and remaining limits. Commit or push only when requested.
