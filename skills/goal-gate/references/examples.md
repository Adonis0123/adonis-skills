# Goal Gate Examples

## Codex tooling: suggest first

User: "This migration may take a while. Should we set a goal?"

```text
Goal Gate
- Decision: suggest
- Runtime: codex-tooling
- Goal fit: high
- Objective: Migrate the module while preserving existing behavior.
- Done condition: Migration is complete, targeted tests pass, and no unrelated files are changed.
- Verification: Surface git diff summary plus the exact test command and passing output.
- Constraints: Keep scope to the migration files; do not change public API unless the user approves.
- Checkpoints: Report after each completed migration slice.
- Stop or ask when: Tests fail for an unclear reason, public API changes are needed, or progress blocks on missing context.
- Prompt: none
- Next: ask approval
```

Do not call `create_goal` unless the user explicitly approves setting the goal.

## Codex tooling: set now

User: "Set a goal to finish PLAN.md and keep going until validation passes."

```text
Goal Gate
- Decision: set-now
- Runtime: codex-tooling
- Goal fit: high
- Objective: Implement PLAN.md until the required validation commands pass.
- Done condition: Every PLAN.md acceptance criterion is implemented and the named validation commands exit 0.
- Verification: Surface changed files, validation commands, exit status, and any skipped checks.
- Constraints: Follow PLAN.md scope; do not push or commit unless explicitly asked.
- Checkpoints: Report after each plan milestone.
- Stop or ask when: PLAN.md is ambiguous, validation requires unavailable credentials, or a destructive action is needed.
- Prompt: none
- Next: create goal
```

Call `get_goal` first when available. If no goal is active, call `create_goal` with the objective. Do not set a token budget unless the user requested one.

## Codex slash

User: "Give me a Codex /goal prompt for this eval improvement loop."

```text
Goal Gate
- Decision: suggest
- Runtime: codex-slash
- Goal fit: high
- Objective: Improve the prompt until the eval suite reaches the target score.
- Done condition: The eval command reaches the target score or further changes require product guidance.
- Verification: Surface each eval command, score, failing cases reviewed, and final diff summary.
- Constraints: Keep prompt edits minimal and do not change eval fixtures unless explicitly approved.
- Checkpoints: Report after each eval run.
- Stop or ask when: The target cannot be reached without changing policy, product behavior, or eval fixtures.
- Prompt: /goal Optimize the prompts in [prompt file or directory] until [eval command] reaches [target score]. After each change, run the eval, inspect failing cases, keep edits minimal, and surface scores and diffs. Stop when the target is met or when further changes require product or policy guidance.
- Next: provide prompt
```

## Claude Code slash

User: "Generate a Claude Code /goal for implementing this design doc."

```text
Goal Gate
- Decision: suggest
- Runtime: claude-code-slash
- Goal fit: high
- Objective: Implement the referenced design doc.
- Done condition: All acceptance criteria hold, the app builds, and the specified tests pass.
- Verification: Surface acceptance-criteria mapping, test/build commands, exit codes, and screenshots if UI changed.
- Constraints: Follow the design doc; do not broaden scope; do not push.
- Checkpoints: Report after each acceptance-criteria group.
- Stop or ask when: The design doc conflicts with code reality, a destructive operation is needed, or verification cannot run.
- Prompt: /goal Implement [design doc path] without stopping until every acceptance criterion is satisfied, the app builds, and [test commands] pass. After each checkpoint, report what changed, what evidence was produced, what remains, and whether the done condition is met. Stop and ask if the doc conflicts with the code, verification is blocked, or a destructive action would be required.
- Next: provide prompt
```

Claude Code goal evaluators judge from surfaced conversation evidence. Instruct the agent to print the commands and results it wants evaluated.

## Unknown runtime

User: "I might run this in another coding agent. Make the goal portable."

```text
Goal Gate
- Decision: suggest
- Runtime: unknown
- Goal fit: medium
- Objective: Complete the requested refactor with behavior preserved.
- Done condition: Refactor is complete and the agreed validation signal passes.
- Verification: Surface changed files, validation command output, and behavior-parity notes.
- Constraints: No public API changes; no unrelated formatting churn.
- Checkpoints: Report after each logical slice.
- Stop or ask when: The runtime lacks required tools, validation is unavailable, or scope expands.
- Prompt: Complete the refactor until the agreed validation signal passes. Keep changes scoped, surface each verification result, and stop for ambiguity, unavailable tools, or scope expansion.
- Next: ask approval
```

## Active Codex tooling goal

User: "Set a new goal for this refactor."

Current `get_goal` says another goal is active.

```text
Goal Gate
- Decision: defer
- Runtime: codex-tooling
- Goal fit: high
- Objective: Refactor the requested module while preserving behavior.
- Done condition: Refactor is complete and validation passes.
- Verification: Surface active goal status, proposed new objective, and validation command output once approved.
- Constraints: Do not replace or mutate the active goal without user approval.
- Checkpoints: n/a
- Stop or ask when: A goal is already active.
- Prompt: none
- Next: ask approval
```

Ask whether to continue, complete, block, clear, or replace the active goal. Do not call `create_goal` or `update_goal` until the user explicitly chooses.

## Workflow gate already ran

Existing block says `Route: Full`, `scope=multi-module`, and `user-intent=implement`.

```text
Goal Gate
- Decision: suggest
- Runtime: codex-tooling
- Goal fit: high
- Objective: Complete the multi-module implementation selected by workflow-gate.
- Done condition: All planned modules are implemented and their validation commands pass.
- Verification: Surface per-module validation output and final git diff summary.
- Constraints: Preserve the workflow-gate route; do not broaden scope beyond the plan.
- Checkpoints: Report after each module or bounded context.
- Stop or ask when: The plan proves wrong, modules conflict, or validation is blocked.
- Prompt: none
- Next: ask approval
```

`workflow-gate` is a signal, not a prerequisite. Do not rerun it unless the user is asking for route selection rather than goal selection.
