# Keep the Coordinator's context small

On one measured Run the Coordinator was about half of all spend (context grew to ~600k tokens; screenshots were the largest item), because every token it reads is re-read on every later turn.

1. **The ledger is the only state.** Do not keep Worker details in the conversation; re-read with `show --line` or `show` (short text).
2. **Never Read the Board HTML, `run.json`, Worker `.jsonl` streams or full reports.** Changing files are worse than large ones: Claude Code injects a file's diff into the conversation each time a file it read changes. The Board lives outside the repository and is rewritten only at milestones, but reading it still costs the whole page.
3. **Workers return at most 10 lines plus paths** (`task-spec.md` Return). Register them with `lane set --summary-file <summary> --result-file <report>`; read only the summary. When a detail of a report matters, give the path to a subagent and take back its text answer.
4. **Screenshots are judged by a subagent that returns text**; look at the final one yourself only when the user will see it.
5. **Reviews: at most 2 rounds**, and round 2 verifies only the round-1 findings. Mechanical reviews (copy, formatting) go to a cheaper model; logic and security get the cross-model reviewer.
6. **Parallel writers agree on shared types first and test them.** Two merges in the measured Run broke because one Lane added a required field.
7. **A fix round resumes the same Worker session** (`launch.md` § Fix rounds).
8. **Let the host compact automatically**; never ask the user to run `/compact` (they run no commands). After a compaction, re-read the Run with `show` before acting: the ledger, not the summary, is the state. A SessionStart hook with matcher `compact` can inject "read <ledger> with show".
9. **Stop processes by pid, never by a command-line pattern.**
