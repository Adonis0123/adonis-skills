# Practices changelog

Newest first. Refresh mode adds one section per run with these headings as needed: Added, Changed, 未采纳 (not adopted: each candidate with every verifier's verdict and reason), Pending (pending-consensus, too few verifiers), Flagged (dead, redirected or unreachable links; never deleted automatically), and the `check_practices.py --fetch` result line.

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
