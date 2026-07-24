# Auto Loop Contract (v2)

Authoritative machine + Reviewer contract for `review-loop run`.

## Topology

- Visible session = **Fixer** (sole worktree writer, sole packet writer, loop driver).
- **Reviewer** = headless product adapter (`codex` / `grok` / `claude`), read-only stdout only.
- Packet is the ledger; stages append at EOF via claim-free stage writer with content-hash guard.

## CLI

```text
review-loop run --repo <root> --reviewer codex|grok|claude [--base <sha>] [--rounds 3] [--packet <path>]
review-loop run --continue --repo <root> [--packet <path>] [--rounds N]
review-loop fix-completion --repo <root> --packet <path> --body-file <md>
review-loop close --repo <root> --packet <path> --reason accept-concerns
review-loop consult --repo <root> --peer codex|grok|claude --question-file <md>
```

Each Reviewer invocation has a 20-minute default deadline. Set
`REVIEW_LOOP_TIMEOUT_MS` to a positive finite millisecond value only when an
advanced runtime integration needs a different budget. The CLI writes an
immediate liveness line to stderr and repeats it every 30 seconds while the
Reviewer process remains alive; final stdout stays machine-readable JSON.

## Reviewer prompt obligations

### Round 1 — Review Findings

Must emit:

1. Markdown table columns: `ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check`
   (full header set required even for a single `(none)` row; ID-only stubs are malformed)
2. Severity tags: `[阻塞]` or `[非阻塞]`
3. Exactly one terminal Verdict: `PASS` | `PASS_WITH_CONCERNS` | `BLOCKED` | `NO_FINDINGS`
4. Do not put unescaped `|` inside table cells (TypeScript unions, shell pipes). Unescaped pipes cause fail-closed column-count rejection.

Rules:

- `BLOCKED` requires ≥1 blocking finding with falsifiable breakage.
- `PASS_WITH_CONCERNS` only when remaining items are all non-blocking.
- Style/taste is never blocking.

### Round ≥2 — Re-review

Must emit **all** of:

1. `## Prior Findings Reassessment` — table `ID | 状态(resolved|partially|unresolved) | 复核证据` covering every prior finding ID
2. `## New Findings` — same columns as round 1 (only load-bearing blockers allowed)
3. `## Regression Surface`
4. Terminal Verdict line (same vocabulary)

Missing any section (including Verdict) is **malformed**. Auto loop asks for one correction via resume; still malformed → stop, no half-write.

## Verdict lifecycle (auto path)

This table is the auto-loop source of truth (scripts enforce it). Do **not** apply the classic lifecycle table in `packet-addressing.md` to auto packets.

| Verdict                | lifecycle_state          | Typical `last_anchor`                                                   | Action                                                                                        |
| ---------------------- | ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `PASS` / `NO_FINDINGS` | `archived`               | `review_findings` or `re_review`                                        | Archive packet; terminal report                                                               |
| `PASS_WITH_CONCERNS`   | `awaiting_user_decision` | first round: `review_findings` (no Fix Handoff); re-review: `re_review` | Terminal report lists concerns; user `close --reason accept-concerns` **or** `run --continue` |
| `BLOCKED`              | `blocked`                | first round: `fix_handoff`; re-review: `re_review`                      | Return structured blockers; Fixer fixes + `fix-completion` + `run --continue`                 |

### Finding ledger (runtime `auto-run-state.json`)

**Anti-tamper (not crash-safe dual-write):** before the long Reviewer await, pin `roundStartPacketHash`. After Reviewer returns (and after one correction if any), current packet hash must still match that pin; then stage write uses the same `expectedHash`. External rewrite mid-await → `packet_hash_mismatch` (never re-baselines from post-await content).

