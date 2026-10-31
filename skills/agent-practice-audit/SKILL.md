---
name: agent-practice-audit
description: "Compare how someone actually uses coding agents (Claude Code, Codex, Grok, WorkBuddy session logs and their instruction files, hooks, permissions and Codex config) against verified official best practices from Anthropic, OpenAI, Google, Cursor, xAI and Tencent CodeBuddy; score six dimensions, track the trend against the previous run, and write a local HTML report with suggestions. Also refreshes the practice list from official docs only: a practice enters only after its quote is found on the page and at least two other models agree, with an offline digest kept per source. Use when the user asks how far their agent usage is from official practice, wants an agent usage check-up, score or grade, wants to refresh or verify the best-practice list, or asks to schedule either. Chinese triggers: Agent 用法体检、对照官方最佳实践、我用得对不对、打个分、更新最佳实践清单. Not for deciding whether a tool, MCP or skill is worth keeping (dev-environment-roi-audit). Never edits the user's AGENTS.md, CLAUDE.md, settings or config."
license: MIT
metadata:
  author: Adonis0123
  version: "0.1.0"
---

# Agent Practice Audit

Answer one question with evidence: how far is this person's coding-agent usage from what the vendors officially recommend? Two modes share one practice list, `references/practices.json`.

| Mode        | Input                                                         | Output                                                                                   |
| ----------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **audit**   | Local session logs (last N days, default 60) and agent config | `report.html` + `report-data.json` under `$AGENT_PRACTICE_AUDIT_DIR/reports/YYYY-MM-DD/` |
| **refresh** | Official pages on the allowlist                               | Diff to `references/practices.json` + a section in `references/changelog.md`             |

Pick the mode from what the user wants to know. "How am I doing / score me / check-up / what should I change" is **audit**. "Update the practice list / are the sources still valid / add what vendors published recently" is **refresh**. A request that only checks links (no new practices) is refresh step 1 plus the gate in step 7. When unsure, ask in one line; when the run is scheduled or headless, nobody can answer, so do the mode named in the invocation and never stop to ask.

Reply in the user's language; set `lang` in `judgments.json` to match.

Related: `dev-environment-roi-audit` answers "is this tool, MCP or skill worth keeping?" with ablations. This skill answers "how far is my usage from official practice?". When a finding is really about cost or startup tax of a component, point to that skill instead of judging it here.

## Contract

1. Read-only towards the user's setup. Never edit `AGENTS.md`, `CLAUDE.md`, settings, hooks, Codex/Grok config, or session logs. Suggestions go into the report; the user decides.
2. Write only under `$AGENT_PRACTICE_AUDIT_DIR` (default `~/.local/share/agent-practice-audit`). Never write audit output into a repository; every script that writes resolves the real path and refuses targets inside a git work tree.
3. No secrets in any output. Use `scripts/config_scan.py` for config; it reports sizes, counts, deny-rule coverage categories (never the rules themselves), env variable names and an allowlist of Codex keys only. If you open a config file yourself, do not print `env`, `headers`, tokens or MCP credentials.
4. Every `ok`/`part`/`no` needs a number or a file fact as evidence. If the logs cannot show it, use `na` and say why.
5. The report is local. Do not publish it, attach it, or paste prompt excerpts from `sessions.jsonl` anywhere.

## Audit mode

Set `RUN="$AGENT_PRACTICE_AUDIT_DIR/reports/$(date +%F)"` (with the default base when the variable is unset) and create `"$RUN/work"`. `SKILL_DIR` is this skill's directory.

1. **Extract.** `python3 "$SKILL_DIR/scripts/extract.py" "$RUN/work/sessions.jsonl" --days 60`
   It auto-detects Claude Code (`~/.claude*/projects/**/*.jsonl`), Codex (`~/.codex*/sessions/**/*.jsonl`), Grok (`~/.grok*/sessions/**/chat_history.jsonl` plus sidecars) and WorkBuddy (`~/.workbuddy/projects/*/*.jsonl`); globs cover multi-account directories. It prints per-host file counts split into human, headless and subagent sessions, and `not found` for missing hosts. A session is in the window when its last event is; file mtime only pre-filters. `dropped-outside-window` counts files touched recently whose events are older; `spans-window-start` counts sessions that began before the window and are kept whole (marked `spansCutoff`). Quote that output to the user. Roots can be overridden; see [references/audit-files.md](references/audit-files.md).
   If every host is `not found` or there are no human sessions in the window, stop here: say which roots were searched and offer a longer `--days` or a custom root. A report built on nothing would grade the person on silence.
