# Audit files and settings

Files, formats and per-user settings for audit mode. Everything here lives outside any repository.

## Locations

| Path                                            | What                                                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$AGENT_PRACTICE_AUDIT_DIR`                     | Base directory. Default `~/.local/share/agent-practice-audit`.                                                                                            |
| `$AGENT_PRACTICE_AUDIT_DIR/config.json`         | Optional per-user settings (below). The skill ships none.                                                                                                 |
| `$AGENT_PRACTICE_AUDIT_DIR/reports/YYYY-MM-DD/` | One directory per audit run.                                                                                                                              |
| `.../work/sessions.jsonl`                       | `extract.py` output. Contains short prompt excerpts (first 160 characters, correction examples): keep it local, never paste it into issues, PRs or chats. |
| `.../work/summary.json`                         | `aggregate.py` output.                                                                                                                                    |
| `.../work/config-scan.json`                     | `config_scan.py` output (sizes, counts, allowlisted keys).                                                                                                |
| `.../judgments.json`                            | Written by the agent: one judgment per practice.                                                                                                          |
| `.../report-data.json`                          | Written by `build_report.py`; the next run compares against it.                                                                                           |
| `.../report.html`                               | The report. Open it locally; do not publish it.                                                                                                           |

Host roots can be overridden with `AGENT_PRACTICE_AUDIT_CLAUDE_GLOBS`, `AGENT_PRACTICE_AUDIT_CODEX_GLOBS`, `AGENT_PRACTICE_AUDIT_GROK_GLOBS` and `AGENT_PRACTICE_AUDIT_WORKBUDDY_GLOBS` (glob patterns separated by `:` on macOS/Linux). An override replaces the default globs for that host; `extraRoots` in config adds to them.

## judgments.json

```json
{
  "lang": "zh",
  "window_days": 60,
  "headline": "One sentence: the overall picture.",
  "lead": "Two or three sentences: counts and the cheapest way up the ladder.",
  "notes": [
    "Run-specific caveats, e.g. a host whose logs could not be parsed."
  ],
  "items": {
    "ctx-clear-between-tasks": {
      "status": "part",
      "summary": "Short table cell: the key number.",
      "evidence": "Numbers from summary/config-scan, with `code` for paths and keys.",
      "suggestion": "What to change and where. Suggestions only.",
      "caveat": "Optional: known bias or false-positive risk."
    }
  }
}
```

- `lang`: `zh` or `en`, following the language the user writes in. It picks the practice title language and the page's fixed labels.
- `status`: `ok` (meets the practice), `part` (meets it for some hosts or sessions, or with a substitute), `no` (clear evidence it is not followed), `na` (cannot be measured from logs or config, or does not apply). Use `na` with a reason instead of guessing.
- Every practice id in `practices.json` needs an entry; `build_report.py` fails on missing ids unless `--allow-missing` is passed.
- Text fields are plain text. Backticks become inline code; everything else is escaped. Write paths with `~`, never an absolute home path.

## Scoring

ok = 10, part = 5, no = 0, na is left out. Total and each dimension = earned / max x 100, rounded. Grades: S >= 90, A >= 80, B >= 70, C >= 60, D < 60. The ladder lists the fewest fixes that reach each higher grade (biggest gains first, ties to the weakest dimension). Trends compare each practice and dimension with the latest earlier `report-data.json` (or the file given by `--previous`).

## config.json

```json
{
  "lang": "en",
  "theme": { "accent": "#3E63DD", "accentDark": "#5B7EEB" },
  "illustration": "~/Pictures/audit-hero.webp",
  "illustrationAlt": "A magnifying glass over a checklist",
  "brand": {
    "name": "My Lab",
    "logo": "~/Pictures/logo.svg",
    "logoDark": "~/Pictures/logo-white.svg"
  },
  "extraRoots": {
    "claude": ["~/work-agents/.claude-team/projects/**/*.jsonl"],
    "codex": [],
    "grok": [],
    "workbuddy": []
  }
}
```

All keys are optional. Theme colours must be `#RRGGBB`; anything else is ignored. The illustration is copied into the run directory as `img/<name>` and shown beside the score on a light plate (white backgrounds blend into it); without it the slot is hidden. `brand` puts a logo (or just the name, when there is no logo) at the left of the top bar; `logoDark` is used in dark mode. Links, tints and focus rings follow `theme.accent`, so one colour restyles the whole page. `lang` is a default for the agent when the user's language is unclear.
