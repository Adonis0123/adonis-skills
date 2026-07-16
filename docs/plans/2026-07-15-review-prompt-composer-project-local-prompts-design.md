# Review Prompt Composer Project-Local Prompts Design

## Background

`review-prompt-composer` currently supports cross-environment delivery by generating repository-external patches, archives, and a manifest when the receiver cannot access the working tree. The actual workflow for this repository is narrower: the user copies a review prompt to another team that can read the same repository and working tree.

In that workflow, portable payload files duplicate the source of truth, make delivery harder, and can become stale relative to the shared working tree. The desired outcome is a single Markdown prompt that is easy to find, inspect, copy, expire, and later correlate with an `agentic-review-handoff` review loop.

## Goals

- Generate one complete, copy-ready Markdown review prompt.
- Store prompts inside the repository under the existing `.review-handoff/` artifact root.
- Keep prompt artifacts ignored without modifying the tracked `.gitignore`.
- Use deterministic branch-aware naming, timestamps, and a 24-hour lifetime.
- Let `agentic-review-handoff` resolve a prompt from a stable `Review-Prompt-ID`.
- Preserve strict staged, unstaged, untracked, all-uncommitted, and ref-range scope semantics.
- Keep reviewed source files as the only source of truth; do not duplicate them into patch or archive payloads.

## Non-goals

- Cross-machine or cross-environment delivery.
- Portable patch, tar, binary payload, manifest, or checksum generation.
- Automatically sending prompts or reviewer feedback.
- Letting `review-prompt-composer` own the review/fix/re-review lifecycle.
- Letting `agentic-review-handoff` modify prompt contents or prompt expiration.

## First-Principles Decision

The receiver already has the same repository and working tree. Therefore the minimum complete handoff consists of:

1. a precise pointer to the shared repository and current Git state;
2. one unambiguous review scope;
3. an evidence-backed change inventory and falsifiable review objective;
4. repository-defined checks and a reviewer output contract.

Copying source changes into `tracked.patch`, `prerequisite-staged.patch`, or `untracked-files.tar.gz` would create a second representation of the same state without adding access. Those artifacts and their manifest are removed from the design.

## Domain Boundaries

The repository-local `.review-handoff/` directory is a shared infrastructure namespace, not a shared domain model.

- `review-prompt-composer` owns immutable review-prompt content plus prompt expiration and prompt addressing under `prompts/**`.
- `agentic-review-handoff` owns append-only review-loop packets and their active/archive lifecycle under the existing top-level `active/**` and `archive/**` paths.
- The contexts communicate only through a small published contract: `Review-Prompt-ID` and `source_prompt_id`.

