# Keep the Coordinator's context small

On one measured Run (n=1; re-measure with `measure.md`) the Coordinator was about half of all spend (context grew to ~600k tokens; screenshots were the largest item), because every token it reads is re-read on every later turn.

1. **The ledger is the only state.** Do not keep Worker details in the conversation; re-read with `show --line` or `show` (short text).
2. **Never Read the Board HTML, `run.json`, Worker `.jsonl` streams or full reports.** Changing files are worse than large ones: Claude Code injects a file's diff into the conversation each time a file it read changes. The Board lives outside the repository and is rewritten only at milestones, but reading it still costs the whole page.
3. **Workers return a summary of at most 10 lines plus paths** (`task-spec.md` Return). Register them with `lane set --summary-file <summary> --result-file <report>`. Read the whole summary, not only its first sentence: its first line is for the user, the rest lists the Worker's decisions, deviations from the spec and UNVERIFIED items, which you need before integrating. Do not Read the full report; when one of its details matters, give the path to a subagent and take back its text answer.
4. **Screenshots are judged by a subagent that returns text**; look at the final one yourself only when the user will see it.
5. **Round budget: the first run plus up to 2 fix rounds** (SKILL.md "Dispatching workers"); each fix round's review checks only the previous round's findings. Mechanical reviews (copy, formatting) go to a cheaper model; logic and security get the cross-model reviewer.
6. **A shared contract lands before the parts that use it fan out** (SKILL.md tier card). Two merges in the measured Run broke because one Lane added a required field another Lane relied on.
7. **A fix round resumes the same Worker session** (`launch.md` § Fix rounds).
8. **Let the host compact automatically**; never ask the user to run `/compact` (they run no commands). After a compaction, re-read the Run with `show` before acting: the ledger, not the summary, is the state. A SessionStart hook with matcher `compact` can inject "read <ledger> with show".
9. **Stop processes by pid, never by a command-line pattern.**
