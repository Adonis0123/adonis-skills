---
name: agentic-review-handoff
description: "Validate pasted review findings before fixes; run same-session automatic Git review-fix-re-review with a headless Reviewer and no redundant confirmation; start fresh-eyes Git diff Review Intake; resume review-loop sessions or packets; get a DecisionConsult from another AI; or run first-principles/DDD/high-cohesion review. Requires Git."
metadata:
  author: adonis
  version: "3.7.0"
---

# Agentic Review Handoff

Persistent packet protocol for review→fix→re-review. **Preferred path (v2): auto loop** — one visible Fixer session drives everything; the Reviewer is invoked headless and read-only; the loop stops only at start, terminal report, or exception.

## Fast Path

Route first, then load only that route's references:

- **Wrong job** — stop; do not start a substitute loop. The parent job is `architecture-hardening-loop` or a diagnose-only architecture scan; the user asked only for a copy-ready review prompt; or they named only `/codex:review` / Grok `/review`.
- **Same-session implementer closure** → `review-loop run`; the verified implementer context permits the default `# Review Handoff` origin.
- **Explicit auto loop / review-fix-re-review without verified implementer context** → `review-loop run --intake`; the script starts truthfully from `# Review Intake` while retaining the auto lifecycle.
- **Decision consult** → `review-loop consult`; **session recovery** → `review-loop sessions`. This file is sufficient; load no references.
- **Fresh-eyes "review this" / "second pair of eyes" / "audit this diff" without implementer context** → classic `intake`; ambiguity defaults to Intake.
- **Classic** (`intake` / `feedback_validation` / `manual_continuation`) → read `references/packet-anatomy.md` and `references/packet-addressing.md`. Add `references/source-prompt-addressing.md` only when source-prompt provenance exists, `references/review-contract.md` only for deep review, and `references/example-packet.md` only when diagnosing packet shape against a populated example.
- **Maintainer-only protocol / state-machine / persistence or integrity-claim change** → `references/protocol-evolution-gate.md`. Ordinary runs do not load it (SoT: `skills/agentic-review-handoff/`; sync via `pnpm skills:install:local -- --skill agentic-review-handoff`).
- **legacy dual-window** (`open`/`bind`/… deleted T8): CLI migration error → use `run` / `fix-completion` / `close` / `consult`

## Auto loop (`review-loop run`) — preferred

Explicit invocation starts immediately. Human intervenes only at: **initiate**, **terminal report**, or a real exception (DELIVERY_UNKNOWN / hash mismatch / budget / deadlock / scope or external-action decision). Reviewer selection and ordinary findings are not confirmation gates.

```bash
RL="<skill-dir>/scripts/review-loop.mjs"
REPO="$(git rev-parse --show-toplevel)"

# Start after this session implemented the change (default Review Handoff origin)
node "$RL" run --repo "$REPO" [--reviewer=codex|grok|claude] [--base <sha>] [--rounds 3]

# Start an explicit auto loop without verified implementer context (Review Intake origin)
node "$RL" run --intake --repo "$REPO" [--reviewer=codex|grok|claude] [--base <sha>] [--rounds 3]

# After BLOCKED or concerns_require_fix: Fixer edits code, records completion, then continues
node "$RL" fix-completion --repo "$REPO" --packet "$PACKET" --body-file /tmp/fix.md
node "$RL" run --continue --repo "$REPO" --packet "$PACKET"

# Optional review-only mode: park PASS_WITH_CONCERNS for an explicit accept/continue decision
node "$RL" run --repo "$REPO" --completion=review
node "$RL" close --repo "$REPO" --packet "$PACKET" --reason accept-concerns

# Recompute current worktree identity before an outer workflow reuses a verdict
node "$RL" evidence --repo "$REPO" --base "$BASE_SHA" [--paths=a,b]

# Advisory decision consult (not part of Verdict machine)
node "$RL" consult --repo "$REPO" --peer=codex --question-file /tmp/q.md

# List recorded reviewer sessions + copy-ready resume commands
# (Codex Desktop's list hides codex_exec sessions — this is the way back in)
node "$RL" sessions --repo "$REPO" [--product=codex|grok|claude]
```

| Concept  | Rule                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Fixer    | Visible session — sole worktree + packet writer                                                            |
| Reviewer | Headless; omitted product defaults to Codex; adapters use read-only + `dontAsk` controls                   |
| Origin   | First H1 only: default `Review Handoff`; explicit `--intake` uses `Review Intake`; later rounds inherit it |
| Evidence | Per-round frozen diff under `.review-handoff/runtime/<packet>/evidence/round-N.diff` (tracked + untracked) |
| Rounds   | Default budget 3; early stop on PASS; budget exhaust → structured report (not a Protocol Gate)             |
| Timeout  | 20 minutes per Reviewer invocation; advanced override: `REVIEW_LOOP_TIMEOUT_MS`                            |
| Progress | Immediate liveness line, then every 30 seconds while the Reviewer process is alive                         |
| STOP     | Global `.review-handoff/STOP` or per-packet `runtime/<id>/STOP`                                            |
| Sandbox  | Best available read-only controls are fixed in adapters; no permission prompt is shown                     |

Default `completion=pass` treats `PASS_WITH_CONCERNS` as more work: the visible Fixer repairs each actionable in-scope concern, appends Fix Completion, and re-reviews within budget. It never asks the user whether to continue. Only explicit `--completion=review` parks concerns in `awaiting_user_decision`; this is the opt-in escape hatch for review-only judgment, not the loop default.

