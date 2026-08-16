#!/usr/bin/env python3
"""Validate an AI reviewer result against an OCR review bundle."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import re
from pathlib import Path
from typing import Any


PRODUCTS = {"codex", "claude-code", "grok-build", "cursor-cli"}
CATEGORIES = {
    "bug",
    "security",
    "performance",
    "maintainability",
    "test",
    "style",
    "documentation",
    "other",
}
SEVERITIES = {"critical", "high", "medium", "low"}
VERDICTS = {"FINDINGS", "NO_FINDINGS", "BLOCKED"}
EVIDENCE_ID_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
BUNDLE_MATERIAL_FIELDS = (
    "schema_version",
    "mode",
    "base_sha",
    "ocr_version",
    "refs",
    "reviewable_files",
    "excluded_files",
    "accepted_exclusion_reasons",
    "unaccepted_excluded_files",
    "background",
    "rules",
    "files",
)
REVIEW_FIELDS = {
    "schema_version",
    "evidence_id",
    "reviewer",
    "files",
    "findings",
    "verdict",
    "block_reason",
}
REVIEWER_FIELDS = {"product", "session_id"}
FILE_FIELDS = {"path", "status", "disposition", "reason"}
FINDING_FIELDS = {
    "id",
    "path",
    "start_line",
    "end_line",
    "category",
    "severity",
    "content",
    "required_fix",
    "acceptance_check",
}


def load_object(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain one JSON object")
    return value


def non_empty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def canonical_evidence_id(bundle: dict[str, Any]) -> str | None:
    if any(field not in bundle for field in BUNDLE_MATERIAL_FIELDS):
        return None
    material = {field: bundle[field] for field in BUNDLE_MATERIAL_FIELDS}
    encoded = json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def identity(entry: Any) -> tuple[str, str]:
    if not isinstance(entry, dict):
        return "", ""
    path = entry.get("path")
    status = entry.get("status")
    return (
        path if isinstance(path, str) else "",
        status if isinstance(status, str) else "",
    )


def reject_unknown_fields(
    errors: list[str], label: str, value: dict[str, Any], allowed: set[str]
) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        errors.append(f"{label} has unknown fields: {', '.join(unknown)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--review", required=True)
    parser.add_argument("--output")
    return parser.parse_args()


def validate(bundle: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    reject_unknown_fields(errors, "review", review, REVIEW_FIELDS)
    expected_entries = bundle.get("reviewable_files")
    files = review.get("files")
    findings = review.get("findings")
    reviewer = review.get("reviewer")
    verdict = review.get("verdict")
    unaccepted_excluded = bundle.get("unaccepted_excluded_files")

    if review.get("schema_version") != "1":
        errors.append("schema_version must be '1'")
    bundle_evidence_id = bundle.get("evidence_id")
    review_evidence_id = review.get("evidence_id")
    if not isinstance(bundle_evidence_id, str) or not EVIDENCE_ID_PATTERN.fullmatch(
        bundle_evidence_id
    ):
        errors.append("bundle.evidence_id must be a canonical sha256 digest")
    computed_evidence_id = canonical_evidence_id(bundle)
    if computed_evidence_id is None:
        missing = sorted(set(BUNDLE_MATERIAL_FIELDS) - set(bundle))
        errors.append(
            "bundle is missing canonical evidence material fields: "
            + ", ".join(missing)
        )
    elif bundle_evidence_id != computed_evidence_id:
        errors.append("bundle.evidence_id does not match canonical bundle material")
    if not isinstance(review_evidence_id, str) or not EVIDENCE_ID_PATTERN.fullmatch(
        review_evidence_id
    ):
        errors.append("review.evidence_id must be a canonical sha256 digest")
    if review_evidence_id != bundle_evidence_id:
        errors.append("evidence_id does not match the bundle")
    if not isinstance(expected_entries, list):
        errors.append("bundle.reviewable_files must be an array")
        expected_entries = []
    if not isinstance(files, list):
        errors.append("files must be an array")
        files = []
    if not isinstance(findings, list):
        errors.append("findings must be an array")
        findings = []
    if not isinstance(reviewer, dict):
        errors.append("reviewer must be an object")
        reviewer = {}
    reject_unknown_fields(errors, "reviewer", reviewer, REVIEWER_FIELDS)
    product = reviewer.get("product")
    if not isinstance(product, str) or product not in PRODUCTS:
        errors.append("reviewer.product is not a supported canonical product id")
    if "session_id" not in reviewer:
        errors.append("reviewer.session_id must be present")
    elif reviewer.get("session_id") is not None and not non_empty(
        reviewer.get("session_id")
    ):
        errors.append("reviewer.session_id must be null or a non-empty string")
    if not isinstance(verdict, str) or verdict not in VERDICTS:
        errors.append("verdict must be FINDINGS, NO_FINDINGS, or BLOCKED")
    if "block_reason" not in review:
        errors.append("block_reason must be present")
    elif review.get("block_reason") is not None and not isinstance(
        review.get("block_reason"), str
    ):
        errors.append("block_reason must be null or a string")
    if verdict != "BLOCKED" and review.get("block_reason") is not None:
        errors.append("block_reason must be null unless verdict is BLOCKED")
    if not isinstance(unaccepted_excluded, list):
        errors.append("bundle.unaccepted_excluded_files must be an array")
        unaccepted_excluded = []

    expected_counter = Counter(identity(entry) for entry in expected_entries)
    actual_counter = Counter(identity(entry) for entry in files if isinstance(entry, dict))
    if expected_counter != actual_counter:
        errors.append("files must account for every OCR (path, status) identity exactly once")

    reviewed = 0
    skipped = 0
    expected_paths = {path for path, _ in expected_counter}
    for index, entry in enumerate(files):
        if not isinstance(entry, dict):
            errors.append(f"files[{index}] must be an object")
            continue
        reject_unknown_fields(errors, f"files[{index}]", entry, FILE_FIELDS)
        if not non_empty(entry.get("path")):
            errors.append(f"files[{index}].path must be a non-empty string")
        if not non_empty(entry.get("status")):
            errors.append(f"files[{index}].status must be a non-empty string")
        disposition = entry.get("disposition")
        if disposition == "reviewed":
            reviewed += 1
        elif disposition == "skipped":
            skipped += 1
            if not non_empty(entry.get("reason")):
                errors.append(f"files[{index}].reason is required when skipped")
        else:
            errors.append(f"files[{index}].disposition must be reviewed or skipped")
        if "reason" not in entry:
            errors.append(f"files[{index}].reason must be present")
        elif not non_empty(entry.get("reason")):
            errors.append(f"files[{index}].reason must be a non-empty string")

    finding_ids: set[str] = set()
    required_strings = ("id", "path", "content", "required_fix", "acceptance_check")
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            errors.append(f"findings[{index}] must be an object")
            continue
        reject_unknown_fields(errors, f"findings[{index}]", finding, FINDING_FIELDS)
        for field in required_strings:
            if not non_empty(finding.get(field)):
                errors.append(f"findings[{index}].{field} must be a non-empty string")
        finding_id = finding.get("id")
        if isinstance(finding_id, str):
            if finding_id in finding_ids:
                errors.append(f"duplicate finding id: {finding_id}")
            finding_ids.add(finding_id)
        if finding.get("path") not in expected_paths:
            errors.append(f"findings[{index}].path is outside the OCR reviewable set")
        category = finding.get("category")
        if not isinstance(category, str) or category not in CATEGORIES:
            errors.append(f"findings[{index}].category is invalid")
        severity = finding.get("severity")
        if not isinstance(severity, str) or severity not in SEVERITIES:
            errors.append(f"findings[{index}].severity is invalid")
        start = finding.get("start_line")
        end = finding.get("end_line")
        if "start_line" not in finding or "end_line" not in finding:
            errors.append(
                f"findings[{index}].start_line and end_line must be present"
            )
        if (start is None) != (end is None):
            errors.append(
                f"findings[{index}] must include start_line and end_line together or omit both"
            )
        if start is not None and (not isinstance(start, int) or isinstance(start, bool) or start < 1):
            errors.append(f"findings[{index}].start_line must be a positive integer")
        if end is not None and (not isinstance(end, int) or isinstance(end, bool) or end < 1):
            errors.append(f"findings[{index}].end_line must be a positive integer")
        if isinstance(start, int) and isinstance(end, int) and end < start:
            errors.append(f"findings[{index}].end_line must be >= start_line")

    total = len(expected_entries)
    coverage_rate = 1.0 if total == 0 else reviewed / total
    if verdict == "NO_FINDINGS":
        if findings:
            errors.append("NO_FINDINGS requires an empty findings array")
        if skipped or reviewed != total:
            errors.append("NO_FINDINGS requires 100% reviewed coverage and zero skipped files")
        if unaccepted_excluded:
            errors.append("NO_FINDINGS requires zero unaccepted excluded files")
    elif verdict == "FINDINGS":
        if not findings:
            errors.append("FINDINGS requires at least one finding")
        if skipped or reviewed != total:
            errors.append("FINDINGS requires full reviewed coverage and zero skipped files")
    elif verdict == "BLOCKED" and not non_empty(review.get("block_reason")):
        errors.append("BLOCKED requires block_reason")

    valid = not errors
    clean = valid and verdict == "NO_FINDINGS"
    return {
        "valid": valid,
        "clean": clean,
        "verdict": verdict,
        "evidence_id": bundle.get("evidence_id"),
        "total_files": total,
        "reviewed_files": reviewed,
        "skipped_files": skipped,
        "coverage_rate": coverage_rate,
        "finding_count": len(findings),
        "unaccepted_excluded_files": len(unaccepted_excluded),
        "errors": errors,
    }


def main() -> int:
    args = parse_args()
    try:
        result = validate(load_object(args.bundle), load_object(args.review))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        result = {"valid": False, "clean": False, "errors": [str(error)]}

    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if result.get("valid") else 2


if __name__ == "__main__":
    raise SystemExit(main())
