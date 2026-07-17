# Goal Gate Examples

These examples assume the auto-set rule: when the safety gate is clear and goal fit is high, `set-now` fires without asking. Medium fit stays on `suggest`; a tripped safety gate drops to `suggest` or `defer`.

## Grok tooling: auto set-now (wait for user /goal)

User: "I'm in Grok Build. The session has `update_goal`. No goal is active. Work through PLAN.md and don't stop until `pnpm test` passes and `pnpm build` succeeds."

High fit, gate clear. Grok has no `create_goal` — durable mode is inactive until the user pastes `/goal`. Emit the contract + copy-ready slash command, set `Next: wait for user /goal`, and **stop**. Do not start PLAN.md work and do not call `update_goal` yet.

```text
Goal Gate
- Decision: set-now
- Runtime: grok-tooling
- Goal fit: high
- Objective: Implement every task in PLAN.md until the named validation commands pass.
- Done condition: All PLAN.md tasks are implemented, `pnpm test` passes, and `pnpm build` succeeds.
- Verification: Surface changed files, the test/build commands, and their exit status.
- Constraints: Stay within PLAN.md scope; do not push or commit unless asked.
- Execution strategy: Before implementation, assess plan-task independence, shared context, write overlap, and separate verification; use subagents only when beneficial and keep final integration with the main agent.
- Checkpoints: After goal is Active, report after each PLAN.md milestone via `update_goal` message.
- Stop or ask when: PLAN.md is ambiguous, validation needs unavailable credentials, or a destructive action is required.
- Prompt: see Recommended /goal below
- Next: wait for user /goal
```

```text
/goal Implement every task in PLAN.md without stopping until pnpm test passes and pnpm build succeeds. Execution strategy: assess dependencies, shared context, write overlap, and independent verification before using subagents; keep final integration with the main agent. Surface each checkpoint with commands and exit codes. Pause for credentials, production data, or destructive actions.
```

One-line truth for the user: `/goal-gate` drafted this contract; paste the `/goal` line above (or say "soft only / no native goal") to continue. Do not call `create_goal` or `get_goal`. After the user activates, work under Active goal and call `update_goal` with checkpoint `message` values; call `completed: true` only after verification evidence proves the done condition; call `blocked_reason` only when genuinely stuck.

## Grok tooling: set-now after user activates /goal

User follows the previous turn by pasting the recommended `/goal …` (or `/goal status` shows Active).

Now work the contract. Checkpoints use `update_goal` messages; completion uses `completed: true` only with surfaced evidence. If `update_goal` returns `Goal is not Active`, stop and re-request `/goal` activation — do not retry complete.

## Grok tooling: soft-adopt exception (user declines native goal)

User: "I'm in Grok. Just do PLAN.md until tests pass — no /goal, soft only."

```text
Goal Gate
- Decision: set-now
- Runtime: grok-tooling
- Goal fit: high
- Objective: Implement every task in PLAN.md until the named validation commands pass.
- Done condition: All PLAN.md tasks are implemented, `pnpm test` passes, and `pnpm build` succeeds.
- Verification: Surface changed files, the test/build commands, and their exit status.
- Constraints: Stay within PLAN.md scope; soft-adopt only — no durable Grok goal.
- Execution strategy: Assess plan-task independence before subagents; main agent keeps final integration.
- Checkpoints: Report in transcript only (no update_goal while inactive).
- Stop or ask when: PLAN.md is ambiguous or a destructive action is required.
- Prompt: none (user declined durable /goal)
- Next: adopt goal and continue
```

Never call `update_goal` while inactive, even on soft-adopt.

## Grok slash: copy-ready Chinese prompt

User: "帮我写一个 Grok /goal，我想做一个本地待办 App，先给能直接复制的版本。"

```text
Goal Gate
- Decision: suggest
- Runtime: grok-slash
- Goal fit: high
- Objective: Build a first-version local personal todo app MVP.
- Done condition: The local app runs and the core add/list/complete todo workflow is proven with runtime evidence.
- Verification: Surface project commands, local run output, and browser evidence for the workflow.
- Constraints: No accounts, paid services, production deploy, or cloud sync.
- Execution strategy: Assess decomposability before implementation; keep final integration with the main agent.
- Checkpoints: Report after inspection, first runnable workflow, and final verification.
- Stop or ask when: Credentials, deployment, or product-scope decisions are required.
- Prompt: see Recommended /goal below
- Next: provide prompt
```

