---
name: open-code-review-loop
description: "Run a bounded OCR-delegation review-fix-re-review loop on a Git workspace until current evidence validates NO_FINDINGS. Use only when the user wants verified findings fixed and independently re-reviewed until clean with codex, claude-code, grok-build, or cursor-cli. Do not use for one-shot open-code-review-delegate or read-only review. A full loop request asks at most once for an unnamed Reviewer (recommending a product other than the host), then runs host mutation checks without further confirmation. Fail closed on missing ocr, reviewer mutation, skipped files, malformed output, stale evidence, or exhausted rounds."
metadata:
  author: adonis
  version: "1.8.1"
---

# Open Code Review Loop

`ocr delegate` is LLM-free: it selects files and resolves rules. Only a
validated reviewer result with full selected coverage may produce `NO_FINDINGS`.
OCR never decides that code is clean.

## Fast Path

Do these in order. Later references stay closed until a step needs them.

1. Git repository? Otherwise stop.
2. `which ocr` — missing → `MISSING_DEPENDENCIES`. Do not open
   adapter-contracts / review-contract / fix-contract, and do not install
   OCR without authorization. Stop before any Reviewer call.
3. Resolve Reviewer/Fixer product IDs, then open **only those product
   sections** in [adapter-contracts.md](references/adapter-contracts.md).
4. Open [review-contract.md](references/review-contract.md) +
   [review-schema.json](references/review-schema.json) only in Phase 2.
5. Open [fix-contract.md](references/fix-contract.md) +
   [fix-schema.json](references/fix-schema.json) only in Phase 4 for
   independently verified `Fix` rows.
6. Historical `--commit` / `--from/--to` → `HUMAN_GATE` before any fix;
   do not load the fix contract.

## Trigger and exclusions

Use this Skill only for an OCR-delegation loop (`ocr delegate` /
open-code-review) on a Git workspace with a supported reviewer (`codex`,
`claude-code`, `grok-build`, `cursor-cli`) when the request includes both
fixing verified findings and independent re-review until validated
`NO_FINDINGS` or `CLEAN`. Merely asking for one `ocr delegate` /
`open-code-review-delegate` pass is insufficient; route that request to
`open-code-review-delegate`. Skip other one-shot or read-only review,
non-Git files, commit/push/deploy, and destructive work.

> **Wrong skill.** Packet protocol, `.review-handoff`, `review-loop run`, or
> a Grok consult → `agentic-review-handoff`. Redirect; do not start
> `ocr delegate`. Named path + architecture scan-fix-rescan until no
> architecture findings → `architecture-hardening-loop`. Do not claim OCR
> `CLEAN`. Do not copy those skills' packet or scanner logic.

## Inputs and defaults

Resolve before the first model call:

- Repository: current Git root; never infer a broader repo
- Target: workspace changes; also OCR `--from/--to` and `--commit`
- Reviewer: user-selected product; when none is named, ask once and
  recommend a product other than the visible host; always use a real
  independent read-only product session. `agy` (Antigravity) is not a
  Reviewer yet: its adapter is not verified end to end
- Fixer: current visible host. An external Fixer needs a user-authorized
  isolated checkout that becomes `$REPO` before round 1
- Paths/excludes: OCR preview; preserve user exclusions every round.
  `default_path` is OCR's built-in non-review scope and `user_exclude` records
  a supplied selector, so neither needs a second confirmation. OCR-excluded
  `.md`/`.mdx` files become mandatory supplemental Reviewer scope. Other
  reasons remain unaccepted unless the user already accepted that exact reason
- Round budget / deadline: 3 rounds (a ceiling, not success permission)
  plus only the user grants recorded in the round ledger; 10 minutes per
  Reviewer/Fixer call. Run the loop through this Skill: calling a review CLI
  repeatedly outside it loses the round ceiling
- Background: user requirement or none; pass through preview/rule/prompt

