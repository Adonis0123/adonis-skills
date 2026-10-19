# Agent Dispatch

How one coordinating session splits a task across agent sessions and lets the user see where each part stands.

These terms are for agents, the ledger and the docs. With the user, speak plain words instead (任务, 外部等待, 问题, 账号额度); the _Avoid_ lists below apply to agent-facing text only.

## Language

**Run**:
One dispatch of a task: the set of Lanes started by one Coordinator decision.
_Avoid_: job, batch (a batch is a group of Lanes integrated together inside a Run)

**Lane**:
One independent piece of work inside a Run, with its own task, branch and worktree.
_Avoid_: task, part, slot

**Worker**:
A session (one product on one account) that carries out one Lane. A review is its own Lane that names the Lane it reviews.
_Avoid_: agent (too broad), peer

**Subagent**:
A child task spawned inside a session, shown under the session that spawned it.
_Avoid_: worker, teammate

**Coordinator**:
The single session that starts Lanes, integrates their results, decides and reports to the user.
_Avoid_: orchestrator, lead, host

**Board**:
The view of one Run that shows each Lane's Worker, state and current activity.
_Avoid_: dashboard, monitor, status page

**Wait**:
An outside process the Run is waiting on that has no Worker, such as a deploy, CI run, build or background shell.
_Avoid_: job, task, background thing

**Ask**:
One question waiting on the user, always with a recommended answer, the evidence behind it and what it blocks.
_Avoid_: confirmation, todo, pending item

**Standing Grant**:
A permission the user gave for repeated use ("以后都这样"), recorded with its exact scope; outward actions stay limited to the current Run.
_Avoid_: preference, default, blanket approval
