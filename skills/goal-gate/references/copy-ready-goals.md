# Copy-Ready Goal Drafting

Use this reference when `goal-gate` needs to produce a prompt the user may paste directly into Grok Build, Codex, Claude Code, or a compatible agent. The `/goal` body shape is shared; only the post-prompt runtime action differs (Grok: adopt + optional `update_goal` progress; Codex tooling: `create_goal`; Claude Code: adopt + transcript evidence).

## Default-First Strategy

If the user gives a vague but low-risk task, choose conservative defaults and state the assumption briefly.

Good defaults:

- New app/site/tool/game: local MVP first.
- Existing repo: inspect project scripts, docs, tests, and conventions before edits.
- No deployment request: local runtime verification only.
- No auth request: no login, accounts, backend auth, paid API, or cloud sync.
- No design-system request: follow the existing style; for a new project, choose a restrained usable UI.
- No known test command: discover package scripts, Makefile, CI config, or repo docs before inventing commands.
- No advanced scope request: implement the smallest complete user-visible workflow.

Ask choices only when the answer changes cost, risk, ownership, product direction, or write boundaries.

## Question Bank

Default-first is the norm. When a missing detail is genuinely high-risk or high-ambiguity and you must ask, pull from this bank by field instead of sending a generic form — a targeted question gets a fast answer, an open questionnaire stalls the user. Prefer numbered choices with a marked default (see `可选调整` below) over open prompts.

- Outcome: code, document, or running deployment? who consumes it? what counts as "complete enough"?
- Verification: which project commands/tests already exist? local-only or real-device/online check? full suite or scoped?
- Constraints: which behavior, API, or format must stay stable? what is off-limits (secrets, production data, default branch)?
- Boundaries: which directories may change? any path or artifact forbidden?
- Execution strategy: does the work contain self-contained, independently verifiable subtasks? would delegation reduce context pressure or wall-clock time without shared-state or write conflicts?
- Iteration: how many focused rounds before reporting? what to do on repeated failure?
- Stop / Pause: what evidence proves done? which steps need a human sign-off (auth, payment, production, destructive, regulated)?

If only low-risk details are missing, state an explicit assumption and proceed — do not block a copyable draft on a questionnaire.

## Chinese Copy-Ready Shape

Use `/goal` as the command prefix. The body may be Chinese.

```text
推荐执行版（中文，可直接复制）
/goal <一个具体结果，包含本地/现有项目/发现优先等关键假设。>
验证：<命令、日志、截图、文件、URL、API、浏览器/模拟器检查或产物证据。>
约束：<不能改变的行为、数据、安全边界、分支、外部服务、版权或合规边界。>
边界：<允许写入的目录/文件范围，以及禁止触碰的范围。>
执行编排：<开始实现前结合任务复杂度、依赖、共享上下文、写入冲突和独立验证能力判断是否使用 subagent；主 agent 保留整体责任，不支持或不适合时退化为单 agent。>
迭代策略：<每轮如何基于新证据改动；失败几次后换证据来源或暂停。>
完成条件：<什么证据证明可以停止。>
暂停条件：<凭证、付费、生产、破坏性、法律/医疗/金融、版权、所有权或反复阻塞。>

默认选择理由：<一句话说明为什么这个默认最安全或最快验证。>
```

Only add `可选调整` when useful:

```text
可选调整
1. 项目形态：A 新建本地 MVP（默认） / B 改现有项目 / C 先做原型
2. 范围：A 核心流程（默认） / B 加常见增强 / C 做完整产品
3. 验证：A 本地运行检查（默认） / B 真机或线上检查 / C 发布前检查

你可以直接回复：按默认，或回复类似 1B 2A 3C。
```

## English-Compatible Shape

Use this when the user writes in English, asks for portability, or wants a bilingual draft.

