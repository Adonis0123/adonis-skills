# Packet Addressing

How to find / create / name / advance / archive packet files. Read this when you need to confirm a `lifecycle_state` value, handle an edge case, or understand why the addressing rules exist.

## Storage layout

```
$repo_root/
├── $GIT_COMMON_DIR/info/exclude ← contains "/.review-handoff/" (auto-managed by this skill)
├── .gitignore                  ← only adonis-skills repo itself dogfoods this
└── .review-handoff/
    ├── active/                 ← in-progress packets; addressing always reads here first
    │   └── <branch_slug>/
    │       └── <local_minute>-<scope_slug>.md
    └── archive/                ← terminal-state PASS / NO_FINDINGS packets; user cleans manually
        └── <branch_slug>/
            └── <local_minute>-<scope_slug>.md
```

**Why repo-local + per-repo isolation**: the protocol is for two CLI agents running on the same machine in the same repo, taking turns. We don't sync packets across machines. We do not modify the target repo's `.gitignore`; `$GIT_COMMON_DIR/info/exclude` is the repository-local Git mechanism and also works when `.git` is a worktree pointer file rather than a directory.

## Filename format

```
.review-handoff/active/<branch_slug>/<local_minute>-<scope_slug>.md
```

- `branch_slug`: `git rev-parse --abbrev-ref HEAD` lowercased, with `/` and `\` replaced by `-`.
- `local_minute`: readable local minute stamp `YYYY-MM-DD_HH-mm` (e.g. `2026-05-15_14-30`). It is precise to minutes and keeps lexical sort = chronological sort inside a branch folder.
- `scope_slug`: 1–3 kebab-case words from the user's stated scope (or the first feature keyword if not stated). Max 24 chars. Must not contain `/`.
- Collision rule: if the exact filename already exists in `active/` or `archive/`, append `-02`, `-03`, ... to the `scope_slug` before `.md`. Do not add seconds back into the timestamp.

Example: `.review-handoff/active/feat-payment/2026-05-15_14-30-refactor-checkout.md`.

## Addressing algorithm (every stage entry) — single source of truth

This is the **only** full statement of the addressing algorithm. `SKILL.md` and other docs must pointer here, not restate steps 0–4.

Run this every time before writing packet output.

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
     section to append next (see stage transitions / Stage Defaults in packet-anatomy.md).
     · lifecycle_state in {in_progress, blocked} → continue normally based on last_anchor.
     · lifecycle_state == awaiting_user_decision and user said "fix it" / "修一下" / "改吧"
       → start a new round: append # Fix Completion (round N+1), increment round.
     · lifecycle_state == archived → the user is engaging a finished packet; copy it back
       to active/$branch_slug/ with a new local_minute filename and a new round before continuing.
   - Does not exist → creation path, branched by who triggered:
     · implementer-initiated (user/agent just finished writing code and is asking for review)
       → start with # Review Handoff (implementer fills Goal / Implementation Summary /
         Open Questions etc.)
     · reviewer-initiated (user is directly asking the reviewer to look at a staged/working-tree
       diff with no implementer handoff) → start with # Review Intake (scope, verification,
       inferred goal labelled inferred from diff), then # Review Findings.
       **Whether to write # Fix Handoff after # Review Findings depends on the Verdict**
       (see Lifecycle and Archive Trigger 1 below):
       - Verdict in {BLOCKED, PASS_WITH_CONCERNS} → append # Fix Handoff
       - Verdict in {PASS, NO_FINDINGS} → DO NOT write # Fix Handoff; archive immediately
       Do NOT fabricate # Review Handoff — implementer-only; writing it without implementer
       context breaks the evidence-first trust boundary.
4. If the user explicitly passed --packet=<path> or named a packet file, prefer that,
   but verify it lives under $repo_root/.review-handoff/active/ or archive/.
   Never accept a prompts/ file as a review-loop packet.
```

Before writing the first packet for a branch, create `$repo_root/.review-handoff/active/${branch_slug}/` and `$repo_root/.review-handoff/archive/${branch_slug}/` if needed. Also ensure the Git common-dir `info/exclude` line (below) is in place.

Selecting a creation path does not authorize an early write. Resolve optional source-prompt provenance (`source-prompt-addressing.md`) before creating the packet file; ambiguity, traversal, or provenance mismatch must leave packet files unchanged.

## Frontmatter fields (full reference)

