# agent-dispatch eval results

Newest run first. Add a section per measured change; keep old sections for comparison. How to run each check: [README.md](README.md).

## 2026-10-25 · skill 1.10.0 · claude-opus-5-5 (judge: sonnet) · Claude Code 2.1.309

### A. With vs without the skill (`claude plugin eval --ablation with-without`)

Scores are the mean share of a case's assertions that held, per arm. Run 1 graded each case with one all-or-nothing grader; runs 2-4 grade every assertion separately, so run 1 is not directly comparable with the later runs.

| Run  | Cases         | Runs per arm | Grading                             | Cost   | Notes                                                                                                                    |
| ---- | ------------- | ------------ | ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| run1 | 22            | 3            | one grader per case, all or nothing | $48.91 | with 0.41, meanDelta +0.36; 3 runs ended on API errors                                                                   |
| run2 | 22            | 3            | one grader per assertion            | $58.63 | incomplete: 68 runs ended on API errors (mostly "You've hit your session limit" for cases 12-22) and scored 0 ungraded   |
| run3 | 07, 08, 11-15 | 3            | one grader per assertion            | $90.88 | after the ledger-note and grant fixes below; stopped at `--max-cost-usd 90` (`partial: cost_ceiling`) before cases 16-22 |
| run4 | 16-22         | 2            | one grader per assertion            | $26.48 | completed, no API errors                                                                                                 |

An interrupted rerun of cases 12-13 between run2 and run3 ($5.64) is left out of the table.

Per case (`-` = not run or every run ended on an API error). "Latest" is the newest per-assertion run for that case, which is what the summary line uses.

| Case                                                        | run1 with | run1 without | run2 with | run2 without | run3 with | run3 without | run4 with | run4 without | latest per-assertion run | failing assertions (with, latest) |
| ----------------------------------------------------------- | --------- | ------------ | --------- | ------------ | --------- | ------------ | --------- | ------------ | ------------------------ | --------------------------------- |
| 01-simple-copy-change-stays-direct                          | 0.67      | 0.00         | 1.00      | 0.87         | -         | -            | -         | -            | run2                     |                                   |
| 02-single-product-machine-degrades                          | 0.67      | 0.00         | 0.86      | 0.67         | -         | -            | -         | -            | run2                     | a05×2, a07×1                      |
| 03-cross-package-fanout-plus-article                        | 0.33      | 0.00         | 1.00      | 0.33         | -         | -            | -         | -            | run2                     |                                   |
| 04-composed-pipeline-defers-reviewer-and-pipeline-ownership | 0.00      | 0.00         | 1.00      | 0.75         | -         | -            | -         | -            | run2                     |                                   |
| 05-allow-list-multi-session-headless-permissions            | 0.00      | 0.00         | 0.90      | 0.48         | -         | -            | -         | -            | run2                     | a02×2                             |
| 06-design-research-fans-out-across-products                 | 0.00      | 0.00         | 0.93      | 0.47         | -         | -            | -         | -            | run2                     | a05×1                             |
| 07-progress-question-mid-run-uses-board                     | 0.00      | -            | 0.62      | 0.62         | 0.96      | 0.62         | -         | -            | run3                     | a08×1                             |
| 08-standing-grant-for-deploy-is-scoped                      | 0.00      | 0.00         | 0.25      | 0.58         | 0.92      | 0.83         | -         | -            | run3                     | a04×1                             |
| 09-outward-ask-carries-recipient-and-draft                  | 0.00      | 0.00         | 1.00      | 0.60         | -         | -            | -         | -            | run2                     |                                   |
| 10-global-session-list-is-not-a-dispatch                    | 0.00      | 0.00         | 0.56      | 0.00         | -         | -            | -         | -            | run2                     | a02×1, a03×3                      |
| 11-plain-answer-updates-the-ledger                          | 0.33      | 0.00         | 0.67      | 0.33         | 1.00      | 0.75         | -         | -            | run3                     |                                   |
| 12-board-that-cannot-open-falls-back-to-chat                | 0.33      | 0.00         | -         | -            | 0.92      | 0.75         | -         | -            | run3                     | a04×1                             |
| 13-authorized-local-commits-stay-on-lane-branch             | 1.00      | 0.00         | -         | -            | 1.00      | 0.67         | -         | -            | run3                     |                                   |
| 14-stop-mid-run-stops-what-it-can                           | 0.67      | 0.00         | -         | -            | 1.00      | 0.80         | -         | -            | run3                     |                                   |
| 15-reply-local-worker-question                              | 0.00      | 0.00         | -         | -            | 0.58      | 0.17         | -         | -            | run3                     | a01×2, a02×1, a03×1, a04×1        |
| 16-fix-round-files-old-result-and-keeps-watching            | 0.67      | 0.00         | -         | -            | -         | -            | 1.00      | 0.60         | run4                     |                                   |
| 17-shared-contract-lands-before-fanout                      | 1.00      | 0.33         | -         | -            | -         | -            | 1.00      | 1.00         | run4                     |                                   |
| 18-l1-coordinator-writes-itself                             | 0.67      | 0.00         | -         | -            | -         | -            | 1.00      | 0.50         | run4                     |                                   |
| 19-small-ux-tweak-is-not-research                           | 1.00      | 0.67         | -         | -            | -         | -            | 1.00      | 1.00         | run4                     |                                   |
| 20-worker-summary-carries-decisions                         | 0.67      | 0.00         | -         | -            | -         | -            | 0.83      | 0.00         | run4                     | a01×1                             |
| 21-coordinator-writes-the-article                           | 1.00      | 0.00         | -         | -            | -         | -            | 1.00      | 1.00         | run4                     |                                   |
| 22-close-reports-whether-dispatch-paid-off                  | 0.00      | 0.00         | -         | -            | -         | -            | 1.00      | 0.30         | run4                     |                                   |