2. **Aggregate.** `python3 "$SKILL_DIR/scripts/aggregate.py" "$RUN/work/sessions.jsonl" -o "$RUN/work/summary.json"`
3. **Scan config.** `python3 "$SKILL_DIR/scripts/config_scan.py" --summary "$RUN/work/summary.json" -o "$RUN/work/config-scan.json"` (add `--repo DIR` for repositories the user cares about).
4. **Judge.** For each practice, read its `detect` field, look up the numbers in `summary.json` / `config-scan.json`, and write `"$RUN/judgments.json"` (schema in [references/audit-files.md](references/audit-files.md)): status, a short summary for the table, evidence with numbers, a concrete suggestion for `part`/`no`, and a caveat where the signal is noisy. Judge mainly on human sessions; mention headless and subagent counts where they matter. A host with few sessions (under ~10) gets a caveat, not a verdict.
   Write the judgments for a reader who scans first and acts second:
   - **Voice.** Lead with the verdict and the number. One fact per clause (about 25 Chinese characters or 15 English words). The user, a host or a file is the subject; active voice. Keep English terms (`subagent`, `headless`, `hook`, `sandbox`) and, in `zh`, add a short Chinese gloss on first mention. No buzzwords, no filler summaries, no emoji.
   - `headline`: one sentence (up to ~35 Chinese characters / 20 English words): the biggest strength, then the biggest gap.
   - `lead`: two sentences. First, session counts by host and kind (human, headless, subagent). Second, the one or two fixes that climb the grade ladder fastest.
   - `summary`: a table-cell fragment (up to ~22 Chinese characters / 10 English words) with the decisive metric first, e.g. `66/339 个 Claude 会话超 200 次工具调用`.
   - `evidence`: one to three short sentences with exact counts, ratios and medians from `summary.json` / `config-scan.json`; config keys and `~/...` paths in code format.
   - `suggestion`: one or two imperative sentences that name the file, flag or command to change; empty for `ok`.
   - Good: `{"summary": "Codex 24/24 人工会话全权限运行", "evidence": "Codex 24/24 人工会话为 approval=never 且 sandbox=danger-full-access。", "suggestion": "在 ~/.codex/config.toml 设 approval_policy = \"on-request\" 和 sandbox_mode = \"workspace-write\"。"}`
   - Bad: `{"summary": "权限配置存在较大风险隐患", "evidence": "经全面分析，很多会话没有开启沙箱。", "suggestion": "建议强化安全意识，完善权限管控。"}` (no numbers, vague subject, nothing to do next).
5. **Build.** `python3 "$SKILL_DIR/scripts/build_report.py" --judgments "$RUN/judgments.json" --summary "$RUN/work/summary.json"`
   It scores, finds the previous run automatically (`--previous none` to skip), and prints score, grade and the upgrade ladder. Open the HTML locally.
6. **Tell the user** the grade and score, the change since last time, the ladder ("fix these N items -> grade X"), the top three suggestions, and the report path. Mark anything you could not verify. In a scheduled run, put the same lines in the notification text instead (no session excerpts in it).

Sources in the report: a reachable source links to the live page with a text fragment. A source whose digest says `linkStatus: unreachable` still shows its link, marked as unavailable (原文暂时打不开), with the stored digest summary beside it. Practices with `basis: digest` are marked 基于摘要 (from digest).

Known false positives to keep in mind while judging: correction and command detection are keyword matches; reading any image counts as a screenshot; long sessions have more corrections partly because they have more turns; plan mode in Codex/Grok is not always logged.

## Refresh mode

Two stages: one agent proposes, at least two other models verify. Nothing enters the active list on one model's word.

