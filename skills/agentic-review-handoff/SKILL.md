---
name: agentic-review-handoff
description: "Validate pasted review findings before fixes; run same-session automatic Git review-fix-re-review with a headless Reviewer and no redundant confirmation; start fresh-eyes Git diff Review Intake; resume review-loop sessions or packets; get a DecisionConsult from another AI; or run first-principles/DDD/high-cohesion review. Requires Git and review/consult intent; ordinary implementation or commit-only requests do not start a review loop."
metadata:
  author: adonis
  version: "3.9.0"
---

# Agentic Review Handoff

Use direct Grok CLI calls only when the user asks Grok (or a `grok00x` account) for an ordinary consult or one-shot review. Use the persistent packet/auto-loop protocol when explicitly requested or when continuing an existing packet; its Reviewer comes from the user's saved preference, Claude first by default (see Reviewer selection).

## Fast Path

Choose a route before loading references:

- **Wrong job** — stop; do not start a substitute loop. Ordinary implementation or commit-only requests (including "commit only, no review") do not authorize review. The parent job is `architecture-hardening-loop` or a diagnose-only architecture scan; the user asked only for a copy-ready review prompt; or they named only `/codex:review` / Grok `/review`.
- **Ordinary consult / one-shot review the user addressed to Grok** (including a named `grok00x` account) → Direct Grok below. Without Grok named, use `review-loop consult` with the default peer. Explicit CLI commands (including `review-loop consult`), auto-loop, packet, and continuation requests take precedence. Do not start a protocol loop merely because Grok is involved.
- **Explicit review-fix-re-review with same-session implementer context** → `review-loop run`; the verified implementer context permits the default `# Review Handoff` origin.
- **Explicit auto loop / review-fix-re-review without verified implementer context** → `review-loop run --intake`; the script starts truthfully from `# Review Intake` while retaining the auto lifecycle.
- **Decision consult** → `review-loop consult`; **session recovery** → `review-loop sessions`. This file is sufficient; load no references.
- **Fresh-eyes "review this" / "second pair of eyes" / "audit this diff" without implementer context** → classic `intake`; ambiguity defaults to Intake.
- **Classic** (`intake` / `feedback_validation` / `manual_continuation`) → read `references/packet-anatomy.md` and `references/packet-addressing.md`. Add `references/source-prompt-addressing.md` only when source-prompt provenance exists, `references/review-contract.md` only for deep review, and `references/example-packet.md` only when diagnosing packet shape against a populated example.
- **Maintainer-only protocol / state-machine / persistence or integrity-claim change** → `references/protocol-evolution-gate.md`. Ordinary runs do not load it (SoT: `skills/agentic-review-handoff/`; sync via `pnpm skills:install:local -- --skill agentic-review-handoff`).
- **Removed dual-window commands** (`open` / `bind` / …): the CLI returns a migration error → use `run` / `fix-completion` / `close` / `consult`

## Direct Grok — only when the user names Grok

Use the user's existing `grok` or named `grok00x` command. Keep account selection
in that launcher; do not recreate account configuration, copy credentials, or
cycle through accounts. `grok00x` is a naming pattern, not a literal command.
Discover the actual command in the user's shell. If it is a shell function, invoke
it in that shell (for example `zsh -ic`), passing the prompt file as an argument;
never interpolate prompt text into shell code.

Keep the launcher's existing sandbox configuration; do not force an OS profile or
turn an explicitly configured sandbox off. The tool allowlist permits file reads
and search; remove the deferred MCP bridge tools as well as denying MCP calls. This is tool-level restriction, not OS isolation.

From the subject repository, prepare one prompt file containing the question or
review scope, relevant diff/context, and required output. Request evidence-backed
findings with file locations and severity; for consultation request reasons and
risks. Instruct Grok to read only and return its answer without implementing.

