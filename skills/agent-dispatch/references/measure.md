# Did dispatching pay off?

`evals/evals.json` checks that the skill picks the right tier and follows the Run rules. It cannot show that dispatching beat doing the work yourself. Until the paired benchmark below has been run, the tier thresholds are judgment, not measurement; say so when the user asks why a tier was chosen.

## After every Run

Before `close`, read `show` and record one decision:

```bash
B decision add --what "派活是否值得" --choice "值得|不值得|说不清" \
  --why "<lanes> 个任务，共 \$<cost>，用时 <wall time>；修复 <n> 轮；集成出问题 <n> 次；复审抓到摘要未报的问题 <n> 条；自己做估计 <time / cost, marked 估计>" \
  --options "自己做（L1）"
```

- Cost and time come from `show` (Lane costs add up across rounds; unknown costs are unknown, never zero).
- "集成出问题" counts merge conflicts, merges that broke a build or test, and Lanes re-dispatched because the split was wrong.
- "复审抓到摘要未报的问题" counts reviewer findings the Worker's summary did not mention: the main evidence that a cross-product review paid for itself.
- The solo estimate is a guess; label it 估计. Never present it as measured.
- `close` archives the ledger under `archive/<run-id>/`, so these decisions can be collected later without a separate log.

Say the same numbers in one line of the final report.

## Paired benchmark (before changing tier rules)

Run this before changing a tier threshold, the split rule or the Writing/Research defaults, and after upgrading the model or a host CLI the skill dispatches to (what a stronger model can hold in one loop changes). Change one rule per benchmarked change and cite its table, so a regression points at one cause.

1. Pick 3-5 golden tasks from real past Runs, each with acceptance checks that decide pass or fail without judgment (tests, a command, a page check). Ten is better; three is enough to start.
2. For each task, run two variants from the same base commit in fresh worktrees: **solo** (one coordinator session does it, L1) and **dispatched** (the tier this skill picks).
3. Run each variant at least 3 times. Failures can appear in only some runs; one run per variant hides them.
4. Record per run: acceptance pass/fail, total cost (Coordinator plus every Lane), wall time from first prompt to integrated result, fix rounds, integration breaks.
5. Compare per task, then in total: each task's solo and dispatched passes (e.g. 3/3 vs 2/3), marking tasks that flipped; then pass rate, median cost, median wall time, breaks. A task that flipped in only one run is read from its transcript before it counts. Dispatching earns its tier only where it completes at least as many tasks as solo, no task got worse, and it saves wall time the user cares about; otherwise lower the tier for that kind of task.

The tools are in `evals/`: `evals/bench/run_bench.py` and `compare.py` run this benchmark on real commits of the skill's repository (`evals/bench/tasks.json`), and `evals/README.md` gives the commands for it and for the cheaper with-vs-without-skill behavior check. Add each run's table to `evals/results.md`, so the next change can rerun the same tasks and compare.
