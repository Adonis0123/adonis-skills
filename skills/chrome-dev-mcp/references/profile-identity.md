# Profile identity gate

Read this reference only when the user reports the wrong Chrome, profile, or login context.

## Define identity outside the public skill

Let the configured safe wrapper own the endpoint and process contract. Require it to verify:

- one exact loopback endpoint;
- a matching loopback WebSocket address;
- the intended browser binary and listener process;
- the configured isolated user-data directory or equivalent profile identity.

Do not encode a machine-specific endpoint, executable, or profile path in the published skill. Store those values in the one-time local configuration created by `scripts/configure-local.zsh` and in the safe wrapper itself.

## Check and recover

Run `scripts/ensure-connection.zsh --check` from the installed skill. Interpret only its sanitized sentinels:

- `CHROME_DEV_MCP_CONNECTION=READY` proves the configured isolated profile owns the endpoint. It does not prove website login identity.
- `CHROME_DEV_MCP_CONNECTION=NOT_READY` reports a bounded reason such as `ENDPOINT_UNAVAILABLE`, `WRONG_BINARY`, or `WRONG_PROFILE`.
- Prefer the wrapper's stable `CHROME_DEVTOOLS_MCP_SAFE_REASON` marker over matching human-readable stderr. Keep text matching only as a compatibility fallback for older wrappers.
- `--recover` may launch only the configured isolated profile when the endpoint is absent.
- A wrong binary or profile fails closed. Do not call `list_pages`, kill the process, scan for another endpoint, or rewrite host registration.

If the user expects a default signed-in browser, ask for an explicit profile-contract decision. Never close or restart the existing browser without authorization.
