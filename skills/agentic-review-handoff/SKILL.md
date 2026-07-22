---
name: agentic-review-handoff
description: "Runs a git-only agentic review workflow with durable .review-handoff packets: second pair of eyes review, feedback validation, Fix Handoff, Fix Completion, scoped re-review, and first-principles/DDD/high-cohesion/low-coupling review with a Verdict. Use when the user asks for a first-principles or DDD review packet; review-loop run/continue or an auto loop; a same-session dual-AI review-fix-re-review closed loop with visible Fixer, headless read-only codex|grok|claude Reviewer, and zero mid-loop human; DecisionConsult via review-loop consult; review-loop sessions or resume commands; packet continuation; or a PASS_WITH_CONCERNS fix round. Do NOT use for ordinary implementation, unit-test-only work, verbal staged-diff glances without packets, review-comment copy editing, non-git folders, non-review design docs, weekly reports (use weekly-report), or named alternatives (/codex:review, Grok /review). Dual-window bind/next/wait is removed; migrate to run, fix-completion, or consult."
metadata:
  author: adonis
  version: "3.2.0"
---

# Agentic Review Handoff

Persistent packet protocol for review→fix→re-review. **Preferred path (v2): auto loop** — one visible Fixer session drives everything; the Reviewer is invoked headless and read-only; the loop stops only at start, terminal report, or exception.

Dual-window bind/wait/gate path was **removed in T8** (dogfood-failed). Do not call `open`/`bind`/… — CLI returns a migration error. See `references/auto-loop-contract.md`.

## Fast Path

- **same-session dual AI review closed loop / auto loop / zero mid-loop human** → `review-loop run` (below)
- **decision consult / ask another AI for stance** → `review-loop consult`
- **resume a past reviewer session ("给我 codex/grok/claude 恢复对话的命令")** → `review-loop sessions`
- **classic single-session packet review (no automation)** → Classic compatibility path (below)
- packet shape → `references/packet-anatomy.md`
- lifecycle / archive / addressing algorithm → `references/packet-addressing.md`
- stage defaults / mixed-stage → `references/packet-anatomy.md` § Stage Defaults
- severity / verdict vocabulary → `references/review-contract.md`
- auto loop contract → `references/auto-loop-contract.md`

## Auto loop (`review-loop run`) — preferred

Human intervenes only at: **initiate**, **terminal report**, **exception** (DELIVERY_UNKNOWN / hash mismatch / budget / deadlock).

```bash
RL="<skill-dir>/scripts/review-loop.mjs"
REPO="$(git rev-parse --show-toplevel)"

# Start (pins base SHA, freezes evidence, headless Reviewer, writes packet stages)
node "$RL" run --repo "$REPO" --reviewer=codex|grok|claude [--base <sha>] [--rounds 3]

# After BLOCKED: Fixer edits code, then records completion, then continue
node "$RL" fix-completion --repo "$REPO" --packet "$PACKET" --body-file /tmp/fix.md
node "$RL" run --continue --repo "$REPO" --packet "$PACKET"

# Advisory decision consult (not part of Verdict machine)
node "$RL" consult --repo "$REPO" --peer=codex --question-file /tmp/q.md

# List recorded reviewer sessions + copy-ready resume commands
# (Codex Desktop's list hides codex_exec sessions — this is the way back in)
node "$RL" sessions --repo "$REPO" [--product=codex|grok|claude]
```

| Concept  | Rule                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Fixer    | Visible session — sole worktree + packet writer                                                            |
| Reviewer | Headless, read-only sandbox (flags hardcoded in adapters)                                                  |
| Evidence | Per-round frozen diff under `.review-handoff/runtime/<packet>/evidence/round-N.diff` (tracked + untracked) |
| Rounds   | Default budget 3; early stop on PASS; budget exhaust → structured report (not a Protocol Gate)             |
| STOP     | Global `.review-handoff/STOP` or per-packet `runtime/<id>/STOP`                                            |
| Sandbox  | Cannot be disabled via CLI flags                                                                           |

Contract details: `references/auto-loop-contract.md`.

Tests:

```bash
# from repo root
node --test skills/agentic-review-handoff/scripts/test/adapters.test.mjs \
  skills/agentic-review-handoff/scripts/test/auto-run.test.mjs \
  skills/agentic-review-handoff/scripts/test/auto-run-negatives.test.mjs \
  skills/agentic-review-handoff/scripts/test/consult.test.mjs \
  skills/agentic-review-handoff/scripts/test/sessions.test.mjs
```

## Legacy dual-window — removed (T8)

