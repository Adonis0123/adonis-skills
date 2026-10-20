---
name: goal-gate
description: "Gate whether a coding-agent task benefits from a durable, verifiable contract, then draft, validate, start, continue, or close it for Codex, Grok, Claude Code, Cursor CLI, or an unknown host. Use for explicit goal or /goal requests and autonomous multi-checkpoint coding work with one checkable end state. Native Goal creation or mutation requires an explicit user or system request. Do not use for quick one-shot work, unrelated backlogs, OKRs, reminders, or token-budget-only changes."
metadata:
  author: adonis
  version: "2.3.0"
---

# Goal Gate

`/goal-gate` drafts and gates durable goal contracts; it doesn't activate product Goal mode itself — only a host's verified facility can. The value is a checkable "done": most real use is "plan's agreed, start now, verify yourself", so the hot path is one honest block, start working, close with evidence — else it's ceremony. Independent from `workflow-gate`: consume a `Workflow Gate` block when present, don't require one.

## Fast Path

Read **this file only** by default; skip re-reading if the host already injected it. Load **at most one** reference, only when needed:

1. Detect runtime with the ordered rules below — explicit Cursor CLI intent wins over the model name.
2. Classify Goal Fit, then run the Safety Gate.
3. Check Goal authorization, pick one Decision, and emit one `Goal Gate` block per selected runtime.
4. If `set-now`, execute the runtime row; load `references/runtime-actions.md` only when the row isn't enough.
5. Load `references/copy-ready-goals.md` only for a user-copyable prompt, `references/examples.md` only for a worked example.

Do not invent goal APIs.

## Runtime Detection

Apply the first matching rule — this order resolves overlapping host/tool names:

1. `cursor-cli`: user names Cursor CLI/`cursor-agent`, or host is Cursor CLI — wins over a Grok/Claude model or ambient goal tools; no verified `/goal`/API, resume restores context only.
2. Prompt-only slash: user wants only text to copy/review → `grok-slash`/`codex-slash`/`claude-code-slash`; Grok with `update_goal` is still `grok-slash` here (no product action asked).
3. `codex-tooling`: `get_goal`/`create_goal` present, not prompt-only (status-only `update_goal` may coexist).
4. `grok-tooling`: only Grok-style `update_goal`, not prompt-only — only user-run `/goal` activates it.
5. Named host, no verified tooling → its slash runtime.
6. `unknown`: portable contract, never a command.

Never borrow one runtime's fields for another; multiple requested runtimes each get their own block.

## Goal Fit

Prefer a goal when: larger than one turn, one durable end state, verifiable from surfaced evidence, progress without steering, and statable stop/ask conditions.

Avoid a goal for lookups, typos, small edits, commit messages, unbounded exploration, an unresolved `grilling` (Route: Challenge) decision, a loose backlog, or anything the Safety Gate holds.

For vague low-risk work, prefer safe defaults over a clarification loop; ask only if the answer changes cost, risk, ownership, or write boundaries.

## Safety Gate

Before any automatic action, check conditions that must keep a human in the loop; if any holds, do not auto-set — emit `Decision: suggest` or `defer` and ask first, even at high goal fit.

- Destructive, irreversible, billing, auth, production-data, or schema-breaking action whose concrete scope isn't yet authorized. Check the action and existing approval, not domain keywords — read-only diagnosis and explicitly authorized isolated local tests can proceed. Prior approval covers only its stated paths, environment, and effects; a new production target, security change, or expanded effect needs its own gate.
- A goal is already active **and** the new objective conflicts with it, or the user hasn't chosen how to handle it. Never replace or mutate it silently — ask whether to continue, complete, block, pause, clear, or replace it (`Decision: defer`). Same-goal management covers an exact objective match, or a contained checkpoint whose parent Goal's frozen scope and Done condition already include it with the parent pipeline authorized. Verify containment from evidence; it never permits scope expansion or narrowing the parent's Done condition.
- The objective still needs a design/scoping decision that `grilling` (Route: Challenge) should resolve.
- Verification can't run, so completion could never be proven.