1. **Re-check links.** `python3 "$SKILL_DIR/scripts/check_practices.py" --fetch --update-digests` re-fetches every source, writes `linkStatus` (`ok`, `redirected` + `finalUrl`, `unreachable`) and `lastVerifiedAt` into `references/sources/<slug>.md`, and reports quotes that no longer match. Unreachable or dead links are flagged in the changelog, never deleted; their practices fall back to the digest (see the gate in step 7). When an unreachable page works again, re-verify its practices against the live page and set `basis` back to `live`.
2. **Propose (stage a).** Read [references/sources.md](references/sources.md). Search only the allowlisted domains, starting from the seed URLs. For each candidate, fetch the page and copy a verbatim quote of at most 25 words plus a shorter `fragment` from inside the quote (it must match rendered page text so the `#:~:text=` link scrolls to it). Write the candidate in practice shape: `id` (kebab-case, stable), `dimension` (ctx, safe, doc, plan, verify, auto), `title`, `title_zh`, `sources[]` (`source` slug, `page`, `url`, `quote`, `fragment`), `detect`. A second vendor saying the same thing becomes another source on the existing practice.
3. **Digest.** Each source page needs `references/sources/<slug>.md`: frontmatter `slug`, `title`, `publisher`, `url`, `fetchedAt`, `lastVerifiedAt`, `linkStatus`, `finalUrl`; a `## Summary` of 5-12 bullets in your own words (no copied paragraphs); a `## Cited quotes` list holding every quote practices cite from that page. Verifiers use the digest when the page cannot be opened.
4. **Verify (stage b).** `python3 "$SKILL_DIR/scripts/consensus.py" detect --exclude <proposer>` lists verifier CLIs on this machine (`claude -p`, `codex exec -`, `grok -p`, `gemini -p`; check `--help` of the installed version). For each candidate, save the page text (or the digest when `linkStatus` is `unreachable`) to a file, render the prompt with `consensus.py prompt --candidate cand.json --page page.txt --basis live|digest > prompt.txt`, and send it on stdin to each verifier, for example `claude -p < prompt.txt > v-claude.txt` and `codex exec - < prompt.txt > v-codex.txt`. Cap each run (for example `--max-turns`) and keep the outputs out of the repository. The prompt is in [references/verify-prompt.md](references/verify-prompt.md) and asks for one strict JSON verdict.
5. **Decide.** `consensus.py decide v-claude.txt v-codex.txt v-grok.txt` applies the rule: accept iff agree >= 2 AND agree > total / 2 AND no veto. `total` is every verifier that ran (malformed or unparseable output counts and never agrees); `agree` counts valid accept verdicts, which need real JSON booleans and all three checks true; any result with `quote_found` strictly `false` vetoes, even if the rest of it is malformed. Give each verdict file a unique verifier name (`--names`, one per file). Accepted candidates go into `practices` with `consensus` from the output, `verifiedAt` today, `basis` `live` or `digest`, and no `needs-consensus` flag. Rejected candidates go to the changelog under **未采纳** with each verifier's reason. When fewer than 2 verifiers ran, the candidate goes into the top-level `pending` list as `pending-consensus`; audit mode ignores `pending`.
6. **Seed re-verification.** Practices with `"needs-consensus": true` (the 20 seeds carry a one-reviewer manual check from 2026-10-31) go through steps 4-5 like new candidates. A rejected seed moves to the changelog with reasons; ask the user before removing an active practice.
7. **Gate and record.** Run `python3 "$SKILL_DIR/scripts/check_practices.py" --fetch` until it exits 0. Gate semantics: every source must be either `live-verified` (page reachable, fragment and quote found) or `digest-verified` (page dead, unreachable or script-rendered, and its digest lists the quote under Cited quotes). It fails only for a quote or fragment missing on a reachable page, or an unreadable page whose digest is missing or lacks the quote. A practice that now rests on its digest is printed with a note: set `"basis": "digest"` on it so the report shows 基于摘要. The summary line reads `live: N/M ok, digest-verified: K, failed: 0`. Then add a dated section to `references/changelog.md` (added, changed, 未采纳, pending, flagged links, and the gate summary line), and show the user the diff. Renaming an id breaks trend comparison; do it only with a changelog note.

## Scoring

ok = 10, part = 5, no = 0, na not counted. Total and per dimension = earned / max x 100. Grades: S >= 90, A >= 80, B >= 70, C >= 60, D < 60. Dimensions: ctx (context management), safe (permissions and safety), doc (instruction files), plan (think before doing), verify (verification), auto (parallelism and automation). Equal weights are a convention for comparison, not an official standard; say so when presenting a grade.

## Scheduling

The skill installs nothing. [references/scheduling.md](references/scheduling.md) describes the intended setup: refresh runs remotely once a week (a hosted scheduled agent, or the sample GitHub Actions workflow) and delivers a pull request, never a push to the default branch; the owner merges it and installed copies pick it up through normal skill updates. Audit runs locally once a month through launchd (macOS) or cron / a systemd timer (Linux) with a headless agent call and a desktop notification when the report is ready. Install a schedule only when the user asks, and show them the exact file first.
