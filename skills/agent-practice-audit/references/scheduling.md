# Scheduling

The skill installs nothing. This page describes the intended schedule and gives samples a user can adapt and install themselves. Check every CLI flag against the installed version.

| Mode    | Where                                        | How often | Delivers                                                                         |
| ------- | -------------------------------------------- | --------- | -------------------------------------------------------------------------------- |
| refresh | Remote: a hosted scheduled agent or CI       | Weekly    | A pull request against the skill repository. Never a push to the default branch. |
| audit   | Local: the machine that has the session logs | Monthly   | `report.html` under `$AGENT_PRACTICE_AUDIT_DIR` plus a desktop notification.     |

The repository owner reviews and merges refresh PRs. Installed copies pick up the new practice list through normal skill updates (`npx skills add ...`, plugin update, or `git pull` in a local clone). Audit never needs the network beyond what the agent CLI itself uses; logs and the report stay on the machine.

## 1. Refresh with a hosted scheduled agent

Use any service that runs an agent on a cron schedule in a fresh checkout and can open pull requests, for example a Claude Code cloud routine (`/schedule` in Claude Code) or a comparable scheduled-agent feature of another vendor.

Set it up with:

- **Repository:** the skill repository (or your fork), with permission to push branches and open PRs, not to push to the default branch.
- **Schedule:** weekly, e.g. Monday 03:00 UTC.
- **Prompt (sample):**

  > Clone state is fresh. Use `skills/agent-practice-audit` in refresh mode. Search only the domains in `references/sources.md`. Re-check every link with `scripts/check_practices.py --fetch --update-digests`. Propose candidates, verify each with at least two other available models through `scripts/consensus.py` (prompt on stdin), keep candidates without enough verifiers in `pending`, and record rejected ones under 未采纳 in `references/changelog.md`. Run `scripts/check_practices.py --fetch` until it passes. Commit on a new branch `practices-refresh/<date>` and open a pull request summarising added, changed, 未采纳, pending and flagged links. Do not push to the default branch and do not merge.

- **Secrets:** the hosted service holds model credentials. If only one model is available there, every new candidate stays `pending-consensus`; that is expected, not a failure.

## 2. Refresh with GitHub Actions (sample)

**Sample only, not wired.** This repository does not ship it under `.github/workflows/`. To use it, copy it into your fork, add repository secrets for the models you want as proposer and verifiers (here `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`), and enable _Settings -> Actions -> General -> Allow GitHub Actions to create and approve pull requests_. Pin the CLI versions you tested. With only one model key the run still works, but new candidates stay pending.

```yaml
# .github/workflows/practices-refresh.yml  (sample)
name: practices-refresh
on:
  schedule:
    - cron: "0 3 * * 1" # weekly, Monday 03:00 UTC
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install agent CLIs
        run: npm install -g @anthropic-ai/claude-code @openai/codex
      - name: Refresh practices (headless)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          claude -p "Use skills/agent-practice-audit in refresh mode as documented in its SKILL.md. You are the proposer; use the other installed CLIs as verifiers via scripts/consensus.py. Search only the domains in references/sources.md. Finish with scripts/check_practices.py --fetch passing." \
            --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(python3 skills/agent-practice-audit/scripts/*),Bash(codex exec:*)" \
            --max-turns 120
      - name: Deterministic gate
        run: python3 skills/agent-practice-audit/scripts/check_practices.py --fetch
      - name: Open pull request
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if git diff --quiet -- skills/agent-practice-audit/references; then echo "no changes"; exit 0; fi
          branch="practices-refresh/$(date -u +%Y-%m-%d)"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git switch -c "$branch"
          git add skills/agent-practice-audit/references
          git commit -m "docs(agent-practice-audit): refresh official practices"
          git push -u origin "$branch"
          gh pr create --fill --body "Automated weekly refresh. Review added quotes, 未采纳 and pending entries in references/changelog.md before merging."
```

A human reviews the PR: the gate proves the quotes exist on the pages and the consensus record shows who agreed; neither proves the practice is worth adding.

## 3. Audit locally, monthly, with a notification

Use the agent CLI's non-interactive mode and give it only what the audit needs: read files, run `python3`, write under `$AGENT_PRACTICE_AUDIT_DIR`. Cap the run so a stuck run cannot loop. The command ends with a notification that names the report.

```sh
# audit-run.sh  (sample; keep it outside any repository, e.g. in $AGENT_PRACTICE_AUDIT_DIR)
set -eu
BASE="${AGENT_PRACTICE_AUDIT_DIR:-$HOME/.local/share/agent-practice-audit}"
claude -p "Run the agent-practice-audit skill in audit mode for the last 60 days. Suggestions only; do not change any configuration." --max-turns 60
REPORT="$BASE/reports/$(date +%F)/report.html"
if [ -f "$REPORT" ]; then MSG="Agent practice report ready: $REPORT"; else MSG="Agent practice audit finished without a report; check the log"; fi
if command -v osascript >/dev/null; then osascript -e "display notification \"$MSG\" with title \"Agent practice audit\""
elif command -v notify-send >/dev/null; then notify-send "Agent practice audit" "$MSG"
else echo "$MSG"; fi
```

`codex exec "..."` works the same way if Codex is the preferred runner.

### macOS: launchd (1st of each month, 09:00)

Save as `~/Library/LaunchAgents/local.agent-practice-audit.plist`, replace `YOUR_HOME`, then `launchctl load` it.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.agent-practice-audit</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>zsh YOUR_HOME/.local/share/agent-practice-audit/audit-run.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Day</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>YOUR_HOME/.local/share/agent-practice-audit/launchd.log</string>
  <key>StandardErrorPath</key><string>YOUR_HOME/.local/share/agent-practice-audit/launchd.log</string>
</dict>
</plist>
```

### Linux: cron or a systemd user timer

```sh
# crontab -e
0 9 1 * *  bash -lc '"$HOME/.local/share/agent-practice-audit/audit-run.sh"' >> "$HOME/.local/share/agent-practice-audit/cron.log" 2>&1
```

```ini
# ~/.config/systemd/user/agent-practice-audit.service
[Service]
Type=oneshot
ExecStart=/bin/bash -lc '%h/.local/share/agent-practice-audit/audit-run.sh'

# ~/.config/systemd/user/agent-practice-audit.timer
[Timer]
OnCalendar=*-*-01 09:00
Persistent=true
[Install]
WantedBy=timers.target
```

Enable with `systemctl --user enable --now agent-practice-audit.timer`. A desktop notification from a user timer needs a running graphical session; otherwise the message lands in the journal.
