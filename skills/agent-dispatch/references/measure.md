# Did dispatching pay off?

`evals/evals.json` checks that the skill picks the right tier and follows the Run rules. It cannot show that dispatching beat doing the work yourself. Until the paired benchmark below has been run, the tier thresholds are judgment, not measurement; say so when the user asks why a tier was chosen.

## After every Run

Before `close`, read `show` and record one decision:

```bash
B decision add --what "派活是否值得" --choice "值得|不值得|说不清" \
  --why "<lanes> 个任务，共 \$<cost>，用时 <wall time>；修复 <n> 轮；集成出问题 <n> 次；自己做估计 <time / cost, marked 估计>" \
  --options "自己做（L1）"
```

- Cost and time come from `show` (Lane costs add up across rounds; unknown costs are unknown, never zero).
- "集成出问题" counts merge conflicts, merges that broke a build or test, and Lanes re-dispatched because the split was wrong.
- The solo estimate is a guess; label it 估计. Never present it as measured.
- `close` archives the ledger under `archive/<run-id>/`, so these decisions can be collected later without a separate log.

Say the same numbers in one line of the final report.

## Paired benchmark (before changing tier rules)

Run this before changing a tier threshold, the split rule or the Writing/Research defaults, and cite its table in the change.

1. Pick 3-5 golden tasks from real past Runs, each with acceptance checks that decide pass or fail without judgment (tests, a command, a page check). Ten is better; three is enough to start.
2. For each task, run two variants from the same base commit in fresh worktrees: **solo** (one coordinator session does it, L1) and **dispatched** (the tier this skill picks).
3. Run each variant at least 3 times. Failures can appear in only some runs; one run per variant hides them.
4. Record per run: acceptance pass/fail, total cost (Coordinator plus every Lane), wall time from first prompt to integrated result, fix rounds, integration breaks.
5. Compare in one table: pass rate, median cost, median wall time, breaks. Dispatching earns its tier only where its pass rate is at least solo's and it saves wall time the user cares about; otherwise lower the tier for that kind of task.

Keep the tasks, prompts and table next to the change that used them, so the next change can rerun them.
