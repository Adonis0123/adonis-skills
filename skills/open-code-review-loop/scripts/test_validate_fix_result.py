#!/usr/bin/env python3

import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).with_name("validate_fix_result.py")
SPEC = importlib.util.spec_from_file_location("validate_fix_result", MODULE_PATH)
assert SPEC and SPEC.loader
validate_fix_result = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_fix_result)

EVIDENCE_ID = "sha256:" + "a" * 64


def fixed_result() -> dict:
    return {
        "schema_version": "1",
        "evidence_id": EVIDENCE_ID,
        "finding_ids": ["OCR-001"],
        "status": "FIXED",
        "changed_paths": ["src/example.ts"],
        "summary": "Restored the missing guard.",
        "block_reason": None,
    }


class ValidateFixResultTest(unittest.TestCase):
    def test_accepts_fixed_and_blocked_results(self) -> None:
        self.assertTrue(validate_fix_result.validate(fixed_result())["valid"])
        blocked = fixed_result()
        blocked.update(status="BLOCKED", changed_paths=[], block_reason="Needs a decision")
        self.assertTrue(validate_fix_result.validate(blocked)["valid"])

    def test_rejects_status_block_reason_mismatch(self) -> None:
        cases = [
            ("fixed reason", {"block_reason": "not null"}),
            ("blocked null", {"status": "BLOCKED", "block_reason": None}),
            ("blocked empty", {"status": "BLOCKED", "block_reason": ""}),
        ]
        for name, changes in cases:
            with self.subTest(name=name):
                result = fixed_result()
                result.update(changes)
                self.assertFalse(validate_fix_result.validate(result)["valid"])

    def test_rejects_empty_summary_and_unknown_fields(self) -> None:
        result = fixed_result()
        result["summary"] = ""
        result["note"] = "extra"
        validation = validate_fix_result.validate(result)
        self.assertFalse(validation["valid"])
        self.assertTrue(any("summary" in error for error in validation["errors"]))
        self.assertTrue(any("unknown" in error for error in validation["errors"]))

    def test_rejects_unsafe_or_malformed_changed_paths(self) -> None:
        cases = [
            ("absolute", ["/etc/passwd"], "repository-relative"),
            ("traversal", ["src/../../x.ts"], "repository-relative"),
            ("windows drive", [r"C:\outside\file.ts"], "repository-relative"),
            ("windows unc", [r"\\server\share\file.ts"], "repository-relative"),
            ("windows rooted", [r"\outside\file.ts"], "repository-relative"),
            ("windows traversal", [r"..\outside.ts"], "repository-relative"),
            ("nul", ["src/a\0.ts"], "repository-relative"),
            ("non-canonical", ["./src/a.ts"], "repository-relative"),
            ("duplicate", ["src/a.ts", "src/a.ts"], "duplicate changed path"),
            ("non-string", [7], "non-empty string"),
            ("empty", [""], "non-empty string"),
        ]
        for name, paths, error in cases:
            with self.subTest(name=name):
                result = fixed_result()
                result["changed_paths"] = paths
                validation = validate_fix_result.validate(result)
                self.assertFalse(validation["valid"])
                self.assertTrue(
                    any(error in message for message in validation["errors"]),
                    validation["errors"],
                )

    def test_rejects_missing_required_field(self) -> None:
        result = fixed_result()
        del result["changed_paths"]
        validation = validate_fix_result.validate(result)
        self.assertFalse(validation["valid"])
        self.assertIn(
            "fix result is missing fields: changed_paths", validation["errors"]
        )

    def test_rejects_wrong_evidence_or_finding_ledger(self) -> None:
        result = fixed_result()
        validation = validate_fix_result.validate(
            result,
            expected_evidence_id="sha256:" + "b" * 64,
            expected_finding_ids=["OCR-001", "OCR-002"],
        )
        self.assertFalse(validation["valid"])
        self.assertIn("evidence_id does not match the Fixer task", validation["errors"])
        self.assertIn("finding_ids do not match the Fixer task", validation["errors"])

    def test_rejects_malformed_evidence_id(self) -> None:
        result = fixed_result()
        result["evidence_id"] = "sha256:abc"
        validation = validate_fix_result.validate(
            result,
            expected_evidence_id="sha256:abc",
            expected_finding_ids=["OCR-001"],
        )
        self.assertFalse(validation["valid"])
        self.assertIn(
            "evidence_id must be a canonical sha256 digest", validation["errors"]
        )

    def test_rejects_non_string_status_and_finding_id_without_raising(self) -> None:
        result = fixed_result()
        result["status"] = []
        result["finding_ids"] = [{"id": "OCR-001"}]
        validation = validate_fix_result.validate(result)
        self.assertFalse(validation["valid"])
        self.assertTrue(any("status" in error for error in validation["errors"]))
        self.assertTrue(any("finding_ids[0]" in error for error in validation["errors"]))


if __name__ == "__main__":
    unittest.main()
