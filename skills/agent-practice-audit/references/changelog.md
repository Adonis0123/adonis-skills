# Practices changelog

Newest first. Refresh mode adds one section per run with these headings as needed: Added, Changed, 未采纳 (not adopted: each candidate with every verifier's verdict and reason), Pending (pending-consensus, too few verifiers), Flagged (dead, redirected or unreachable links; never deleted automatically), and the `check_practices.py --fetch` result line.

## 2026-11-11

Refresh from the nine newest Claude Code usage articles on `claude.com/resources/articles` (2026-06-18 to 2026-09-24). Newer posts (October-November) were product, enterprise or customer stories with no checkable individual practice. Proposer: claude (subagent). Verifiers: codex (isolated) and grok (`isolated: false`, no isolation flags). Three consensus rounds: all candidates and seeds; revised seeds and added sources; a rerun of two seeds where grok had timed out (`--timeout 1500`).

- Sources: six new digests `cc-art-loops`, `cc-art-maximizing-sessions`, `cc-art-opus-5-5-context`, `cc-art-sdlc-playbook`, `cc-art-steering`, `cc-art-verification-loops`. Read and not cited: `auto-mode-default-in-claude-code` (product announcement), `claude-code-guide-for-startups` (team-level; individual tips already covered), `claude-model-and-effort-level-in-claude-code`.
- Added: `ctx-compact-before-break` (2/2). `extract.py` now records idle gaps of at least `gap_minutes` inside human Claude sessions (resumes included) and whether a manual `/compact` came right before; auto-compaction is counted separately and does not satisfy the rule. `summary.json` gains `hosts.claude.idle_gaps`, `compact_cmds` and `compact_focus`. The judge-input size budget in `test_measurement.py` moved from 12 KB to 13 KB.
- Changed: `doc-update-on-repeat` gains an Anthropic source (`cc-art-sdlc-playbook`, 2/2).
- Changed (rule fidelity, after round 1 rejections): the 17 seeds rejected in round 1 were revised to match their quotes; `prejudge.py` and tests follow each rule. Main edits: every number missing from the vendor text sits in a rule marked `(heuristic)`; `safe-deny-secrets` scores `.env` only (no `~/.ssh` / `~/.aws` requirement) across all active configs; `safe-small-enforced-set` counts every hook and deny rule; `safe-low-risk-preset` drops the effort claim from its title and keeps the trusted-repo exception; `ctx-custom-subagents` is about `model: haiku` for simple subagents and is `na` without definitions; `ctx-clear-between-tasks` caps at part because logs cannot see task relatedness; `doc-test-commands` accepts any real check command and lists missing kinds (new `mentions_build` in `config_scan.py`); `auto-headless` scores absence as `na`. These practices are marked 规则已改 in the next report and left out of the delta.
- Seed consensus passed (2/2, `needs-consensus` removed): `doc-update-on-repeat`, `plan-done-when`, `verify-revert-retry` (round 1); `ctx-custom-subagents`, `ctx-compact-focus`, `safe-small-enforced-set`, `safe-deny-secrets`, `plan-interview`, `auto-headless-limits` (round 2).
- 未采纳 (new candidates; no quote was vetoed, every rejection is about rule fidelity):
  - `verify-fresh-context-review` 0/2: rule counts any review skill call; the sources ask for a second agent with fresh context.
  - `verify-checks-as-skills` 1/2: codex: install and call rates cannot show that repeated manual checks became skills.
  - `verify-lint-hook` 1/2: codex: rule accepts Stop-only hooks and a single tool; source says formatter and linter after edits.
  - `ctx-model-at-start` 0/2: rule exempts switches after compaction; sources name only session start or after `/clear`.
  - Added sources, rejected in both rounds because the host title or rule goes beyond the new quote (the quote itself was found): `doc-test-commands` (0/2), `ctx-compact-focus` (1/2, grok: quote is conditional on "always the same thing"), `safe-hooks-for-musts` (0/2), `plan-done-when` (1/2, grok: title adds "in the prompt"), `doc-skills-on-demand` (0/2).
- 待用户决定 (seeds still rejected after revision, kept active with `needs-consensus: true`): `ctx-clear-between-tasks`, `ctx-subagent-offload`, `safe-low-risk-preset`, `safe-hooks-for-musts`, `doc-short-instructions`, `doc-test-commands`, `doc-skills-on-demand`, `plan-mode-first`, `verify-runnable-checks`, `auto-worktrees`, `auto-headless`. Remaining reasons: the logs cannot see what the page asks (task relatedness, whether a procedure moved into a skill, whether a check passed); a 200-line rule that accepts exactly 200 lines where the page says "under 200"; and on `doc-test-commands` / `auto-worktrees`, the Claude Code and Codex sources ask for different things, so one rule cannot match both. Verdicts also varied between rounds (codex accepted `auto-worktrees` on one page in round 2 and rejected the same page text in round 3). grok timed out or returned no verdict array on some large batches in rounds 1 and 2; those count as malformed.
- Flagged: `cc-art-sdlc-playbook` says keep CLAUDE.md "under a page", tighter than the 200-line target of `doc-short-instructions`; rule unchanged. No dead or redirected links.

## 2026-11-01

- Changed (measurement, not refresh): eight false positives found in the 2026-11-01 audit were fixed in the scripts. These practices' `detect` or `rule.text` now describe the new measurement, so the next report marks them 规则已改 / rule changed and leaves them out of the delta:
  - `ctx-clear-between-tasks`: cleared = any new human session in the same directory within 10 min (another account or host, a new window, a sideby handoff), not only `/clear` or `/new`; Claude session ends ignore late system lines (rule text and detect).
  - `ctx-compact-focus`: compaction notes without the `Compact instructions` heading give part, not no (rule text and detect).
  - `safe-small-enforced-set`, `safe-hooks-for-musts`: a hook counts as blocking only when its script can return deny / block / exit 2; env variable names such as `*_TOKEN` no longer make a secrets topic (detect).
  - `doc-short-instructions`: the global AGENTS file no longer counts toward `project_doc_max_bytes` (rule text and detect).
  - `doc-test-commands`: subdirectory AGENTS.md / CLAUDE.md count for their repository; `pnpm check` counts as a lint gate (detect).
  - `auto-worktrees`: only overlapping sessions that both edited files, overlap >= 5 min (new param `min_overlap_minutes`), clones of one remote grouped and counted as isolated (rule text, params and detect).
  - `plan-done-when`: more completion keywords (验证, 截图核对, 跑通, 测试通过, 改完/做完…验|测|跑); rule and detect unchanged.

## 2026-10-31

- Added: 20 practices across six dimensions (ctx 4, safe 4, doc 4, plan 3, verify 2, auto 3), seeded from a one-off audit whose quotes were checked by hand against the live pages.
- Checked: `check_practices.py --fetch` -> `live: 38/38 ok`.
- Dropped: one supporting quote from `agents.md` on `doc-test-commands`, because that domain is not on the official allowlist. The practice keeps its Claude Code and Codex sources.
- Consensus: each seed carries a one-reviewer manual quote check (`claude (manual quote check)`, 1/1) and `needs-consensus: true`; the first refresh re-verifies them with at least two other models.
- Digests: one offline digest per source page under `references/sources/` (9 pages, all `linkStatus: ok`).
- Flagged: none.
