# Goal Gate Examples

These examples assume the auto-set rule: when the safety gate is clear and goal fit is high, `set-now` fires without asking. Medium fit stays on `suggest`; a tripped safety gate drops to `suggest` or `defer`.

## Codex tooling: auto set-now (safety gate clear)

User: "I'm in Codex with goal tooling. No goal is active. Work through PLAN.md and don't stop until `pnpm test` passes and `pnpm build` succeeds."

High fit, no safety-gate trip, tooling available — so create the goal now instead of asking.

```text
Goal Gate
- Decision: set-now
- Runtime: codex-tooling
- Goal fit: high
- Objective: Implement every task in PLAN.md until the named validation commands pass.
- Done condition: All PLAN.md tasks are implemented, `pnpm test` passes, and `pnpm build` succeeds.
- Verification: Surface changed files, the test/build commands, and their exit status.
- Constraints: Stay within PLAN.md scope; do not push or commit unless asked.
- Checkpoints: Report after each PLAN.md milestone.
- Stop or ask when: PLAN.md is ambiguous, validation needs unavailable credentials, or a destructive action is required.
- Prompt: none
- Next: create goal
```

Call `get_goal` first when available; with no active goal, call `create_goal` with the objective. Do not add a token budget unless the user asked for one.

## Codex tooling: explicit set-now

User: "Set a goal to finish PLAN.md and keep going until validation passes."

Same action; here the user also asked explicitly.

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

## Codex tooling: safety gate holds (auth)

User: "Migrate our auth module from server sessions to JWT across the Node backend. Set this up to run to completion."

High fit and tooling is available, but auth work trips the safety gate, so do not auto-create the goal — ask first.

```text
Goal Gate
- Decision: suggest
- Runtime: codex-tooling
- Goal fit: high
- Objective: Migrate auth from server sessions to JWT while preserving behavior.
- Done condition: Migration complete, auth tests pass, and no unrelated files change.
- Verification: Surface git diff summary plus the exact auth test command and passing output.
- Constraints: Auth-sensitive change — keep scope tight; do not weaken token validation or session handling without review.
- Checkpoints: Report after each migration slice.
- Stop or ask when: Auth behavior would change in a way that needs review, or tests fail for an unclear reason.
- Prompt: none
- Next: ask approval
```

Auth, billing, production-data, schema, and other irreversible work stays behind explicit approval even at high fit. Do not call `create_goal` until the user approves.

## Codex tooling: active goal already present

User: "Set a new goal for this refactor."

`get_goal` shows another goal is active.

```text
Goal Gate
- Decision: defer
- Runtime: codex-tooling
- Goal fit: high
- Objective: Refactor the requested module while preserving behavior.
- Done condition: Refactor complete and validation passes.
- Verification: Surface active goal status, the proposed objective, and validation output once approved.
- Constraints: Do not replace or mutate the active goal without user approval.
- Checkpoints: n/a
- Stop or ask when: A goal is already active.
- Prompt: none
- Next: ask approval
```

Ask whether to continue, complete, block, clear, or replace the active goal before any goal mutation.

## Claude Code slash: auto-adopt

User: "I'm in Claude Code. Implement docs/PLAN.md and keep going until `pnpm test` passes and the app builds. I'm stepping away — finish it and show me the evidence."

High fit, gate clear, but Claude Code has no goal API. So adopt the contract and keep working, and also hand back a `/goal` prompt for reuse.

```text
Goal Gate
- Decision: set-now
- Runtime: claude-code-slash
- Goal fit: high
- Objective: Implement docs/PLAN.md.
- Done condition: All acceptance criteria hold, the app builds, and `pnpm test` passes.
- Verification: Surface acceptance-criteria mapping, test/build commands, exit codes, and screenshots if UI changed.
- Constraints: Follow the plan; do not broaden scope; do not push.
- Checkpoints: Report after each acceptance-criteria group.
- Stop or ask when: The plan conflicts with code reality, a destructive operation is needed, or verification cannot run.
- Prompt: /goal Implement docs/PLAN.md without stopping until every acceptance criterion is satisfied, the app builds, and `pnpm test` passes. After each checkpoint, report what changed, what evidence was produced, and what remains. Stop and ask if the plan conflicts with the code, verification is blocked, or a destructive action would be required.
- Next: adopt goal and continue
```

Claude Code goal evaluators judge from surfaced conversation evidence, so the agent must print the commands and results it wants evaluated as it works.

## Claude Code slash: prompt only (user wants to review)

User: "Generate a Claude Code /goal prompt for implementing docs/design.md. I want to review it before running."

The user asked to review first, so hand back the prompt instead of adopting it.

```text
Goal Gate
- Decision: suggest
- Runtime: claude-code-slash
- Goal fit: high
- Objective: Implement docs/design.md.
- Done condition: All acceptance criteria hold, the app builds, and the specified tests pass.
- Verification: Surface acceptance-criteria mapping, test/build commands, exit codes, and screenshots if UI changed.
- Constraints: Follow the design doc; do not broaden scope; do not push.
- Checkpoints: Report after each acceptance-criteria group.
- Stop or ask when: The doc conflicts with code, a destructive operation is needed, or verification cannot run.
- Prompt: /goal Implement docs/design.md without stopping until every acceptance criterion is satisfied, the app builds, and the tests pass. After each checkpoint, report what changed, what evidence was produced, what remains, and whether the done condition is met. Stop and ask if the doc conflicts with the code, verification is blocked, or a destructive action would be required.
- Next: provide prompt
```

## Codex slash: prompt for reuse

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

The user asked for a prompt to copy, so this stays `suggest` even at high fit.

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

Capabilities are uncertain, so do not auto-execute even if fit were high.

## Workflow gate already ran

Existing block says `Route: Full`, `scope=multi-module`, `user-intent=implement`, and `get_goal` shows no active goal.

`Route: Full` is a strong goal-fit signal; with the safety gate clear, auto-set.

```text
Goal Gate
- Decision: set-now
- Runtime: codex-tooling
- Goal fit: high
- Objective: Complete the multi-module implementation selected by workflow-gate.
- Done condition: All planned modules are implemented and their validation commands pass.
- Verification: Surface per-module validation output and final git diff summary.
- Constraints: Preserve the workflow-gate route; do not broaden scope beyond the plan.
- Checkpoints: Report after each module or bounded context.
- Stop or ask when: The plan proves wrong, modules conflict, or validation is blocked.
- Prompt: none
- Next: create goal
```

`workflow-gate` is a signal, not a prerequisite. Do not rerun it unless the user is asking for route selection rather than goal selection.