| Field                 | Type                         | Maintained by                                                      | Description                                                                                                                                  |
| --------------------- | ---------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packet_id`           | string                       | creator                                                            | Equals `<branch_slug>/<filename without .md>`. Acts as packet identity across active/archive moves (creator must not change after creation). |
| `branch`              | string                       | creator                                                            | Original `git branch` value, including `/`. Kept for traceability when filename's `branch_slug` has been munged.                             |
| `scope`               | string                       | creator                                                            | Free-form 1-line scope description from the user.                                                                                            |
| `created`             | ISO datetime (UTC, with `Z`) | creator                                                            | Set once at creation, never modified.                                                                                                        |
| `updated`             | ISO datetime (UTC, with `Z`) | every writer                                                       | Updated on every frontmatter rewrite (i.e. after every H1 append).                                                                           |
| `last_anchor`         | enum (see below)             | every writer                                                       | **Structural fact**: the last H1 anchor in the body, normalized.                                                                             |
| `lifecycle_state`     | enum (see below)             | every writer                                                       | **Domain state**: where this packet sits in its review-loop lifecycle.                                                                       |
| `round`               | int                          | writer of `# Fix Completion (round N)` and `# Re-review (round N)` | Default 1. Increment when starting a new fix round.                                                                                          |
| `source_prompt_id`    | string, optional             | source resolver                                                    | Stable repository-local prompt identity. Must be present with both other `source_prompt_*` fields.                                           |
| `source_prompt_head`  | 40-char SHA, optional        | source resolver                                                    | HEAD recorded by the validated source prompt. Provenance only, not current-code evidence.                                                    |
| `source_prompt_scope` | string, optional             | source resolver                                                    | Canonical scope copied from the validated source prompt.                                                                                     |
| `mode`                | enum, classic path only      | classic writer                                                     | Set to `classic` on classic prompt-protocol packets. Auto loop leaves this unset.                                                            |
| `classic_reason`      | enum, classic path only      | classic writer                                                     | Required when `mode: classic`. Closed set: `intake` \| `feedback_validation` \| `manual_continuation`.                                       |

### `last_anchor` values

Direct normalization of H1 anchor text: strip `# `, strip ` (round N)` suffix, snake_case.

| H1 written                                         | `last_anchor`     |
| -------------------------------------------------- | ----------------- |
| `# Review Handoff`                                 | `review_handoff`  |
| `# Review Intake`                                  | `review_intake`   |
| `# Review Findings`                                | `review_findings` |
| `# Fix Handoff`                                    | `fix_handoff`     |
| `# Fix Completion` or `# Fix Completion (round N)` | `fix_completion`  |
| `# Re-review` or `# Re-review (round N)`           | `re_review`       |

### `lifecycle_state` values

| Value                    | Meaning                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `in_progress`            | Loop still running. Default state from creation through `# Re-review` write.                                                                                                                                                                                                               |
| `awaiting_user_decision` | Re-review verdict was `PASS_WITH_CONCERNS`. Packet stays in `active/` waiting for user to either say "fix it" (auto-resumes to round N+1) or manually `mv` to archive (drop the concerns).                                                                                                 |
| `blocked`                | Re-review verdict was `BLOCKED`. Waiting for fixer to start the next round.                                                                                                                                                                                                                |
| `archived`               | Terminal state. Two ways in: (a) first-pass `# Review Findings` Verdict was `PASS` / `NO_FINDINGS` (golden path — no Fix Handoff written); (b) `# Re-review` (or `# Re-review (round N)`) Verdict was `PASS` / `NO_FINDINGS`. In both cases the packet file has been `mv`'d to `archive/`. |

## Lifecycle derivation and archive actions — single source of truth

`lifecycle_state` is **not** the snake_case of the last H1. Validators, evals, and writers all use **this table only**. Other docs (including `packet-anatomy.md`) must pointer here — do not restate Verdict→location→state mappings elsewhere.

Only the reviewer ever auto-archives; fixers never archive. Users may manually `mv` either direction; the agent should respect that.

| `last_anchor`                      | Verdict (in `# Review Findings` for first-pass, in `# Re-review` for later rounds) | File location | `lifecycle_state`        | Writer action                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review_handoff` / `review_intake` | (no Verdict yet)                                                                   | `active/`     | `in_progress`            | Continue review                                                                                                                                     |
| `review_findings`                  | none yet, or `BLOCKED` / `PASS_WITH_CONCERNS`                                      | `active/`     | `in_progress`            | **Trigger 1 path B:** append `# Fix Handoff` when Verdict is `BLOCKED` / `PASS_WITH_CONCERNS`                                                       |
| `review_findings`                  | `PASS` / `NO_FINDINGS` (golden path — no Fix Handoff)                              | `archive/`    | `archived`               | **Trigger 1 path A:** `mv` to `archive/<branch_slug>/` immediately; no Fix Handoff                                                                  |
| `fix_handoff` / `fix_completion`   | (n/a — re-review not done)                                                         | `active/`     | `in_progress`            | Fixer completes fix; wait for re-review                                                                                                             |
| `re_review`                        | `PASS` / `NO_FINDINGS`                                                             | `archive/`    | `archived`               | **Trigger 2:** `mv` to `archive/<branch_slug>/`                                                                                                     |
| `re_review`                        | `PASS_WITH_CONCERNS`                                                               | `active/`     | `awaiting_user_decision` | **Trigger 2:** do not archive; tell user "fix it" / "修一下" / "改吧" continues to round N+1; manual `mv` to archive only on explicit drop-concerns |
| `re_review`                        | `BLOCKED`                                                                          | `active/`     | `blocked`                | **Trigger 2:** do not archive; wait for fixer next round                                                                                            |

