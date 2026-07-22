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
review-loop consult --repo <root> --peer codex|grok|claude --question-file <md>
```

## Reviewer prompt obligations

### Round 1 — Review Findings

Must emit:

1. Markdown table columns: `ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check`
2. Severity tags: `[阻塞]` or `[非阻塞]`
3. Exactly one terminal Verdict: `PASS` | `PASS_WITH_CONCERNS` | `BLOCKED` | `NO_FINDINGS`

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

| Verdict | lifecycle_state | Action |
|---|---|---|
| `PASS` / `NO_FINDINGS` | `archived` | Archive packet; terminal report |
| `PASS_WITH_CONCERNS` | `awaiting_user_decision` | Terminal report lists concerns; user archives or continues |
| `BLOCKED` | `blocked` | Return structured blockers; Fixer fixes + `fix-completion` + `run --continue` |

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

- Non-zero / empty / timeout / STOP → `DELIVERY_UNKNOWN` (no retry).
- Resume degrades to newSession only for: missing session id, T0 resume unsupported, CLI "session not found".
- Gray-zone connection failures do **not** degrade (would double-review).
- External packet rewrite between calls → hash mismatch refuse + stop.

## Consult (advisory)

`consult` is one-shot, advisory. Fixer must not silently adopt peer stance unless the user explicitly authorized "一致即采纳" for that turn. Records land in `.review-handoff/runtime/consults/`.
