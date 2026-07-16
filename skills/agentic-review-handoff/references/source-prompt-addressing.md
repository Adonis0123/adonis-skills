# Source Prompt Addressing

Resolve an optional `review-prompt-composer` artifact as provenance for an agentic review loop. Prompt content supplies scope and user-declared objectives; it never proves a reviewer finding.

## Resolution order

Use the first unambiguous source:

1. an explicit `--prompt-id=<id>` or named prompt path;
2. a line matching `Review-Prompt-ID: \`<id>\`` in pasted feedback;
3. `source_prompt_id` already present in the current packet;
4. the only non-expired prompt under the current branch's `prompts/active/` directory;
5. otherwise ask the user.

Do not silently choose the latest file when multiple valid prompts remain. No prompt is required for agentic workflows that have no prompt signal and no active prompt candidate.

## ID format

Accept only IDs matching:

```regex
^[a-z0-9._-]+/[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[a-z0-9-]+(?:-[0-9]{2})?$
```

The first segment is `branch_slug`; the second is the filename without `.md`. Reject absolute paths, backslashes, empty segments, `.` or `..`, percent-encoded traversal, and any value outside this grammar before reading a file.

For the unique current-branch fallback, derive the prompt branch slug exactly as `review-prompt-composer` does: lowercase the Git branch, replace `/` and `\` with `-`, replace every remaining run outside `[a-z0-9._-]` with `-`, then trim leading and trailing `-` or `.`. This prompt slug is independent from the historical packet-folder slug and must not be inferred from a packet path.

## Candidate paths

Resolve the repository root first, then construct exactly these candidates from parsed ID components:

```text
$repo_root/.review-handoff/prompts/active/<branch_slug>/<filename>.md
$repo_root/.review-handoff/prompts/archive/<branch_slug>/<filename>.md
```

Resolve each existing candidate to a real path and verify it remains a descendant of the corresponding `prompts/active/` or `prompts/archive/` root. Never concatenate an unvalidated user string into a shell command.

Require exactly one match. Zero matches means unresolved; two matches means an active/archive identity conflict that must stop packet writes until the user resolves it.

## Frontmatter validation

Read the whole prompt and require:

```yaml
artifact_type: review_prompt
format_version: 1
prompt_id: <exact requested ID>
head: <40-character Git SHA>
scope: <canonical scope>
expires_at: <timezone-aware ISO 8601 timestamp>
lifecycle_state: active | expired
```

An active candidate must live under `prompts/active/`, have `lifecycle_state: active`, and not be past `expires_at`. An archived candidate must live under `prompts/archive/` and have `lifecycle_state: expired`.

Expired prompts are valid historical provenance only when explicitly identified, echoed in feedback, or already recorded by a packet. Never choose an expired prompt through the unique-current-branch fallback.

## Packet provenance

Copy only these values into packet frontmatter:

```yaml
source_prompt_id: feat-auth/2026-07-15_14-30-all-uncommitted
source_prompt_head: 78b4382b19abd651a2274b5f6f188849cbec845d
source_prompt_scope: all-uncommitted
```

If a packet already contains provenance, require a newly resolved prompt to match its `source_prompt_id`. Stop and ask on mismatch; never silently replace provenance.

Do not copy the prompt's absolute path. The ID is repository-local and stable across active/archive moves.

## Ownership boundary

`agentic-review-handoff` may read a source prompt but must never edit, expire, archive, delete, or rewrite it. Validate pasted feedback against current code even when it cites a prompt. Current repository evidence wins over prompt summaries, reviewer claims, and fixer claims.
