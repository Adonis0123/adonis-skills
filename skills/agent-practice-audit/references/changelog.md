# Practices changelog

Newest first. Refresh mode adds one section per run with these headings as needed: Added, Changed, 未采纳 (not adopted: each candidate with every verifier's verdict and reason), Pending (pending-consensus, too few verifiers), Flagged (dead, redirected or unreachable links; never deleted automatically), and the `check_practices.py --fetch` result line.

## 2026-10-31

- Added: 20 practices across six dimensions (ctx 4, safe 4, doc 4, plan 3, verify 2, auto 3), seeded from a one-off audit whose quotes were checked by hand against the live pages.
- Checked: `check_practices.py --fetch` -> `live: 38/38 ok`.
- Dropped: one supporting quote from `agents.md` on `doc-test-commands`, because that domain is not on the official allowlist. The practice keeps its Claude Code and Codex sources.
- Consensus: each seed carries a one-reviewer manual quote check (`claude (manual quote check)`, 1/1) and `needs-consensus: true`; the first refresh re-verifies them with at least two other models.
- Digests: one offline digest per source page under `references/sources/` (9 pages, all `linkStatus: ok`).
- Flagged: none.
