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

  > Clone state is fresh. First create the branch `practices-refresh/<date>`: `check_practices.py --update-digests` refuses to write on the default branch, in a detached HEAD or in an installed copy outside git. Use `skills/agent-practice-audit` in refresh mode. Search only the domains in `references/sources.md`. Re-check every link with `scripts/check_practices.py --fetch --update-digests`. Propose candidates into a candidates file outside the repository, save page text with `scripts/check_practices.py --save-pages <tmp>/pages --candidates <tmp>/cands.json`, then verify new candidates and `needs-consensus` seeds in one call: `scripts/consensus.py run --candidates <tmp>/cands.json references/practices.json --pages <tmp>/pages --out <tmp>/refresh --exclude <your model> --jobs 6 --timeout 240 --max-calls 24`. That call can take up to about 20 minutes: give the shell command that long or run it in the background and wait for it. Keep candidates without enough verifiers in `pending`, and record rejected ones under 未采纳 in `references/changelog.md`. Run `scripts/check_practices.py --fetch` until it passes. Commit on that branch and open a pull request summarising added, changed, 未采纳, pending and flagged links. Do not push to the default branch and do not merge.

- **Secrets:** the hosted service holds model credentials. If only one model is available there, every new candidate stays `pending-consensus`; that is expected, not a failure.

## 2. Refresh with GitHub Actions (sample)

**Sample only, not wired.** This repository does not ship it under `.github/workflows/`. To use it, copy it into your fork, add repository secrets for the proposer and at least two verifiers (here Claude proposes; Codex and Gemini verify, so `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY`), and enable _Settings -> Actions -> General -> Allow GitHub Actions to create and approve pull requests_. Pin the CLI versions you tested and check the `consensus.py detect` line in the log: with fewer than two verifiers the run still works, but every candidate stays pending.

The model steps and the verification are separate steps, each with its own time limit, so one slow stage cannot use up the job. Verification is the long one, and its budget is set by batching: `consensus.py run` makes one call per (source page, verifier), not per candidate. Page text goes to `$WORK/pages` with a `manifest.json`; `consensus.py` treats a page as live only when that manifest marks it fresh and its hash matches, so a file left from an earlier run never stands in for a failed fetch. The verifier calls get isolation flags (no user settings, hooks, MCP servers or skills) when the installed `--help` lists them; `consensus.py detect` prints the exact commands. The 20 seeds cite 9 pages; with a few new pages that is at most about 12 pages x 2 verifiers = 24 calls. `--max-calls 24` caps it, `--jobs 6` runs six at once, and `--timeout 240` caps each call, so the worst case is 4 rounds x 4 minutes = 16 minutes, inside the step's 18. Pages beyond the cap stay `pending-consensus` and are picked up next week. The step limits add up to 42 minutes, leaving 3 of the job's 45 for checkout, install and the pull request; raise `timeout-minutes` together with `--max-calls` if your list grows.

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
    env:
      APA: skills/agent-practice-audit
      WORK: ${{ runner.temp }}/refresh
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install agent CLIs
        run: npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli
      - name: Create the review branch
        # --update-digests writes only on a non-default branch of a git clone
        run: git switch -c "practices-refresh/$(date -u +%Y-%m-%d)"
      - name: Propose (refresh steps 1-3)
        timeout-minutes: 12
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          mkdir -p "$WORK"
          claude -p "Use $APA in refresh mode as documented in its SKILL.md. Do steps 1-3 only: re-check links, propose candidates from the domains in references/sources.md, write digests. Write the candidates as a JSON list to $WORK/cands.json (write [] if there are none). Do not run consensus.py." \
            --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(python3 $APA/scripts/check_practices.py *)" \
            --max-budget-usd 5
      - name: Save page text
        timeout-minutes: 2
        run: python3 "$APA/scripts/check_practices.py" --save-pages "$WORK/pages" --candidates "$WORK/cands.json"
      - name: Verify with other models (refresh steps 4-6)
        timeout-minutes: 18
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: |
          python3 "$APA/scripts/consensus.py" detect --exclude claude
          python3 "$APA/scripts/consensus.py" run --candidates "$WORK/cands.json" "$APA/references/practices.json" \
            --pages "$WORK/pages" --out "$WORK/out" --exclude claude --jobs 6 --timeout 240 --max-calls 24
      - name: Record decisions (refresh steps 5-7)
        timeout-minutes: 8
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude -p "Use $APA in refresh mode. Apply $WORK/out/decisions.json to references/practices.json and references/changelog.md as SKILL.md steps 5-7 describe. Candidates are in $WORK/cands.json. Do not call any model CLI." \
            --allowedTools "Read,Edit,Write,Bash(python3 $APA/scripts/check_practices.py *)" \
            --max-budget-usd 2
      - name: Deterministic gate
        timeout-minutes: 2
        run: python3 "$APA/scripts/check_practices.py" --fetch
      - name: Open pull request
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if git diff --quiet -- skills/agent-practice-audit/references; then echo "no changes"; exit 0; fi
          branch="$(git branch --show-current)"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add skills/agent-practice-audit/references
          git commit -m "docs(agent-practice-audit): refresh official practices"
          git push -u origin "$branch"
          gh pr create --fill --body "Automated weekly refresh. Review added quotes, 未采纳 and pending entries in references/changelog.md before merging."
```

A human reviews the PR: the gate proves the quotes exist on the pages and the consensus record shows who agreed; neither proves the practice is worth adding.

## 3. Audit locally, monthly, with a notification

Use the agent CLI's non-interactive mode and give it only what the audit needs: read files, run the two audit scripts, write under `$AGENT_PRACTICE_AUDIT_DIR`. In print mode a tool outside `--allowedTools` is refused instead of prompting, so the list below is the whole permission set. Claude Code 2.1.316 `--help` lists no `--max-turns`; it does list `--max-budget-usd` (print mode only), which caps a run that loops. The command ends with a notification that names the report.

```sh
# audit-run.sh  (sample; keep it outside any repository, e.g. in $AGENT_PRACTICE_AUDIT_DIR)
set -eu
BASE="${AGENT_PRACTICE_AUDIT_DIR:-$HOME/.local/share/agent-practice-audit}"
SKILL="$HOME/.claude/skills/agent-practice-audit"   # where the skill is installed; adjust
mkdir -p "$BASE" && cd "$BASE"                      # run outside any repository
# Edit(...) also covers Write; change the path there if you set AGENT_PRACTICE_AUDIT_DIR.
claude -p "Read $SKILL/SKILL.md and run the agent-practice-audit skill in audit mode for the last 60 days. Suggestions only; do not change any configuration." \
  --allowedTools "Read,Edit(~/.local/share/agent-practice-audit/**),Bash(python3 $SKILL/scripts/run_audit.py *),Bash(python3 $SKILL/scripts/build_report.py *)" \
  --max-budget-usd 3
REPORT="$BASE/reports/$(date +%F)/report.html"
if [ -f "$REPORT" ]; then MSG="Agent practice report ready: $REPORT"; else MSG="Agent practice audit finished without a report; check the log"; fi
if command -v osascript >/dev/null; then osascript -e "display notification \"$MSG\" with title \"Agent practice audit\""
elif command -v notify-send >/dev/null; then notify-send "Agent practice audit" "$MSG"
else echo "$MSG"; fi
```

`codex exec "..."` works the same way if Codex is the preferred runner; check `codex exec --help` for its sandbox flag and use a read-only or workspace-write sandbox rooted at `$BASE`.

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
