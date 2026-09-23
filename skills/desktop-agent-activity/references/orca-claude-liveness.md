# Orca + Claude Code liveness (macOS)

Host: Orca (`com.stablyai.orca`, `/Applications/Orca.app`). Support dir:

`~/Library/Application Support/orca/`

## Process map

| Signal | How |
|--------|-----|
| Claude Code CLI | `ps` command `claude`; version string often `2.1.x` in `lsof` COMMAND |
| cwd | `lsof -a -p <pid> -d cwd` only (full `lsof -p` times out) |
| Parent | `orca-tcc-login` → `-/bin/zsh -l` on `ttysXXX` |
| Typical idle children | `npm exec chrome-devtools-mcp@latest --port=9222`, `npm exec @modelcontextprotocol/server-github`, `kimi-cu mcp -s user`, wakatime plugin |
| Typical work children | `caffeinate -i -t 300` (Claude keeps the Mac awake while a turn runs), git/test/compiler |

Sample CPU 2–3 times over ~5s. Working: `%CPU` jumps. Idle-alive: ~0 with only MCP children.

TTY last-write: `ls -lT /dev/ttysXXX`. Stale TTY + ~0 CPU = hung/idle, even if the process is up.

## Repo proof (the actual "working" bit)

Walk the target cwd excluding `node_modules`, `.next`, `.git`, `dist`, `.turbo`. Fresh `.ts/.tsx/.md` mtimes + `git status` dirty files beat process tables.

`~/.claude/projects/<slug>/*.jsonl` mtime can lag days while Claude is live. Do not use stale jsonl as "not working".

## Orca telemetry

| File | Use |
|------|-----|
| `agent-hooks/last-status.json` | Latest pane: `payload.state`, `payload.prompt`, `worktreeId` (`<uuid>::/abs/path`), `source` (`claude`/`grok`/`cursor`), `receivedAt` (ms) |
| `orca-stats.json` | `events[]` of `agent_start` / `agent_stop` with `meta.ptyId` and `durationMs` |
| `terminal-history/` | Per-pane **directories** (not files), name encodes worktree + pane |

`last-status.json` `state=done` can lag behind a resumed edit loop. Corroborate with file mtimes.

Unmatched `agent_start` in `orca-stats.json` can be months-old ghosts. Prefer `last-status.json` + CPU + files.

Iterating the Orca support dir can hit disappearing Electron cookies (`SingletonCookie`). Skip `FileNotFoundError`; don't abort.

`main.trace.ndjson` is huge and a poor first source.

## Screenshot

`computer_use` capture of Orca is optional. Empty / 0×0 → stop looping captures, ship the process+file verdict. Don't raise the window unless the user asked to look at the screen.
