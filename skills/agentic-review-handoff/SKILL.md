---
name: agentic-review-handoff
description: "Use this skill whenever the user wants auto loop, review-loop run/continue, same-session dual-AI review closed loop, review-fix-re-review with zero mid-loop human, DecisionConsult (review-loop consult), or review-loop sessions (resume codex/grok/claude headless reviewer). Also for .review-handoff packets, second pair of eyes leaving durable findings/Fix Handoff, feedback validation before fix, Fix Completion + re-review, PASS_WITH_CONCERNS fix-it, and first-principles/DDD/high-cohesion review with Verdict. Preferred: visible Fixer + headless read-only Reviewer (codex|grok|claude); git required. Use even if the skill name is not said. Do NOT use for ordinary implementation, unit-test-only work, verbal staged-diff glances without packets, review-comment copy-edit, non-git folders, weekly reports (use weekly-report skill), or other named review tools (/codex:review, Grok /review). Dual-window bind/next/wait removed - migrate with this skill."
metadata:
  author: adonis
  version: "3.1.1"
---

# Agentic Review Handoff

Persistent packet protocol for review→fix→re-review. **Preferred path (v2): auto loop** — one visible Fixer session drives everything; the Reviewer is invoked headless and read-only; the loop stops only at start, terminal report, or exception.

Dual-window bind/wait/gate path was **removed in T8** (dogfood-failed). Do not call `open`/`bind`/… — CLI returns a migration error. See `references/auto-loop-contract.md`.

## Fast Path

- **same-session dual AI review closed loop / auto loop / zero mid-loop human** → `review-loop run` (below)
- **decision consult / ask another AI for stance** → `review-loop consult`
- **resume a past reviewer session ("给我 codex/grok/claude 恢复对话的命令")** → `review-loop sessions`
- **classic single-session packet review (no automation)** → Workflow sections below
- packet shape → `references/packet-anatomy.md`
- lifecycle / archive → `references/packet-addressing.md`
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

## Workflow

### 1. State the stage and scope

Stage is one of: `review`, `feedback validation`, `fix handoff`, `fix`, `re-review`. Scope is one of: staged diff / working-tree diff / full branch diff / generated artifacts / docs only / specific files. If the user did not name a stage, infer from the Stage Defaults table below. If scope is missing, reconstruct the minimum scope from the diff / file paths / prior findings the user gave you and label your assumptions explicitly. Asking a clarifying question is a last resort.

### 2. Locate or create the packet (every stage)

Before writing any output, run packet addressing exactly in this order. These steps define the packet identity and resume contract.

```
0. repo_root=$(git rev-parse --show-toplevel)
   - Not in a git repo → fail loudly. The packet protocol requires a repo identity.
   - All read / write / mv must use $repo_root/.review-handoff/... absolute paths.
     Do not use cwd-relative paths — agents are often invoked from monorepo subdirectories
     like apps/web/, and a relative path would create a second inbox or miss the root one.
1. branch=$(git rev-parse --abbrev-ref HEAD)
   branch_slug = lowercase(branch with "/" and "\" replaced by "-")
2. List $repo_root/.review-handoff/active/${branch_slug}/*.md, sort ascending by filename.
   File names use local minute time plus scope: `YYYY-MM-DD_HH-mm-<scope_slug>.md`.
   The fixed-width local minute prefix guarantees lexical sort = chronological sort within the branch folder.
3. Take the last (newest) one:
   - Exists → read the whole file; the last H1 anchor + frontmatter tells you which
     section to append next (see Stage transitions below).
     Special case: if lifecycle_state = awaiting_user_decision and the user said
     "fix it" / "修一下" / "改吧", start a new round (append # Fix Completion (round N+1)).
   - Does not exist → enter creation path, branched by who triggered:
     · implementer-initiated (the user/agent just finished writing code and is asking
       for review) → start with # Review Handoff (implementer fills Goal /
       Implementation Summary / Open Questions etc.)
     · reviewer-initiated (the user is directly asking the reviewer to look at a
       staged/working-tree diff with no implementer handoff in hand) → start with
       # Review Intake (reviewer records only what it can verify itself: scope,
       verification, inferred goal labelled inferred from diff), then # Review
       Findings. **Whether to write # Fix Handoff after # Review Findings depends
       on the Verdict**: if Verdict is PASS / NO_FINDINGS, skip # Fix Handoff and
       immediately archive (see "Lifecycle and Archive" Trigger 1 below). If
       Verdict is BLOCKED / PASS_WITH_CONCERNS, append # Fix Handoff with the
       validated findings to fix. Do NOT fabricate # Review Handoff — that
       section is implementer-only and writing it without implementer context
       breaks the evidence-first trust boundary.
4. If the user explicitly passed --packet=<path> or named a packet file, prefer that,
   but verify it lives under $repo_root/.review-handoff/active/ or archive/.
   Never accept a prompts/ file as a review-loop packet.
```

Before writing the first packet for a branch, create `$repo_root/.review-handoff/active/${branch_slug}/` and `$repo_root/.review-handoff/archive/${branch_slug}/` if needed. Also ensure the Git common-dir `info/exclude` line described above is in place.