**A quiet Reviewer is not a failed Reviewer.** Product CLIs commonly return
structured stdout only when the model finishes. While the child process is
alive, do not kill it, retry it, or start a second Reviewer because stdout is
silent. Trust the adapter's progress line and deadline; use STOP only when the
user intentionally cancels. A real timeout remains `DELIVERY_UNKNOWN` with no
automatic retry, because delivery state is ambiguous.

Contract details: `references/auto-loop-contract.md`.

Successful parsed rounds return `evidence = { baseSha, pathFilter, digest, coveredPaths, sourceRound }`. Equality uses only `baseSha + pathFilter + digest`; `coveredPaths` is audit metadata. Outer workflows must run `review-loop evidence` with the returned base/filter before reusing a verdict. A mismatch, missing legacy identity, or non-success status makes the review non-reusable and requires a new review or `UNVERIFIED` report.

Tests:

```bash
# from repo root
node --test skills/agentic-review-handoff/scripts/test/adapters.test.mjs \
  skills/agentic-review-handoff/scripts/test/auto-run.test.mjs \
  skills/agentic-review-handoff/scripts/test/auto-run-negatives.test.mjs \
  skills/agentic-review-handoff/scripts/test/intake-run.test.mjs \
  skills/agentic-review-handoff/scripts/test/consult.test.mjs \
  skills/agentic-review-handoff/scripts/test/sessions.test.mjs
```

## Read-only Boundary (Important)

This skill historically said "review/re-review are read-only by default; do not edit files." That rule still holds for the **subject of review** (source / docs / product / tests / configs being reviewed) but is **explicitly overridden** for one path: writing to the packet artifact itself.

- **Read-only still means**: do not modify the code, docs, tests, or configs being reviewed; do not commit / push / rebase.
- **Packet artifact writes are part of the protocol, not a violation**: creating, appending to, renaming, and `mv`-ing files under `$repo_root/.review-handoff/**` is exactly what makes the cross-agent loop work. Treat these writes the same way you treat printing findings to the terminal.
- **Before writing the first packet in a repo**, resolve `$GIT_COMMON_DIR` with `git rev-parse --git-common-dir` and ensure its `info/exclude` contains `/.review-handoff/` (the canonical root-anchored form). Treat the historical `.review-handoff/` form as already configured. Auto-loop scripts already bootstrap this line; classic writers who need the snippet load `packet-addressing.md` § Git common-dir `info/exclude`.

## Three non-negotiable invariants

These survive every path (auto loop and classic). Each line is an accident-backed rule:

1. **Absolute paths under `$repo_root/.review-handoff/`** — never cwd-relative. Violation → monorepo subdirectories create a second inbox or miss the root packet.
2. **Never fabricate `# Review Handoff` without implementer context** — reviewers use `# Review Intake` instead. Violation → evidence trust boundary breaks; re-reviewers cannot independently re-attest findings.
3. **H1 body is append-only at EOF; frontmatter is rewritten atomically once per stage** — never mid-file insert or leave `last_anchor` / `lifecycle_state` stale. Violation → physical last H1 diverges from frontmatter (Incident A); packet is unusable.

## Classic compatibility path (prompt-protocol only)

**Compatibility path — prompt-protocol only (no script guarantees).** Use only when auto loop cannot express the intent:

| `classic_reason`      | When                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `intake`              | Reviewer-initiated review-only packet or packet-plus-fix brief that does not need the auto lifecycle |
| `feedback_validation` | User pasted reviewer/team feedback to validate as a defect report before fix                         |
| `manual_continuation` | User continues an existing classic packet without `review-loop run`                                  |

**Why classic for these:** classic is still the prompt-protocol path for review-only packets, pasted feedback validation, and manual packet continuation. It can stop at a portable Fix Handoff without authorizing the auto loop. Auto budget exit (`budget_exhausted` on final BLOCKED round, including `--rounds 1`) is not the same as classic "stop at Fix Handoff and wait for a human fixer."

Fresh-eyes "review this" / "second pair of eyes" / "audit this diff" without an explicit closed-loop request defaults to classic `intake`. Explicit auto-loop or review-fix-re-review intent without verified implementer context uses `review-loop run --intake`. Visible same-session implementation context uses default `review-loop run`. If context is ambiguous, choose an Intake origin so the protocol never fabricates an implementer Handoff.

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
- Deep review is opt-in for DDD, high cohesion / low coupling, industry comparison, source-backed research, or architectural / cross-module risk. Auto loop already has severity / Verdict rules in `auto-loop-contract.md`; load `references/review-contract.md` only on classic / deep-opt-in when that rubric is the current step.

## Guardrails

- Reviewer suggests, never rewrites the subject under review by default. Implementer or user decides fixes. (Packet artifact writes are not "rewriting the subject" — see Read-only Boundary.)
- Style preferences are marked `Preference` or omitted — never reported as bugs.
- Never write "looks good" without listing what was checked.
- Never claim a command passed unless it actually ran in this session.
- When paths or branches matter, verify `pwd`, `git rev-parse --show-toplevel`, branch, and `git status` before quoting them.
- Never write a `# Review Handoff` section unless you are the implementer with implementation context.
- Never modify a previously-written H1 section. Append a new round suffix `(round N)` if the same kind of section needs to recur.
- Always atomically rewrite frontmatter after appending; never leave `last_anchor` / `lifecycle_state` stale.