```bash
grok --prompt-file "$PROMPT_FILE" --output-format json \
  --tools read_file,grep,list_dir --disallowed-tools search_tool,use_tool --deny MCPTool --permission-mode dontAsk \
  --no-subagents --disable-web-search
# For an existing account function, pass its discovered name and prompt path as
# environment values (GROK_COMMAND is a bare command name, not a command string):
GROK_COMMAND="<discovered-name>" PROMPT_FILE="$PROMPT_FILE" zsh -ic '"$GROK_COMMAND" --prompt-file "$PROMPT_FILE" --output-format json --tools read_file,grep,list_dir --disallowed-tools search_tool,use_tool --deny MCPTool --permission-mode dontAsk --no-subagents --disable-web-search'
```

Prefer an existing executable launcher when available. A defining shell may emit
startup text; distinguish that from the CLI result instead of assuming its entire
stdout is one JSON object. Do not rewrite the user's shell startup to silence it.

Use the selected command consistently, including `-r <session-id>` for follow-up.
The visible agent verifies findings and makes authorized fixes. Do not create a
packet, ledger, or extra orchestration script for this route. Record the selected
command and returned session ID when available; direct sessions are not listed by
`review-loop sessions`. Do not claim frozen-evidence or automatic-loop guarantees.
On failure follow the short startup-failure rule below; do not repair Docker.

## Auto loop (`review-loop run`) — explicit automation

Explicit invocation starts immediately once the Reviewer is known. Human intervenes only at: **initiate** (including the one Reviewer question below), **terminal report**, or an unresolved exception (ambiguous delivery / hash mismatch / budget / deadlock / scope or external-action decision). Ordinary findings and safely recoverable local startup faults are not confirmation gates.

### Reviewer selection (before the first `run`)

A fresh `run` has no default Reviewer; omitting `--reviewer` fails with `REVIEWER_REQUIRED` before any external call. Resolve it in this order and never ask again for the same packet:

1. The user named a product or account (`grok`, `grok002`, `codex003`, `cc002`, ...) → use it. An account name maps to its product (`grok00x`→grok, `codex00x`→codex, `cc00x`→claude) plus `--reviewer-command=<name>`.
2. `run --continue` → inherits the stored Reviewer, launcher and `--fallback` list; pass nothing.
3. Otherwise do not ask and do not pick a product yourself: pass `--host=<visible host product>` (`claude` / `codex` / `grok`) instead of `--reviewer` (consult: instead of `--peer`). The script reads the user's saved **Reviewer preference** and uses its first product as Reviewer and the rest as `--fallback`. Default: `claude,codex,grok`, host kept (`skipHost: false`), so a Claude host is reviewed by a fresh read-only Claude session. The result's `reviewerFrom` says what was picked and why; state it in the start line and the terminal report. Parent workflows (`architecture-hardening-loop`, `task-completion-loop`) use this same preference.

**Reviewer preference.** Saved per user in `${XDG_CONFIG_HOME:-~/.config}/agentic-review-handoff/config.json` as `{ "order": [...], "skipHost": bool }`. When the user states a lasting preference ("prefer codex", "以后先用 claude", "不要让宿主审自己"), save it: `node "$RL" prefs --order=codex,claude,grok`, `--skip-host=true`, or `--reset` for the default; `node "$RL" prefs` shows it. `REVIEW_LOOP_REVIEWERS=codex,claude` overrides the order for one shell. A one-off request ("review this one with grok") is step 1, not a preference change.

**Fallback on timeout.** When a Reviewer or consult peer times out, the script hands the same round to the next product in a new session (Reviewers are read-only, so the timed-out one left nothing behind), records it as `fallbacks: [{ from, to, reason }]` and keeps the new Reviewer for `--continue`. Only a timeout moves on; a user stop or any other failure stays `DELIVERY_UNKNOWN`. A user who named one product gets no fallback unless they asked for one; with `--host`, the preference supplies it. Report every fallback in the terminal report.

`--reviewer-command` takes a bare launcher name that starts with its product (`grok*`, `codex*`, `cc*`/`claude*`) and is a zsh/bash function defined in the rc file (`.zshrc` / `.bashrc`, not a profile file) or a PATH executable; aliases and fish functions do not resolve. The adapter runs it through an interactive shell and appends the product's read-only argv; a launcher from another family (`cc002` with `--reviewer=grok`) or with no product prefix is rejected because those flags would not restrict it. The launcher's own flags still apply, so it must not add permission-widening flags. Never copy credentials or rotate accounts. Consult uses the same rule with `--peer` / `--peer-command`.