Packet addressing may select a target filename at this stage, but do not create or write the packet file until optional source-prompt resolution in step 3 succeeds. Ambiguous or unsafe prompt provenance must leave packet files unchanged.

### 3. Resolve optional source prompt provenance

After locating or creating the packet identity but before writing its first H1 group, apply `references/source-prompt-addressing.md` when the user supplies a prompt ID/path, pasted feedback contains `Review-Prompt-ID`, the packet already records `source_prompt_id`, or the current branch has prompt candidates.

Use this order: explicit ID/path → echoed ID → existing packet provenance → exactly one non-expired current-branch prompt → ask on remaining ambiguity. Validate the ID, real path, frontmatter, lifecycle, and active/archive uniqueness before using it.

When resolved, write `source_prompt_id`, `source_prompt_head`, and `source_prompt_scope` into packet frontmatter. Preserve matching existing provenance and stop on mismatch. The source prompt is read-only provenance: never mutate it, never treat its summary as verified evidence, and revalidate returned feedback against current code. Lack of a prompt remains valid for existing agentic workflows with no prompt signal or candidate.

### 4. Append the stage's required H1 section group, then atomically rewrite frontmatter

Two write rules govern every packet edit:

- **Body H1 sections are append-only.** Once a `# Anchor` section has been written, never modify, delete, or reorder it. New writes only append to the end of the file.
- **Under auto loop**, packet stages are written only by the claim-free stage writer (`run` / `fix-completion`); never mid-file edit the packet.
- **A single stage entry may append more than one H1 section.** Specifically:
  - **review / feedback-validation stage** typically writes a group of H1 sections in one atomic packet update: `# Review Intake` (or `# Review Handoff` for implementer-initiated) → `# Review Findings` → (conditional) `# Fix Handoff`. The Fix Handoff is appended only when Verdict is `BLOCKED` or `PASS_WITH_CONCERNS`; on `PASS` / `NO_FINDINGS` the group ends after `# Review Findings` and the packet is archived.
  - **fix stage** appends exactly one `# Fix Completion` (or `# Fix Completion (round N)`).
  - **re-review stage** appends exactly one `# Re-review` (or `# Re-review (round N)`).
    Do **not** stop after a single H1 if the stage requires more — partial groups break the auto-resume chain (e.g. reviewer stopping after `# Review Intake` leaves the fixer nothing to act on).
- **Frontmatter is metadata; rewrite it atomically once per stage entry.** After appending the stage's H1 group, rewrite the entire YAML frontmatter to update `updated`, `last_anchor` (= the **last** H1 you just wrote), `lifecycle_state`, and (when entering a new round) `round`. Rewriting frontmatter is **not** a violation of append-only.

### 5. Use references only on demand

Use the Fast Path map above. Loading references is optional and should be tied to a concrete uncertainty; routine turns should not read all reference files.

### 6. Run the loop