**Crash / dual-write non-goals:** packet Markdown + `auto-run-state.json` are two files; mid-write process kill may leave them inconsistent. Next run fails closed (`PACKET_HASH_MISMATCH` or `STATE_RECOVERY_REQUIRED`). Leftover `pendingStage` from the removed journal auto-replays is **not** applied — explicit recovery or a new packet is required. Do not claim kill/power-loss exactly-once recovery without a real transactional store. Changes to these persistence or recovery **claims** are subject to the maintainer-only [protocol evolution gate](./protocol-evolution-gate.md) (not loaded on ordinary auto-loop runs).

**Legacy / stale ledger rebuild:** if `findingCatalog` is missing or inconsistent with packet review stages, replay `# Review Findings` + every `# Re-review` through the same parsers/ledger/verdict invariants. Unreadable stages → `STATE_MIGRATION_REQUIRED` (before Reviewer invoke). Markdown replay is migration only; normal `close` still reads structured ledger after reconcile.

After each successful Reviewer parse, the Fixer script persists:

| Field            | Meaning                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `findingCatalog` | Stable map `id → { severity, title, targetFiles, blocking, ... }`              |
| `openBlocking`   | IDs still open as blockers (recomputed from reassessment + catalog each round) |
| `openConcerns`   | IDs still open as non-blocking concerns                                        |

Re-review `PASS_WITH_CONCERNS` terminal `concerns` and `close` **must** read this ledger — not re-parse Markdown tables (New Findings is empty under valid PWC).

Verdict invariants (fail-closed before write):

- `PASS_WITH_CONCERNS` → `openBlocking=[]` and `openConcerns.length ≥ 1`
- `PASS` / `NO_FINDINGS` → both open sets empty
- `BLOCKED` → `openBlocking.length ≥ 1`

`parseReReview` prior-blocker gate uses **all historical blocking IDs in catalog**, not only the previous `openBlocking` set (so a re-opened blocker still fails PASS).

### Decision Closure (`close --reason accept-concerns`)

User-only terminal path when lifecycle is `awaiting_user_decision` after `PASS_WITH_CONCERNS`:

- Requires packet lock + content-hash guard (same as other auto stage writes).
- Reads `findingCatalog` + non-empty `openConcerns` from runtime state under the lock; missing/corrupt ledger → **fail closed** (no Markdown reverse-parse for re-review packets).
- Appends `# Decision Closure` with reason, original Verdict `PASS_WITH_CONCERNS`, accepted concern IDs, and timestamp.
- Sets `last_anchor=decision_closure`, `lifecycle_state=archived`, `mv` to `archive/` under the **packet_id slug** (no path rewrite).
- Does **not** rewrite the original Verdict to `PASS`, does **not** invent Fix Completion, and does **not** trigger re-review.
- Auto loop must never call `close` by itself.

## Convergence rules (8+1)

1. Round budget default 3 (ceiling, not quota).
2. Early stop when re-review clears all blockers and no new blockers.
3. Blocking findings must name falsifiable breakage (correctness/contract/security/data loss).
4. Only blockers gate PASS; non-blocking = backlog.
5. From round 2, new opinions only for load-bearing blockers.
6. Deadlock → stop with structured disagreement (not a freeze Gate).
7. Verdict vocabulary above is exclusive.
8. Diff >500 lines: warn and suggest split (do not hard-fail).
9. Budget exhaust / deadlock exits as user report; continue = new budget authorization.

## Delivery / stop semantics

- Stdout silence is not failure. A living Reviewer may be reasoning without
  partial output; do not manually kill, retry, or start a second Reviewer
  before the configured deadline.
- The adapter owns the only automatic invocation deadline. STOP remains the
  explicit user cancellation path.
- Non-zero / empty / timeout / STOP → `DELIVERY_UNKNOWN` (no retry).
- Resume degrades to newSession only for: missing session id, T0 resume unsupported, CLI "session not found".
- Gray-zone connection failures do **not** degrade (would double-review).
- External packet rewrite between calls → hash mismatch refuse + stop.

## Consult (advisory)

`consult` is one-shot, advisory. Fixer must not silently adopt peer stance unless the user explicitly authorized "一致即采纳" for that turn. Records land in `.review-handoff/runtime/consults/`.