**Latest per-assertion run per case, 22 cases: with skill 0.93, without 0.60, delta +0.33.** These mix runs 2-4 (runs 2 and 3 used 3 runs per arm, run 4 used 2).

Remaining with-skill failures:

- 15 (0.58): the sandbox has no `sideby`, so replying to a local worker cannot be shown end to end. UNVERIFIED, not a skill change.
- 10 (0.56): the global session list question; the sandbox also lacks `sideby`, so the agent cannot run `sideby sessions` it should route to. UNVERIFIED.
- 02 a05, 05 a02, 06 a05, 07 a08, 08 a04, 12 a04, 20 a01: one or two runs out of 2-3 missed one assertion each; no repeated pattern across cases, not acted on.

### B. Solo vs dispatch outcome benchmark (`bench/run_bench.py`)

3 tasks from this repository's history, hidden tests from the original commit, 3 runs per arm, coordinators rotated across claude:001/002/008. Cost $32.50.

| Task | solo pass | dispatch pass | dispatch tier | solo median s | dispatch median s | solo median $ | dispatch median $ | Flip |
| ---- | --------- | ------------- | ------------- | ------------- | ----------------- | ------------- | ----------------- | ---- |
| T1   | 3/3       | 3/3           | L1            | 100.7         | 173.5             | 1.22          | 1.66              | -    |
| T2   | 3/3       | 3/3           | L1            | 322.3         | 478.2             | 1.83          | 2.95              | -    |
| T3   | 3/3       | 3/3           | L1            | 83.1          | 147.3             | 0.86          | 1.45              | -    |

- solo: 9/9 passed, median 100.7s, median cost $1.22.
- dispatch: 9/9 passed, median 211.2s, median cost $2.11.
- Verdict: dispatch does not pay off on these tasks: not faster and not more correct. Every dispatch run picked L1 (coordinator does the work itself), which is the right tier for tasks this size; the extra time and cost is the skill's own reading and Run Board overhead. All three tasks are solved by both arms, so the set has a ceiling effect: it cannot show a quality gain from dispatching. A future task set needs a task large enough that L2 should win.

### Diagnosis and changes made from these runs

| Finding                                                    | Cause                                                                                                                                                                                                 | Change                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run 1 scored 0/3 on cases that per-assertion review passed | all-or-nothing grader, turn caps                                                                                                                                                                      | `build_plugin_eval.py` emits one LLM grader per assertion and raises limits (timeout 900s, 40 turns)                                                                                                                                 |
| Low scores on 07/08/11 in run 2                            | harness: the agent copies the static ledger fixture, file times reset, after 5 minutes `watch` wakes correctly and the last message reports that false silence; the judge sees middle messages elided | `build_plugin_eval.py` tells the agent `fixtures/run-*` ledgers are static snapshots and a background `watch` only needs to be described                                                                                             |
| 08 missed the grant read-back                              | skill: the grant rule did not say to answer the grant first                                                                                                                                           | `references/run-board.md` rule 7: answer the grant before status news, quote scope and words, deploy/send/publish grants last this Run only and never widen to another environment, ask once as a numbered Ask when scope is unclear |
| Article gap: budgets and gates lived only in prose         | skill                                                                                                                                                                                                 | `dispatch_board.py` enforces max 3 rounds, `--budget-usd`, overlapping `--owns` write Lanes and reviewer-in-writer-session refusal (`scripts/test_harness_limits.py`)                                                                |
| run2 incomplete                                            | account hit its session limit                                                                                                                                                                         | README: API-error runs score 0; rerun them on another account, subsets via a copied `--eval-dir`                                                                                                                                     |

UNVERIFIED: the trigger eval (skill-creator `run_eval.py`) cannot run on this machine because the installed agent-dispatch shadows the candidate description (see README).

Total spend for this round: A $230.54 (runs 1-4 plus the interrupted rerun), B $32.50, smoke $0.47: $263.51.