```bash
RL="<skill-dir>/scripts/review-loop.mjs"
REPO="$(git rev-parse --show-toplevel)"

# Start after this session implemented the change (default Review Handoff origin)
node "$RL" run --repo "$REPO" --host=claude|codex|grok [--base <sha>] [--rounds 3]      # Reviewer + fallbacks from the preference
node "$RL" run --repo "$REPO" --reviewer=codex|grok|claude [--reviewer-command=grok002] [--fallback=grok] [--base <sha>] [--rounds 3]

# Start an explicit auto loop without verified implementer context (Review Intake origin)
node "$RL" run --intake --repo "$REPO" --reviewer=codex|grok|claude [--reviewer-command=grok002] [--fallback=grok] [--base <sha>] [--rounds 3]

# After BLOCKED or concerns_require_fix: Fixer edits code, records completion, then continues
node "$RL" fix-completion --repo "$REPO" --packet "$PACKET" --body-file /tmp/fix.md
node "$RL" run --continue --repo "$REPO" --packet "$PACKET"

# Optional review-only mode: park PASS_WITH_CONCERNS for an explicit accept/continue decision
node "$RL" run --repo "$REPO" --reviewer=codex --completion=review
node "$RL" close --repo "$REPO" --packet "$PACKET" --reason accept-concerns

# Recompute current worktree identity before an outer workflow reuses a verdict
node "$RL" evidence --repo "$REPO" --base "$BASE_SHA" [--paths=a,b]

# Advisory decision consult (not part of Verdict machine)
node "$RL" consult --repo "$REPO" --host=claude [--skip-host] --question-file /tmp/q.md   # peer from the preference
node "$RL" consult --repo "$REPO" --peer=codex [--peer-command=codex002] [--fallback=grok] --question-file /tmp/q.md
# Multi-round: continue the same peer session; the follow-up is appended to the same record.
# --web adds search/fetch only (pi has none); --raw sends the file without the advisory framing.
node "$RL" consult --repo "$REPO" --resume <recordPath from the last result> [--web] [--raw] --question-file /tmp/q2.md

# Reviewer preference: show / save / reset
node "$RL" prefs [--order=claude,codex,grok] [--skip-host=true|false] [--reset]

# List recorded reviewer and consult sessions + copy-ready resume commands
# (Codex Desktop's list hides codex_exec sessions — this is the way back in)
node "$RL" sessions --repo "$REPO" [--product=codex|grok|claude|pi]
```

| Concept  | Rule                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Fixer    | Visible session — sole worktree + packet writer                                                              |
| Reviewer | Headless; required on a fresh run (see Reviewer selection); optional account launcher; read-only + `dontAsk` |
| Origin   | First H1 only: default `Review Handoff`; explicit `--intake` uses `Review Intake`; later rounds inherit it   |
| Evidence | Per-round frozen diff under `.review-handoff/runtime/<packet>/evidence/round-N.diff` (tracked + untracked)   |
| Rounds   | Default budget 3; early stop on PASS; budget exhaust → structured report (not a Protocol Gate)               |
| Timeout  | 20 minutes per Reviewer invocation; advanced override: `REVIEW_LOOP_TIMEOUT_MS`                              |
| Progress | Immediate liveness line, then every 30 seconds while the Reviewer process is alive                           |
| STOP     | Global `.review-handoff/STOP` or per-packet `runtime/<id>/STOP`                                              |
| Sandbox  | Codex OS sandbox; Grok read-only tool allowlist + MCP deny; Claude tool restrictions; no permission prompt   |

Default `completion=pass` treats `PASS_WITH_CONCERNS` as more work: the visible Fixer repairs each actionable in-scope concern, appends Fix Completion, and re-reviews within budget. It never asks the user whether to continue. Only explicit `--completion=review` parks concerns in `awaiting_user_decision`; this is the opt-in escape hatch for review-only judgment, not the loop default.

**A quiet Reviewer is not a failed Reviewer.** Product CLIs commonly return
structured stdout only when the model finishes. While the child process is
alive, do not kill it, retry it, or start a second Reviewer because stdout is
silent. Trust the adapter's progress line and deadline; use STOP only when the
user intentionally cancels. A real timeout remains `DELIVERY_UNKNOWN` with no
automatic retry, because delivery state is ambiguous.

