# Accounts, pools and the probe

Read this before choosing a tier above L0, and whenever the user restricts accounts ("只用 cc001 cc002 cc003 cc008"), asks for 多开, or names a product you have not seen the probe report.

## Run the probe once per session

```bash
python3 <this skill>/scripts/probe_agents.py
```

It discovers accounts in order: accounts file (`~/.config/agent-dispatch/accounts.json` or `$AGENT_DISPATCH_ACCOUNTS`) → optional multi-account manager (sideby) → PATH lookup, and prints:

| Field                                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`                             | available products with distinct `quota_pools` and the per-account `<command>` to launch each                                                                                                                                                                                                                                                                                                 |
| `code_products`                        | coding CLIs with usable subscriptions (API-key accounts excluded from managers unless listed in the accounts file)                                                                                                                                                                                                                                                                            |
| `drafting_agents`                      | CLIs preferred for article drafting (e.g. Antigravity `agy`)                                                                                                                                                                                                                                                                                                                                  |
| `sessions_per_pool`                    | concurrent headless sessions allowed per pool (default 1)                                                                                                                                                                                                                                                                                                                                     |
| `busy_sessions` / `available_slots`    | per-pool occupied user sessions and remaining slots; never select a full pool silently. The protocol cannot identify interactive sessions, so all busy sessions are reserved unless listed in `AGENT_DISPATCH_OWNED_SESSIONS`; the Coordinator id (`AGENT_DISPATCH_COORDINATOR_SESSION`, else `CLAUDE_CODE_SESSION_ID`, else `CODEX_THREAD_ID`) is excluded before the separate Coordinator reservation |
| `max_parallel_workers`                 | pool slots left after reservations (pools × `sessions_per_pool`), minus the one session the Coordinator keeps; capped at 3 while `sessions_per_pool` is 1                                                                                                                                                                                                                                      |
| `allow` / `allow_unmatched`            | the user's allow-list and entries that matched nothing (typos)                                                                                                                                                                                                                                                                                                                                |
| `fallback`                             | degradations that apply on this machine                                                                                                                                                                                                                                                                                                                                                       |

Do not assume Codex, Grok, Antigravity or extra accounts exist because a plan, a prior session or this skill mentions them. If the probe cannot run, treat the machine as single-product with one pool.

Also confirm the review skills you plan to use are installed and callable; `open-code-review-*` additionally needs the `ocr` CLI on PATH.

## Pools bound quota, not concurrency

One subscription account can run several headless sessions at once, and the Coordinator's own pool may host workers too. Keep one session per pool unless the user asks for or authorizes 多开; then raise `sessions_per_pool` (`AGENT_DISPATCH_SESSIONS_PER_POOL=2` or the file field). Sessions on one pool share its rate limit, so extra sessions there trade wall time for earlier limit hits; say so when you use them.

Read pools from the probe, never from account names: one login can sit behind two names (sideby reported `claude:main` and `claude:001` as one pool).

## Restricting accounts

Pass the names via `AGENT_DISPATCH_ALLOW` or the file's `allow`; it overrides discovery. Entries may be probe ids (`claude:001`), short commands (`cc001`, resolved from `sideby config get aliases` or the file's `aliases`) or a product name for all its accounts; check `allow_unmatched` for typos.

## Accounts file

`pool` groups accounts sharing quota; a missing `pool` gets its own pool; `id` defaults to `command`; optional `aliases` maps short names to ids; env vars override `allow` and `sessions_per_pool`.

```json
{
  "allow": ["personal", "work"],
  "sessions_per_pool": 1,
  "accounts": [
    { "id": "personal", "product": "claude", "command": "claude", "pool": "personal" },
    {
      "id": "work",
      "product": "claude",
      "command": "CLAUDE_CONFIG_DIR=~/.claude-work claude",
      "pool": "work"
    }
  ]
}
```

## sideby as the session layer

When `sideby` is on PATH, `sideby sessions --json` lists every live session across accounts (status `needs-you` / `busy` / `idle`), `sideby send <session> "<text>" --json` delivers a message to a running Claude session (others get a paste line), and `sideby sessions copy <id> --as reference --json` hands a session to another AI. Detect each at runtime (`--help` exits 0) and keep the per-product fallbacks in `launch.md`. Listing every session on the machine belongs to sideby, not to a Run.
