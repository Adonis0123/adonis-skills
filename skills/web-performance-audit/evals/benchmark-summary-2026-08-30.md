# Benchmark summary — 2026-08-30

Each cell is one fresh-agent run graded against the assertions in `evals.json`. These small samples demonstrate direction, not statistical confidence. The runs exercised the same v1.1 behavior before its repository-neutral rename; the Adonis Skills port changed only the public identity and installation guidance, then reran deterministic and host-discovery checks.

| Eval                     | With skill | Without skill | Observed difference                                                                                                                    |
| ------------------------ | ---------: | ------------: | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Large media workspace |        8/8 |           3/8 | Preserved the fixture's exact duration/surfaces, isolated Recorder and React Scan, used median/range, and added retest/stop conditions |
| 2. Browser-only fallback |        5/5 |           2/5 | Kept visual evidence separate, covered cold/warm/cycles, handled polling noise, and restored state without fabricating a trace         |
| 3. Lighthouse boundary   |        3/3 |           2/3 | Explicitly routed a public load/SEO/a11y request to Lighthouse / Web Quality and rejected the complex runtime matrix                   |
| 4. Metric semantics      |        6/6 |           5/6 | Corrected `4× CPU slowdown` wording and preserved all click/heap/image/Coverage caveats with falsifiable retests                       |

Aggregate: **22/22 with the skill vs 12/22 without it**. The result supports instruction quality for these fixtures only. It does not replace a real browser audit, cross-version client acceptance, or repeated statistical evaluation.

This benchmark predates the v1.1 capability-bootstrap eval. The new install/fallback contract is covered by deterministic validation in the repository but is not included in the 22-assertion aggregate; do not present this table as a v1.1 comparative score.