```text
推荐执行版（中文，可直接复制）
/goal 创建第一版本地待办 App MVP；先读取项目已有命令和约束，若无现有项目则创建最小本地 Web 应用，实现添加、列表、完成/取消完成待办的核心流程。
验证：运行项目最小相关检查，启动本地应用，在浏览器走通新增、列表、完成待办，并用命令输出或截图作为证据。
约束：不接入账号、云同步、付费服务或生产部署。
边界：只写入新项目目录，或只修改与待办核心流程直接相关的文件。
执行编排：开始前评估依赖、共享上下文、写入冲突与独立验证能力再决定是否用 subagent；主 agent 负责最终集成验证。
迭代策略：先做可运行核心流程，最多 3 轮聚焦改进。
完成条件：本地核心待办流程可运行且验证证据已展示。
暂停条件：需要凭证、付费、生产部署或产品范围决策时暂停。

默认选择理由：本地 MVP 最快验证核心流程，并避开账号与云端风险。
```

Note: `/goal` in Grok is available when the goal feature is enabled and `update_goal` is in the toolset. Management: `/goal status` | `pause` | `resume` | `clear`.

## Grok tooling: active goal already present

User: "I'm in Grok. A goal is already active for the search-indexing refactor. Set a new goal to finish the pagination rewrite."

```text
Goal Gate
- Decision: defer
- Runtime: grok-tooling
- Goal fit: high
- Objective: Finish the pagination rewrite with validation evidence.
- Done condition: Pagination rewrite complete and agreed checks pass.
- Verification: Surface active-goal status, proposed objective, and validation output once approved.
- Constraints: Do not clear, complete, or replace the active goal without user approval.
- Execution strategy: n/a until the active-goal decision is resolved.
- Checkpoints: n/a
- Stop or ask when: A goal is already active.
- Prompt: none
- Next: ask approval
```

Ask whether to continue the active goal, mark it complete via `update_goal` only if truly done, `/goal pause|resume|clear`, or replace after clear. Do not call `update_goal(completed=true)` on the wrong objective.

## Codex slash: vague Chinese app prompt

User: "帮我写一个 Codex /goal，我想做一个本地记账 App，先给能直接复制的版本。"

The user wants a prompt, not immediate execution. Use conservative defaults and make the first `/goal` copy-ready.

```text
Goal Gate
- Decision: suggest
- Runtime: codex-slash
- Goal fit: high
- Objective: Build a first-version local personal budgeting app MVP.
- Done condition: The local app runs and the core add/view/edit transaction workflow is proven with runtime evidence.
- Verification: Surface discovered project commands, local run output, screenshots or browser evidence for the workflow, and any skipped checks.
- Constraints: No account system, paid services, production deployment, bank integration, or real financial advice.
- Execution strategy: Assess decomposability before implementation; delegate only bounded, independently verifiable work and keep final integration with the main agent.
- Checkpoints: Report after project inspection, first runnable workflow, and final verification.
- Stop or ask when: Credentials, bank APIs, deployment, regulated financial advice, or unclear data ownership is required.
- Prompt: see Recommended /goal below
- Next: provide prompt
```