**Keep startup failures local.** Report the concrete failure once; do not turn a
review into Docker/service repair. Never move or delete sockets, start shared
services, or alter account configuration as part of this skill. A failed optional
consult does not block independent work; mark that peer's opinion unavailable.
A required review remains blocked, not passed. Do not silently switch accounts or
reviewers. For ambiguous delivery or timeout, inspect the existing session rather
than resubmitting. See `references/environment-recovery.md` only if needed.

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

Review and re-review never modify the **subject of review** (source / docs / product / tests / configs being reviewed). Writing the packet artifact itself is part of the protocol, not an edit to that subject:

- **Read-only still means**: do not modify the code, docs, tests, or configs being reviewed; do not commit / push / rebase.
- **Packet artifact writes are part of the protocol, not a violation**: creating, appending to, renaming, and `mv`-ing files under `$repo_root/.review-handoff/**` is exactly what makes the cross-agent loop work. Treat these writes the same way you treat printing findings to the terminal.
- **Before writing the first packet in a repo**, resolve `$GIT_COMMON_DIR` with `git rev-parse --git-common-dir` and ensure its `info/exclude` contains `/.review-handoff/` (the canonical root-anchored form). Treat the historical `.review-handoff/` form as already configured. Auto-loop scripts already bootstrap this line; classic writers who need the snippet load `packet-addressing.md` § Git common-dir `info/exclude`.

## Three non-negotiable invariants

These survive every path (auto loop and classic):

1. **Absolute paths under `$repo_root/.review-handoff/`** — never cwd-relative. Violation → monorepo subdirectories create a second inbox or miss the root packet.
2. **Never fabricate `# Review Handoff` without implementer context** — reviewers use `# Review Intake` instead. Violation → evidence trust boundary breaks; re-reviewers cannot independently re-attest findings.
3. **H1 body is append-only at EOF; frontmatter is rewritten atomically once per stage** — never mid-file insert or leave `last_anchor` / `lifecycle_state` stale. Violation → physical last H1 diverges from frontmatter; packet is unusable.

## Classic compatibility path

**Compatibility path — agent-selected stages, scripted writes.** Use only when auto loop cannot express the intent:

| `classic_reason`      | When                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `intake`              | Reviewer-initiated review-only packet or packet-plus-fix brief that does not need the auto lifecycle |
| `feedback_validation` | User pasted reviewer/team feedback to validate as a defect report before fix                         |
| `manual_continuation` | User continues an existing classic packet without `review-loop run`                                  |

**Why classic for these:** classic is still the prompt-protocol path for review-only packets, pasted feedback validation, and manual packet continuation. It can stop at a portable Fix Handoff without authorizing the auto loop. Auto budget exit (`budget_exhausted` on final BLOCKED round, including `--rounds 1`) is not the same as classic "stop at Fix Handoff and wait for a human fixer."

Fresh-eyes "review this" / "second pair of eyes" / "audit this diff" without an explicit closed-loop request defaults to classic `intake`. Explicit auto-loop or review-fix-re-review intent without verified implementer context uses `review-loop run --intake`. Explicit review-fix-re-review with visible same-session implementation context uses default `review-loop run`. If context is ambiguous, choose an Intake origin so the protocol never fabricates an implementer Handoff.

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
5. Write the required H1 group to `$BODY_FILE`, then append and sync frontmatter: `node "$RL" classic-append --repo "$REPO" --packet "$PACKET" --body-file "$BODY_FILE" --anchor "$ANCHOR" --lifecycle "$LIFECYCLE"`. The script verifies disk bytes before reporting success.
6. Apply **classic** lifecycle/archive actions from `packet-addressing.md` (not the auto-loop map) after Verdicts.

### Classic write rules (summary)

- Body H1 sections are append-only; classic has no auto-loop hash guard.
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
- Report checks actually run and their results.
- When paths or branches matter, verify `pwd`, `git rev-parse --show-toplevel`, branch, and `git status` before quoting them.