An auto-started goal hands the agent a long leash — safe only when the end state is reversible-or-approved, unambiguous, and checkable; when in doubt, `suggest`. High-risk work can still get a discovery-first or approval-first draft, but never as immediately executable for a production write, destructive migration, auth rewrite, billing change, or regulated-domain decision.

## Goal Authorization and Decision

Creating, replacing, completing, or blocking a native Goal is separate from doing the task — authorized only by an explicit ask to use/set/create/continue/complete/block a Goal, a `$goal-gate`/`/goal-gate` invocation, or a parent workflow whose contract owns a Goal. Large, autonomous, or high-fit work does **not** by itself authorize `create_goal`, `update_goal`, or a user-run `/goal` — fit isn't a second permission gate. When authorized but native state isn't, adopt the contract in the transcript and keep working without claiming Active (first two rows).

| Situation                                                                                | Decision             | Next                                                      |
| ---------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| High fit, native-capable runtime, no explicit Goal action                                | `suggest`            | `adopt goal and continue`; no native Goal mutation        |
| High fit, transcript-only runtime, no explicit Goal action                               | `set-now`            | `adopt goal and continue`; no product Goal claim          |
| Explicit Goal action, high fit, safety clear                                             | `set-now`            | Runtime row below                                         |
| Medium fit, safety clear                                                                 | `suggest`            | `provide prompt`; continue authorized task work           |
| Safety tripped (auth, destructive, production-data, irreversible, billing, unverifiable) | `suggest` or `defer` | `ask approval` (or `route elsewhere`); do not auto-create |
| Conflicting or unchosen active goal                                                      | `defer`              | Ask continue / complete / block / pause / clear / replace |
| Exact-same or compatible-contained continuation                                          | `set-now`            | `continue active goal`                                    |
| Same-goal proven complete or 3-turn persistent block                                     | `set-now`            | `report via update_goal`                                  |
| User asked only for text to copy or review                                               | `suggest`            | `provide prompt`                                          |
| Low fit (typo, one-shot, no durable end state)                                           | `none`               | `continue without goal`; Prompt `none`                    |
| User is asking which workflow/route to use                                               | `defer`              | `route elsewhere`                                         |
| Unresolved `Route: Challenge`                                                            | `defer` (fit `low`)  | Finish the thesis/spec first                              |
| Diagnose-only `Route: Architecture` without a goal request                               | `none` (fit `low`)   | Preserve stop-after-report                                |
| Runtime `unknown`                                                                        | do not auto-execute  | `ask approval`                                            |

A contained checkpoint reports progress but leaves completion to the parent owner; never complete or clear a goal merely to make replacement convenient.

### Runtime action on `set-now`

| Runtime                                      | Next                                                        | Do now                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `cursor-cli`                                 | `adopt goal and continue`; resume → `continue adopted goal` | Work in this chat; no `/goal`/API; report evidence in transcript.                                        |
| `grok-tooling` (not Active, explicit Goal)   | `wait for user /goal`                                       | Emit block + copy-ready `/goal`, then stop; no `update_goal` until Active.                               |
| `grok-tooling` (Active, same/contained)      | `continue active goal`                                      | Work the contract; checkpoint via `message`; `completed: true` only once Done is proven.                 |
| `grok-tooling` (Active, Done proven)         | `report via update_goal`                                    | `completed: true` + evidence `message`; never Codex `status`.                                            |
| `grok-slash`                                 | usually `provide prompt`                                    | Copy-ready `/goal`; soft-adopt only if execution is authorized too.                                      |
| `codex-tooling` (no active, explicit Goal)   | `create goal`                                               | `get_goal` then `create_goal`; no token budget unless asked.                                             |
| `codex-tooling` (same/contained, not done)   | `continue active goal`                                      | Keep working; no `create_goal`, replacement, or terminal `update_goal`.                                  |
| `codex-tooling` (Done proven / 3-turn block) | `report via update_goal`                                    | `status: "complete"` after evidence, or `"blocked"` after ≥3-turn persistent blocker; never Grok fields. |
| `claude-code-slash` / `codex-slash`          | `adopt goal and continue`                                   | Self-adopt and start now; `Prompt: none` unless asked; surface verification in transcript.               |
| `unknown`                                    | `ask approval`                                              | Portable contract only.                                                                                  |

