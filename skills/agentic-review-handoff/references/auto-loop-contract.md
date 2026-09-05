# Auto Loop Contract (v2)

Authoritative machine + Reviewer contract for `review-loop run`.

## Topology

- Visible session = **Fixer** (sole worktree writer, sole packet writer, loop driver).
- **Reviewer** = headless product adapter (`codex` / `grok` / `claude`), read-only stdout only.
- Packet is the ledger; stages append at EOF via claim-free stage writer with content-hash guard.

## CLI

```text
review-loop run --repo <root> [--reviewer codex|grok|claude] [--completion pass|review] [--base <sha>] [--rounds 3] [--intake]
review-loop run --continue --repo <root> [--packet <path>] [--rounds N]
review-loop fix-completion --repo <root> --packet <path> --body-file <md>
review-loop close --repo <root> --packet <path> --reason accept-concerns
review-loop evidence --repo <root> --base <sha> [--paths a,b]
review-loop consult --repo <root> --peer codex|grok|claude --question-file <md>
```

Origin rules are fail-closed:

- A new default run starts from `# Review Handoff`; use it only with verified implementer context.
- A new `run --intake` starts from `# Review Intake` without inventing implementation claims.
- `--intake` is creation-only. It is incompatible with `--continue`, `--packet`, and caller-supplied packet IDs. Later rounds inherit the packet's original first H1 and do not repeat the flag.
- Before invoking the Reviewer, round 1 requires exactly one physical H1 and a matched pair: `review_handoff` + `# Review Handoff`, or `review_intake` + `# Review Intake`.
- The first H1 is the only origin truth. Do not add another frontmatter/runtime field or overload `mode` to encode Handoff versus Intake; auto state may still use `mode: auto` for protocol ownership.

Each Reviewer invocation has a 20-minute default deadline. Set
`REVIEW_LOOP_TIMEOUT_MS` to a positive finite millisecond value only when an
advanced runtime integration needs a different budget. The CLI writes an
immediate liveness line to stderr and repeats it every 30 seconds while the
Reviewer process remains alive; final stdout stays machine-readable JSON.

## Review evidence identity

Every successfully parsed `run` round returns and persists:

```json
{
  "evidence": {
    "baseSha": "<full sha>",
    "pathFilter": ["optional/caller/scope"],
    "digest": "<sha256 of the frozen UTF-8 diff text>",
    "coveredPaths": ["actual/changed/path"],
    "sourceRound": 2
  }
}
```

- Equality uses exactly `baseSha + normalized pathFilter + digest`. `pathFilter: null` means the full worktree relative to `baseSha`.
- `coveredPaths` is sorted audit metadata; it is not a substitute for the caller's filter and does not participate in equality.
- `digest` is SHA-256 of the same deterministic tracked-plus-untracked diff text written to `round-N.diff`.
- `sourceRound` is the last successfully parsed Reviewer round. Decision Closure returns that persisted identity and does **not** re-attest the current worktree.
- Before reusing a verdict, an outer workflow must run `review-loop evidence` with the returned `baseSha` and `pathFilter`, then compare the equality fields. Same HEAD and same path names are insufficient.
- `DELIVERY_UNKNOWN`, malformed output, hash mismatch, recovery errors, and other runs without a successful parsed round do not return a reusable identity. Legacy terminal state without this object is non-reusable; do not guess or backfill a public identity.

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

| Mode / Verdict                           | lifecycle_state          | Typical `last_anchor`                                  | Action                                                                                           |
| ---------------------------------------- | ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| any / `PASS` or `NO_FINDINGS`            | `archived`               | `review_findings` or `re_review`                       | Archive packet; terminal report                                                                  |
| default `pass` / `PASS_WITH_CONCERNS`    | `blocked`                | first round: `fix_handoff`; re-review: `re_review`     | Return `concerns_require_fix`; Fixer fixes + `fix-completion` + `run --continue`, without asking |
| explicit `review` / `PASS_WITH_CONCERNS` | `awaiting_user_decision` | first round: `review_findings`; re-review: `re_review` | User may `close --reason accept-concerns` or `run --continue`                                    |
| any / `BLOCKED`                          | `blocked`                | first round: `fix_handoff`; re-review: `re_review`     | Return blockers; Fixer fixes + `fix-completion` + `run --continue`                               |

Omitting Reviewer selects Codex deterministically. An explicit product wins. Neither path asks the user to choose a product. `completion` and Reviewer persist across `run --continue`.

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

Opt-in review-only terminal path when lifecycle is `awaiting_user_decision` after `PASS_WITH_CONCERNS`:

- Requires packet lock + content-hash guard (same as other auto stage writes).
- Reads `findingCatalog` + non-empty `openConcerns` from runtime state under the lock; missing/corrupt ledger → **fail closed** (no Markdown reverse-parse for re-review packets).
- Appends `# Decision Closure` with reason, original Verdict `PASS_WITH_CONCERNS`, accepted concern IDs, and timestamp.
- Sets `last_anchor=decision_closure`, `lifecycle_state=archived`, `mv` to `archive/` under the **packet_id slug** (no path rewrite).
- Does **not** rewrite the original Verdict to `PASS`, does **not** invent Fix Completion, and does **not** trigger re-review.
- Default `completion=pass` never calls `close`; it fixes and re-reviews. `close` is available only after explicit `completion=review` parked the packet.

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
- Non-zero / empty / timeout / STOP → conservative `DELIVERY_UNKNOWN`; the adapter does not retry these failures automatically. The visible Fixer diagnoses local startup faults before escalating to the user; this status alone is not a confirmation gate.
- Proven failure before submission permits one Fixer-driven retry after a minimal reversible environment repair under existing authorization. See `environment-recovery.md`. The adapter does not itself repair the environment or guarantee non-delivery.
- Real timeout, empty output without pre-submission proof, and ambiguous connection failure remain non-retryable automatically. STOP is cancellation, not a repair trigger.
- Resume degrades to newSession only for: missing session id, T0 resume unsupported, CLI "session not found".
- Gray-zone connection failures do **not** degrade (would double-review).
- External packet rewrite between calls → hash mismatch refuse + stop.

## Consult (advisory)

`consult` is one-shot, advisory. Fixer must not silently adopt peer stance unless the user explicitly authorized "一致即采纳" for that turn. Records land in `.review-handoff/runtime/consults/`.
