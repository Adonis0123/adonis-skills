# Packet Addressing

How to find / create / name / advance / archive packet files. Read this when you need to confirm a `lifecycle_state` value, handle an edge case, or understand why the addressing rules exist.

## Storage layout

```
$repo_root/
├── .git/info/exclude           ← contains "/.review-handoff/" (auto-managed by this skill)
├── .gitignore                  ← only adonis-skills repo itself dogfoods this; other repos rely on .git/info/exclude
└── .review-handoff/
    ├── active/                 ← in-progress packets; addressing always reads here first
    │   └── <branch_slug>/
    │       └── <local_minute>-<scope_slug>.md
    └── archive/                ← terminal-state PASS / NO_FINDINGS packets; user cleans manually
        └── <branch_slug>/
            └── <local_minute>-<scope_slug>.md
```

**Why repo-local + per-repo isolation**: the protocol is for two CLI agents running on the same machine in the same repo, taking turns. We don't sync packets across machines (use `docs/reviews/` and remove the gitignore line if you ever need that). We do not modify the target repo's `.gitignore` because this skill runs in repos that don't belong to its author; per-repo `.git/info/exclude` is the right git-native isolation primitive (local-only, not in history, never affects collaborators).

## Filename format

```
.review-handoff/active/<branch_slug>/<local_minute>-<scope_slug>.md
```

- `branch_slug`: `git rev-parse --abbrev-ref HEAD` lowercased, with `/` and `\` replaced by `-`.
- `local_minute`: readable local minute stamp `YYYY-MM-DD_HH-mm` (e.g. `2026-05-15_14-30`). It is precise to minutes and keeps lexical sort = chronological sort inside a branch folder.
- `scope_slug`: 1–3 kebab-case words from the user's stated scope (or the first feature keyword if not stated). Max 24 chars. Must not contain `/`.
- Collision rule: if the exact filename already exists in `active/` or `archive/`, append `-02`, `-03`, ... to the `scope_slug` before `.md`. Do not add seconds back into the timestamp.

Example: `.review-handoff/active/feat-payment/2026-05-15_14-30-refactor-checkout.md`.

## Addressing algorithm (every stage entry)

Re-stated from `SKILL.md` for completeness. Run this every time before writing output.

```
0. repo_root=$(git rev-parse --show-toplevel)
   - Not in a git repo → fail loudly. The packet protocol requires a repo identity.