- **Review stage**: verify what the user pasted as a defect report, not as ground truth. Use a lightweight first-principles frame by default: goal, constraints, invariants, evidence, assumptions, concrete failure modes. Escalate to the deeper DDD / high-cohesion / low-coupling lens only when the change is architectural, cross-module, or domain-rule heavy. Use official or primary sources only when the claim depends on external API, framework, browser, security, payment, legal, or platform behavior.
- **Fix handoff stage**: when the user wants to ship the review result to the original implementer or another agent, ensure the packet ends with a `# Fix Handoff` section per `references/packet-anatomy.md`.
- **Fix stage**: only fix findings already marked valid or partially valid. Do not broaden scope. Always end by appending `# Fix Completion`; do not replace it with a prose-only summary. If the user asks for "fix conclusion" / "修改结论" / "修复结论" / "给出结论", satisfy that request inside the packet's `Fix Conclusion` subsection (the first subsection of `# Fix Completion`).
- **Re-review stage**: review only the changed fix scope and nearby regression surface. Do not restart a full review unless the user asks or the fix changed architecture/scope. If a prior reviewer claim is wrong, explain why with evidence instead of defending the implementation by default. Output order is fixed:
  1. Scope preamble naming this as a scoped re-review (not a restart).
  2. Prior findings reassessment table (re-attest each row from the `Original Findings Snapshot`, not the fixer's `Claimed status`).
  3. New findings introduced by the fix or surfaced by adjacency.
  4. Regression surface list — call sites or behaviors at risk because of the fix.
  5. Single Verdict from the fixed vocabulary.

After writing `# Re-review`, look at the Verdict and apply the lifecycle / archive action from the table below.

## Lifecycle and Archive

There are **two archive triggers** depending on which review section the Verdict was written in:

### Trigger 1: First-pass `# Review Findings` with no fix needed (golden path)

When the very first review finds nothing or only `Preference`-level items, the reviewer writes the Verdict in `# Review Findings` itself, **does not** write a `# Fix Handoff` (there's nothing to hand off), and acts on the verdict immediately:

| Verdict in `# Review Findings`   | Action                                                                                                              | `last_anchor`     | `lifecycle_state` | File location |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------- | ------------- |
| `PASS` / `NO_FINDINGS`           | `mv $repo_root/.review-handoff/active/<branch_slug>/<file> $repo_root/.review-handoff/archive/<branch_slug>/<file>` | `review_findings` | `archived`        | `archive/`    |
| `PASS_WITH_CONCERNS` / `BLOCKED` | Continue to `# Fix Handoff` — there are findings to fix.                                                            | `review_findings` | `in_progress`     | `active/`     |

### Trigger 2: After every `# Re-review` (or `# Re-review (round N)`)

| Re-review Verdict      | Action                                                                                                                                                                                                                           | `last_anchor` | `lifecycle_state`        | File location |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------ | ------------- |
| `PASS` / `NO_FINDINGS` | `mv $repo_root/.review-handoff/active/<branch_slug>/<file> $repo_root/.review-handoff/archive/<branch_slug>/<file>`                                                                                                              | `re_review`   | `archived`               | `archive/`    |
| `PASS_WITH_CONCERNS`   | **Do not archive.** Stay in `active/`. Tell the user the packet is parked and any "fix it" / "修一下" / "改吧" will auto-continue to round N+1; manual `mv` to archive only on the user's explicit "drop the concerns" decision. | `re_review`   | `awaiting_user_decision` | `active/`     |
| `BLOCKED`              | Do not archive. Wait for fixer to start the next round.                                                                                                                                                                          | `re_review`   | `blocked`                | `active/`     |

Only the reviewer ever auto-archives; fixers never archive. Users may manually `mv` either direction; the agent should respect that.

## Stage Defaults

Infer the stage from the user's signal:

| User signal                                                                                                                                                                                                                  | Stage                        | Required output                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| "review", "second pair of eyes", "audit this diff", or pasted team feedback                                                                                                                                                  | review / feedback validation | Findings or feedback validation, optionally followed by `# Fix Handoff` in the same packet                |
| "give this back to the implementer", "send context to the fixing AI", or asks for a repair brief                                                                                                                             | fix handoff                  | Append `# Fix Handoff`                                                                                    |
| "fix according to this packet", "apply only these validated findings", "fix it", "apply the valid feedback", "修改吧", "改吧", "修一下", "按这个改", "按 review 意见修", "修改之后给出结论", "修完给结论", or "改完给我结论" | fix                          | Code/doc changes plus appended `# Fix Completion` whose first subsection is `Fix Conclusion`              |
| "fixed, review again", "改好了再看", or the latest section in the packet is `# Fix Completion`                                                                                                                               | re-review                    | Append `# Re-review` (Prior findings reassessment, new fix-induced findings, regression surface, verdict) |

### Mixed-stage requests

When one user message combines review/validation with a fix request (e.g. "review this then fix it", "validate this feedback and apply the valid parts"), execute stages sequentially in this order:

1. Finish review or feedback validation: append `# Review Findings` with verdict. Then branch:
   - Verdict in `BLOCKED` / `PASS_WITH_CONCERNS` → append `# Fix Handoff` with validated findings, then proceed to step 2.
   - Verdict in `PASS` / `NO_FINDINGS` → **do not** write `# Fix Handoff` (nothing to fix). Archive immediately per Lifecycle Trigger 1 and **skip step 2** — the user's "fix it" request becomes a no-op because there are no findings to fix. Say so explicitly in the terminal output.
2. Only enter fix stage when step 1 produced a `# Fix Handoff`. Apply only the validated findings, then append `# Fix Completion`.

Do not merge review evidence and fix changes into one unstructured response. Merging stages destroys the portability the packet design depends on — a later re-reviewer cannot independently re-attest findings if there is no `# Fix Handoff` section to anchor them. If the user pushes back on the sequencing, name the cost ("merging stages means a later re-reviewer can't independently re-attest findings") and let them decide. Free-form "rewrite this function" requests not tied to a validated finding are not a stage switch — defer them as a separate implementation task.

## Review Modes

- Standard review checks scope, correctness, regression risk, boundaries, verification, and security/privacy when relevant.
- Feedback validation treats pasted feedback as a defect report, not ground truth; verify each claim and fix only valid / partially valid items.
- Deep review is opt-in for DDD, high cohesion / low coupling, industry comparison, source-backed research, or architectural / cross-module risk. Use `references/review-contract.md` for the full rubric only when these details are needed.

## Guardrails

- Reviewer suggests, never rewrites the subject under review by default. Implementer or user decides fixes. (Packet artifact writes are not "rewriting the subject" — see Read-only Boundary at the top.)
- Style preferences are marked `Preference` or omitted — never reported as bugs.
- Never write "looks good" without listing what was checked.
- Never claim a command passed unless it actually ran in this session.
- When paths or branches matter, verify `pwd`, `git rev-parse --show-toplevel`, branch, and `git status` before quoting them.
- Never write a `# Review Handoff` section unless you are the implementer with implementation context. Reviewers without implementer handoff use `# Review Intake` instead.
- Never modify a previously-written H1 section. Append a new round suffix `(round N)` if the same kind of section needs to recur.
- Always atomically rewrite frontmatter after appending; never leave `last_anchor` / `lifecycle_state` stale.