```text
/goal <one concrete outcome>.
Verification: <commands, logs, screenshots, files, URLs, API checks, browser/simulator checks, or artifacts>.
Constraints: <what must not change; safety and scope limits>.
Boundaries: <allowed writes and forbidden paths/systems>.
Execution strategy: <assess complexity, dependencies, shared context/state, write overlap, independent verification, coordination cost, and runtime support before choosing single-agent, delegated, or parallel execution; keep the main agent accountable and fall back to one agent when needed>.
Iteration policy: <bounded retries based on evidence>.
Stop when: <evidence proves the result or skipped checks are explicit>.
Pause if: <credentials, payment, production data, destructive actions, regulated judgment, copyright, ownership, or repeated blockers are required>.
```

## Unknown Domain Strategy

For unfamiliar, regulated, or specialized domains, make the goal discovery-first:

- Inspect authoritative workspace docs, sample data, existing scripts, official references, or project notes before implementation.
- State working assumptions after discovery.
- Do not invent compliance claims, data semantics, domain promises, diagnoses, financial advice, or legal interpretations.
- Pause before real user data, production data, regulated decisions, paid services, destructive changes, or external authorization.

## Per-Field Drafting Craft

Naming the fields is not enough; each one fails in a predictable way, so write each so the agent cannot drift:

- Outcome: state the end result, not the activity. "Add CSV export to the reports page" beats "work on CSV export" — a result has a truth value the agent can check against, an activity never finishes.
- Verification: name the exact checks the repo already exposes (a real test command, a specific URL, a screenshot of a named screen). Discover them before inventing; a made-up command that fails teaches the agent nothing. This field is the spine of the contract — if it cannot run, the goal can never prove done.
- Constraints: phrase as what must not change (behavior, public API, data, secrets, default branch), not as permissions granted. "Do not change the existing API response shape" is enforceable; "you may edit the API" invites scope creep.
- Boundaries: restrict the write surface — which dirs/files may change, which paths are forbidden. This is filesystem reach, kept separate from Constraints' behavioral reach. Narrow boundaries are the cheapest insurance against an agent editing the whole repo.
- Execution strategy: assess decomposability, not size alone. Delegate bounded self-contained work or high-volume read-only output; parallelize only independent tasks without shared mutable state, write conflicts, or sequential dependencies. Keep the main agent responsible for context handoff, review, conflict resolution, and final integration verification.
- Iteration policy: bound the retries and require a new source of evidence after repeated failure. "After 2 failures on the same error, read logs/console/docs before retrying, at most 3 focused rounds" converges where "keep trying until it works" spins forever.
- Done condition: define proof, never a feeling. "Tests pass and the workflow completes once with captured evidence" is checkable; "until it looks good" is not.
- Pause condition: list every point that needs human judgment or external authority — credentials, payments, production or real-user data, destructive actions, legal/medical/financial calls, copyrighted assets, unclear ownership, repeated blockers. A goal without pause conditions is a long leash with no collar.

## Quality Checks

Reject or revise a copy-ready goal when it:

- uses `/目标` instead of `/goal`;
- leaves placeholders such as `[path]`, `<file>`, `TODO`, `TBD`, `待补充`, or `待定`;
- says only `make it work`, `fix bugs`, `做得高级`, or `直到满意` as the done condition;
- lacks concrete verification evidence;
- lets the agent edit the whole repo or machine without reason;
- omits execution-strategy assessment or delegates solely because the task is large;
- lets subagents broaden scope, share conflicting writes, or declare the aggregate goal complete;
- asks for infinite retries without new evidence;
- has no pause condition for credentials, payments, production data, destructive actions, regulated judgment, copyrighted assets, unclear ownership, or repeated blockers.

Translate vague taste words into evidence instead of deleting them:

```text
设计方向：克制、专业、有留白。
验证：用桌面和移动端截图检查信息层级、可读性、核心入口、控件密度和布局重叠。
迭代策略：基于截图做最多 3 轮聚焦视觉改进，优先调整层级、间距、字体、素材处理和控件密度。
```