1. branch_slug = lowercase($(git rev-parse --abbrev-ref HEAD) with "/" and "\" → "-")
2. ls $repo_root/.review-handoff/active/${branch_slug}/*.md | sort
3. tail -1:
   - Exists → read whole file. Find the last H1 anchor and frontmatter.
     · lifecycle_state in {in_progress, blocked} → continue normally based on last_anchor.
     · lifecycle_state == awaiting_user_decision and user said "fix it" / "修一下" / "改吧"
       → start a new round: append # Fix Completion (round N+1), increment round.
     · lifecycle_state == archived → the user is engaging a finished packet; copy it back
       to active/$branch_slug/ with a new local_minute filename and a new round before continuing.
   - Does not exist → creation path:
     · implementer-initiated → start with # Review Handoff (reviewer will append the rest)
     · reviewer-initiated → start with # Review Intake → # Review Findings, then branch on Verdict:
       - Verdict in {BLOCKED, PASS_WITH_CONCERNS} → append # Fix Handoff (continues to fix)
       - Verdict in {PASS, NO_FINDINGS}            → DO NOT write # Fix Handoff; archive immediately
         (mv packet from active/$branch_slug/ to archive/$branch_slug/, set lifecycle_state = archived). See SKILL.md
         Lifecycle and Archive Trigger 1.
4. --packet=<path> override: prefer it, but verify the path is under $repo_root/.review-handoff/.
```

## Frontmatter fields (full reference)

| Field | Type | Maintained by | Description |
|---|---|---|---|
| `packet_id` | string | creator | Equals `<branch_slug>/<filename without .md>`. Acts as packet identity across active/archive moves (creator must not change after creation). |
| `branch` | string | creator | Original `git branch` value, including `/`. Kept for traceability when filename's `branch_slug` has been munged. |
| `scope` | string | creator | Free-form 1-line scope description from the user. |
| `created` | ISO datetime (UTC, with `Z`) | creator | Set once at creation, never modified. |
| `updated` | ISO datetime (UTC, with `Z`) | every writer | Updated on every frontmatter rewrite (i.e. after every H1 append). |
| `last_anchor` | enum (see below) | every writer | **Structural fact**: the last H1 anchor in the body, normalized. |
| `lifecycle_state` | enum (see below) | every writer | **Domain state**: where this packet sits in its review-loop lifecycle. |
| `round` | int | writer of `# Fix Completion (round N)` and `# Re-review (round N)` | Default 1. Increment when starting a new fix round. |

### `last_anchor` values

Direct normalization of H1 anchor text: strip `# `, strip ` (round N)` suffix, snake_case.

| H1 written | `last_anchor` |
|---|---|
| `# Review Handoff` | `review_handoff` |
| `# Review Intake` | `review_intake` |
| `# Review Findings` | `review_findings` |
| `# Fix Handoff` | `fix_handoff` |
| `# Fix Completion` or `# Fix Completion (round N)` | `fix_completion` |
| `# Re-review` or `# Re-review (round N)` | `re_review` |

### `lifecycle_state` values

| Value | Meaning |
|---|---|
| `in_progress` | Loop still running. Default state from creation through `# Re-review` write. |
| `awaiting_user_decision` | Re-review verdict was `PASS_WITH_CONCERNS`. Packet stays in `active/` waiting for user to either say "fix it" (auto-resumes to round N+1) or manually `mv` to archive (drop the concerns). |
| `blocked` | Re-review verdict was `BLOCKED`. Waiting for fixer to start the next round. |
| `archived` | Terminal state. Two ways in: (a) first-pass `# Review Findings` Verdict was `PASS` / `NO_FINDINGS` (golden path — no Fix Handoff written); (b) `# Re-review` (or `# Re-review (round N)`) Verdict was `PASS` / `NO_FINDINGS`. In both cases the packet file has been `mv`'d to `archive/`. |

## Lifecycle derivation table (validator / eval source of truth)

`lifecycle_state` is **not** simply the snake_case of the last H1. It must satisfy this table — both the validator and eval assertions should compute the expected `lifecycle_state` from this table, not from the H1 anchor alone.

| `last_anchor` | Verdict (in `# Review Findings` for first-pass, in `# Re-review` for subsequent rounds) | File location | Expected `lifecycle_state` |
|---|---|---|---|
| `review_handoff` / `review_intake` | (no Verdict yet — review not done) | `active/` | `in_progress` |
| `review_findings` | (no Verdict written yet, or Verdict ∈ `BLOCKED` / `PASS_WITH_CONCERNS` — fix needed) | `active/` | `in_progress` |
| `review_findings` | `PASS` / `NO_FINDINGS` (first-pass terminal — no fix needed, no Fix Handoff written) | `archive/` | `archived` |
| `fix_handoff` / `fix_completion` | (n/a — Re-review hasn't run yet) | `active/` | `in_progress` |
| `re_review` | `PASS` / `NO_FINDINGS` | `archive/` | `archived` |
| `re_review` | `PASS_WITH_CONCERNS` | `active/` | `awaiting_user_decision` |
| `re_review` | `BLOCKED` | `active/` | `blocked` |

The first-pass `review_findings` → `archived` row is the **golden-path terminal**: when reviewer finds no issues at all, no Fix Handoff is needed — the reviewer writes Verdict in `# Review Findings`, immediately archives the packet. No fixer involvement, no Re-review.

Any other combination is illegal:

- `last_anchor != re_review` with `lifecycle_state in {awaiting_user_decision, blocked}` → invalid (these states are exclusively post-Re-review).
- `last_anchor == re_review` with `lifecycle_state == in_progress` → invalid (Re-review wrote a verdict but lifecycle wasn't updated).
- `lifecycle_state == archived` while file is in `active/` → invalid (archive action skipped).
- `lifecycle_state != archived` while file is in `archive/` → invalid (file moved without lifecycle update, or vice versa).
- `last_anchor in {review_handoff, review_intake}` with `lifecycle_state == archived` → invalid (review never produced findings; no terminal verdict to archive on).

## `.git/info/exclude` bootstrapping

Before creating the first packet in any repo:

```bash
exclude_file="$repo_root/.git/info/exclude"
mkdir -p "$repo_root/.git/info"
touch "$exclude_file"
# Canonical form is /.review-handoff/ (leading slash anchors to repo root).
# Tolerate the unanchored form .review-handoff/ from earlier versions of this
# skill so re-running bootstrap doesn't append a duplicate line.
grep -qE '^/?\.review-handoff/$' "$exclude_file" || echo '/.review-handoff/' >> "$exclude_file"
```

This is repo-local, never enters git history, never modifies `.gitignore` (which would dirty the working tree of a repo that isn't yours). Verify with `git status --short` that `.review-handoff/` does not appear after a packet write.

## Edge cases

### Branch switch mid-loop

`git rev-parse --abbrev-ref HEAD` is read at every addressing call. If the user switched branches between stages, the agent will list a different `active/` namespace and may not find a packet — that is correct behavior. The previous-branch packet stays in its own namespace and resumes if the user switches back.

If a fix branch was created *off* the review branch (`feat/x` → `feat/x-review-fix`), say so explicitly and either: (a) move/copy the packet into the new branch folder, (b) symlink from the new branch folder to the old packet, or (c) create a new packet and link the old `packet_id` in `scope`. The user has a workflow preference here; ask if unsure.

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