**Trigger 1 (first-pass `# Review Findings`):** when the very first review finds nothing or only Preference-level items, write Verdict in `# Review Findings` itself and take path A (archive) or path B (Fix Handoff) from the table — never invent a Fix Handoff on PASS/NO_FINDINGS.

**Trigger 2 (every `# Re-review`):** apply the matching `re_review` row after the Verdict.

Any other combination is illegal:

- `last_anchor != re_review` with `lifecycle_state in {awaiting_user_decision, blocked}` → invalid
- `last_anchor == re_review` with `lifecycle_state == in_progress` → invalid
- `lifecycle_state == archived` while file is in `active/` → invalid
- `lifecycle_state != archived` while file is in `archive/` → invalid
- `last_anchor in {review_handoff, review_intake}` with `lifecycle_state == archived` → invalid

## Git common-dir `info/exclude` bootstrapping

Before creating the first packet in any repo:

```bash
common_dir=$(git -C "$repo_root" rev-parse --git-common-dir)
case "$common_dir" in
  /*) ;;
  *) common_dir="$repo_root/$common_dir" ;;
esac
exclude_file="$common_dir/info/exclude"
mkdir -p "$common_dir/info"
touch "$exclude_file"
# Canonical form is /.review-handoff/ (leading slash anchors to repo root).
# Tolerate the unanchored form .review-handoff/ from earlier versions of this
# skill so re-running bootstrap doesn't append a duplicate line.
grep -qE '^/?\.review-handoff/$' "$exclude_file" || echo '/.review-handoff/' >> "$exclude_file"
```

This is repo-local, never enters Git history, and never modifies `.gitignore`. Verify with `git status --short` that `.review-handoff/` does not appear after a packet or prompt write.

## Edge cases

### Branch switch mid-loop

`git rev-parse --abbrev-ref HEAD` is read at every addressing call. If the user switched branches between stages, the agent will list a different `active/` namespace and may not find a packet — that is correct behavior. The previous-branch packet stays in its own namespace and resumes if the user switches back.

If a fix branch was created _off_ the review branch (`feat/x` → `feat/x-review-fix`), say so explicitly and either: (a) move/copy the packet into the new branch folder, (b) symlink from the new branch folder to the old packet, or (c) create a new packet and link the old `packet_id` in `scope`. The user has a workflow preference here; ask if unsure.

### Two active packets on the same branch

Rare (one branch usually = one active loop), but allowed. Addressing takes the latest filename in the branch folder (lexical sort). If the user wants to engage an older packet, they pass `--packet=<path>` or address it by name in the prompt.

### User cwd is a subdirectory (monorepo)

Step 0's `git rev-parse --show-toplevel` always resolves to the repo root regardless of cwd, so `.review-handoff/active/` is always read from the repo root. Never use `./.review-handoff/` or `../../.review-handoff/` — always `$repo_root/.review-handoff/`.

### Resuming an archived packet

If the user explicitly says "go back to packet X" and X is in `archive/`, do NOT mutate it in place. Copy back to `active/<branch_slug>/` with a fresh local-minute filename (preserving `scope_slug`), increment `round`, and continue. The original archived file remains as historical record.

### Two agents writing simultaneously

Not supported. The protocol assumes serial handoff (CC writes → user switches to Codex → Codex writes → ...). If agents truly contend, the second writer should refuse and report the conflict. We don't implement a lock because the cost outweighs the benefit at our concurrency level (≈ 0).

### Packet file got hand-edited by the user

Allowed. The user is the source of truth. The agent should re-read the entire file before its next write and accept the user's edits. Do not lecture about append-only — the user is not the agent.

### Terminal Verdict written but the agent forgot to apply lifecycle action

Self-heal: on next addressing call, if `last_anchor in {review_findings, re_review}` and the section's terminal verdict + file location don't match `lifecycle_state`, the agent should silently update `lifecycle_state` to the derived value and (if needed) `mv` the file. Treat this as a post-condition repair, not a finding to report.
