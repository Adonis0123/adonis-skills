---
name: desktop-agent-activity
description: "Use when 查 Orca/Claude Code 是否还在干活. Process+files first."
version: 1.0.0
license: MIT
metadata:
  author: Adonis0123
---

# Desktop coding-agent activity

User asks whether a **desktop-hosted coding agent** (Orca + Claude Code, and similar PTY hosts) is still working, stuck, or idle.

**Do not treat `ps` showing `claude` as "working".** Alive sessions sit for hours with MCP children. Prove work with CPU + file/git mtimes + host telemetry.

Visual capture is optional confirmation, not the primary evidence.

## Verdict (what to tell the user)

结论先说：**在干 / 闲着挂着 / 已停**。

表列每个实例：TTY 或 PID · 状态 · 依据（CPU 在跳 / 源文件刚改 / 终端停写多久）。≤5 行要点。不要贴命令输出。

## Check order (do all of 1–4 before claiming idle)

1. **Process + cwd**
   - `ps` for `claude` (and host app, e.g. Orca).
   - `lsof -a -p <pid> -d cwd` only — do **not** dump full `lsof -p` (large Claude processes time out).
   - Parent is often `orca-tcc-login` → login zsh on a `ttysXXX`.

2. **CPU sample, 2–3 times over ~5s**
   - Working: `%CPU` jumps (often 1–10%+).
   - Idle-alive: stays ~0, children are only MCP (`chrome-devtools-mcp`, `server-github`, `kimi-cu mcp`).
   - Work-ish children: `caffeinate`, compilers, `git`, test runners — not MCP.

3. **TTY last-write + source mtimes**
   - `ls -lT /dev/ttysXXX` — terminal still printing?
   - Walk the repo excluding `node_modules` / `.next` / `.git` for `.ts/.tsx/.md` mtime in the last hour.
   - `git status -sb` + recent commits. Uncommitted files with fresh mtimes = still editing.

4. **Host telemetry (Orca)**
   - `~/Library/Application Support/orca/agent-hooks/last-status.json` — last prompt, `state`, worktree path.
   - `orca-stats.json` `agent_start` / `agent_stop`.
   - Paths and parse pitfalls: `references/orca-claude-liveness.md`.

## Optional: screenshot

`computer_use` capture of the host window can confirm the TUI. If capture returns empty / 0×0, **stop looping captures** and ship the process+file verdict. Do not raise the window unless the user asked to look at the screen itself.

## Pitfalls

- **Alive ≠ working.** MCP children spawn at session start and stay.
- **`~/.claude/projects/**/*.jsonl` mtime can lag days** while the process is live. Never use stale jsonl as "not working".
- **`orca-stats` unmatched `agent_start`** can be months-old ghosts. Prefer `last-status.json` + CPU + files.
- **`last-status` `state=done` can lag** behind an already-resumed edit loop. Corroborate with file mtimes.
- `terminal-history/` entries are **directories**, not files.
- Iterating `Application Support/orca` can hit disappearing Electron cookies — skip `FileNotFoundError`, don't abort the check.

## Out of scope

Starting, stopping, or steering the agent. This skill is **read-only status**.
