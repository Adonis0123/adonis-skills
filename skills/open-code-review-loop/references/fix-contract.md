# Fixer result contract

Load this reference before invoking an external Fixer. Its user-authorized
isolated checkout must already be the authoritative `$REPO` used to build the
current evidence. Give the Fixer only the verified findings, frozen write
boundary, current evidence ID, and acceptance checks. The Fixer must return one
JSON object and no surrounding Markdown.

Use [fix-schema.json](fix-schema.json) when the selected product supports an
output schema.

```json
{
  "schema_version": "1",
  "evidence_id": "sha256:<current evidence>",
  "finding_ids": ["OCR-001"],
  "status": "FIXED",
  "changed_paths": ["relative/path.ts"],
  "summary": "Smallest coherent repair that was attempted",
  "block_reason": null
}
```

For `BLOCKED`, provide a non-empty `block_reason`. For `FIXED`, use `null`.
After product-envelope extraction, validate the report before inspecting its
claims:

```bash
python3 <skill-dir>/scripts/validate_fix_result.py \
  --fix "$ROUND_DIR/fix.json" \
  --evidence-id "$CURRENT_EVIDENCE_ID" \
  --finding-id "OCR-001" \
  --output "$ROUND_DIR/fix-validation.json"
```

Malformed output gets at most one correction in the same known-delivery Fixer
session. A valid report still does not prove a mutation.

## Host-owned verification

The Fixer's `status`, `changed_paths`, summary, and claimed checks are
untrusted reports. They never prove that a write happened or that a finding is
resolved. After every Fixer return, the visible host must:

1. Recompute the real Git status and diff without resetting existing changes.
2. Reject every path outside the frozen write boundary as `HUMAN_GATE`.
3. Derive actual changed paths from Git rather than the Fixer response.
4. Re-open the cited code and run the host-owned acceptance checks.
5. Rebuild the OCR bundle before another Reviewer verdict can be accepted.

An external Fixer must operate in the user-authorized isolated writable `$REPO`
that the Reviewer and evidence builder have used since round 1. The checks
below are evidence gates after delivery; they are not a substitute for write
isolation and cannot safely undo an out-of-scope mutation in a dirty worktree.
This version has no patch-transfer mode.

If `status` is `FIXED` but Git/evidence did not change and the verified finding
still reproduces, classify the attempt as `FIXER_NO_MUTATION`. Delivery is
known in this case, so one correction in the same Fixer session is allowed.
If that correction also makes no valid mutation, return `UNVERIFIED`; do not
loop indefinitely.

A timeout, connection loss, non-zero exit, or truncated response after writes
may have occurred is different. Recompute Git state and return
`UNVERIFIED: DELIVERY_UNKNOWN_WITH_MUTATION`; never retry, reset, or assume the
reported `changed_paths` are complete.
