#!/usr/bin/env python3
"""Validate a Fixer report before host-owned Git and test verification."""

from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
from typing import Any


FIELDS = {
    "schema_version",
    "evidence_id",
    "finding_ids",
    "status",
    "changed_paths",
    "summary",
    "block_reason",
}
STATUSES = {"FIXED", "BLOCKED"}
EVIDENCE_ID_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


def load_object(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain one JSON object")
    return value


def non_empty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate(
    result: dict[str, Any],
    expected_evidence_id: str | None = None,
    expected_finding_ids: list[str] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    unknown = sorted(set(result) - FIELDS)
    if unknown:
        errors.append(f"fix result has unknown fields: {', '.join(unknown)}")
    missing = sorted(FIELDS - set(result))
    if missing:
        errors.append(f"fix result is missing fields: {', '.join(missing)}")

    if result.get("schema_version") != "1":
        errors.append("schema_version must be '1'")
    evidence_id = result.get("evidence_id")
    if not isinstance(evidence_id, str) or not EVIDENCE_ID_PATTERN.fullmatch(
        evidence_id
    ):
        errors.append("evidence_id must be a canonical sha256 digest")
    if expected_evidence_id is not None and evidence_id != expected_evidence_id:
        errors.append("evidence_id does not match the Fixer task")

    finding_ids = result.get("finding_ids")
    if not isinstance(finding_ids, list):
        errors.append("finding_ids must be an array")
        finding_ids = []
    elif not finding_ids:
        errors.append("finding_ids must contain at least one finding id")
    seen_finding_ids: set[str] = set()
    valid_finding_ids: list[str] = []
    for index, finding_id in enumerate(finding_ids):
        if not non_empty(finding_id):
            errors.append(f"finding_ids[{index}] must be a non-empty string")
            continue
        if finding_id in seen_finding_ids:
            errors.append(f"duplicate finding id: {finding_id}")
        seen_finding_ids.add(finding_id)
        valid_finding_ids.append(finding_id)
    if expected_finding_ids is not None and set(valid_finding_ids) != set(
        expected_finding_ids
    ):
        errors.append("finding_ids do not match the Fixer task")
    status = result.get("status")
    if not isinstance(status, str) or status not in STATUSES:
        errors.append("status must be FIXED or BLOCKED")
    if not non_empty(result.get("summary")):
        errors.append("summary must be a non-empty string")

    changed_paths = result.get("changed_paths")
    if not isinstance(changed_paths, list):
        errors.append("changed_paths must be an array")
        changed_paths = []
    seen: set[str] = set()
    for index, path in enumerate(changed_paths):
        if not non_empty(path):
            errors.append(f"changed_paths[{index}] must be a non-empty string")
            continue
        posix = PurePosixPath(path)
        windows = PureWindowsPath(path)
        if (
            "\0" in path
            or "\\" in path
            or posix.is_absolute()
            or windows.is_absolute()
            or bool(windows.drive)
            or ".." in posix.parts
            or ".." in windows.parts
            or path == "."
            or path != posix.as_posix()
        ):
            errors.append(f"changed_paths[{index}] must be repository-relative")
        if path in seen:
            errors.append(f"duplicate changed path: {path}")
        seen.add(path)

    block_reason = result.get("block_reason")
    if status == "FIXED" and block_reason is not None:
        errors.append("FIXED requires null block_reason")
    if status == "BLOCKED" and not non_empty(block_reason):
        errors.append("BLOCKED requires a non-empty block_reason")

    return {
        "valid": not errors,
        "evidence_id": evidence_id,
        "finding_ids": finding_ids,
        "status": status,
        "reported_changed_paths": changed_paths,
        "errors": errors,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fix", required=True)
    parser.add_argument("--evidence-id", required=True)
    parser.add_argument("--finding-id", action="append", required=True)
    parser.add_argument("--output")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validation = validate(
            load_object(args.fix),
            expected_evidence_id=args.evidence_id,
            expected_finding_ids=args.finding_id,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        validation = {"valid": False, "errors": [str(error)]}
    rendered = json.dumps(validation, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if validation.get("valid") else 2


if __name__ == "__main__":
    raise SystemExit(main())
