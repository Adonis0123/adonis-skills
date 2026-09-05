---
name: discuss-before-plan
description: "Resolve a bounded design choice before planning. Use when the user presents named alternatives, a proposal with an implicit status-quo alternative, or delegates a decision and asks to compare, recommend, or decide. Do not use for open-ended option generation, a fully specified implementation, or a ready spec that only needs task planning."
metadata:
  author: adonis
  version: "2.5.1"
---

# Discuss Before Plan

Converge on a bounded choice, record it, then plan only when requested. This skill narrows; it does not turn a decision into an open-ended interview.

<HARD-GATE>
- Do not plan or implement while a blocking decision is open.
- If a new decision appears during Planning, stop and return to Deliberation.
- A Decision Summary in chat is enough to lock a choice; a file is optional.
- “You decide” delegates a choice, not authorization for destructive, production, auth, billing, external-message, or otherwise hard-to-reverse action.
- A design-only choice about a future sensitive or hard-to-reverse action may converge here. Its Summary must state that implementation is not authorized and requires a fresh safety gate.
</HARD-GATE>

## Route First

First match wins:

1. **Safety hold** — this turn would execute a sensitive or hard-to-reverse action, directly authorize its execution, or make an external commitment. Ask the single blocking authorization question or defer. Do not mark the action `agent-committed`. A design-only comparison of future destructive options is not a hold: converge without executing, and record the required implementation re-gate in the Summary.
2. **Skip** — the interface and behavior are already specified, or this is typo / formatting / mechanical execution with no remaining choice. Do the work; do not manufacture a Decision Summary.
3. **Redirect widening** — the user wants to expand the option space, generate alternatives, or has no shortlist / thesis. Point to Challenge (`grilling`) and stop. “First principles” alone is an analysis method, not proof that widening is needed.
4. **Already locked** — skip Deliberation. If the user wants to pressure-test the locked thesis, hand off to `grilling`. For a requested Spec/ADR, use [references/doc-conventions.md](references/doc-conventions.md). For an implementation plan, hand off to `writing-plans`; do not maintain a second planning contract here.
5. **Decide now** — the choice is bounded and the user delegates it, or it is a reversible implementation detail inside already authorized work with no product preference. Use the fast path below. An explicit request to confirm a choice keeps it user-owned.
6. **Deliberate** — the user wants to participate in the bounded choice. Choose light or standard mode below.

A proposal may have an implicit alternative: “replace polling with WebSocket” means “replace it or keep the current mechanism”. Treating that pair as bounded convergence is not widening. Do not invent a third provider or architecture merely to appear thorough.

## Decide-now Fast Path

Gather the cheapest code, configuration, doc, or history evidence that could overturn the recommendation, then stop searching. Do not ask the user for facts you can inspect. If facts remain unavailable, state the decision-relevant assumptions instead of adding a confirmation round.

In one turn:

1. Pick one option and give the decisive reason plus the rejected alternative.
2. Emit a Decision Summary with `commitment: agent-committed`.
3. Skip the persist question and second confirmation. Default to chat-only.
4. If the user also requested a plan, hand the locked Summary to `writing-plans` without a persistence or confirmation round. If implementation was already requested, continue it after locking the choice; otherwise stop after the decision.

Write a file only when the user requested one or repository rules require it.

## Deliberation

Use **light mode** for one local decision with two alternatives (including proposal vs status quo), small impact, and no architecture-level consequence. Recommend one option and explain the rejected alternative. Ask one confirmation question only for a user-owned choice; lock an ordinary agent-owned default with its evidence and continue the authorized work. Aim to finish in 1–2 rounds.

Use **standard mode** for multiple dependent decisions, three or more credible alternatives, cross-module/public-interface impact, or architecture-level consequence. Ask the current independent frontier together, capped at three questions per round; defer questions that depend on answers in the same round.

### 1. Establish the decision

Inspect relevant code, configuration, docs, and history. Keep these distinct:

- **Confirmed facts** — directly observed
- **Assumptions** — inferred and still falsifiable
- **Open decisions** — require a choice, not more lookup

Classify each unresolved item before asking:

- **Fact** — inspect it locally or through an appropriate read-only source.
- **Agent decision** — choose a reversible, low-risk implementation default when the user delegated the decision or no product preference is involved.
- **User decision** — ask only for safety/external-side-effect authorization, a hard-to-reverse choice with substantive tradeoffs, product/taste preference, or a fact only the user can provide.

Ask the current user-owned frontier, not every open detail. Pair each question with a provisional recommendation and say which answer would overturn it; a question-only turn needlessly returns the whole decision burden. If a missing fact makes any recommendation irresponsible, say that explicitly instead of guessing.

### 2. Compare one decision

Lead with judgment:

1. recommendation and decisive evidence;
2. strongest rejected alternative and its tradeoff;
3. impact on complexity, modules, tests, and rollback;
4. what is explicitly not needed now;
5. one confirmation question only if a user-owned decision remains.

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

Also record **Non-goals** and any **Open items**. A row belongs in the table when the user confirmed or delegated it, or when it is an evidence-backed reversible implementation default within authorized work. Label the latter `agent-committed`; never use that label to settle a product preference or grant action authorization. Do not hide an open item in a confirmed row.

For user-confirmed deliberation, walk the Summary once. For Decide-now or an agent-owned implementation default, emit it and continue the requested work without re-asking.

## Persistence

The in-chat Summary is the default commitment for this session. A Spec / Decision Record is optional persistence, not a planning prerequisite.

- Persist only when the user asks, repository rules require it, or cross-session handoff makes a durable record materially necessary. In the last case, recommend it once without blocking an already requested plan.
- Otherwise default to chat-only and do not ask.
- If persistence is requested or required, read [references/doc-conventions.md](references/doc-conventions.md), resolve the repository profile, and write there. Do not duplicate its templates here.

## Planning handoff

Planning begins only after a Decision Summary exists.

- If the user requested a plan, load `writing-plans` with the locked Summary and continue without another confirmation. If it is unavailable or not callable, report `MISSING_DEPENDENCIES`; do not imitate a second plan format.
- If the user requested only a decision, stop after the Summary. Ask whether to plan only when the next action is genuinely unclear.
- `writing-plans` owns task structure, documentation placement, execution waves, and verification. A new blocking what/why decision returns here for Deliberation.

## Stop Conditions

Stop immediately when one of these is true:

- the route is Redirect widening or Safety hold (Skip exits this skill and continues the specified work);
- one blocking question is waiting on the user;
- the user requested only a decision and the Summary is complete;
- the requested planning handoff is complete and introduces no new decision.

Do not add another confirmation, persistence prompt, phase recap, or option after the applicable stop condition.