`open` / `bind` / `next` / `wait` / `append-eof` / `complete` / `board` / `resolve` / `gate` / `disarm` / `blind-submit` / `h1-probe` were deleted in T8 (`plan-2026-07-22-review-loop-v2-auto-loop.md` D11). Invoking them returns a migration error pointing at `run` / `fix-completion` / `consult`.

## Read-only Boundary (Important)

This skill historically said "review/re-review are read-only by default; do not edit files." That rule still holds for the **subject of review** (source / docs / product / tests / configs being reviewed) but is **explicitly overridden** for one path: writing to the packet artifact itself.

- **Read-only still means**: do not modify the code, docs, tests, or configs being reviewed; do not commit / push / rebase.
- **Packet artifact writes are part of the protocol, not a violation**: creating, appending to, renaming, and `mv`-ing files under `$repo_root/.review-handoff/**` is exactly what makes the cross-agent loop work. Treat these writes the same way you treat printing findings to the terminal.
- **Before writing the first packet in a repo**, resolve `$GIT_COMMON_DIR` with `git rev-parse --git-common-dir` and ensure its `info/exclude` contains `/.review-handoff/` (the canonical root-anchored form). Treat the historical `.review-handoff/` form as already configured. See `references/packet-addressing.md` for the exact idempotent snippet.

## Three non-negotiable invariants

These survive every path (auto loop and classic). Each line is an accident-backed rule:

1. **Absolute paths under `$repo_root/.review-handoff/`** — never cwd-relative. Violation → monorepo subdirectories create a second inbox or miss the root packet.
2. **Never fabricate `# Review Handoff` without implementer context** — reviewers use `# Review Intake` instead. Violation → evidence trust boundary breaks; re-reviewers cannot independently re-attest findings.
3. **H1 body is append-only at EOF; frontmatter is rewritten atomically once per stage** — never mid-file insert or leave `last_anchor` / `lifecycle_state` stale. Violation → physical last H1 diverges from frontmatter (Incident A); packet is unusable.

## Classic compatibility path (prompt-protocol only)

For classic single-session packet review **without** `review-loop run` automation:

1. Infer stage/scope (see Stage Defaults in `packet-anatomy.md`).
2. Locate or create the packet via the addressing algorithm in `packet-addressing.md` (only full statement of steps 0–4).
3. Resolve optional source-prompt provenance via `source-prompt-addressing.md`.
4. Append the stage's required H1 group (packet-anatomy templates); rewrite frontmatter atomically.
5. Apply lifecycle/archive actions from `packet-addressing.md` after Verdicts.

### Classic write rules (summary)

- Body H1 sections are append-only; auto loop uses the claim-free stage writer only.
- Review / feedback-validation typically appends `# Review Intake` or `# Review Handoff` → `# Review Findings` → (conditional) `# Fix Handoff`.
- Fix stage appends `# Fix Completion`; re-review appends `# Re-review`.
- Full templates and Stage Defaults: `packet-anatomy.md`. Lifecycle tables: `packet-addressing.md`.

### Run the loop (classic)

- **Review**: verify pasted feedback as a defect report, not ground truth. Lightweight first-principles by default; escalate to DDD / cohesion only when architectural.
- **Fix handoff / Fix / Re-review**: follow packet-anatomy section templates; re-review order is Prior reassessment → New findings → Regression Surface → Verdict.

## Review Modes

- Standard review checks scope, correctness, regression risk, boundaries, verification, and security/privacy when relevant.
- Feedback validation treats pasted feedback as a defect report, not ground truth; verify each claim and fix only valid / partially valid items.
- Deep review is opt-in for DDD, high cohesion / low coupling, industry comparison, source-backed research, or architectural / cross-module risk. Use `references/review-contract.md` for the full rubric only when these details are needed.

## Guardrails

- Reviewer suggests, never rewrites the subject under review by default. Implementer or user decides fixes. (Packet artifact writes are not "rewriting the subject" — see Read-only Boundary.)
- Style preferences are marked `Preference` or omitted — never reported as bugs.
- Never write "looks good" without listing what was checked.
- Never claim a command passed unless it actually ran in this session.
- When paths or branches matter, verify `pwd`, `git rev-parse --show-toplevel`, branch, and `git status` before quoting them.
- Never write a `# Review Handoff` section unless you are the implementer with implementation context.
- Never modify a previously-written H1 section. Append a new round suffix `(round N)` if the same kind of section needs to recur.
- Always atomically rewrite frontmatter after appending; never leave `last_anchor` / `lifecycle_state` stale.
