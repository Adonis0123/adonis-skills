# Audit files and settings

Files, formats and per-user settings for audit mode. Everything here lives outside any repository.

## Locations

| Path                                            | What                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$AGENT_PRACTICE_AUDIT_DIR`                     | Base directory. Default `~/.local/share/agent-practice-audit`.                                                                                                                                                                                                                                                                                                                                       |
| `$AGENT_PRACTICE_AUDIT_DIR/config.json`         | Optional per-user settings (below). The skill ships none.                                                                                                                                                                                                                                                                                                                                            |
| `$AGENT_PRACTICE_AUDIT_DIR/reports/YYYY-MM-DD/` | One directory per audit run.                                                                                                                                                                                                                                                                                                                                                                         |
| `.../work/sessions.jsonl`                       | `extract.py` output: one row per session with counts, tags, a first-prompt shape hash, a done-when keyword flag and correction categories. No prompt text; paths are `~/...` or `(outside ~)/<name>`, with `cwd_id` / `repo_id` hashes to keep same-named directories apart. A file that cannot be read or parsed gets a fixed `error` code (`unreadable`, `parse-<ExceptionType>`), never log text. |
| `.../work/summary.json`                         | `aggregate.py` output: counts and ratios only, no prompt text; paths outside home reduced to `(outside ~)/<name>`.                                                                                                                                                                                                                                                                                   |
| `.../work/config-scan.json`                     | `config_scan.py` output (sizes, counts, allowlisted keys; paths outside home reduced to `(outside ~)/<name>`).                                                                                                                                                                                                                                                                                       |
| `.../work/judge-input.json`                     | `prejudge.py` output: per practice, its `detect` and `rule` text, the numbers they need, and a draft verdict. The agent judges from this file first.                                                                                                                                                                                                                                                 |
| `.../judgments.json`                            | Written by the agent: one judgment per practice.                                                                                                                                                                                                                                                                                                                                                     |
| `.../report-data.json`                          | Written by `build_report.py`; the next run compares against it.                                                                                                                                                                                                                                                                                                                                      |
| `.../report.html`                               | The report. Open it locally; do not publish it.                                                                                                                                                                                                                                                                                                                                                      |

Host roots can be overridden with `AGENT_PRACTICE_AUDIT_CLAUDE_GLOBS`, `AGENT_PRACTICE_AUDIT_CODEX_GLOBS`, `AGENT_PRACTICE_AUDIT_GROK_GLOBS` and `AGENT_PRACTICE_AUDIT_WORKBUDDY_GLOBS` (glob patterns separated by `:` on macOS/Linux). An override replaces the default globs for that host; `extraRoots` in config adds to them.

`scripts/run_audit.py [--days N] [--repo DIR ...] [--run DIR]` writes all four `work/` files in one call (extract, aggregate, config_scan, prejudge). It exits 3 with the searched roots when the window has no human sessions, and 2 when the run directory is inside a git work tree.

## judge-input.json

```json
{
  "window_days": 60,
  "lang": { "hint": "zh", "from": "config.json" },
  "low_sample_below": 10,
  "counts": {
    "claude": {
      "human": 120,
      "headless": 30,
      "subagent": 210,
      "judged": 118,
      "unknown": 2
    },
    "codex": {
      "human": 6,
      "headless": 40,
      "subagent": 0,
      "judged": 6,
      "low_sample": true
    }
  },
  "headless_total": 70,
  "subagent_total": 210,
  "practices": [
    {
      "id": "safe-small-enforced-set",
      "title": "...",
      "detect": "...",
      "rule": "Hooks + non-secret deny rules in the largest setup ... ok: <20; part: 20-39; no: >=40 (heuristic)",
      "metrics": {
        "setups": [{ "roots": 2, "hooks": 18, "deny": 6, "enforced": 24 }]
      },
      "draft": {
        "status": "part",
        "reason": "24 enforced rules (18 hooks + 6 deny) in ~/.claude"
      }
    },
    {
      "id": "plan-done-when",
      "detect": "...",
      "rule": "Semantic; usually na.",
      "metrics": {},
      "draft": null,
      "note": "semantic: ..."
    }
  ]
}
```

- `counts.<host>.judged` is the number of human sessions with prompts that the metrics use. Hosts are ordered by it. A host under `low_sample_below` is flagged `low_sample`, left out of weighted percentages, and listed in each draft's `low_sample`: give it a caveat, not a verdict. `counts.<host>.unknown` counts sessions whose entrypoint is missing or not recognised: they are neither human nor headless.
- Every item carries `detect` (where to look) and `rule` (the criteria, from `rule.text` in `practices.json`). `draft` is a deterministic first verdict from that practice's `rule.params`; `reason` states only the measured numbers. Accept it or override it with a reason in `evidence`. `draft: null` comes with a `note` saying what to read; those practices need `summary.json`, `config-scan.json` or the instruction files, never prompt text.
- Drafts judge applicability before compliance: a workload the user does not have (no complex sessions, no parallel sessions in one repository, no wide exploration, no repeated tasks, no must-rules) gives `na`, not `no`, and volume alone never earns `ok`.
- A practice id without a mapping (for example one added by refresh) gets `metrics: {}`, `draft: null` and a note.
- The file holds counts, ratios, config keys and `~/...` paths only. Paths outside home are reduced to `(outside ~)/<name>`; prompt excerpts, env values and deny rules never appear.

## Thresholds and measurement

`references/practices.json` is the single source of truth for thresholds: each practice has `rule.text` (human-readable criteria with the numbers), `rule.params` (the same numbers by name) and `fix_kind` (`config` = a one-time file or setting change; `habit` = a change in how the user works). `aggregate.py` reads the cohort definitions from it and `prejudge.py` the verdict thresholds; no threshold is defined in code. When a practice lacks a param, its cohort is left out of the summary and its item gets `draft: null` with a note. Numbers that do not come from the vendor text end `rule.text` with `(heuristic)`. Tool-name sets, the path reducer and worktree folding live in `scripts/audit_common.py`.

How the logs are measured:

- **Shell tags** (`pct_session_bash_tags`: test, lint, typecheck, git_diff, commit, headless, worktree, screenshot) come only from shell tools (Bash, shell, exec_command, run_terminal_cmd, Codex code-mode `tools.exec_command`), matched at command position: the start of a command or after `&&`, `||`, `;`, `|`, a subshell, `bash -c`, or wrappers such as `env`, `xargs`, `npx`, `pnpm exec`, `uv run`, `python -m`. Quoted text, heredocs and patch bodies never count, so `echo pytest` does not.
- **screenshot** also counts screenshot-named tools (not Figma design screenshots), computer-use `screenshot`/`zoom` actions, `mode: image` on browser or desktop observation tools (not image generation), and a Read of an image the same session produced. Other image reads do not count.
- **worktree** counts `git worktree add` (not `list`), Claude `EnterWorktree`, `claude --worktree`, and a working directory inside a worktree checkout: `<repo>/.claude/worktrees/<name>`, `<repo>/.worktrees/<name>`, `<repo>/worktrees/<name>` or `~/.codex/worktrees/<id>/<repo>`. The same fold maps those to their repository in `cwd_top` and in parallel-session grouping (grouped by repository name, so a Codex worktree meets its main checkout).
- **Session kinds**: Claude `cli`, `claude-vscode`, `claude-desktop` and Codex `codex-tui`, `codex_cli_rs`, `codex_vscode`, `Codex Desktop`, `codex_work_desktop` are human; Claude `sdk-cli`, `sdk-ts`, `sdk-py`, `claude-code-github-action` and Codex `codex_exec`, `codex_sdk_ts`, `codex_sdk_py`, `Claude Code` are headless; any other or missing entrypoint/originator is `unknown`. Grok `session_kind: subagent*` is a subagent; a WorkBuddy run with an automation system reminder is headless (`scheduled`). Claude `isMeta` entries, skill bodies and task notifications are not prompts.
- **Own runs**: a session whose first prompt starts like `references/verify-prompt.md` (read from the template at run time) or mentions `agent-practice-audit`, or that runs `run_audit.py`, `build_report.py`, `consensus.py`, `prejudge.py` or `config_scan.py`, is marked `self_audit` and never counts as the user's automation; scheduler entries that do the same are counted as `schedulers.own`.
- **/clear**: `/clear` and `/new` open a new transcript, so a long session counts as cleared when a different session in the same directory that starts with `/clear` or `/new` begins at or after its end, within `clear_gap_minutes`. Corrections are compared per 100 prompts, not as sessions with any correction.
- **Wide exploration** counts read/search calls including those in the session's linked subagent transcripts (Claude sidechains, Codex `parent_thread_id`, Grok `parent_session_id`), so offloading does not push a session out of the cohort. Unlinked subagents count only in their own transcript.
- **Plan mode** is logged only by Claude; on other hosts substitutes (ask-user, planning skills) are judged on their own (they can reach `ok`), and missing plan mode there is never a `no`.
- **Codex code cells**: every `tools.<name>({...})` call inside a code-mode `exec` cell goes through the same tagging as a direct call (shell tags, reads, edits, screenshots).
- **Repositories** are identified by their full path with worktrees folded; a linked worktree with a readable `.git` file resolves to its main checkout. Output carries only reduced labels and counts.
- **Active Claude roots**: settings roots whose account has human sessions in the window are judged; other `.claude*` roots are reported as `inactive_roots`. `safe-deny-secrets` grades only the setups that ran bypass/auto (`bypass_by_account`) when any did.
- **Full access** is joint per turn: Claude `bypassPermissions` (today's `sandbox.enabled` is reported but not applied to past sessions), Grok yolo, or a Codex turn context with `approval=never` and `danger-full-access` together (`full-access` mode). Reasoning effort is shown but not judged.
- **Subagent** launches: Agent, Task, spawn_agent, spawn_subagent. Reading a subagent's output (`get_command_or_subagent_output`) is not a launch.
- A malformed `sessions.jsonl` line counts in `errors` instead of stopping the run.

`summary.json` fields used by the drafts:

| Field                                                                                                  | Meaning                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hosts.<h>.cohorts.complex`                                                                            | `n` sessions with >= 5 files edited or >= 100 tool calls; `plan`, `plan_or_sub` (plan mode, ask-user or a planning skill), `interview` (ask-user or an interview skill), `plan_logged` (the host logs plan mode). |
| `hosts.<h>.cohorts.wide`                                                                               | `n` sessions with >= 30 read/search calls including linked subagent transcripts; `subagent` among them.                                                                                                           |
| `hosts.<h>.cohorts.long`                                                                               | `n` sessions over 200 tool calls; `cleared` (followed by a /clear- or /new-started session), `compact`, `corr_per100` (corrections per 100 prompts).                                                              |
| `hosts.<h>.long_sessions`, `pct_compaction_long`, `corrections_per100_prompts`, `pct_started_by_clear` | Long-session count, its compaction share, the host's corrections per 100 prompts, sessions opened by /clear or /new.                                                                                              |
| `hosts.<h>.correction_categories`                                                                      | Correction prompts per keyword bucket: `not_verified`, `misunderstood`, `unrequested_change`, `redo`, `revert`, `broke_or_forgot`, `other`.                                                                       |
| `hosts.<h>.pct_first_prompt_done_when`                                                                 | Share of first prompts with a completion-condition keyword (a weak hint).                                                                                                                                         |
| `parallel`                                                                                             | Human sessions overlapping another human session in the same repository (sessions over 12 hours left out): `sessions`, `with_worktree`, `repos`, `by_host` (`[n, with_worktree]`).                                |
| `headless.repeated`, `human_repeated`                                                                  | `shapes` and `sessions` whose first-prompt shape (hash of the normalised first 48 characters) repeats at least 3 times.                                                                                           |
| `headless.self_audit`, `headless.scheduled`                                                            | Headless runs of this skill itself (excluded from `repeated`), and scheduled WorkBuddy runs.                                                                                                                      |
| `unknown`                                                                                              | Sessions with an unrecognised entrypoint or originator, total and `by_host`.                                                                                                                                      |
| `cohort_params`                                                                                        | The `rule.params` the cohorts used.                                                                                                                                                                               |