This keeps each model cohesive while making the relationship explicit, consistent with bounded-context guidance from [Martin Fowler](https://martinfowler.com/bliki/BoundedContext.html) and [Microsoft's domain-analysis guidance](https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis).

## Storage Layout

```text
$repo_root/.review-handoff/
├── active/                         # agentic-review-handoff, unchanged
├── archive/                        # agentic-review-handoff, unchanged
└── prompts/                        # review-prompt-composer only
    ├── active/
    │   └── <branch_slug>/
    │       └── YYYY-MM-DD_HH-mm-<scope_slug>.md
    └── archive/
        └── <branch_slug>/
            └── YYYY-MM-DD_HH-mm-<scope_slug>.md
```

`branch_slug` is the lowercase branch name with `/` and `\` replaced by `-`. The timestamp uses local time to keep filenames readable and lexically sortable. `scope_slug` contains one to three kebab-case words and is limited to 24 characters. Filename collisions append `-02`, `-03`, and so on.

All paths are resolved from `git rev-parse --show-toplevel`; callers running from monorepo subdirectories must not create a second `.review-handoff/` tree.

## Ignore Contract

Before writing the first prompt, ensure the repository-local Git exclude file contains the canonical pattern:

```gitignore
/.review-handoff/
```

Treat the historical unanchored `.review-handoff/` form as already configured so the operation remains idempotent. Do not modify the tracked `.gitignore`. Git documents `$GIT_COMMON_DIR/info/exclude` as the appropriate place for repository-specific workflow artifacts that should not be shared with other clones: [gitignore documentation](https://git-scm.com/docs/gitignore).

After creating or moving a prompt, verify that `git status --short` does not expose `.review-handoff/`.

## Prompt Frontmatter

```yaml
---
artifact_type: review_prompt
format_version: 1
prompt_id: feat-auth/2026-07-15_14-30-all-uncommitted
branch: feat/auth
head: 78b4382b19abd651a2274b5f6f188849cbec845d
scope: all-uncommitted
created_at: 2026-07-15T06:30:00Z
expires_at: 2026-07-16T06:30:00Z
lifecycle_state: active
---
```

The filename timestamp uses local time. `created_at` and `expires_at` use UTC ISO 8601 timestamps with `Z`. The default expiration is 24 hours after creation.

## Prompt Body Contract

Each file contains one complete prompt with these sections:

1. `# 审核任务`
2. `## 工作区与范围`
3. `## 待验证目标`
4. `## 改动清单`
5. `## 审核重点`
6. `## 检查命令` when reliable repository evidence exists
7. `## 输出要求`

The workspace section includes the absolute repository root, expected HEAD, canonical scope, explicit exclusions, and read-only commands for confirming repository identity and status. If the repository, HEAD, or recorded file status differs, the receiver must stop and report that the prompt is stale.

The output contract requires the reviewer to return the following line exactly:

```text
Review-Prompt-ID: `<prompt_id>`
```

The prompt must not embed a full patch, archive, manifest, checksum list, local conversation references, secret values, or unverified claims.

## Creation Flow

1. Resolve repository root, branch, HEAD, and `git status --short`.
2. Resolve `$GIT_COMMON_DIR` and ensure its shared `info/exclude` rule exists.
3. Scan the current branch's `prompts/active/` directory and archive expired prompts.
4. Map the user request to one canonical review scope.
5. Collect scope evidence, change inventory, review objectives, and repository-defined check commands without running tests.
6. Write the new prompt to a same-directory temporary file and atomically rename it to its final name.
7. Verify the artifact remains ignored.
8. Return a clickable prompt path and a short summary in chat. The file is the authoritative copy.

New prompt generation never overwrites or edits an existing active prompt.

## Expiration and Archive

- A prompt is active until `expires_at`.
- On a later composer invocation, expired active prompts are moved to the matching branch under `prompts/archive/`.
- The move atomically updates only frontmatter metadata needed to set `lifecycle_state: expired`; the prompt body remains unchanged.
- Expired prompts are not automatically deleted.
- A malformed prompt is preserved in place and reported; the skill must not guess how to repair or archive it.
- Time expiration is a cleanup and usability boundary, not proof that the working tree remained unchanged. Repository identity, HEAD, and recorded status still need receiver validation.

## Agentic Review Handoff Integration

### Shared Identifier

`prompt_id` has the form:

```text
<branch_slug>/<filename_without_md>
```

Example:

```text
feat-auth/2026-07-15_14-30-all-uncommitted
```

### Resolution Order

`agentic-review-handoff` resolves a source prompt in this order:

1. an explicit `--prompt-id=<id>` or prompt path supplied by the user;
2. `Review-Prompt-ID: ...` parsed from pasted reviewer feedback;
3. `source_prompt_id` already stored in the current review-loop packet;
4. the only non-expired prompt for the current branch;
5. ask the user when the source still cannot be uniquely identified.

It must not silently choose the latest file when multiple valid candidates remain.

### Safe Addressing

Resolve IDs only beneath:

```text
.review-handoff/prompts/active/<branch_slug>/<filename>.md
.review-handoff/prompts/archive/<branch_slug>/<filename>.md
```

Reject absolute-path injection, `..`, paths outside `prompts/**`, frontmatter ID mismatches, and duplicate active/archive matches.

### Packet Provenance

After resolving the source, the agentic packet records:

```yaml
source_prompt_id: feat-auth/2026-07-15_14-30-all-uncommitted
source_prompt_head: 78b4382b19abd651a2274b5f6f188849cbec845d
source_prompt_scope: all-uncommitted
```

The agentic skill may read the prompt as provenance and context. It does not modify, expire, archive, or treat the prompt summary as verified review evidence. An expired prompt can remain historical provenance, but reviewer feedback must be validated against current code before fixes are applied.

## Error Handling

- Fail without writing when outside a Git repository or when the selected scope is empty.
- Fail rather than silently broaden an ambiguous or conflicting scope.
- Add a collision suffix instead of overwriting an existing file.
- Preserve malformed or unreadable active prompts and report them.
- Use same-directory temporary files plus atomic rename for prompt creation and frontmatter updates.
- Inspect content before embedding it in the prompt; report sensitive paths and risk types without printing secret values.
- Treat ignore bootstrapping as idempotent and verify that generated artifacts remain absent from Git status.
- Never run repository tests, modify reviewed source, stage, commit, stash, push, or send the prompt.

## Verification Strategy

Automated tests and evals must cover:

1. repository-root resolution from a nested working directory;
2. branch-slug storage and deterministic filename generation;
3. strict staged, unstaged, untracked, all-uncommitted, and ref-range scopes;
4. real HEAD, absolute repository path, status inventory, and complete prompt structure;
5. absence of patch, tar, manifest, checksum, and portable-bundle artifacts;
6. collision suffixes;
7. active prompts before 24 hours and archive behavior after expiration;
8. preservation of malformed prompts;
9. idempotent canonical and historical exclude patterns;
10. unchanged Git status after prompt writes;
11. secret-safe output and absence of unresolved placeholders;
12. `Review-Prompt-ID` echo requirements;
13. agentic resolution from explicit ID, pasted feedback, existing packet provenance, and a unique current-branch prompt;
14. ambiguity refusal and path-traversal rejection;
15. agentic provenance fields without mutation of the source prompt.

Repository validation commands:

```bash
python3 skills/review-prompt-composer/scripts/test_*.py
pnpm skills:quick-validate skills/review-prompt-composer
pnpm skills:quick-validate skills/agentic-review-handoff
pnpm skills:validate
pnpm skills:index
```

## Accepted Design Decisions

- Shared repository and working tree only; no cross-environment support.
- One authoritative Markdown prompt file.
- Repository-local storage under `.review-handoff/prompts/**`.
- Shared ignore bootstrapping through `$GIT_COMMON_DIR/info/exclude`.
- Local-time sortable filenames and UTC metadata timestamps.
- Default 24-hour prompt expiration with archive, not deletion.
- Stable reviewer-echoed `Review-Prompt-ID` with safe agentic fallback resolution.
- No automatic commit, push, or implementation as part of this design phase.