Once the user has requested the full fix-and-re-review loop, explicit skill
invocation authorizes the reversible local workspace loop. Do
not ask whether to start, reconfirm OCR scope, or accept supplemental Markdown
review. One named product without roles → that product is Reviewer, current
host is Fixer. No named product → ask once with the host question tool,
recommending an installed capability-safe product other than the visible host
(a model reviewing its own host's work is the weakest independence); the host
product stays a valid answer in a separate session. Without a question tool, or
when the user asked for defaults, pick that recommendation and record it. If an
auto-selected Reviewer cannot satisfy the read-only adapter, try the next
installed capability-safe product and record the fallback; never replace a
product the user explicitly named. Missing `ocr`, historical-target fixes,
external actions, and destructive or security-sensitive choices still fail
closed. Same product in both roles always means separate sessions.

## Capability preflight

Fast Path already covers Git, `ocr`, and product IDs. Before editing, also
inspect installed product help: a binary name does not prove read-only
review, structured output, scoped writes, or session recovery. Reviewer
inspects without editing. External Fixer: verify the isolated checkout
holds the intended snapshot, freeze that Git root as the only `$REPO`, and
never review one worktree while fixing another. No isolated target →
`HUMAN_GATE` (no patch-transfer protocol). Do not auto-create a worktree.

Record allowed source/test paths, prohibited Git/external actions, and already
accepted exclusion reasons. OCR `default_path` entries are not Reviewer
coverage and do not need a user gate; keep them in the evidence report. Run
relevant tests as host verification even when OCR excludes test files, but
never count test execution as Reviewer coverage. The builder promotes
`unsupported_ext` Markdown to `supplemental_reviewable_files`, captures its
content, and applies `supplemental_rules`; it remains visible in raw OCR
exclusions but no longer needs a question. Other unsupported extensions,
`binary`, or a missing reason remain incomplete coverage.
Partition sessions by repository, loop ID, role, and canonical product ID —
never resume a Reviewer as a Fixer. Reviewer invocations use the strongest
available read-only controls plus `dontAsk`; configured hooks/MCPs or lack of
an OS-perfect sandbox do not alone create a user gate. Freeze the subject Git
identity immediately before the call and recompute it afterward. Any mutation
caused during review returns `UNVERIFIED: REVIEWER_MUTATED_SUBJECT`, with the
actual diff reported and no automatic reset or retry. If a named product lacks
structured output or cannot run non-interactively, return `HUMAN_GATE`; an
automatic selection tries the next installed product without asking.

## Loop contract

Freeze before round 1:

```text
OCR Review Contract
- Repository / target:
- Reviewer / session policy:
- Fixer / session policy:
- Scope / exclusions:
- Accepted exclusion reasons:
- Background / acceptance checks:
- Write boundary:
- Round budget:
- Per-call deadline:
- Git and external actions: none
```

Reviewer owns findings and the clean verdict. Fixer owns source edits and
verification. Visible host owns OCR evidence, schema validation, triage,
round accounting, and the final result.

### Phase 1: Build current evidence

```bash
ROUND_DIR="$(mktemp -d)"
python3 <skill-dir>/scripts/build_review_bundle.py \
  --repo "$REPO" \
  --output "$ROUND_DIR/bundle.json" \
  [--from-ref <ref> --to-ref <ref>] \
  [--commit <hash>] \
  [--exclude <patterns>]... \
  [--allow-excluded-reason <reason>] \
  [--rule <rule.json>] \
  [--background <text> | --background-file <path>]
```

Keep `ROUND_DIR` outside the repo so the next preview cannot select the
bundle and permanently drift evidence. `--exclude` may be repeated; the
script combines values into OCR's list and keeps that selection every
round. `--allow-excluded-reason` is not authority: pass it only after
recording the user's explicit acceptance of that exact non-default reason.
The builder accepts `default_path` and `user_exclude` automatically and routes
Markdown `unsupported_ext` entries into mandatory supplemental scope; do not
pause at round 0 to reconfirm either behavior. Zero OCR reviewable files, zero
supplemental reviewable files, and zero unaccepted exclusions → `CLEAN` with
`0/0` coverage. Any remaining unaccepted exclusion →
`UNVERIFIED: INCOMPLETE_COVERAGE`. Do not invoke an AI just to manufacture a
verdict when the combined selected scope is empty.

Builder already fail-closes on (do not re-implement; read
`scripts/build_review_bundle.py` only if the builder fails):

- mid-build `HEAD` / binary-diff / untracked fingerprint drift
- missing captured content vs a real zero-byte file (`empty_file: true`)
- first-parent merge selection and immutable ref resolution
- in-repository output
- background argv redaction and a private `0600` snapshot

Prefer `--background-file` for non-trivial or sensitive background. Do not
commit the bundle. `validate_round.py` recomputes the canonical digest, so
editing bundle content (`repository` included) while keeping an old
`evidence_id` also fails closed.

### Phase 2: Invoke the Reviewer

Give the Reviewer the frozen contract, background, whole `bundle.json`
(including `evidence_id`), nearby read-only context, non-mutating checks,
and the JSON contract from Fast Path step 4. The selected review set is the
union of `reviewable_files` and `supplemental_reviewable_files`; apply both
`rules` and `supplemental_rules`. Every selected `(path, status)` appears
exactly once as `reviewed` or `skipped`. Emit only evidence-backed, actionable
findings. Tests that need temporary writes belong to host verification and are
not a reason to weaken the Reviewer sandbox.

The round ledger is not a file you choose. `validate_round.py` keeps one per
repository checkout at
`~/.local/state/open-code-review-loop/ledgers/<repository-hash>.json` and
prints the path as `ledger`. That directory is fixed under the home directory
that the system account database lists for the current user: no argument or
environment variable (`XDG_STATE_HOME`, `HOME`) moves it, and a sandboxed host
needs it as an extra writable directory. When the account database has no
entry for the user, or Python has no `fcntl` file lock (native Windows), the
script returns `UNVERIFIED` (exit 2) and records nothing; there is no fallback
to `HOME` and no unlocked mode. `bundle.repository` is part of `evidence_id`,
and the script asks Git which checkout it is and whether `bundle.base_sha` is
its `HEAD`, so a stale bundle, or one edited to point at another checkout (a
worktree or clone on the same `HEAD` included), is refused instead of getting
another ledger. Each checkout has its own ledger and the script does not link
them, so build every bundle in the frozen `$REPO`; never build in another
worktree or clone to continue a loop. A handoff, a resumed session, a new
`ROUND_DIR`, or a new commit lands on the same ledger and the rounds already
used; never move, delete, edit, or recreate it. Omit `--history`: any other
path is refused.

Rounds add up across commits; the ledger lists every `base_sha` it saw. Only
a validated `NO_FINDINGS` closes the loop, and the next evidence then starts a
new budget. A loop that ended any other way stays open: the next loop in that
checkout continues its count until the user grants rounds.

Before every Reviewer call, run the gate and chain the call with `&&`, never
`;` or a new line, so a refused gate (exit 2) cannot be followed by a review:

```bash
python3 <skill-dir>/scripts/validate_round.py --check-call \
  --bundle "$ROUND_DIR/bundle.json" \
  && <Reviewer command from the product's adapter section>
```

A passed gate records the round as `started` before the Reviewer runs. Run it
only immediately before a real Reviewer call, never to look at the count (earlier
output and the `ledger` file show it): a call that starts and is then interrupted has
used its round, and a relay session sees it. Passing the gate again for the
same evidence ID stays one round; a refused gate writes nothing.

A fresh evidence ID consumes one round of the budget; one same-session format
correction uses the same round. A timeout is `UNVERIFIED` and its round stays
used. Validate each raw envelope so the same ledger entry gets the result and
extraction failures are counted:

```bash
python3 <skill-dir>/scripts/validate_round.py \
  --bundle "$ROUND_DIR/bundle.json" \
  --review "$ROUND_DIR/raw-review.json" --product "$REVIEWER_PRODUCT" \
  --output "$ROUND_DIR/validation.json" \
  [--session-id "$RECORDED_SESSION_ID"]
```

`--output` must not be the ledger, its `.tmp` or `.lock` file, or any path
inside the ledger state directory: that is refused (exit 2) and nothing is
written. Keep it in `ROUND_DIR`. An error raised before that check finishes (an
unreadable bundle, no account home) is printed to stdout only, so a
`validation.json` left by an earlier run may be stale: trust the exit code and
this run's stdout, not the file, when the validator exits non-zero.

The validator reuses `extract_product_output.py`. Its gate stops a second
malformed result as `UNVERIFIED` and refuses a round beyond the budget: format
correction supplies no new evidence. A review obtained after a refused gate
is rejected the same way and never recorded. Every refusal carries a `fix`
or `errors` text; follow it instead of working around the ledger.

### Phase 3: Detect evidence drift

Rebuild the bundle with the same target and exclusions. Compare
`evidence_id`. Equal → the result covers the current snapshot. Different →
discard the verdict, record `evidence-drift`, and review the new bundle.
Never carry findings or `NO_FINDINGS` across snapshots.

### Phase 4: Triage and fix findings

For a valid `FINDINGS` result:

1. Independently open each cited path and verify the evidence.
2. Classify each item as `Fix`, `Reject`, or `Human decision`.
3. Give the Fixer only verified `Fix` rows, target paths, required fix,
   acceptance check, current evidence ID, and the write boundary. Load the
   fix contract only now (Fast Path step 5).
4. Extract with `extract_product_output.py`, then `validate_fix_result.py`.
   One same-session correction for malformed output; a valid result is still
   only a claim.
5. Fixer re-reads current code and applies the smallest coherent change.
6. Host recomputes Git status/diff, derives actual changed paths, rejects
   out-of-scope writes, and runs listed checks. Never trust claimed
   `FIXED`, `changed_paths`, or the Fixer's test summary.
7. Record rejected findings with counter-evidence. Do not edit code to
   satisfy a known false positive.

Fixer does not commit, push, merge, rebase, deploy, send messages, or edit
outside the frozen boundary. External Fixer writes only the authorized
isolated `$REPO`. Direct writes to the user's original worktree need
path-scoped enforcement, not a later diff check; the four documented CLI
adapters do not meet that bar. Range/commit review always returns
`HUMAN_GATE` before fixing — another writable branch cannot prove those
edits against the immutable target. Any source or test edit invalidates
the prior bundle, validation, tests, and verdict; return to Phase 1.

Fixer timeout or lost delivery after it could have written → recompute the
real Git diff and return `UNVERIFIED: DELIVERY_UNKNOWN_WITH_MUTATION`. Do
not retry blindly or reset user changes. `FIXED` with unchanged
Git/evidence and a still-reproducing finding → `FIXER_NO_MUTATION`.
Delivery is known, so allow one same-session correction. A repeated
no-mutation result is `UNVERIFIED`, never `CLEAN`.

### Phase 5: Re-review and stop

Resume the Reviewer when the product supports reliable session recovery;
otherwise start a fresh read-only session with the finding ledger and new
bundle. The Fixer never supplies the terminal verdict.

- `CLEAN`: validated `NO_FINDINGS` with 100% combined OCR + supplemental
  coverage, zero skipped files, zero unaccepted exclusions, and no drift; **or**
  the bundle proves `reviewable_files`, `supplemental_reviewable_files`, and
  `unaccepted_excluded_files` are all empty (no Reviewer invoked).
- `HUMAN_GATE`: real product decision, writable-target choice, unavailable non-interactive capability,
  repeated disagreement, or round extension.
- `MISSING_DEPENDENCIES`: OCR or a required product capability unavailable
  before edits.
- `UNVERIFIED`: ambiguous delivery, malformed output after one correction,
  failed checks, repeated drift, or stale required evidence.

Round-budget exhaustion is never `CLEAN`, and only the user extends the
budget. The extension exists once it is recorded, with the user's words
verbatim:

```bash
python3 <skill-dir>/scripts/validate_round.py --bundle "$ROUND_DIR/bundle.json" \
  --grant-rounds <N> --granted-by "<the user's own words about extra rounds>"
```

The budget is 3 plus the grants recorded in the open loop. A host's unattended
prompt (for example "go on with the recommended option" / 「按推荐继续」), a
handoff note, or your own judgment is not a grant; only what the user said
about adding rounds is. The script refuses the obvious non-quotes: a
placeholder (`<...>`, `TODO`, `TBD`), blank or invisible text, and a bare
go-ahead such as 「按推荐继续」 or 「都按推荐来」. Text that passes that check
is still a grant only when the user said it. A run is unattended when `sideby` is on `PATH` and
`sideby unattended status --json` reports `"on": true`, or the host has stated
that nobody is present and questions are refused. A missing or failing
`sideby` settles nothing; without that host statement the user is present.
Probe when the last budgeted round returns `FINDINGS`, before Phase 4, and
again when the gate refuses a call.

- **User present**: report the remaining ledger and ask whether to authorize
  another bounded set of rounds; record a yes with the command above before
  the next gate.
- **Unattended**: do not ask. Skip Phase 4 for the last budgeted round's
  findings, since no round is left to re-review an edit; a fix already applied
  when the gate refuses is reported as unreviewed. Record one item for the
  user with
  `sideby unattended defer "<N> OCR findings open on <branch> after <rounds_used> rounds"`
  (only the finding count, the branch or the short SHA on a detached HEAD,
  and `rounds_used` from the gate output); without `sideby` the final report
  carries it alone. Code with open findings is not
  committed or merged by the surrounding task, which continues only with work
  that does not depend on it and lists the item in its final report.

## Output contract

```text
OCR Review Loop Result
- Result: CLEAN | HUMAN_GATE | MISSING_DEPENDENCIES | UNVERIFIED
- Repository / target:
- Scope / exclusions:
- Reviewer / Fixer:
- Rounds used / budget: <rounds_used>/<round_budget>; grants: none | <N> by "<granted-by words>"
- Round ledger:
- Final evidence id:
- Coverage: <reviewed>/<OCR + supplemental>; skipped: <count>; unaccepted excluded: <count>
- Fixed / Rejected / Open findings:
- Deferred user decision: none | <item and where it was recorded>
- Verification:
- Sessions / recovery:
- Git and external actions: none
```

Reviewer-backed `CLEAN` includes the final `validate_round.py` result and
the same-evidence comparison. Zero-file `CLEAN` includes the bundle summary
proving OCR scope, supplemental scope, and unaccepted exclusions are all
empty; no review response exists on that path.
Every other state names the exact stop point and does not claim OCR or the
AI approved the current code.
