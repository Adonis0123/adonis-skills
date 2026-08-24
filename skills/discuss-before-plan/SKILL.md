---
name: discuss-before-plan
description: "Resolve a bounded design choice before planning. Use when the user presents alternatives, or a proposal with an implicit status-quo alternative, and asks to compare, recommend, or decide. Also use when they delegate the choice. Redirect open-ended option generation to grilling; skip fully specified execution. Safety-sensitive or irreversible choices still require explicit authorization."
metadata:
  author: adonis
  version: "2.3.0"
---

# Discuss Before Plan

Converge on a bounded choice, record it, then plan only when requested. This skill narrows; it does not turn a decision into an open-ended interview.

<HARD-GATE>
- Do not plan or implement while a blocking decision is open.
- If a new decision appears during Planning, stop and return to Deliberation.
- A Decision Summary in chat is enough to lock a choice; a file is optional.
- “You decide” delegates a choice, not authorization for destructive, production, auth, billing, external-message, or otherwise hard-to-reverse action.
</HARD-GATE>

## Route First

First match wins:

1. **Safety hold** — the requested choice would authorize a sensitive or hard-to-reverse action. Ask the single blocking authorization question or defer. Do not mark the action `agent-committed`.
2. **Skip** — the interface and behavior are already specified, or this is typo / formatting / mechanical execution with no remaining choice. Do the work; do not manufacture a Decision Summary.
3. **Redirect widening** — the user wants first-principles exploration, alternative generation, or says there is no shortlist / preferred approach. Point to Challenge (`grilling`) and stop. Do not impersonate its interview.
4. **Persist only** — the choice is already locked and the user asks for a spec, ADR, or plan file. Skip Deliberation and use [references/doc-conventions.md](references/doc-conventions.md).
5. **Decide now** — the choice is bounded and the user says “you decide”, “don't ask”, or equivalent. Use the fast path below.
6. **Deliberate** — the user wants to participate in the bounded choice. Choose light or standard mode below.

A proposal may have an implicit alternative: “replace polling with WebSocket” means “replace it or keep the current mechanism”. Treating that pair as bounded convergence is not widening. Do not invent a third provider or architecture merely to appear thorough.

## Decide-now Fast Path

Gather cheap facts from code, configuration, and docs when they could change the recommendation. Do not ask the user for facts you can inspect. If facts remain unavailable, state the decision-relevant assumptions instead of adding a confirmation round.

In one turn:

1. Pick one option and give the decisive reason plus the rejected alternative.
2. Emit a Decision Summary with `commitment: agent-committed`.
3. Skip the persist question and second confirmation. Default to chat-only.
4. If the user also requested a plan, write it against the Summary. Otherwise stop after the decision.

Write a file only when the user requested one or repository rules require it.

## Deliberation

Use **light mode** for one local decision with two alternatives (including proposal vs status quo), small impact, and no architecture-level consequence. Recommend one option, explain the rejected alternative, then ask one confirmation question. Aim to finish in 1–2 rounds.

Use **standard mode** for multiple dependent decisions, three or more credible alternatives, cross-module/public-interface impact, or architecture-level consequence.

### 1. Establish the decision

Inspect relevant code, configuration, docs, and history. Keep these distinct:

- **Confirmed facts** — directly observed
- **Assumptions** — inferred and still falsifiable
- **Open decisions** — require a choice, not more lookup

Ask only the unresolved question that most changes downstream choices. Do not ask the user for discoverable facts. Pair the question with a provisional recommendation and say which answer would overturn it; a question-only turn needlessly returns the whole decision burden. If the missing fact makes any recommendation irresponsible, say that explicitly instead of guessing.

### 2. Compare one decision

Lead with judgment:

1. recommendation and decisive evidence;
2. strongest rejected alternative and its tradeoff;
3. impact on complexity, modules, tests, and rollback;
4. what is explicitly not needed now;
5. one confirmation question.

If an option has a fatal failure mode, say so instead of preserving artificial neutrality.

### 3. Lock the choice

When no blocking item remains, emit the first formal artifact:

```text
Decision Summary
commitment: user-confirmed | agent-committed
```

| Decision   | Choice   | Decisive reason | Rejected alternative |
| ---------- | -------- | --------------- | -------------------- |
| [question] | [choice] | [reason]        | [alternative]        |

Also record **Non-goals** and any **Open items**. A row belongs in the table only when the user confirmed it or explicitly delegated the choice. Do not hide an open item in a confirmed row.

For user-confirmed deliberation, walk the Summary once. For Decide-now, emit it and continue without re-asking.

## Persistence

The in-chat Summary is the commitment for this session. A Spec / Decision Record preserves it across sessions.

- If the user did not waive questions, ask once whether to persist before Planning; do not repeatedly chase an unanswered preference.
- If they waived, default to chat-only and do not ask.
- If persistence is requested or required, read [references/doc-conventions.md](references/doc-conventions.md), resolve the repository profile, and write there. Do not duplicate its templates here.

## Planning

Planning begins only after a Decision Summary exists.

- If the user already requested a plan, write it; otherwise ask whether to proceed.
- Each task names affected files, executable steps, and verification.
- Tasks reference locked choices and introduce no new what/why decisions.
- If a new blocking decision surfaces, stop Planning and return to Deliberation.
- Resolve the documentation profile only when the plan must be written to disk.

## Stop Conditions

Stop immediately when one of these is true:

- the route is Skip, Redirect widening, or Safety hold;
- one blocking question is waiting on the user;
- the user requested only a decision and the Summary is complete;
- the requested plan is complete and introduces no new decision.

Do not add another confirmation, persistence prompt, phase recap, or option after the applicable stop condition.
