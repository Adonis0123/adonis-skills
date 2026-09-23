# Artifact and interaction contract

## Required outputs

All artifacts live under the agreed absolute `OUT_DIR`.

| Path | Purpose |
|---|---|
| `00-capabilities.json` | CLI versions, utility availability, wrappers, blocked flags |
| `01-inventory.json` | Pure component and cost-side data |
| `02-metrics.json` | Machine-readable M1-M8 metrics |
| `02-metrics.md` | Human-readable metrics and tables |
| `03-experiments.md` | Experiments plus sanitized raw output |
| `dispatch-prompt.md` | Blind-review prompt, when used |
| `04-*.json` / `04-*.jsonl` | Independent reviewer output and events |
| `FINAL.md` | Decisions, bills, conflicts, disagreements, guards, unknowns |
| `scripts/` | Every parser/helper needed to reproduce the audit |
| `raw/` | Sanitized command and probe output |
| `runtime/` | Reproducible caches, isolated homes, clones, and experiment state |
| `proposed/` | Draft config/instruction changes only |
| `recovery/` | Minimal credential-free recovery fragments |
| `MANIFEST.sha256` | Integrity for non-runtime artifacts |

## Command checkpoint format

Before a command, state:

```text
要跑：<command purpose>
想得到：<specific numeric fields>
写入：<OUT_DIR paths or “none”>
```

After a command, present:

```text
原始输出：<relevant unedited/sanitized lines>
解释：<what the numbers establish>
下一步：<one bounded action>
```

Do not hide a failed command. Show the error, explain whether it invalidates a metric, and inspect `--help` only after the failure.

## Resume behavior

- Treat inventory and metrics as timestamped snapshots, not current truth.
- On resume, verify current config and source paths before acting on an old recommendation.
- Never overwrite a raw artifact silently. Use a dated suffix or record that a file is a refreshed current-state artifact.
- A historical call count remains historical after a component is removed.

## Output hygiene

- Sanitize tokens, cookies, Authorization values, emails, private prompts, and personal data before writing.
- It is safe to record credential field names, value types, string lengths, and counts.
- Do not include raw session content when aggregated tool names and counts are enough.
- Keep reports small; remove reproducible runtime clones after embedding necessary evidence.
