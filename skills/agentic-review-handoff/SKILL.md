---
name: agentic-review-handoff
description: "Cross-agent code review handoff and review-fix-re-review loop with persistent packet artifacts. Use when the user asks for an independent, read-only 'second pair of eyes' pass on a diff/branch/PR another agent (Codex, Cursor) or a teammate implemented; asks to verify team/reviewer feedback before fixing; says a fix is done and wants scoped re-review; asks to continue the most recent review packet; or asks for first-principles, DDD, high-cohesion/low-coupling review. Persists each review→fix→re-review loop as a single artifact file under <repo_root>/.review-handoff/active/ so CC and Codex auto-resume without manual copy-paste. Do NOT use for ordinary implementation, generic staged-change review, polishing review-comment wording, or when the user names a different review skill."
metadata:
  author: adonis
  version: "2.0.0"
---

# Agentic Review Handoff

Persistent packet protocol that lets two agents (typically Claude Code as reviewer + Codex as implementer/fixer) hand a review loop back and forth via a file artifact instead of manual copy-paste. Each review→fix→re-review loop is one append-only markdown file under `$repo_root/.review-handoff/active/`.

## Read-only Boundary (Important)

This skill historically said "review/re-review are read-only by default; do not edit files." That rule still holds for the **subject of review** (source / docs / product / tests / configs being reviewed) but is **explicitly overridden** for one path: writing to the packet artifact itself.

- **Read-only still means**: do not modify the code, docs, tests, or configs being reviewed; do not commit / push / rebase.
- **Packet artifact writes are part of the protocol, not a violation**: creating, appending to, renaming, and `mv`-ing files under `$repo_root/.review-handoff/**` is exactly what makes the cross-agent loop work. Treat these writes the same way you treat printing findings to the terminal.
- **Before writing the first packet in a repo**, ensure `$repo_root/.git/info/exclude` already contains a line `/.review-handoff/` (leading slash anchors to repo root, the canonical form). If neither `/.review-handoff/` nor the unanchored `.review-handoff/` is already present, append the canonical form. See `references/packet-addressing.md` § ".git/info/exclude bootstrapping" for the exact idempotent snippet. This isolates the artifact per-repo without modifying anyone's `.gitignore` (important when reviewing in a repo that isn't yours).

## Workflow

### 1. State the stage and scope

Stage is one of: `review`, `feedback validation`, `fix handoff`, `fix`, `re-review`. Scope is one of: staged diff / working-tree diff / full branch diff / generated artifacts / docs only / specific files. If the user did not name a stage, infer from the Stage Defaults table below. If scope is missing, reconstruct the minimum scope from the diff / file paths / prior findings the user gave you and label your assumptions explicitly. Asking a clarifying question is a last resort.

### 2. Locate or create the packet (every stage)

Before writing any output, run packet addressing exactly in this order. This is the single mechanism that makes CC and Codex auto-resume the same loop.

```
0. repo_root=$(git rev-parse --show-toplevel)
   - Not in a git repo → fail loudly. The packet protocol requires a repo identity.
   - All read / write / mv must use $repo_root/.review-handoff/... absolute paths.
     Do not use cwd-relative paths — agents are often invoked from monorepo subdirectories
     like apps/web/, and a relative path would create a second inbox or miss the root one.
1. branch=$(git rev-parse --abbrev-ref HEAD)
   branch_slug = lowercase(branch with "/" and "\" replaced by "-")
2. List $repo_root/.review-handoff/active/${branch_slug}__*.md, sort ascending by filename.
   The utc-stamp in the filename guarantees lexical sort = chronological sort.
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
   but still verify it lives under $repo_root/.review-handoff/.
```

If `$repo_root/.review-handoff/active/` does not exist yet, create it (and `archive/` alongside) before writing the first packet. Also ensure the `.git/info/exclude` line described above is in place.

### 3. Append exactly one new H1 section, then atomically rewrite frontmatter

Two write rules govern every packet edit:

- **Body H1 sections are append-only.** Once a `# Anchor` section has been written, never modify, delete, or reorder it. New stages only append to the end of the file.
- **Frontmatter is metadata; rewrite it atomically every time you append.** After appending the new H1 section, rewrite the entire YAML frontmatter to update `updated`, `last_anchor`, `lifecycle_state`, and (when entering a new round) `round`. Rewriting frontmatter is **not** a violation of append-only.

### 4. Use the right reference

- `references/packet-anatomy.md` — full template of one packet file from `# Review Handoff` (or `# Review Intake`) through the final `# Re-review`. Use this when authoring or extending a packet. **This replaces the old `handoff-packet.md` and `review-loop-packets.md` files** (those are kept as transitional stubs).
- `references/packet-addressing.md` — frontmatter field reference, naming format, lifecycle_state derivation table, archive triggers, common edge cases. Use when you need to confirm which `lifecycle_state` value a verdict implies, or to handle multi-round / branch-switch / subdirectory cwd cases.
- `references/review-contract.md` — the unchanged protocol layer: severity ladder (P0–P3 + Preference), Source tag taxonomy, Verdict vocabulary, Feedback Validation Format, Deep Review lens. Findings inside a packet always follow this contract.
- `references/example-packet.md` — fully-worked canonical example showing one BLOCKED → PASS round-2 cycle, including the exact 8-column unified-table verbatim copy and the optional 9th `Notes` column. Diff your own packet against it when you're unsure of the format.

### 5. Run the loop

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

| Verdict in `# Review Findings` | Action | `last_anchor` | `lifecycle_state` | File location |
|---|---|---|---|---|
| `PASS` / `NO_FINDINGS` | `mv $repo_root/.review-handoff/active/<file> $repo_root/.review-handoff/archive/<file>` | `review_findings` | `archived` | `archive/` |
| `PASS_WITH_CONCERNS` / `BLOCKED` | Continue to `# Fix Handoff` — there are findings to fix. | `review_findings` | `in_progress` | `active/` |

### Trigger 2: After every `# Re-review` (or `# Re-review (round N)`)

| Re-review Verdict | Action | `last_anchor` | `lifecycle_state` | File location |
|---|---|---|---|---|
| `PASS` / `NO_FINDINGS` | `mv $repo_root/.review-handoff/active/<file> $repo_root/.review-handoff/archive/<file>` | `re_review` | `archived` | `archive/` |
| `PASS_WITH_CONCERNS` | **Do not archive.** Stay in `active/`. Tell the user the packet is parked and any "fix it" / "修一下" / "改吧" will auto-continue to round N+1; manual `mv` to archive only on the user's explicit "drop the concerns" decision. | `re_review` | `awaiting_user_decision` | `active/` |
| `BLOCKED` | Do not archive. Wait for fixer to start the next round. | `re_review` | `blocked` | `active/` |

Only the reviewer ever auto-archives; fixers never archive. Users may manually `mv` either direction; the agent should respect that.

## Stage Defaults

Infer the stage from the user's signal:

| User signal | Stage | Required output |
|---|---|---|
| "review", "second pair of eyes", "audit this diff", or pasted team feedback | review / feedback validation | Findings or feedback validation, optionally followed by `# Fix Handoff` in the same packet |
| "give this back to the implementer", "send context to the fixing AI", or asks for a repair brief | fix handoff | Append `# Fix Handoff` |
| "fix according to this packet", "apply only these validated findings", "fix it", "apply the valid feedback", "修改吧", "改吧", "修一下", "按这个改", "按 review 意见修", "修改之后给出结论", "修完给结论", or "改完给我结论" | fix | Code/doc changes plus appended `# Fix Completion` whose first subsection is `Fix Conclusion` |
| "fixed, review again", "改好了再看", or the latest section in the packet is `# Fix Completion` | re-review | Append `# Re-review` (Prior findings reassessment, new fix-induced findings, regression surface, verdict) |

### Mixed-stage requests

When one user message combines review/validation with a fix request (e.g. "review this then fix it", "validate this feedback and apply the valid parts"), execute stages sequentially in this order:

1. Finish review or feedback validation: append `# Review Findings` with verdict. Then branch:
   - Verdict in `BLOCKED` / `PASS_WITH_CONCERNS` → append `# Fix Handoff` with validated findings, then proceed to step 2.
   - Verdict in `PASS` / `NO_FINDINGS` → **do not** write `# Fix Handoff` (nothing to fix). Archive immediately per Lifecycle Trigger 1 and **skip step 2** — the user's "fix it" request becomes a no-op because there are no findings to fix. Say so explicitly in the terminal output.
2. Only enter fix stage when step 1 produced a `# Fix Handoff`. Apply only the validated findings, then append `# Fix Completion`.

Do not merge review evidence and fix changes into one unstructured response. Merging stages destroys the portability the packet design depends on — a later re-reviewer cannot independently re-attest findings if there is no `# Fix Handoff` section to anchor them. If the user pushes back on the sequencing, name the cost ("merging stages means a later re-reviewer can't independently re-attest findings") and let them decide. Free-form "rewrite this function" requests not tied to a validated finding are not a stage switch — defer them as a separate implementation task.

## Review Modes

### Standard Review

Use for normal staged, working-tree, or final implementation review. Check:

- Scope correctness: reviewer is looking at the intended diff.
- Functional correctness: behavior matches the request/spec.
- Regression risk: unchanged contracts remain true.
- Error handling and boundary cases.
- Test coverage and verification evidence.
- Security/privacy concerns when data, auth, payment, file, or network boundaries are touched.

### Feedback Validation

Use when the user pastes feedback from another reviewer or team. Treat the feedback as a defect report, not ground truth. For each claim:

- Verify against code, docs, diff, tests, or runtime evidence.
- Classify as `valid`, `partially valid`, `invalid`, or `hypothesis`.
- Explain the minimum fix only for valid or partially valid issues.
- If the claim confuses final file state with execution timeline, call that out explicitly.

Scope discipline: do not add new findings beyond the claims the user pasted. Two exceptions are allowed:

- Safety-critical issues you happened to see in the same snippet — meaning P0 or P1 severity in the domains of security, data loss, payment, auth, or privacy. Maintainability, style, missing returns on dead code paths, and "while we're here" P2/P3 ideas do NOT qualify. Surface real safety-critical findings in a clearly separated section labelled "Out-of-scope findings".
- The user explicitly asked to "also look for other issues" or equivalent.

If you find yourself adding a P2 or P3 to the out-of-scope section, delete it — that is the exact failure mode this rule exists to prevent.

### Deep Review

Enable the full deep-review lens only when the user explicitly asks for DDD, high cohesion/low coupling, industry comparison, source-backed research, or when the change is architectural, cross-module, or domain-rule heavy. A lightweight first-principles frame is allowed in normal review. Convert these labels into evidence-backed checks (see `references/review-contract.md`):

- First principles: goal, constraints, invariants, evidence, assumptions, concrete failure modes.
- DDD: core domain, ubiquitous language, bounded context, rule ownership, explicit cross-context mapping.
- Cohesion/coupling: change locality, dependency direction, duplicated rules, hidden coupling, interface size.
- Source-driven check: official or primary sources only, with `Source:` tag set to `verified from docs` only when you actually loaded the doc this session.

## Guardrails

- Reviewer suggests, never rewrites the subject under review by default. Implementer or user decides fixes. (Packet artifact writes are not "rewriting the subject" — see Read-only Boundary at the top.)
- Style preferences are marked `Preference` or omitted — never reported as bugs.
- Never write "looks good" without listing what was checked.
- Never claim a command passed unless it actually ran in this session.
- When paths or branches matter, verify `pwd`, `git rev-parse --show-toplevel`, branch, and `git status` before quoting them.
- Never write a `# Review Handoff` section unless you are the implementer with implementation context. Reviewers without implementer handoff use `# Review Intake` instead.
- Never modify a previously-written H1 section. Append a new round suffix `(round N)` if the same kind of section needs to recur.
- Always atomically rewrite frontmatter after appending; never leave `last_anchor` / `lifecycle_state` stale.
