#!/usr/bin/env python3

import importlib.util
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import call, patch


MODULE_PATH = Path(__file__).with_name("validate_round.py")
SPEC = importlib.util.spec_from_file_location("validate_round", MODULE_PATH)
assert SPEC and SPEC.loader
validate_round = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_round)

BUILD_MODULE_PATH = Path(__file__).with_name("build_review_bundle.py")
BUILD_SPEC = importlib.util.spec_from_file_location(
    "build_review_bundle", BUILD_MODULE_PATH
)
assert BUILD_SPEC and BUILD_SPEC.loader
build_review_bundle = importlib.util.module_from_spec(BUILD_SPEC)
BUILD_SPEC.loader.exec_module(build_review_bundle)

EVIDENCE_MATERIAL = {
    "schema_version": "1",
    "mode": "workspace",
    "base_sha": "a" * 40,
    "ocr_version": "ocr 1.9.4",
    "refs": {},
    "reviewable_files": [
        {
            "path": "src/example.ts",
            "status": "modified",
            "insertions": 1,
            "deletions": 0,
        },
    ],
    "excluded_files": [],
    "accepted_exclusion_reasons": ["user_exclude"],
    "unaccepted_excluded_files": [],
    "background": None,
    "rules": {
        "schema_version": "1",
        "groups": [
            {
                "group_id": 1,
                "source": "system",
                "pattern": "**/*.ts",
                "files": ["src/example.ts"],
                "rule": "Review TypeScript correctness.",
            }
        ],
    },
    "files": [
        {
            "path": "src/example.ts",
            "status": "modified",
            "insertions": 1,
            "deletions": 0,
            "empty_file": False,
            "content": "+const value = 1;\n",
        }
    ],
}
EVIDENCE_ID = "sha256:" + hashlib.sha256(
    json.dumps(
        EVIDENCE_MATERIAL,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
).hexdigest()


def bundle() -> dict:
    return {
        **deepcopy(EVIDENCE_MATERIAL),
        "evidence_id": EVIDENCE_ID,
    }


def clean_review() -> dict:
    return {
        "schema_version": "1",
        "evidence_id": EVIDENCE_ID,
        "reviewer": {"product": "codex", "session_id": "session-1"},
        "files": [
            {
                "path": "src/example.ts",
                "status": "modified",
                "disposition": "reviewed",
                "reason": "Reviewed the current file and frozen evidence.",
            }
        ],
        "findings": [],
        "verdict": "NO_FINDINGS",
        "block_reason": None,
    }


def finding_review() -> dict:
    review = clean_review()
    review["verdict"] = "FINDINGS"
    review["findings"] = [
        {
            "id": "OCR-001",
            "path": "src/example.ts",
            "start_line": 2,
            "end_line": 3,
            "category": "bug",
            "severity": "medium",
            "content": "A real correctness issue.",
            "required_fix": "Apply the smallest repair.",
            "acceptance_check": "Run the focused regression test.",
        }
    ]
    return review


class ValidateRoundTest(unittest.TestCase):
    def test_accepts_full_coverage_no_findings(self) -> None:
        result = validate_round.validate(bundle(), clean_review())
        self.assertTrue(result["valid"])
        self.assertTrue(result["clean"])
        self.assertEqual(result["coverage_rate"], 1.0)

    def test_rejects_skipped_file_as_clean(self) -> None:
        review = clean_review()
        review["files"][0]["disposition"] = "skipped"
        review["files"][0]["reason"] = "too large"
        result = validate_round.validate(bundle(), review)
        self.assertFalse(result["valid"])
        self.assertFalse(result["clean"])
        self.assertIn(
            "NO_FINDINGS requires 100% reviewed coverage and zero skipped files",
            result["errors"],
        )

    def test_rejects_stale_evidence(self) -> None:
        review = clean_review()
        review["evidence_id"] = "sha256:" + "b" * 64
        result = validate_round.validate(bundle(), review)
        self.assertFalse(result["valid"])
        self.assertIn("evidence_id does not match the bundle", result["errors"])

    def test_rejects_tampered_bundle_material(self) -> None:
        cases = [
            (
                "captured content",
                lambda current: current["files"][0].update(content="tampered"),
            ),
            (
                "rules",
                lambda current: current["rules"]["groups"][0].update(
                    rule="tampered"
                ),
            ),
        ]
        for name, mutate in cases:
            with self.subTest(name=name):
                current_bundle = bundle()
                mutate(current_bundle)
                result = validate_round.validate(current_bundle, clean_review())
                self.assertFalse(result["valid"])
                self.assertFalse(result["clean"])
                self.assertIn(
                    "bundle.evidence_id does not match canonical bundle material",
                    result["errors"],
                )

    def test_rejects_missing_or_malformed_evidence_ids(self) -> None:
        cases = [
            ("both missing", None, None),
            ("both null", None, None),
            ("both empty", "", ""),
            ("both malformed", "sha256:abc", "sha256:abc"),
            ("bundle missing", None, EVIDENCE_ID),
            ("review missing", EVIDENCE_ID, None),
        ]
        for name, bundle_id, review_id in cases:
            with self.subTest(name=name):
                current_bundle = bundle()
                review = clean_review()
                if name == "both missing":
                    current_bundle.pop("evidence_id")
                    review.pop("evidence_id")
                else:
                    current_bundle["evidence_id"] = bundle_id
                    review["evidence_id"] = review_id
                result = validate_round.validate(current_bundle, review)
                self.assertFalse(result["valid"])
                self.assertFalse(result["clean"])
                self.assertTrue(
                    any("evidence_id" in error for error in result["errors"]),
                    result["errors"],
                )

    def test_rejects_unaccepted_exclusion_as_clean(self) -> None:
        current_bundle = bundle()
        current_bundle["unaccepted_excluded_files"] = [
            {
                "path": "docs/contract.md",
                "status": "modified",
                "exclude_reason": "unsupported_ext",
            }
        ]
        result = validate_round.validate(current_bundle, clean_review())
        self.assertFalse(result["valid"])
        self.assertIn(
            "NO_FINDINGS requires zero unaccepted excluded files",
            result["errors"],
        )

    def test_accepts_full_coverage_findings(self) -> None:
        result = validate_round.validate(bundle(), finding_review())
        self.assertTrue(result["valid"])
        self.assertFalse(result["clean"])
        self.assertEqual(result["finding_count"], 1)

    def test_rejects_findings_without_a_finding(self) -> None:
        review = clean_review()
        review["verdict"] = "FINDINGS"
        result = validate_round.validate(bundle(), review)
        self.assertFalse(result["valid"])
        self.assertIn("FINDINGS requires at least one finding", result["errors"])

    def test_rejects_findings_with_skipped_coverage(self) -> None:
        review = finding_review()
        review["files"][0]["disposition"] = "skipped"
        review["files"][0]["reason"] = "not inspected"
        result = validate_round.validate(bundle(), review)
        self.assertFalse(result["valid"])
        self.assertIn(
            "FINDINGS requires full reviewed coverage and zero skipped files",
            result["errors"],
        )

    def test_requires_block_reason(self) -> None:
        review = clean_review()
        review["verdict"] = "BLOCKED"
        result = validate_round.validate(bundle(), review)
        self.assertFalse(result["valid"])
        self.assertIn("BLOCKED requires block_reason", result["errors"])

    def test_accepts_well_formed_blocked_reviews_as_not_clean(self) -> None:
        cases = ["full coverage", "partial coverage"]
        for name in cases:
            with self.subTest(name=name):
                review = clean_review()
                review["verdict"] = "BLOCKED"
                review["block_reason"] = "Reviewer could not verify a required fact."
                if name == "partial coverage":
                    review["files"][0].update(
                        disposition="skipped", reason="Required context is unavailable."
                    )
                result = validate_round.validate(bundle(), review)
                self.assertTrue(result["valid"], result["errors"])
                self.assertFalse(result["clean"])
                self.assertEqual(result["errors"], [])

    def test_accepts_null_line_fields(self) -> None:
        review = finding_review()
        review["findings"][0]["start_line"] = None
        review["findings"][0]["end_line"] = None
        result = validate_round.validate(bundle(), review)
        self.assertTrue(result["valid"])

    def test_rejects_missing_canonical_nullable_fields(self) -> None:
        cases = [
            (
                "block_reason",
                lambda review: review.pop("block_reason"),
                "block_reason must be present",
            ),
            (
                "reviewer.session_id",
                lambda review: review["reviewer"].pop("session_id"),
                "reviewer.session_id must be present",
            ),
            (
                "files.reason",
                lambda review: review["files"][0].pop("reason"),
                "files[0].reason must be present",
            ),
            (
                "finding lines",
                lambda review: (
                    review["findings"][0].pop("start_line"),
                    review["findings"][0].pop("end_line"),
                ),
                "findings[0].start_line and end_line must be present",
            ),
        ]
        for name, mutate, error in cases:
            with self.subTest(name=name):
                review = finding_review() if name == "finding lines" else clean_review()
                mutate(review)
                result = validate_round.validate(bundle(), review)
                self.assertFalse(result["valid"])
                self.assertIn(error, result["errors"])

    def test_rejects_unknown_contract_fields(self) -> None:
        cases = [
            ("review", lambda review: review.update(note="extra"), "review"),
            (
                "reviewer",
                lambda review: review["reviewer"].update(note="extra"),
                "reviewer",
            ),
            (
                "file",
                lambda review: review["files"][0].update(note="extra"),
                "files[0]",
            ),
            (
                "finding",
                lambda review: review["findings"][0].update(note="extra"),
                "findings[0]",
            ),
        ]
        for name, mutate, location in cases:
            with self.subTest(name=name):
                review = finding_review() if name == "finding" else clean_review()
                mutate(review)
                result = validate_round.validate(bundle(), review)
                self.assertFalse(result["valid"])
                self.assertTrue(
                    any(location in error and "unknown" in error for error in result["errors"]),
                    result["errors"],
                )

    def test_rejects_block_reason_for_non_blocked_verdict(self) -> None:
        review = clean_review()
        review["block_reason"] = "contradictory"
        result = validate_round.validate(bundle(), review)
        self.assertFalse(result["valid"])
        self.assertIn(
            "block_reason must be null unless verdict is BLOCKED", result["errors"]
        )

    def test_rejects_empty_reviewed_reason(self) -> None:
        review = clean_review()
        review["files"][0]["reason"] = "  "
        result = validate_round.validate(bundle(), review)
        self.assertFalse(result["valid"])
        self.assertIn("files[0].reason must be a non-empty string", result["errors"])

    def test_rejects_invalid_base_types_without_raising(self) -> None:
        cases = [
            ("product", lambda review: review["reviewer"].update(product=[]), "product"),
            ("verdict", lambda review: review.update(verdict=[]), "verdict"),
            ("path", lambda review: review["files"][0].update(path=1), "path"),
            ("status", lambda review: review["files"][0].update(status=1), "status"),
            (
                "category",
                lambda review: review["findings"][0].update(category=[]),
                "category",
            ),
            (
                "severity",
                lambda review: review["findings"][0].update(severity=[]),
                "severity",
            ),
        ]
        for name, mutate, field in cases:
            with self.subTest(name=name):
                review = finding_review() if name in {"category", "severity"} else clean_review()
                mutate(review)
                result = validate_round.validate(bundle(), review)
                self.assertFalse(result["valid"])
                self.assertTrue(
                    any(field in error for error in result["errors"]), result["errors"]
                )

    def test_rejects_unpaired_line_fields(self) -> None:
        for field_to_remove in ("start_line", "end_line"):
            with self.subTest(field_to_remove=field_to_remove):
                review = finding_review()
                del review["findings"][0][field_to_remove]
                result = validate_round.validate(bundle(), review)
                self.assertFalse(result["valid"])
                self.assertTrue(
                    any("together or omit both" in error for error in result["errors"]),
                    result["errors"],
                )

    def test_rejects_invalid_finding_fields(self) -> None:
        cases = [
            ("missing content", lambda item: item.update(content=""), "content"),
            ("invalid category", lambda item: item.update(category="logic"), "category"),
            ("invalid severity", lambda item: item.update(severity="urgent"), "severity"),
            ("zero start", lambda item: item.update(start_line=0), "start_line"),
            ("inverted range", lambda item: item.update(start_line=4, end_line=3), "end_line"),
            ("outside path", lambda item: item.update(path="src/other.ts"), "outside"),
        ]
        for name, mutate, error_fragment in cases:
            with self.subTest(name=name):
                review = finding_review()
                mutate(review["findings"][0])
                result = validate_round.validate(bundle(), review)
                self.assertFalse(result["valid"])
                self.assertTrue(
                    any(error_fragment in error for error in result["errors"]),
                    result["errors"],
                )

    def test_rejects_duplicate_finding_ids(self) -> None:
        review = finding_review()
        review["findings"].append(deepcopy(review["findings"][0]))
        result = validate_round.validate(bundle(), review)
        self.assertFalse(result["valid"])
        self.assertIn("duplicate finding id: OCR-001", result["errors"])

    def test_rejects_duplicate_identity_with_omitted_file(self) -> None:
        current_bundle = bundle()
        current_bundle["reviewable_files"].append(
            {"path": "src/second.ts", "status": "added"}
        )
        review = clean_review()
        review["files"].append(deepcopy(review["files"][0]))
        result = validate_round.validate(current_bundle, review)
        self.assertFalse(result["valid"])
        self.assertIn(
            "files must account for every OCR (path, status) identity exactly once",
            result["errors"],
        )

    def test_combines_repeated_exclude_arguments(self) -> None:
        args = SimpleNamespace(
            from_ref=None,
            to_ref=None,
            commit=None,
            exclude=["generated/**", "vendor/**"],
            rule=None,
            background=None,
            background_file=None,
        )
        self.assertEqual(
            build_review_bundle.selector_args(args),
            ["--exclude", "generated/**,vendor/**"],
        )
        args.from_ref = "main"
        args.to_ref = "feature"
        self.assertEqual(
            build_review_bundle.selector_args(
                args,
                {"mode": "range", "from": "a" * 40, "to": "b" * 40},
            )[:4],
            ["--from", "a" * 40, "--to", "b" * 40],
        )

    def test_partition_exclusions_keeps_unsafe_reasons_unaccepted_by_default(self) -> None:
        excluded = [
            {"path": "generated.ts", "exclude_reason": "user_exclude"},
            {"path": "README.md", "exclude_reason": "unsupported_ext"},
            {"path": "unknown.txt"},
        ]
        accepted, unaccepted = build_review_bundle.partition_excluded_files(
            excluded, []
        )
        self.assertEqual(accepted, ["default_path", "user_exclude"])
        self.assertEqual(
            [entry["path"] for entry in unaccepted],
            ["README.md", "unknown.txt"],
        )

    def test_partition_exclusions_accepts_ocr_default_paths_without_user_gate(self) -> None:
        excluded = [
            {"path": "src/example.test.ts", "exclude_reason": "default_path"},
            {"path": "generated.ts", "exclude_reason": "user_exclude"},
            {"path": "README.md", "exclude_reason": "unsupported_ext"},
            {"path": "asset.png", "exclude_reason": "binary"},
            {"path": "unknown.txt"},
        ]
        accepted, unaccepted = build_review_bundle.partition_excluded_files(
            excluded, []
        )
        self.assertEqual(accepted, ["default_path", "user_exclude"])
        self.assertEqual(
            [entry["path"] for entry in unaccepted],
            ["README.md", "asset.png", "unknown.txt"],
        )

    def test_partition_exclusions_allows_explicit_reason(self) -> None:
        excluded = [
            {"path": "README.md", "exclude_reason": "unsupported_ext"},
        ]
        accepted, unaccepted = build_review_bundle.partition_excluded_files(
            excluded, ["unsupported_ext"]
        )
        self.assertEqual(
            accepted, ["default_path", "unsupported_ext", "user_exclude"]
        )
        self.assertEqual(unaccepted, [])

    def test_run_suppresses_failure_output_when_background_is_sensitive(self) -> None:
        secret = "LINE_ONE_MARKER\nLINE_TWO_MARKER"
        rendered_failures = [
            f"preview failed: {secret}",
            f"preview failed: {json.dumps(secret)}",
            f"preview failed: {secret!r}",
        ]
        for stderr in rendered_failures:
            with self.subTest(stderr=stderr):
                completed = subprocess.CompletedProcess(
                    args=[],
                    returncode=7,
                    stdout="",
                    stderr=stderr,
                )
                with patch.object(
                    build_review_bundle.subprocess, "run", return_value=completed
                ):
                    with self.assertRaises(RuntimeError) as raised:
                        build_review_bundle.run(
                            ["ocr", "delegate", "preview", "--background", secret],
                            Path("/repo"),
                        )
                message = str(raised.exception)
                self.assertNotIn("LINE_ONE_MARKER", message)
                self.assertNotIn("LINE_TWO_MARKER", message)
                self.assertIn("sensitive command output omitted", message)

    def test_run_suppresses_failure_output_for_background_file(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[],
            returncode=7,
            stdout="",
            stderr="preview failed: BACKGROUND_FILE_SECRET_MARKER",
        )
        with patch.object(build_review_bundle.subprocess, "run", return_value=completed):
            with self.assertRaises(RuntimeError) as raised:
                build_review_bundle.run(
                    [
                        "ocr",
                        "delegate",
                        "preview",
                        "--background-file",
                        "BACKGROUND_FILE_PATH_MARKER",
                    ],
                    Path("/repo"),
                )
        message = str(raised.exception)
        self.assertNotIn("BACKGROUND_FILE_SECRET_MARKER", message)
        self.assertNotIn("BACKGROUND_FILE_PATH_MARKER", message)
        self.assertIn("sensitive command output omitted", message)

    def test_freeze_background_file_uses_one_private_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "background.txt"
            source.write_text("ORIGINAL_BACKGROUND\n", encoding="utf-8")
            args = SimpleNamespace(
                background=None,
                background_file=str(source),
            )
            background_text, frozen_path = (
                build_review_bundle.freeze_background_input(args)
            )
            self.assertIsNotNone(frozen_path)
            assert frozen_path is not None
            try:
                source.write_text("MUTATED_BACKGROUND\n", encoding="utf-8")
                self.assertEqual(background_text, "ORIGINAL_BACKGROUND\n")
                self.assertEqual(
                    frozen_path.read_text(encoding="utf-8"),
                    "ORIGINAL_BACKGROUND\n",
                )
                self.assertEqual(frozen_path.stat().st_mode & 0o777, 0o600)

                selector_args = SimpleNamespace(
                    from_ref=None,
                    to_ref=None,
                    commit=None,
                    exclude=[],
                    rule=None,
                    background=None,
                    background_file=str(source),
                )
                selectors = build_review_bundle.selector_args(
                    selector_args,
                    {"mode": "workspace"},
                    frozen_path,
                )
                self.assertEqual(
                    selectors,
                    ["--background-file", str(frozen_path)],
                )
                self.assertNotIn(str(source), selectors)
            finally:
                frozen_path.unlink(missing_ok=True)

    def test_run_rejects_non_utf8_output_without_traceback_leak(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "valid UTF-8"):
            build_review_bundle.run(
                [sys.executable, "-c", "import os; os.write(1, bytes([255]))"],
                Path.cwd(),
            )

    def test_workspace_content_preserves_raw_newlines(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "new.py").write_bytes(b"one\r\ntwo\r\n")
            content = build_review_bundle.workspace_content(
                repo, {"path": "new.py", "status": "untracked"}
            )
        self.assertEqual(content, "one\r\ntwo\r\n")

    def test_workspace_content_rejects_invalid_utf8(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "new.py").write_bytes(b"print('ok')\n\xff")
            with self.assertRaisesRegex(RuntimeError, "valid UTF-8"):
                build_review_bundle.workspace_content(
                    repo, {"path": "new.py", "status": "untracked"}
                )

    def test_workspace_content_returns_symlink_marker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            repo = root / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            target = root / "outside.py"
            target.write_text("secret", encoding="utf-8")
            (repo / "link.py").symlink_to(target)
            content = build_review_bundle.workspace_content(
                repo, {"path": "link.py", "status": "untracked"}
            )
        self.assertTrue(content.startswith("SYMLINK -> "))
        self.assertNotIn("secret", content)

    def test_workspace_content_rejects_untracked_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            repo = root / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            outside = root / "outside.py"
            outside.write_text("outside", encoding="utf-8")
            with patch.object(Path, "is_symlink", return_value=False):
                with patch.object(Path, "resolve", return_value=outside):
                    with self.assertRaisesRegex(RuntimeError, "escapes repository"):
                        build_review_bundle.workspace_content(
                            repo, {"path": "inside.py", "status": "untracked"}
                        )

    def test_workspace_content_rejects_absolute_and_parent_symlink_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            repo = root / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            outside = root / "outside.py"
            outside.write_text("outside", encoding="utf-8")
            link = root / "outside-link.py"
            link.symlink_to(outside)
            for unsafe in (str(link), "../outside-link.py"):
                with self.subTest(path=unsafe):
                    with self.assertRaisesRegex(RuntimeError, "repository-relative"):
                        build_review_bundle.workspace_content(
                            repo, {"path": unsafe, "status": "untracked"}
                        )

    def test_workspace_content_uses_git_diff_for_tracked_file(self) -> None:
        repo = Path("/repo")
        with patch.object(build_review_bundle, "is_tracked", return_value=True):
            with patch.object(build_review_bundle, "git", return_value="tracked diff") as git:
                content = build_review_bundle.workspace_content(
                    repo, {"path": "tracked.py", "status": "added"}
                )
        self.assertEqual(content, "tracked diff")
        git.assert_called_once_with(
            repo,
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "HEAD",
            "--",
            "tracked.py",
        )

    def test_workspace_paths_are_literal_git_pathspecs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "foob.py").write_text("tracked\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(repo), "add", "foob.py"], check=True)
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(repo),
                    "-c",
                    "user.name=OCR Test",
                    "-c",
                    "user.email=ocr-test@example.invalid",
                    "commit",
                    "-qm",
                    "test: fixture",
                ],
                check=True,
            )
            (repo / "foo[bar].py").write_text("literal\n", encoding="utf-8")
            self.assertFalse(build_review_bundle.is_tracked(repo, "foo[bar].py"))
            self.assertEqual(
                build_review_bundle.workspace_content(
                    repo, {"path": "foo[bar].py", "status": "untracked"}
                ),
                "literal\n",
            )

    def test_is_tracked_distinguishes_unmatched_from_git_failure(self) -> None:
        cases = [(0, True), (1, False)]
        for returncode, expected in cases:
            with self.subTest(returncode=returncode):
                completed = SimpleNamespace(returncode=returncode, stderr="")
                with patch.object(subprocess, "run", return_value=completed):
                    self.assertEqual(
                        build_review_bundle.is_tracked(Path("/repo"), "src/a.py"),
                        expected,
                    )
        completed = SimpleNamespace(returncode=128, stderr="fatal: index is corrupt")
        with patch.object(subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(RuntimeError, "git ls-files failed"):
                build_review_bundle.is_tracked(Path("/repo"), "src/a.py")

    def test_repository_snapshot_detects_head_tracked_and_untracked_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            tracked = repo / "tracked.py"
            tracked.write_text("base\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(repo), "add", "tracked.py"], check=True)
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(repo),
                    "-c",
                    "user.name=OCR Test",
                    "-c",
                    "user.email=ocr-test@example.invalid",
                    "commit",
                    "-qm",
                    "test: base",
                ],
                check=True,
            )
            stable = build_review_bundle.repository_snapshot(repo)
            self.assertEqual(stable, build_review_bundle.repository_snapshot(repo))

            tracked.write_text("changed\n", encoding="utf-8")
            tracked_snapshot = build_review_bundle.repository_snapshot(repo)
            with self.assertRaisesRegex(RuntimeError, "repository changed"):
                build_review_bundle.require_stable_snapshot(stable, tracked_snapshot)

            tracked.write_text("base\n", encoding="utf-8")
            (repo / "new.py").write_text("new\n", encoding="utf-8")
            untracked_snapshot = build_review_bundle.repository_snapshot(repo)
            with self.assertRaisesRegex(RuntimeError, "repository changed"):
                build_review_bundle.require_stable_snapshot(stable, untracked_snapshot)

            subprocess.run(["git", "-C", str(repo), "add", "new.py"], check=True)
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(repo),
                    "-c",
                    "user.name=OCR Test",
                    "-c",
                    "user.email=ocr-test@example.invalid",
                    "commit",
                    "-qm",
                    "test: move head",
                ],
                check=True,
            )
            head_snapshot = build_review_bundle.repository_snapshot(repo)
            with self.assertRaisesRegex(RuntimeError, "repository changed"):
                build_review_bundle.require_stable_snapshot(stable, head_snapshot)

    def test_file_evidence_marks_explicit_empty_untracked_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "empty.py").write_bytes(b"")
            evidence = build_review_bundle.file_evidence(
                repo,
                {"mode": "workspace"},
                {"path": "empty.py", "status": "untracked"},
            )
        self.assertEqual(evidence["content"], "")
        self.assertTrue(evidence["empty_file"])

    def test_capture_disables_textconv_for_workspace_range_and_commit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            sentinel = repo / "textconv-ran"
            converter = repo / "converter.sh"
            converter.write_text(
                f"#!/bin/sh\ntouch '{sentinel}'\ncat \"$1\"\n", encoding="utf-8"
            )
            converter.chmod(0o755)
            (repo / ".gitattributes").write_text("*.txt diff=danger\n", encoding="utf-8")
            (repo / "sample.txt").write_text("base\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(repo), "config", "diff.danger.textconv", str(converter)], check=True)
            subprocess.run(["git", "-C", str(repo), "add", ".gitattributes", "converter.sh", "sample.txt"], check=True)
            subprocess.run(
                ["git", "-C", str(repo), "-c", "user.name=OCR Test", "-c", "user.email=ocr-test@example.invalid", "commit", "-qm", "test: base"],
                check=True,
            )
            base = subprocess.run(
                ["git", "-C", str(repo), "rev-parse", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            (repo / "sample.txt").write_text("changed\n", encoding="utf-8")
            build_review_bundle.workspace_content(
                repo, {"path": "sample.txt", "status": "modified"}
            )
            self.assertFalse(sentinel.exists(), "workspace capture executed textconv")
            subprocess.run(["git", "-C", str(repo), "add", "sample.txt"], check=True)
            subprocess.run(
                ["git", "-C", str(repo), "-c", "user.name=OCR Test", "-c", "user.email=ocr-test@example.invalid", "commit", "-qm", "test: target"],
                check=True,
            )
            target = subprocess.run(
                ["git", "-C", str(repo), "rev-parse", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            build_review_bundle.diff_content(
                repo,
                {"mode": "range", "merge_base": base, "to": target},
                {"path": "sample.txt", "status": "modified"},
            )
            self.assertFalse(sentinel.exists(), "range capture executed textconv")
            build_review_bundle.commit_content(repo, target, "sample.txt")
            self.assertFalse(sentinel.exists(), "commit capture executed textconv")

    def test_ocr_helpers_reject_malformed_shapes(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "OCR preview must be an object"):
            build_review_bundle.parse_json_object("[]", "OCR preview")
        with self.assertRaisesRegex(RuntimeError, r"reviewable_files\[0\]"):
            build_review_bundle.validate_object_entries([[]], "reviewable_files")
        with self.assertRaisesRegex(RuntimeError, "ocr --version returned no output"):
            build_review_bundle.first_output_line("", "ocr --version")

    def test_rule_contract_rejects_incomplete_or_malformed_coverage(self) -> None:
        entries = EVIDENCE_MATERIAL["reviewable_files"]
        valid = deepcopy(EVIDENCE_MATERIAL["rules"])
        build_review_bundle.validate_rules(valid, entries)
        cases = [
            ("groups shape", {"schema_version": "1", "groups": {}}),
            ("empty groups", {"schema_version": "1", "groups": []}),
            (
                "missing path",
                {
                    "schema_version": "1",
                    "groups": [
                        {**valid["groups"][0], "files": []},
                    ],
                },
            ),
            (
                "unknown path",
                {
                    "schema_version": "1",
                    "groups": [
                        {**valid["groups"][0], "files": ["src/other.ts"]},
                    ],
                },
            ),
            (
                "empty rule",
                {
                    "schema_version": "1",
                    "groups": [
                        {**valid["groups"][0], "rule": ""},
                    ],
                },
            ),
        ]
        for name, rules in cases:
            with self.subTest(name=name):
                with self.assertRaises(RuntimeError):
                    build_review_bundle.validate_rules(rules, entries)

    def test_preview_contract_rejects_missing_or_inconsistent_fields(self) -> None:
        valid = {
            "schema_version": "1",
            "mode": "workspace",
            "repository": "/repo",
            "total_files": 0,
            "reviewable_count": 0,
            "excluded_count": 0,
            "total_insertions": 0,
            "total_deletions": 0,
            "reviewable_files": [],
            "excluded_files": [],
        }
        cases = [
            ("missing excluded", lambda value: value.pop("excluded_files")),
            ("missing mode", lambda value: value.pop("mode")),
            ("unsupported mode", lambda value: value.update(mode="future")),
            ("review count", lambda value: value.update(reviewable_count=1, total_files=1)),
            ("exclude count", lambda value: value.update(excluded_count=1, total_files=1)),
            ("negative count", lambda value: value.update(total_insertions=-1)),
            ("range refs", lambda value: value.update(mode="range")),
            ("commit ref", lambda value: value.update(mode="commit")),
        ]
        for name, mutate in cases:
            with self.subTest(name=name):
                preview = deepcopy(valid)
                mutate(preview)
                with self.assertRaises(RuntimeError):
                    build_review_bundle.validate_preview(preview, Path("/repo"))

        entries, excluded = build_review_bundle.validate_preview(valid, Path("/repo"))
        self.assertEqual(entries, [])
        self.assertEqual(excluded, [])

    def test_diff_content_routes_workspace_mode(self) -> None:
        repo = Path("/repo")
        entry = {"path": "src/example.py", "status": "modified"}
        with patch.object(
            build_review_bundle, "workspace_content", return_value="workspace patch"
        ) as workspace:
            content = build_review_bundle.diff_content(
                repo, {"mode": "workspace"}, entry
            )
        self.assertEqual(content, "workspace patch")
        workspace.assert_called_once_with(repo, entry)

    def test_diff_content_routes_range_mode(self) -> None:
        repo = Path("/repo")
        entry = {"path": "src/example.py", "status": "modified"}
        with patch.object(build_review_bundle, "git", return_value="range patch") as git:
            content = build_review_bundle.diff_content(
                repo,
                {"mode": "range", "merge_base": "base", "to": "target"},
                entry,
            )
        self.assertEqual(content, "range patch")
        git.assert_called_once_with(
            repo,
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "base..target",
            "--",
            "src/example.py",
        )

    def test_freeze_requested_refs_resolves_before_preview(self) -> None:
        repo = Path("/repo")
        range_args = SimpleNamespace(
            from_ref="main",
            to_ref="feature",
            commit=None,
        )
        with patch.object(
            build_review_bundle,
            "git",
            side_effect=["a" * 40 + "\n", "b" * 40 + "\n", "c" * 40 + "\n"],
        ):
            frozen = build_review_bundle.freeze_requested_refs(repo, range_args)
        self.assertEqual(frozen["from"], "a" * 40)
        self.assertEqual(frozen["to"], "b" * 40)
        self.assertEqual(frozen["merge_base"], "c" * 40)

        commit_args = SimpleNamespace(
            from_ref=None,
            to_ref=None,
            commit="HEAD",
        )
        with patch.object(build_review_bundle, "git", return_value="d" * 40 + "\n"):
            frozen = build_review_bundle.freeze_requested_refs(repo, commit_args)
        self.assertEqual(frozen["commit"], "d" * 40)

    def test_validate_frozen_preview_refs_rejects_ref_drift(self) -> None:
        frozen = {
            "mode": "range",
            "from": "a" * 40,
            "to": "b" * 40,
            "merge_base": "c" * 40,
        }
        preview = dict(frozen)
        build_review_bundle.validate_frozen_preview_refs(preview, frozen)
        preview["to"] = "d" * 40
        with self.assertRaisesRegex(RuntimeError, "frozen Git refs"):
            build_review_bundle.validate_frozen_preview_refs(preview, frozen)

    def test_frozen_selector_does_not_follow_moved_branch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            subprocess.run(
                ["git", "config", "user.email", "test@example.com"],
                cwd=repo,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test"], cwd=repo, check=True
            )
            (repo / "value.txt").write_text("base\n", encoding="utf-8")
            subprocess.run(["git", "add", "value.txt"], cwd=repo, check=True)
            subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
            base = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=repo,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            subprocess.run(["git", "branch", "feature"], cwd=repo, check=True)
            args = SimpleNamespace(
                from_ref=base,
                to_ref="feature",
                commit=None,
                exclude=[],
                rule=None,
                background=None,
                background_file=None,
            )
            frozen = build_review_bundle.freeze_requested_refs(repo, args)
            frozen_feature = frozen["to"]

            (repo / "value.txt").write_text("moved\n", encoding="utf-8")
            subprocess.run(["git", "add", "value.txt"], cwd=repo, check=True)
            subprocess.run(["git", "commit", "-qm", "moved"], cwd=repo, check=True)
            moved = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=repo,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            subprocess.run(
                ["git", "update-ref", "refs/heads/feature", moved],
                cwd=repo,
                check=True,
            )

            selectors = build_review_bundle.selector_args(args, frozen)
        self.assertNotEqual(frozen_feature, moved)
        self.assertEqual(selectors[:4], ["--from", base, "--to", frozen_feature])

    def test_commit_content_uses_first_parent_for_merge(self) -> None:
        repo = Path("/repo")
        with patch.object(
            build_review_bundle,
            "git",
            side_effect=["merge parent-1 parent-2\n", "commit patch"],
        ) as git:
            content = build_review_bundle.commit_content(repo, "merge", "src/example.py")
        self.assertEqual(content, "commit patch")
        self.assertEqual(
            git.call_args_list,
            [
                call(repo, "rev-list", "--parents", "-n", "1", "merge"),
                call(
                    repo,
                    "--literal-pathspecs",
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "parent-1",
                    "merge",
                    "--",
                    "src/example.py",
                ),
            ],
        )

    def test_diff_content_rejects_empty_capture(self) -> None:
        with patch.object(build_review_bundle, "workspace_content", return_value=""):
            with patch.object(
                build_review_bundle,
                "is_explicit_empty_workspace_file",
                return_value=False,
            ):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "empty captured content for reviewable file in workspace mode",
                ):
                    build_review_bundle.diff_content(
                        Path("/repo"),
                        {"mode": "workspace"},
                        {"path": "src/empty.py", "status": "added"},
                    )


if __name__ == "__main__":
    unittest.main()