Exceptions (soft-adopt opt-outs, `Goal is not Active` recovery, Ask/Plan limits, Claude's standalone-condition rule) live in `references/runtime-actions.md`.

## Goal Drafting

A contract is only as good as its Done condition — write it so the user could check it without asking what you meant.

- **Anchor on the user's source**: point Objective/Done at any named plan, spec, PRD, TAPD item, or Figma node and its acceptance items; name an excluded/reinterpreted item on `Stop or ask when`/Constraints — silent narrowing is what later turns "done" into "你没按文档做".
- **Verify on the acceptance path**: if the user will judge it in a page, device, design, or command, Verification exercises that path per item — tests/typecheck aren't sufficient alone.
- **No unrequested delivery**: commit/push/MR/deploy/messaging go into Done/Checkpoints only if asked; otherwise changes stay in the working tree.
- **Execution strategy** follows dependency order, shared state, write overlap, and independent verification — never size alone; the main agent keeps review and final integration.

For unfamiliar domains, prefer discovery-first over inventing rules. `references/copy-ready-goals.md`: per-field craft, Chinese/English shapes, and the Quality Checks a copy-ready draft must pass.

## Output Contract

Emit this block once, then act:

```text
Goal Gate
- Decision: <none | suggest | set-now | defer>
- Runtime: <grok-tooling | grok-slash | codex-tooling | codex-slash | claude-code-slash | cursor-cli | unknown>
- Goal fit: <low | medium | high>
- Objective: <one durable objective or n/a>
- Done condition: <verifiable stopping condition or n/a>
- Verification: <commands/artifacts/evidence to surface or n/a>
- Constraints: <scope/safety/must-not-change limits or n/a>
- Execution strategy: <single-agent/delegated/parallel + why, or n/a>
- Checkpoints: <progress reporting cadence or n/a>
- Stop or ask when: <blocked/risky/ambiguous/destructive/budget condition or n/a>
- Prompt: <runtime-specific goal prompt, "see Recommended /goal below", or none>
- Next: <create goal | continue active goal | wait for user /goal | adopt goal and continue | continue adopted goal | report via update_goal | provide prompt | ask approval | continue without goal | route elsewhere>
```

Keep it concise; a longer prompt gets `Prompt: see Recommended /goal below` under the block — on Grok's `wait for user /goal` it comes first, then stop.

Chinese-first copy-ready prompts include `推荐执行版（中文，可直接复制）`, `默认选择理由` (when defaulting), and an `执行编排：` / `Execution strategy:` line; see `references/copy-ready-goals.md` for full templates.

## Closing an adopted contract

The final report is where false completion happens: map each Done item to surfaced evidence (command+result, screenshot, Figma comparison), marking anything unexercised `UNVERIFIED` with a reason — say "done" only when every item has evidence. A native Goal completes only through its runtime row.

Unattended runs: `references/runtime-actions.md` covers continuation discipline — why a text-only turn isn't proof of done, how many auto-continuations to allow, and which stops are blocked vs owed.

## Workflow-Gate Relationship

A `Workflow Gate` block is a Goal Fit signal, not a second decision table: implement/harden `Route: Architecture` (`architecture-hardening-loop`), long `Light`+`systematic-debugging`, and broad `verification-before-completion` raise fit; `Route: Direct`, small `Light`, and `Review-Handoff` lower it unless the user wants a goal. Unresolved `Route: Challenge` and diagnose-only `Architecture` already have rows above. Never rewrite the route; a routing question is `Decision: defer`, `Next: route elsewhere`.
