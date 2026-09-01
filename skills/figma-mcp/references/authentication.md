# Authentication

Read this reference only when Figma OAuth is required, the connected identity is wrong, or the user explicitly asks for Computer Use assistance.

## Keep credentials host-native

Each supported host owns its Figma registration, OAuth client flow, callback, and credential cache. Sharing the endpoint or using the same Figma account does not authorize copying credentials between hosts.

Never read, export, print, move, or symlink:

- OAuth access or refresh tokens;
- credential-store entries;
- browser cookies or profiles;
- callback query parameters;
- `whoami` names, emails, plan names, or IDs.

## Keep the shared configuration account-neutral

The reusable configuration contains only the official server identifier and endpoint. It must not contain a default account, email, account alias, token, cookie, browser profile, or callback value.

When the user does not name an account, keep the current host's OAuth grant. Use `whoami` for readiness-only, recovery, write, and multi-host acceptance. For a single-host read-only file or node task that accepts the current account, the first requested official read proves tool and auth readiness without a separate identity call. When the user names an account, treat that identity as an invocation-time requirement rather than a stored setting.

Changing accounts must never require a second Figma server entry. Preserve the current registration and replace only the current host surface's OAuth grant.

## Switch accounts without rewriting registration

1. Call `whoami` once and compare privately when the user named a target.
2. If the current account already matches, keep the grant and stop; do not reauthenticate.
3. If it does not match, clear only the current host surface's Figma OAuth grant. An explicit switch request authorizes this scoped logout; follow any stricter host confirmation policy.
4. Start that surface's native login or Connect flow without removing or re-adding the MCP server.
5. On Figma's official OAuth page, use Switch accounts when needed and select only the user's requested existing account.
6. Let the user handle passwords, passkeys, Touch ID, 2FA, CAPTCHA, or any ambiguous account chooser.
7. After the callback succeeds, call `whoami` exactly once and report only `MATCH`, `MISMATCH`, or `UNVERIFIED`.

Use the installed host's native capability:

| Host surface | Scoped account-switch route                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Codex CLI    | `codex mcp logout figma`, then `codex mcp login figma`                                            |
| Codex app    | Figma plugin Disconnect/Connect UI                                                                |
| Claude Code  | `claude mcp logout <exact-figma-identifier>`, then `claude mcp login <exact-figma-identifier>`    |
| Cursor       | Figma MCP/plugin Disconnect/Connect UI; use a CLI logout only if the installed CLI advertises one |

App plugins and CLIs can keep separate grants. Do not assume switching one surface switches another.

## Select the requested account

When the user names an account:

1. Start the native login flow for exactly one host.
2. If the browser already shows an unambiguous account chooser, select only the requested account.
3. Stop and ask the user when the account is absent, ambiguous, or requires credentials, a passkey, Touch ID, 2FA, CAPTCHA, or another challenge.
4. Approve Figma access only when the consent page clearly belongs to the expected official endpoint and requested account.
5. Return to the host and call `whoami` once.
6. Compare privately and report only `MATCH`, `MISMATCH`, or `UNVERIFIED`.

When the user does not name an account, do not infer a remembered target from previous conversations or local files. On paths that use `whoami`, accept the returned identity and report the Account state as `CURRENT`. The current-account single-host read-only fast path does not produce an Account result because it deliberately avoids reading identity.

If the wrong account is connected, clear only the Figma grant for the current host. Do not sign out of the user's entire browser, close unrelated sessions, or modify account settings.

## Use Kimi Computer Use only as an authorized helper

When the user explicitly requests Kimi Computer Use and the `kimi-computer-use` skill is installed:

1. Follow that skill's installation and permission checks.
2. Call `list_apps` only when the browser process identity is unknown.
3. Inspect the target browser with `get_app_state` in `ax` mode before acting.
4. Use the smallest non-secret action needed to select the requested existing account or approve the expected consent page.
5. Call `get_app_state` again after every UI mutation.
6. Stop for password, passkey, Touch ID, 2FA, CAPTCHA, account ambiguity, or unexpected consent.

Computer Use does not prove MCP readiness. The same host must still complete the path-specific Figma proof: `whoami` for identity-sensitive paths, or the requested official read for the current-account single-host read-only fast path.

## Keep evidence private

Authentication evidence should contain only:

- host name;
- native command or UI route used;
- whether authentication completed;
- proof call as `WHOAMI` or `REQUESTED_READ`, and whether it completed;
- account result as `CURRENT`, `MATCH`, `MISMATCH`, `UNVERIFIED`, or `NOT_READ` for the identity-free read-only fast path;
- one blocker when incomplete.

Do not capture or attach screenshots that contain account identifiers, OAuth codes, private Figma file names, or unrelated tabs.
