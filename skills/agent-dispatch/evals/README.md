# agent-dispatch evals

[简体中文](README.zh-CN.md)

Three checks, from cheapest to the one that answers "does dispatching pay off". Run them before changing a tier rule, after upgrading the model or a CLI the skill dispatches to, and change one rule per measured change (`../references/measure.md`). Record every run in [`results.md`](results.md).

| Check                                 | Question it answers                                                                                                            | What it cannot show                                                                               | Cost                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A. Behavior with vs without the skill | Does loading the skill make the agent pick the right tier and follow the Run rules, compared with no skill?                    | Whether the chosen tier produces better code. Routing accuracy is not an architecture comparison. | 22 cases × 3 runs × 2 arms; about $25-55, 30-40 min    |
| B. Solo vs dispatch outcome benchmark | On real tasks from this repository's history, does an agent using the skill finish as many tasks as one working alone, faster? | Tasks unlike the ones in `bench/tasks.json`, or other models.                                     | 3 tasks × 3 runs × 2 arms; hours, real worker accounts |
| Trigger eval                          | Does the description make Claude load the skill for the right prompts?                                                         | Anything after loading.                                                                           | 12 prompts × 3 runs                                    |

## A. Behavior with vs without the skill

Cases live in [`evals.json`](evals.json) (prompt, fixtures, assertions). It is the only place to edit them; the suite for `claude plugin eval` is generated:

```bash
python3 skills/agent-dispatch/evals/build_plugin_eval.py
claude plugin eval . --eval-dir evals/agent-dispatch --runs 3 --ablation with-without --scaffold \
  --allow-tools Bash Write Edit --trust-plugin --no-publish -j 4 --judge-model sonnet \
  --output-dir <out> --json <out>/result.json
```

Run from the repository root. The suite lands in `evals/agent-dispatch/` (gitignored; `claude plugin eval` refuses an eval directory inside `skills/`). The with-skill arm loads only this skill; the baseline arm has no access to it, including copies installed in your home directory. Each assertion is its own LLM grader, so a case scores the share of assertions held (`score` / `scoreWithout` / `delta` per case in `result.json`) and the report names the assertion that failed; the judge sees the transcript with middle messages elided, so a step buried in a long run can read as missing. `partial: true` means the run did not finish. A run that ends on an API error (for example "You've hit your session limit") scores 0 without grading and the run log counts them; rerun those cases on another account. `--case` matches one plain `*` glob (no `[..]` or `{..}`), so to rerun several cases copy their generated directories into another gitignored directory and pass it as `--eval-dir`. Cases that use a Run ledger fixture tell the agent the ledger is a static snapshot and a background `watch` only needs to be described: on the copy, files turn 5 minutes old with nothing running, `watch` wakes, and the last message reports that false silence instead of answering the user. Some assertions name ledger commands the baseline cannot know, so part of the delta is "knows the commands", not only "picks better". The sandbox has no `sideby`, so cases that list `fixtures/sideby-stub/sideby` get a stand-in that answers `sessions`, `send` and a few other commands from fixture data in the real `--json` shapes and sends nothing; the agent is told to put it on `PATH`. Ledger and sideby cases are judged on the whole trace, because a correct final answer need not repeat which command it came from. Unit tests for the suite builder and the stub: `python3 -m unittest discover -s skills/agent-dispatch/evals -p 'test_*.py'`.

## B. Solo vs dispatch outcome benchmark

Tasks are real commits of this repository ([`bench/tasks.json`](bench/tasks.json)). Each trial clones the repository at the commit's parent, gives a headless Claude Code session the task's issue-style prompt, then copies the commit's own tests over the result and runs the acceptance commands. Only the outcome is graded.

```bash
B=skills/agent-dispatch/evals/bench
python3 $B/run_bench.py --out <dir outside the repo> --fake reference --runs 1 --arms solo   # every task must PASS
python3 $B/run_bench.py --out <dir outside the repo> --fake noop --runs 1 --arms solo        # every task must FAIL
python3 $B/run_bench.py --out <dir> --runs 3 --jobs 3 \
  --agent-cmd "sideby run {account} --" --accounts claude:001,claude:002,claude:008
python3 $B/run_bench.py --out <dir> ... --skip-done   # resume: run only trials missing from results.jsonl
python3 $B/compare.py <dir>/results.jsonl --md <dir>/report.md
```

- Arms: `solo` (the agent works alone) and `dispatch` (the agent uses `/agent-dispatch` and may start workers on other CLIs and accounts). Both arms of one repetition use the same coordinator account.
- Safety: every trial works in its own clone with the `origin` remote removed and `git push` disallowed; its dispatch ledgers stay in the clone. Workers run with bypassed permissions inside that clone, so run it only on a machine where that is acceptable.
- Verdict (`compare.py`): dispatch holds only if it completes at least as many tasks as solo, no task gets worse, and its median wall time is lower. A task whose arms differ by one run is marked "check transcript" (`<dir>/logs/<task>-<arm>-<rep>.jsonl`, clone in `<dir>/work/`).
- Ceiling effect: when both arms pass every run, the benchmark only measures time and cost, and the review a dispatch tier adds shows up as cost with no visible benefit. Add tasks that a solo run fails at least once before reading the verdict as "dispatch does not pay".
- Adding a task: pick a commit whose tests decide the change, write an issue-style prompt that names every interface the tests use without giving the solution, list the test files as `hidden_tests` and the commands as `accept`, then run both `--fake` checks on it (`--only <id>`). Ten tasks are the target; three are enough to start.
- Unit tests for the harness: `python3 -m unittest discover -s skills/agent-dispatch/evals/bench -p 'test_*.py'`.

## Trigger eval

[`trigger-eval-set.json`](trigger-eval-set.json) lists prompts that should and should not load the skill. Build one case per prompt and run it with `--ablation none` (the default adds a baseline arm that cannot load the skill):

```bash
python3 skills/agent-dispatch/evals/build_plugin_eval.py --trigger
claude plugin eval . --eval-dir evals/agent-dispatch-trigger --runs 3 --ablation none --allow-tools Bash Write Edit \
  --trust-plugin --no-publish -j 4 --output-dir <out> --json <out>/result.json
```

Each case has one free grader: the Skill tool loaded agent-dispatch (`NN-fires`) or never did (`NN-stays-off`, `min: 0` and `max: 0`). The run sees only this copy of the skill, so a copy installed in your home directory cannot answer first, which is why skill-creator's `scripts/run_eval.py` reads every query as "not triggered" on a machine that has the skill installed. Runs stop at 15 turns; a run that starts real work may hit that cap.