```text
推荐执行版（中文，可直接复制）
/goal 创建第一版本地个人记账 App MVP，先读取项目已有命令和约束；如果没有现有项目，就创建最小本地 Web 应用，实现添加、查看、编辑和删除一笔收支记录的核心流程。
验证：运行项目提供的最小相关检查，启动本地应用，在浏览器中完整走通新增、查看、编辑、删除收支记录流程，并用命令输出、日志或截图作为证据。
约束：不接入真实银行、支付、账号系统、云同步、生产部署或金融建议；不保存真实敏感财务数据。
边界：只写入新项目目录，或只修改现有项目中与记账核心流程直接相关的文件。
执行编排：开始实现前结合任务复杂度、依赖、共享上下文、写入冲突和独立验证能力判断是否使用 subagent；主 agent 负责审查结果和最终集成验证，不适合或不支持时退化为单 agent。
迭代策略：先做可运行核心流程，再根据检查结果和浏览器证据做最多 3 轮聚焦改进；同一错误连续失败 2 次后换日志、控制台或文档证据来源。
完成条件：本地核心记账流程可运行，验证证据已展示，检查通过或缺失配置已明确说明。
暂停条件：需要真实银行接口、账号凭证、付费服务、生产部署、法律/金融判断、敏感真实数据或产品范围决策时暂停。

默认选择理由：先做本地 MVP 能最快验证核心记账流程，同时避开账号、银行接口和生产数据风险。
```

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
- Execution strategy: Before implementation, assess plan-task independence, shared context, write overlap, and separate verification; use installed subagent orchestration only when it helps, with the main agent retaining final integration responsibility.
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
- Execution strategy: Assess single-agent versus delegated execution from plan dependencies and write boundaries; parallelize only independent non-conflicting tasks and keep final verification with the main agent.
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
- Execution strategy: Decide only after approval; keep security-sensitive integration under main-agent control and delegate only bounded work that inherits all auth constraints and receives independent review.
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
- Execution strategy: n/a until the active-goal decision is resolved.
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
- Execution strategy: Assess plan-task independence before implementation; use subagents only for bounded independently verifiable tasks, and keep review, conflict resolution, and final integration verification with the main agent.
- Checkpoints: Report after each acceptance-criteria group.
- Stop or ask when: The plan conflicts with code reality, a destructive operation is needed, or verification cannot run.
- Prompt: /goal Implement docs/PLAN.md without stopping until every acceptance criterion is satisfied, the app builds, and `pnpm test` passes. Execution strategy: Before implementation, assess dependencies, shared context, write overlap, and independent verification to decide whether subagents help; keep final integration responsibility with the main agent and fall back to one agent when needed. After each checkpoint, report what changed, what evidence was produced, and what remains. Stop and ask if the plan conflicts with the code, verification is blocked, or a destructive action would be required.
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
- Execution strategy: Assess whether the plan contains bounded independently verifiable tasks; delegate only when useful and keep the main agent responsible for synthesis and final verification.
- Checkpoints: Report after each acceptance-criteria group.
- Stop or ask when: The doc conflicts with code, a destructive operation is needed, or verification cannot run.
- Prompt: /goal Implement docs/design.md without stopping until every acceptance criterion is satisfied, the app builds, and the tests pass. Execution strategy: Before implementation, assess dependencies, shared context, write overlap, and independent verification to decide whether subagents help; keep the main agent responsible for synthesis and final verification. After each checkpoint, report what changed, what evidence was produced, what remains, and whether the done condition is met. Stop and ask if the doc conflicts with the code, verification is blocked, or a destructive action would be required.
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
- Execution strategy: Delegate independent eval analysis only when it reduces context pressure; keep prompt edits serialized and final score/diff verification with the main agent.
- Checkpoints: Report after each eval run.
- Stop or ask when: The target cannot be reached without changing policy, product behavior, or eval fixtures.
- Prompt: /goal Optimize the prompts in [prompt file or directory] until [eval command] reaches [target score]. Execution strategy: Delegate only independent read-only eval analysis that reduces context pressure; serialize prompt edits and keep final score/diff verification with the main agent. After each change, run the eval, inspect failing cases, keep edits minimal, and surface scores and diffs. Stop when the target is met or when further changes require product or policy guidance.
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
- Execution strategy: Assess delegation only if the runtime supports it; otherwise use one agent, and in all cases keep scope review and final behavior-parity verification with the main agent.
- Checkpoints: Report after each logical slice.
- Stop or ask when: The runtime lacks required tools, validation is unavailable, or scope expands.
- Prompt: Complete the refactor until the agreed validation signal passes. Execution strategy: Assess whether delegation helps only when the runtime supports it; otherwise use one agent, while keeping final scope and behavior-parity verification with the main agent. Keep changes scoped, surface each verification result, and stop for ambiguity, unavailable tools, or scope expansion.
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
- Execution strategy: Assess bounded-context independence, dependency order, shared state, and write overlap; delegate or parallelize only non-conflicting work and keep aggregate verification with the main agent.
- Checkpoints: Report after each module or bounded context.
- Stop or ask when: The plan proves wrong, modules conflict, or validation is blocked.
- Prompt: none
- Next: create goal
```

`workflow-gate` is a signal, not a prerequisite. Do not rerun it unless the user is asking for route selection rather than goal selection.