`config-scan.json` fields used by the drafts: instruction files carry `must_rules` (lines with always/never/must or 必须/禁止/一律/不得/务必/严禁/不准; "do not", "don't" and 不要 are advice, not counted), `must_topics` (must-rule lines per topic: `secrets`, `destructive`, `git_push`, `language`) and `compact_instructions`; `mentions_test` / `mentions_lint` need a real command (`pnpm test`, `pytest`, `go test`, `eslint`, `ruff`, `pnpm lint`...). Settings carry `enforcing_hook_entries` (PreToolUse, PermissionRequest, UserPromptSubmit, Stop, SubagentStop, PostToolUse), `enforcing_hook_topics` (topics judged from those hooks' matcher and command; the command is never reported), `deny_topics`, `secret_deny_count`, `sandbox_enabled`, and report a non-object file as `{"unreadable": true}`; `deny_coverage` secret categories count only path-like file rules (`Read(./.env*)`, `Read(~/.ssh/**)`...). `claude_projects[]` scans each repository's `.claude/settings*.json`. `codex[].instruction_chain_bytes_max` and `instruction_chain_repo` give the largest combined chain Codex reads (global AGENTS file plus one AGENTS.override.md / AGENTS.md per directory from the git root down). `other_skills` counts `~/.codex*/skills` and `~/.agents/skills`. `schedulers` counts launchd jobs, crontab lines and CI workflows that start a headless agent, `with_limits` those that pass `--max-turns` / `--max-budget-usd`, and `own` those that run this skill.

## judgments.json

```json
{
  "lang": "zh",
  "window_days": 60,
  "headline": "One sentence: the overall picture.",
  "lead": "Two sentences: counts and the cheapest way up the ladder.",
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
