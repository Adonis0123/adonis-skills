---
name: agentic-review-handoff
description: "Use this skill when the user pastes review feedback to validate as a defect report before any fix (feedback validation), and for auto loop (review-loop run/continue): same-session dual-AI review-fix-re-review with visible Fixer, headless read-only codex|grok|claude Reviewer, zero mid-loop human; ordinary review / second pair of eyes / audit this diff routes here via auto loop. Also Review Intake for reviewer-initiated live review or manual packet continuation (classic prompt-protocol only - no script guarantees), DecisionConsult (review-loop consult), review-loop sessions (resume headless reviewer commands), PASS_WITH_CONCERNS fix-it, and first-principles/DDD/high-cohesion review. Requires a git repo. Do NOT use for ordinary implementation, unit-test-only work, verbal staged-diff glances without packets, review-comment copy-edit, non-git folders, weekly reports (weekly-report), or named alternatives (/codex:review, Grok /review). Dual-window bind/next/wait removed; migrate to run, fix-completion, or consult."
metadata:
  author: adonis
  version: "3.3.0"
---

# Agentic Review Handoff

Persistent packet protocol for review→fix→re-review. **Preferred path (v2): auto loop** — one visible Fixer session drives everything; the Reviewer is invoked headless and read-only; the loop stops only at start, terminal report, or exception.

Dual-window bind/wait/gate path was **removed in T8** (dogfood-failed). Do not call `open`/`bind`/… — CLI returns a migration error. See `references/auto-loop-contract.md`.

## Fast Path

- **same-session dual AI review closed loop / auto loop / zero mid-loop human / ordinary "review" or "audit this diff"** → `review-loop run` (below)
- **decision consult / ask another AI for stance** → `review-loop consult`
- **resume a past reviewer session ("给我 codex/grok/claude 恢复对话的命令")** → `review-loop sessions`
- **classic compatibility path** (prompt-protocol only, **no script guarantees**) — only for: Review Intake (reviewer-initiated live review), feedback validation of pasted findings, or manual packet continuation → Classic section below
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

# After PASS_WITH_CONCERNS: accept remaining concerns and archive (no re-review)
node "$RL" close --repo "$REPO" --packet "$PACKET" --reason accept-concerns

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

`open` / `bind` / `next` / `wait` / `append-eof` / `complete` / `board` / `resolve` / `gate` / `disarm` / `blind-submit` / `h1-probe` were deleted in T8 (`plan-2026-07-22-review-loop-v2-auto-loop.md` D11). Invoking them returns a migration error pointing at `run` / `fix-completion` / `close` / `consult`.

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

**Compatibility path — prompt-protocol only (no script guarantees).** Use only when auto loop cannot express the intent:

| `classic_reason`      | When                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `intake`              | Reviewer-initiated live review that must start with `# Review Intake` (not implementer `# Review Handoff`) |
| `feedback_validation` | User pasted reviewer/team feedback to validate as a defect report before fix                               |
| `manual_continuation` | User continues an existing classic packet without `review-loop run`                                        |

**Why not auto for these:** auto `createPacketFile` always seeds implementer `# Review Handoff` — routing reviewer-initiated Intake into auto would forge Handoff and break the evidence boundary. Also, auto budget exit (`budget_exhausted` on final BLOCKED round, including `--rounds 1`) is not the same as classic "stop at Fix Handoff and wait for a human fixer."

Ordinary "review this" / "second pair of eyes" / "audit this diff" **defaults to auto loop**, not classic.

Steps when classic is correct:

1. Infer stage/scope (Stage Defaults in `packet-anatomy.md` — classic-only rows).
2. Locate or create the packet via `packet-addressing.md` addressing algorithm step 3 **mode isolation**:
   - Continue only a packet that already has `mode: classic`.
   - If the newest active packet is auto-owned (`loop: on` without `mode: classic`, or has auto-run runtime state) → **create a new classic packet**; never re-label an auto packet.
3. On classic create (and keep on every classic rewrite), set observability frontmatter:
   ```yaml
   mode: classic
   classic_reason: intake | feedback_validation | manual_continuation
   ```
   Closed set only — exactly one of those three reasons. Never write these fields onto auto packets.
4. Resolve optional source-prompt provenance via `source-prompt-addressing.md`.
5. Append the stage's required H1 group (packet-anatomy templates); rewrite frontmatter atomically.
6. Apply **classic** lifecycle/archive actions from `packet-addressing.md` (not the auto-loop map) after Verdicts.

### Classic write rules (summary)

- Body H1 sections are append-only (model-written; **no** claim-free stage writer / hash guard).
- Review / feedback-validation typically appends `# Review Intake` or `# Review Handoff` → `# Review Findings` → (conditional) `# Fix Handoff`.
- Fix stage appends `# Fix Completion`; re-review appends `# Re-review`.
- Full templates and Stage Defaults: `packet-anatomy.md`. Classic lifecycle: `packet-addressing.md`. Auto lifecycle: `auto-loop-contract.md` + scripts.

### Run the loop (classic)

- **Review / Intake**: verify code and claims with evidence; never invent implementer intent in Intake.
- **Feedback validation**: treat pasted feedback as a defect report, not ground truth.
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
