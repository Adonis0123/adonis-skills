# Reviewer result contract

Load this reference before invoking the selected Reviewer. The Reviewer must
return one JSON object and no surrounding Markdown. Use
[review-schema.json](review-schema.json) when the product supports an output
schema.

```json
{
  "schema_version": "1",
  "evidence_id": "sha256:<hex>",
  "reviewer": {
    "product": "codex|claude-code|grok-build|cursor-cli",
    "session_id": null
  },
  "files": [
    {
      "path": "relative/path.ts",
      "status": "modified",
      "disposition": "reviewed|skipped",
      "reason": "review rationale when reviewed; required when skipped"
    }
  ],
  "findings": [
    {
      "id": "OCR-001",
      "path": "relative/path.ts",
      "start_line": 10,
      "end_line": 12,
      "category": "bug|security|performance|maintainability|test|style|documentation|other",
      "severity": "critical|high|medium|low",
      "content": "Evidence-backed problem and impact",
      "required_fix": "Smallest acceptable repair",
      "acceptance_check": "Command or observable check that would falsify the problem"
    }
  ],
  "verdict": "FINDINGS|NO_FINDINGS|BLOCKED",
  "block_reason": null
}
```

## Invariants

1. `evidence_id` must equal the supplied bundle ID.
2. The selected review set is the union of `reviewable_files` and
   `supplemental_reviewable_files`. `files` must account for every selected
   `(path, status)` identity exactly once, applying both `rules` and
   `supplemental_rules`.
3. `NO_FINDINGS` requires an empty findings list, 100% reviewed coverage, and
   zero skipped files. The host additionally rejects clean when the bundle has
   any `unaccepted_excluded_files`.
4. `FINDINGS` requires at least one actionable finding and full file coverage.
5. `BLOCKED` requires a concrete reason. It is not a clean verdict.
6. Every finding path must belong to the selected review set. Nearby context may
   support a finding but does not silently expand the writable scope.
7. Do not report preferences, speculative redesigns, or unverified external
   claims. A low-severity item is still expected to be worth fixing now.
8. The Reviewer is read-only. It may run checks that require no writes, but must
   not edit source, tests, configs, Git state, the bundle, or temporary paths.
   The host runs tests that need caches or temporary directories.
9. The visible host replaces `reviewer.product` and `reviewer.session_id` with
   the canonical selected product and the recorded product session. Never
   trust model-authored identity fields.

The host validates this object with `scripts/validate_round.py`. One malformed
response may be corrected in the same Reviewer session; a second failure ends
the loop as `UNVERIFIED`.

`start_line` and `end_line` are positive integers when the issue maps to lines
in the new file. Use `null` for both on deleted files or a genuinely path-level
finding; never invent a line merely to satisfy the shape. Use `null` for
`block_reason` except on `BLOCKED`.

The portable provider schema keeps the two line fields independently nullable
because supported structured-output subsets differ. The local validator is the
authoritative semantic gate and rejects a one-null/one-integer pair.
