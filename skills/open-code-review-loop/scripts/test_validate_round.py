#!/usr/bin/env python3

import contextlib
import importlib.util
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import call, patch


MODULE_PATH = Path(__file__).with_name("validate_round.py")
if str(MODULE_PATH.parent) not in sys.path:
    sys.path.insert(0, str(MODULE_PATH.parent))
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
    "supplemental_reviewable_files": [],
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
    "supplemental_rules": {"schema_version": "1", "groups": []},
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
        "repository": "/srv/example-repo",
        "evidence_id": EVIDENCE_ID,
    }


REAL_STATE_ROOT = validate_round.STATE_ROOT


def setUpModule() -> None:
    """Keep every test away from the real per-user state directory.

    The validator has no flag or environment variable for the ledger
    location, so tests run its main() in-process and replace the module
    constant. A test that forgets its own directory still lands here.
    """
    directory = tempfile.TemporaryDirectory()
    unittest.addModuleCleanup(directory.cleanup)
    patcher = patch.object(
        validate_round, "STATE_ROOT", Path(directory.name) / "module-state"
    )
    patcher.start()
    unittest.addModuleCleanup(patcher.stop)


def run_validator(*args: str) -> tuple[int, dict]:
    stdout = io.StringIO()
    with patch.object(sys, "argv", [str(MODULE_PATH), *args]), \
            contextlib.redirect_stdout(stdout):
        code = validate_round.main()
    return code, json.loads(stdout.getvalue())


def run_git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "-c", "user.name=test",
         "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
         "-c", "core.hooksPath=/dev/null", *args],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def make_repository(path: Path) -> tuple[str, str]:
    """Create a real checkout: the validator asks Git who the repository is."""
    path.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    return str(path.resolve()), new_commit(path, f"base {path.name}")


def new_commit(repo: Path | str, message: str) -> str:
    run_git(Path(repo), "commit", "-q", "--allow-empty", "-m", message)
    return run_git(Path(repo), "rev-parse", "HEAD")


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


def bundle_with_supplemental_markdown() -> tuple[dict, dict]:
    material = deepcopy(EVIDENCE_MATERIAL)
    material["supplemental_reviewable_files"] = [
        {
            "path": "docs/plan.md",
            "status": "modified",
            "insertions": 2,
            "deletions": 0,
            "exclude_reason": "unsupported_ext",
        }
    ]
    material["supplemental_rules"] = {
        "schema_version": "1",
        "groups": [
            {
                "group_id": "supplemental-markdown",
                "source": "host",
                "pattern": "**/*.{md,mdx}",
                "files": ["docs/plan.md"],
                "rule": "Review Markdown correctness and consistency with the implementation.",
            }
        ],
    }
    material["files"].append(
        {
            "path": "docs/plan.md",
            "status": "modified",
            "insertions": 2,
            "deletions": 0,
            "empty_file": False,
            "content": "+# Plan\n+Keep the behavior safe.\n",
        }
    )
    evidence_id = "sha256:" + hashlib.sha256(
        json.dumps(
            material,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    current_bundle = {**material, "evidence_id": evidence_id}
    review = clean_review()
    review["evidence_id"] = evidence_id
    return current_bundle, review


class RoundBudgetCliTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(directory.cleanup)
        cls.shared_repository = make_repository(Path(directory.name) / "repo")

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.bundle_path = self.root / "bundle.json"
        self.review_path = self.root / "raw.json"
        self.state_home = self.root / "state"
        patcher = patch.object(validate_round, "STATE_ROOT", self.state_home)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.use_repository(*self.shared_repository)

    def use_repository(self, repository: str, head: str) -> None:
        self.repository, self.head = repository, head
        self.set_evidence(1)
        self.history_path = validate_round.ledger_path(
            validate_round.repository_identity(self.bundle)
        )

    def set_evidence(self, number: int) -> None:
        self.bundle = bundle()
        self.bundle["repository"] = self.repository
        self.bundle["base_sha"] = self.head
        self.bundle["background"] = str(number)
        self.write_bundle()

    def write_bundle(self) -> None:
        self.bundle["evidence_id"] = validate_round.canonical_evidence_id(self.bundle)
        self.bundle_path.write_text(json.dumps(self.bundle), encoding="utf-8")

    def run_cli(self, *args: str) -> tuple[int, dict]:
        return run_validator("--bundle", str(self.bundle_path), *args)

    def use_rounds(self, count: int, start: int = 1) -> None:
        for number in range(start, start + count):
            self.set_evidence(number)
            self.assertEqual(self.run_cli("--check-call")[0], 0)
            review = finding_review()
            review["evidence_id"] = self.bundle["evidence_id"]
            self.assertEqual(self.submit(review)[0], 0)

    def read_ledger_file(self) -> dict:
        return json.loads(self.history_path.read_text(encoding="utf-8"))

    def submit(self, payload: object, product: str = "codex") -> tuple[int, dict]:
        self.review_path.write_text(json.dumps(payload), encoding="utf-8")
        return self.run_cli("--review", str(self.review_path), "--product", product)

    def test_second_schema_failure_blocks_all_further_calls(self) -> None:
        calls = 0
        for _ in range(6):
            code, gate = self.run_cli("--check-call")
            if code:
                break
            calls += 1
            code, result = self.submit({})
            self.assertEqual(code, 2)
        self.assertEqual(calls, 2)
        self.assertFalse(result["call_allowed"])
        self.assertIn("UNVERIFIED", result["stop"])
        self.assertEqual(gate["rounds_used"], 1)
        self.set_evidence(2)
        code, result = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertIn("UNVERIFIED", result["stop"])

    def test_six_calls_are_three_rounds_not_permission_for_round_four(self) -> None:
        calls = 0
        for number in range(1, 7):
            self.set_evidence(number)
            code, gate = self.run_cli("--check-call")
            if code:
                break
            calls += 1
            self.assertEqual(self.submit({})[0], 2)
            self.assertEqual(self.run_cli("--check-call")[0], 0)
            review = finding_review()
            review["evidence_id"] = self.bundle["evidence_id"]
            calls += 1
            self.assertEqual(self.submit(review)[0], 0)
        self.assertEqual(calls, 6)
        self.assertEqual(number, 4)
        self.assertEqual(gate["rounds_used"], 3)
        self.assertFalse(gate["call_allowed"])
        self.assertIn("round budget exhausted", gate["stop"])
        for number in (5, 6):
            self.set_evidence(number)
            self.assertEqual(self.run_cli("--check-call")[0], 2)

    def test_extraction_and_json_failures_share_the_correction_limit(self) -> None:
        self.assertEqual(self.submit({"text": "looks clean"}, "grok-build")[0], 2)
        self.assertEqual(self.run_cli("--check-call")[0], 0)
        self.review_path.write_text("not JSON", encoding="utf-8")
        code, result = self.run_cli("--review", str(self.review_path), "--product", "grok-build")
        self.assertEqual(code, 2)
        self.assertFalse(result["call_allowed"])
        self.assertEqual(self.run_cli("--check-call")[0], 2)

    def test_fresh_evidence_after_failure_consumes_round(self) -> None:
        for number in range(1, 4):
            self.set_evidence(number)
            self.assertEqual(self.run_cli("--check-call")[0], 0)
            self.assertEqual(self.submit({})[0], 2)
        self.set_evidence(4)
        code, result = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual(result["rounds_used"], 3)

    def test_valid_correction_can_be_clean_without_terminal_error(self) -> None:
        self.assertEqual(self.submit({})[0], 2)
        self.assertEqual(self.run_cli("--check-call")[0], 0)
        review = clean_review()
        review["evidence_id"] = self.bundle["evidence_id"]
        code, result = self.submit(review)
        self.assertEqual(code, 0)
        self.assertTrue(result["clean"])
        self.assertIsNone(result["stop"])
        self.assertEqual(result["rounds_used"], 1)
        before = self.history_path.read_bytes()
        self.assertEqual(self.run_cli("--check-call")[0], 2)
        self.assertEqual(self.submit(review)[0], 2)
        self.assertEqual(self.history_path.read_bytes(), before)

    def test_corrupt_history_fails_closed(self) -> None:
        self.history_path.parent.mkdir(parents=True)
        evidence_id = self.bundle["evidence_id"]
        corrupt_ledgers = (
            "{}",
            "not JSON",
            '{"entries": [], "grants": [{"rounds": 2}]}',
            json.dumps({"entries": [{"evidence_id": evidence_id, "status": "done"}]}),
            json.dumps({"entries": [{"evidence_id": evidence_id}]}),
            # A hand-added `clean` flag must not close the loop.
            json.dumps({"entries": [
                {"evidence_id": evidence_id, "status": "valid", "clean": True}
            ]}),
            json.dumps({"entries": [], "base_shas": ["abc1234"]}),
        )
        for corrupt in corrupt_ledgers:
            with self.subTest(corrupt=corrupt):
                self.history_path.write_text(corrupt, encoding="utf-8")
                code, result = self.run_cli("--check-call")
                self.assertEqual(code, 2)
                self.assertFalse(result["call_allowed"])
                self.assertEqual(result["stop"], "UNVERIFIED")
                self.assertIn("Do not delete", result["errors"][0])
                self.assertEqual(
                    self.history_path.read_text(encoding="utf-8"), corrupt
                )

    def test_other_history_path_is_refused_and_does_not_reset_the_count(self) -> None:
        self.use_rounds(3)
        self.set_evidence(4)
        fresh = self.root / "fresh-history.json"
        for mode in (("--check-call",), ("--review", str(self.review_path))):
            with self.subTest(mode=mode[0]):
                code, result = self.run_cli(*mode, "--history", str(fresh))
                self.assertEqual(code, 2)
                self.assertFalse(result["call_allowed"])
                self.assertIn("Drop --history", result["errors"][0])
                self.assertIn(str(self.history_path), result["errors"][0])
                self.assertFalse(fresh.exists())
        code, gate = self.run_cli("--check-call", "--history", str(self.history_path))
        self.assertEqual(code, 2)
        self.assertEqual(gate["rounds_used"], 3)
        self.assertIn("round budget exhausted", gate["stop"])

    def test_environment_cannot_move_the_ledger(self) -> None:
        self.use_rounds(3)
        self.set_evidence(4)
        elsewhere = self.root / "elsewhere"
        moved = {"XDG_STATE_HOME": str(elsewhere), "HOME": str(elsewhere)}
        with patch.dict(os.environ, moved):
            code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual((gate["rounds_used"], gate["round_budget"]), (3, 3))
        self.assertEqual(gate["ledger"], str(self.history_path))
        self.assertFalse(elsewhere.exists())

    def test_passed_gate_records_the_round_before_any_review(self) -> None:
        # Three Reviewer calls start and are interrupted: no review comes back.
        for number in range(1, 4):
            self.set_evidence(number)
            code, gate = self.run_cli("--check-call")
            self.assertEqual((code, gate["rounds_used"]), (0, number))
        entries = self.read_ledger_file()["entries"]
        self.assertEqual([item["status"] for item in entries], ["started"] * 3)
        self.assertEqual({item["base_sha"] for item in entries}, {self.head})
        before = self.history_path.read_bytes()
        # A relay session with a new round directory still sees three rounds.
        with tempfile.TemporaryDirectory() as other_round_dir:
            self.bundle_path = Path(other_round_dir) / "bundle.json"
            self.set_evidence(4)
            code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual((gate["rounds_used"], gate["round_budget"]), (3, 3))
        self.assertIn("round budget exhausted", gate["stop"])
        self.assertEqual(self.history_path.read_bytes(), before)

    def test_repeated_gate_for_one_evidence_is_one_round(self) -> None:
        for _ in range(3):
            code, gate = self.run_cli("--check-call")
            self.assertEqual((code, gate["rounds_used"]), (0, 1))
        entries = self.read_ledger_file()["entries"]
        self.assertEqual(len(entries), 1)
        self.assertEqual((entries[0]["status"], entries[0]["check_calls"]), ("started", 3))

    def test_review_updates_the_round_the_gate_started(self) -> None:
        self.assertEqual(self.run_cli("--check-call")[0], 0)
        started = self.read_ledger_file()["entries"][0]
        review = finding_review()
        review["evidence_id"] = self.bundle["evidence_id"]
        code, result = self.submit(review)
        self.assertEqual((code, result["rounds_used"]), (0, 1))
        entries = self.read_ledger_file()["entries"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["status"], "valid")
        self.assertEqual(entries[0]["started_at"], started["started_at"])
        self.assertIn("reviewed_at", entries[0])
        self.assertNotIn("clean", entries[0])

    def test_review_without_history_is_counted(self) -> None:
        for number in range(1, 4):
            self.set_evidence(number)
            review = finding_review()
            review["evidence_id"] = self.bundle["evidence_id"]
            code, result = self.submit(review)
            self.assertEqual(code, 0)
            self.assertEqual(result["rounds_used"], number)
            self.assertEqual(result["ledger"], str(self.history_path))
        self.assertEqual(len(self.read_ledger_file()["entries"]), 3)
        self.set_evidence(4)
        review = finding_review()
        review["evidence_id"] = self.bundle["evidence_id"]
        code, result = self.submit(review)
        self.assertEqual(code, 2)
        self.assertFalse(result["valid"])
        self.assertIn("round budget exhausted", result["stop"])
        self.assertEqual(len(self.read_ledger_file()["entries"]), 3)

    def test_round_four_without_a_grant_is_refused(self) -> None:
        self.use_rounds(3)
        self.set_evidence(4)
        code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertFalse(gate["call_allowed"])
        self.assertEqual(gate["stop"], "HUMAN_GATE: round budget exhausted")
        self.assertEqual((gate["rounds_used"], gate["round_budget"]), (3, 3))
        self.assertIn("--grant-rounds", gate["fix"])
        self.assertIn("unattended prompt is not a grant", gate["fix"])

    def test_recorded_grant_extends_the_budget_by_exactly_its_rounds(self) -> None:
        self.use_rounds(3)
        self.set_evidence(4)
        code, result = self.run_cli(
            "--grant-rounds", "2", "--granted-by", " 剩下 2 条也修掉，再审两轮 "
        )
        self.assertEqual(code, 0)
        self.assertTrue(result["call_allowed"])
        self.assertEqual((result["round_budget"], result["granted_rounds"]), (5, 2))
        grant = self.read_ledger_file()["grants"][0]
        self.assertEqual(grant, result["granted"])
        self.assertEqual(grant["rounds"], 2)
        self.assertEqual(grant["granted_by"], "剩下 2 条也修掉，再审两轮")
        self.assertRegex(grant["at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$")
        self.use_rounds(2, start=4)
        self.set_evidence(6)
        code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual((gate["rounds_used"], gate["round_budget"]), (5, 5))
        self.assertIn("round budget exhausted", gate["stop"])

    def test_grant_needs_the_users_words_and_a_positive_count(self) -> None:
        self.use_rounds(3)
        self.set_evidence(4)
        rejected = (
            (("--grant-rounds", "1", "--granted-by", "  "), "--granted-by must quote"),
            (("--grant-rounds", "1", "--granted-by", ""), "--granted-by must quote"),
            (("--grant-rounds", "1"), "--granted-by must quote"),
            (("--grant-rounds", "0", "--granted-by", "ok"), "positive whole number"),
            (("--grant-rounds", "+2", "--granted-by", "ok"), "positive whole number"),
            (("--check-call", "--granted-by", "ok"), "--granted-by only records"),
        )
        for args, message in rejected:
            with self.subTest(args=args):
                code, result = self.run_cli(*args)
                self.assertEqual(code, 2)
                self.assertFalse(result["call_allowed"])
                self.assertIn(message, result["errors"][0])
        self.assertEqual(self.read_ledger_file()["grants"], [])
        self.assertEqual(self.run_cli("--check-call")[0], 2)

    def test_placeholder_invisible_and_blanket_text_is_not_a_grant(self) -> None:
        self.use_rounds(3)
        self.set_evidence(4)
        unattended_prompt = (
            "Nobody is here to answer. Where the choice can be undone, go on "
            "with the recommended option and carry on to the end."
        )
        rejected = (
            ("...", "--granted-by must quote"),
            ("…", "--granted-by must quote"),
            ("​", "--granted-by must quote"),
            (" ​⁠﻿ ", "--granted-by must quote"),
            ("<用户原话>", "is a placeholder"),
            ("<the user's own words>", "is a placeholder"),
            ("＜the user's own words about extra rounds＞", "is a placeholder"),
            ("​<anything at all>", "is a placeholder"),
            ("TODO", "is a placeholder"),
            (" tbd. ", "is a placeholder"),
            ("用户原话", "is a placeholder"),
            ("按推荐继续", "says nothing about extra review rounds"),
            ("按推荐继续。", "says nothing about extra review rounds"),
            ("按​推荐继续", "says nothing about extra review rounds"),
            ("都按推荐来", "says nothing about extra review rounds"),
            ("Go on with the recommended option.", "says nothing about extra review rounds"),
            (unattended_prompt, "says nothing about extra review rounds"),
        )
        for text, message in rejected:
            with self.subTest(text=text):
                code, result = self.run_cli("--grant-rounds", "1", "--granted-by", text)
                self.assertEqual(code, 2)
                self.assertFalse(result["call_allowed"])
                self.assertIn(message, result["errors"][0])
                # Every refusal says what to do instead.
                self.assertRegex(result["errors"][0], r"[Aa]sk the user|ask them")
        self.assertEqual(self.read_ledger_file()["grants"], [])
        self.assertEqual(self.run_cli("--check-call")[0], 2)

    def test_the_printed_grant_usage_template_is_not_a_grant(self) -> None:
        template = validate_round.GRANT_USAGE.split('"')[1]
        with self.assertRaisesRegex(ValueError, "is a placeholder"):
            validate_round.validate_grant("1", template)

    def test_user_sentences_about_rounds_are_still_grants(self) -> None:
        accepted = (
            "one more", "try again", "ok", "再审 2 轮",
            "按推荐继续，再审两轮", "TODO 里那两条修完再审一轮",
        )
        for text in accepted:
            with self.subTest(text=text):
                self.assertEqual(validate_round.validate_grant("2", text), (2, text))

    def test_resubmitting_one_evidence_id_stays_one_round(self) -> None:
        self.assertEqual(self.submit({})[0], 2)
        review = finding_review()
        review["evidence_id"] = self.bundle["evidence_id"]
        code, result = self.submit(review)
        self.assertEqual(code, 0)
        self.assertEqual(result["rounds_used"], 1)
        code, result = self.submit(review)
        self.assertEqual(code, 2)
        self.assertEqual(result["rounds_used"], 1)
        self.assertEqual(len(self.read_ledger_file()["entries"]), 2)
        self.use_rounds(2, start=2)
        self.set_evidence(4)
        self.assertEqual(self.run_cli("--check-call")[0], 2)

    def test_legacy_list_ledger_is_read_and_upgraded_on_grant(self) -> None:
        legacy = []
        for number in range(1, 4):
            self.set_evidence(number)
            legacy.append({"evidence_id": self.bundle["evidence_id"], "valid": True})
        self.history_path.parent.mkdir(parents=True)
        self.history_path.write_text(json.dumps(legacy), encoding="utf-8")
        self.set_evidence(4)
        code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual((gate["rounds_used"], gate["round_budget"]), (3, 3))
        self.history_path.write_text(json.dumps({"entries": legacy}), encoding="utf-8")
        self.assertEqual(self.run_cli("--check-call")[0], 2)
        code, result = self.run_cli("--grant-rounds", "1", "--granted-by", "one more")
        self.assertEqual(code, 0)
        self.assertTrue(result["call_allowed"])
        ledger = self.read_ledger_file()
        # A legacy `valid: true` is a used round and never closes the loop.
        self.assertEqual(ledger["entries"], [
            {"evidence_id": item["evidence_id"], "status": "valid"} for item in legacy
        ])
        self.assertEqual(ledger["schema_version"], "3")
        self.assertEqual(ledger["repository"], os.path.realpath(self.repository))

    def test_schema_two_ledger_keeps_its_rounds_and_base_commit(self) -> None:
        entries = []
        for number in range(1, 4):
            self.set_evidence(number)
            entries.append(
                {"evidence_id": self.bundle["evidence_id"], "valid": number != 2}
            )
        self.history_path.parent.mkdir(parents=True)
        self.history_path.write_text(json.dumps({
            "schema_version": "2", "repository": self.repository,
            "base_sha": "b" * 40, "entries": entries, "grants": [],
        }), encoding="utf-8")
        self.set_evidence(4)
        code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual((gate["rounds_used"], gate["round_budget"]), (3, 3))
        self.assertEqual(gate["base_shas"], ["b" * 40])
        self.assertEqual(self.run_cli(
            "--grant-rounds", "1", "--granted-by", "one more")[0], 0)
        code, gate = self.run_cli("--check-call")
        self.assertEqual((code, gate["rounds_used"]), (0, 4))
        ledger = self.read_ledger_file()
        self.assertEqual(ledger["base_shas"], ["b" * 40, self.head])
        self.assertEqual(
            [item["status"] for item in ledger["entries"]],
            ["valid", "invalid", "valid", "started"],
        )

    def test_new_round_directory_and_session_reuse_the_ledger(self) -> None:
        self.use_rounds(3)
        self.set_evidence(4)
        with tempfile.TemporaryDirectory() as other_round_dir:
            self.bundle_path = Path(other_round_dir) / "bundle.json"
            self.set_evidence(4)
            code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual(gate["rounds_used"], 3)
        self.assertEqual(gate["ledger"], str(self.history_path))

    def test_new_commit_keeps_the_ledger_and_the_count(self) -> None:
        self.use_repository(*make_repository(self.root / "repo"))
        self.use_rounds(3)
        first = self.head
        self.head = new_commit(self.repository, "fix the round three findings")
        self.set_evidence(4)
        code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual((gate["rounds_used"], gate["round_budget"]), (3, 3))
        self.assertIn("round budget exhausted", gate["stop"])
        self.assertEqual(gate["ledger"], str(self.history_path))
        self.assertEqual(self.run_cli(
            "--grant-rounds", "1", "--granted-by", "再审一轮")[0], 0)
        code, gate = self.run_cli("--check-call")
        self.assertEqual((code, gate["rounds_used"], gate["round_budget"]), (0, 4, 4))
        self.assertEqual(gate["base_shas"], [first, self.head])
        self.assertEqual(self.read_ledger_file()["base_shas"], [first, self.head])
        self.assertEqual(
            [path.name for path in self.history_path.parent.glob("*.json")],
            [self.history_path.name],
        )
        # A bundle built before the commit is stale, not a way back.
        self.head = first
        self.set_evidence(5)
        code, result = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertIn("is not HEAD", result["errors"][0])

    def test_only_a_validated_clean_review_closes_the_loop(self) -> None:
        self.use_rounds(2)
        self.assertEqual(self.run_cli(
            "--grant-rounds", "1", "--granted-by", "one more round")[0], 0)
        self.set_evidence(3)
        self.assertEqual(self.run_cli("--check-call")[0], 0)
        review = clean_review()
        review["evidence_id"] = self.bundle["evidence_id"]
        code, result = self.submit(review)
        self.assertEqual(code, 0)
        self.assertTrue(result["clean"])
        self.assertTrue(result["loop_closed"])
        # The closing result reports the loop it closed.
        self.assertEqual((result["rounds_used"], result["round_budget"]), (3, 4))
        # Evidence reviewed in the closed loop is still known.
        code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertIn("evidence already reviewed", gate["stop"])
        # The next loop starts at zero and does not inherit the old grant.
        self.set_evidence(4)
        code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 0)
        self.assertEqual(
            (gate["rounds_used"], gate["round_budget"], gate["granted_rounds"]),
            (1, 3, 0),
        )
        self.use_rounds(2, start=5)
        self.set_evidence(7)
        code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual((gate["rounds_used"], gate["round_budget"]), (3, 3))

    def test_grant_reopens_a_ledger_locked_by_repeated_malformed_output(self) -> None:
        self.assertEqual(self.submit({})[0], 2)
        code, result = self.submit({})
        self.assertEqual(code, 2)
        self.assertIn("repeated malformed output", result["stop"])
        self.assertIn("--grant-rounds", result["fix"])
        self.set_evidence(2)
        self.assertEqual(self.run_cli("--check-call")[0], 2)
        code, result = self.run_cli("--grant-rounds", "1", "--granted-by", "try again")
        self.assertEqual(code, 0)
        self.assertEqual((result["rounds_used"], result["round_budget"]), (1, 4))
        self.assertEqual(self.run_cli("--check-call")[0], 0)
        self.assertEqual(self.submit({})[0], 2)
        self.assertEqual(self.run_cli("--check-call")[0], 0)
        self.assertEqual(self.submit({})[0], 2)
        self.assertEqual(self.run_cli("--check-call")[0], 2)

    def test_bundle_without_builder_identity_is_refused(self) -> None:
        for field, value in (("repository", None), ("repository", "relative/repo")):
            with self.subTest(field=field, value=value):
                self.bundle[field] = value
                self.bundle_path.write_text(json.dumps(self.bundle), encoding="utf-8")
                code, result = self.run_cli("--check-call")
                self.assertEqual(code, 2)
                self.assertFalse(result["call_allowed"])
                self.assertIn("rebuild the bundle", result["errors"][0])
        self.assertFalse(self.state_home.exists())

    def test_edited_repository_cannot_select_another_ledger(self) -> None:
        self.use_repository(*make_repository(self.root / "repo"))
        self.use_rounds(3)
        other, _ = make_repository(self.root / "other")
        nested = Path(self.repository) / "nested"
        nested.mkdir()
        plain = self.root / "plain"
        plain.mkdir()
        edited = (
            (other, "is not HEAD"),
            (str(nested), "is not the root of its Git checkout"),
            (str(plain), "is not a Git checkout"),
            (str(self.root / "missing"), "is not a Git checkout"),
        )
        for repository, message in edited:
            with self.subTest(repository=repository):
                self.set_evidence(4)
                self.bundle["repository"] = repository
                self.write_bundle()
                code, result = self.run_cli("--check-call")
                self.assertEqual(code, 2)
                self.assertFalse(result["call_allowed"])
                self.assertIn(message, result["errors"][0])
        # Another spelling of the same checkout is still the same ledger.
        alias = self.root / "alias"
        alias.symlink_to(self.repository)
        self.set_evidence(4)
        self.bundle["repository"] = str(alias)
        self.write_bundle()
        code, gate = self.run_cli("--check-call")
        self.assertEqual(code, 2)
        self.assertEqual((gate["rounds_used"], gate["round_budget"]), (3, 3))
        self.assertEqual(gate["ledger"], str(self.history_path))
        self.assertEqual(
            [path.name for path in self.history_path.parent.glob("*.json")],
            [self.history_path.name],
        )

    def test_git_environment_cannot_redirect_the_repository(self) -> None:
        other, _ = make_repository(self.root / "other")
        redirect = {"GIT_DIR": str(Path(other) / ".git"), "GIT_WORK_TREE": other}
        with patch.dict(os.environ, redirect):
            identity = validate_round.repository_identity(self.bundle)
        self.assertEqual(identity, os.path.realpath(self.repository))

    def test_unwritable_state_directory_fails_closed_with_a_fix(self) -> None:
        self.state_home.write_text("a file, not a directory", encoding="utf-8")
        for mode in (("--check-call",), ("--review", str(self.review_path))):
            with self.subTest(mode=mode[0]):
                code, result = self.run_cli(*mode)
                self.assertEqual(code, 2)
                self.assertFalse(result["valid"])
                self.assertFalse(result["call_allowed"])
                self.assertEqual(result["stop"], "UNVERIFIED")
                self.assertIn("extra writable directory", result["errors"][0])
                self.assertNotIn("XDG_STATE_HOME", result["errors"][0])

    def assert_output_refused(self, output: Path | str, *mode: str) -> dict:
        code, result = self.run_cli(*(mode or ("--check-call",)), "--output", str(output))
        self.assertEqual(code, 2)
        self.assertFalse(result["valid"])
        self.assertFalse(result["call_allowed"])
        self.assertIn("--output", result["errors"][0])
        self.assertIn("Pass another path", result["errors"][0])
        return result

    def test_output_on_the_ledger_is_refused_and_leaves_it_unchanged(self) -> None:
        self.use_rounds(1)
        before = self.history_path.read_bytes()
        self.set_evidence(2)
        review = finding_review()
        review["evidence_id"] = self.bundle["evidence_id"]
        self.review_path.write_text(json.dumps(review), encoding="utf-8")
        modes = (
            ("--check-call",),
            ("--review", str(self.review_path), "--product", "codex"),
            ("--grant-rounds", "2", "--granted-by", "two more rounds are fine"),
        )
        for mode in modes:
            with self.subTest(mode=mode[0]):
                self.assert_output_refused(self.history_path, *mode)
                self.assertEqual(self.history_path.read_bytes(), before)
        self.assertEqual(len(self.read_ledger_file()["entries"]), 1)

    def test_output_aliases_of_the_ledger_are_refused(self) -> None:
        self.use_rounds(1)
        before = self.history_path.read_bytes()
        file_link = self.root / "result.json"
        file_link.symlink_to(self.history_path)
        directory_link = self.root / "ledgers-alias"
        directory_link.symlink_to(self.history_path.parent)
        hard_link = self.root / "hard-link.json"
        os.link(self.history_path, hard_link)
        relative = os.path.join(
            os.path.relpath(self.history_path.parent, Path.cwd()),
            "..", "ledgers", self.history_path.name,
        )
        aliases = {
            "file symlink": file_link,
            "directory symlink": directory_link / self.history_path.name,
            "hard link": hard_link,
            "relative": relative,
        }
        self.set_evidence(2)
        for name, alias in aliases.items():
            with self.subTest(alias=name):
                self.assert_output_refused(alias)
                self.assertEqual(self.history_path.read_bytes(), before)
        self.assertTrue(file_link.is_symlink())

    def test_output_on_ledger_companions_or_state_directory_is_refused(self) -> None:
        self.use_rounds(1)
        before = self.history_path.read_bytes()
        ledgers = self.history_path.parent
        name = self.history_path.name
        listing = sorted(path.name for path in ledgers.iterdir())
        targets = (
            ledgers / f"{name}.tmp",
            ledgers / f"{name}.lock",
            ledgers / "result.json",
            self.state_home / "new" / "result.json",
            self.state_home,
        )
        self.set_evidence(2)
        for target in targets:
            with self.subTest(target=str(target.relative_to(self.root))):
                self.assert_output_refused(target)
                self.assertEqual(self.history_path.read_bytes(), before)
        self.assertEqual(sorted(path.name for path in ledgers.iterdir()), listing)
        self.assertFalse((self.state_home / "new").exists())

    def test_output_into_the_state_directory_is_refused_before_it_exists(self) -> None:
        target = self.state_home / "ledgers" / self.history_path.name
        self.assert_output_refused(target)
        self.assertFalse(self.state_home.exists())

    def test_output_on_the_ledger_is_refused_when_the_bundle_is_unreadable(self) -> None:
        self.use_rounds(1)
        before = self.history_path.read_bytes()
        code, result = run_validator(
            "--bundle", str(self.root / "missing.json"), "--check-call",
            "--output", str(self.history_path),
        )
        self.assertEqual(code, 2)
        self.assertIn("Pass another path", result["errors"][0])
        self.assertEqual(self.history_path.read_bytes(), before)

    def test_output_outside_the_state_directory_still_works(self) -> None:
        output = self.root / "round-1" / "gate.json"
        code, gate = self.run_cli("--check-call", "--output", str(output))
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.read_text(encoding="utf-8")), gate)
        self.assertEqual(gate["ledger"], str(self.history_path))
        self.assertEqual(len(self.read_ledger_file()["entries"]), 1)
        review = finding_review()
        review["evidence_id"] = self.bundle["evidence_id"]
        self.review_path.write_text(json.dumps(review), encoding="utf-8")
        report = self.root / "state-sibling.json"
        code, result = self.run_cli(
            "--review", str(self.review_path), "--product", "codex",
            "--output", str(report),
        )
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(report.read_text(encoding="utf-8")), result)
        self.assertEqual(self.read_ledger_file()["entries"][0]["status"], "valid")


class LedgerPathTest(unittest.TestCase):
    def test_keyed_by_the_checkout_git_reports_not_by_commit_or_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository, head = make_repository(Path(directory) / "repo")
            other, other_head = make_repository(Path(directory) / "other")
            first = {**bundle(), "repository": repository, "base_sha": head}
            drifted = {**first, "background": "different evidence",
                       "repository": repository + "/"}
            identity = validate_round.repository_identity(first)
            self.assertEqual(identity, os.path.realpath(repository))
            self.assertEqual(validate_round.repository_identity(drifted), identity)
            path = validate_round.ledger_path(identity)
            self.assertEqual(path.parent, validate_round.STATE_ROOT / "ledgers")
            later = {**first, "base_sha": new_commit(repository, "later")}
            self.assertEqual(
                validate_round.ledger_path(validate_round.repository_identity(later)),
                path,
            )
            elsewhere = {**bundle(), "repository": other, "base_sha": other_head}
            self.assertNotEqual(
                validate_round.ledger_path(
                    validate_round.repository_identity(elsewhere)
                ),
                path,
            )

    def test_default_root_ignores_environment(self) -> None:
        import pwd

        home = Path(pwd.getpwuid(os.getuid()).pw_dir)
        with tempfile.TemporaryDirectory() as directory:
            moved = {"XDG_STATE_HOME": directory, "HOME": directory}
            with patch.dict(os.environ, moved):
                root = validate_round.default_state_root()
        self.assertEqual(root, home / ".local" / "state" / "open-code-review-loop")
        self.assertEqual(root, REAL_STATE_ROOT)

    def test_cli_offers_no_way_to_choose_the_ledger_location(self) -> None:
        options = {
            option
            for action in validate_round.build_parser()._actions
            for option in action.option_strings
        }
        self.assertEqual(options, {
            "-h", "--help", "--bundle", "--review", "--check-call",
            "--grant-rounds", "--granted-by", "--history", "--product",
            "--session-id", "--output",
        })

    def test_refuses_a_ledger_inside_the_repository(self) -> None:
        inside = Path("/srv/example-repo/.state")
        with patch.object(validate_round, "STATE_ROOT", inside):
            with self.assertRaisesRegex(ValueError, "inside the repository"):
                validate_round.ledger_path("/srv/example-repo")

    def test_refuses_a_short_or_missing_base_commit(self) -> None:
        for value in (None, "abc1234", "A" * 40):
            with self.subTest(value=value):
                current = bundle()
                current["base_sha"] = value
                with self.assertRaisesRegex(ValueError, "rebuild the bundle"):
                    validate_round.repository_identity(current)


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

    def test_requires_reviewer_coverage_for_supplemental_markdown(self) -> None:
        current_bundle, review = bundle_with_supplemental_markdown()
        result = validate_round.validate(current_bundle, review)
        self.assertFalse(result["valid"])
        self.assertIn(
            "files must account for every selected review (path, status) identity exactly once",
            result["errors"],
        )

    def test_accepts_reviewed_supplemental_markdown_as_clean(self) -> None:
        current_bundle, review = bundle_with_supplemental_markdown()
        review["files"].append(
            {
                "path": "docs/plan.md",
                "status": "modified",
                "disposition": "reviewed",
                "reason": "Reviewed the plan against the frozen implementation evidence.",
            }
        )
        result = validate_round.validate(current_bundle, review)
        self.assertTrue(result["valid"], result["errors"])
        self.assertTrue(result["clean"])
        self.assertEqual(result["ocr_reviewable_files"], 1)
        self.assertEqual(result["supplemental_reviewable_files"], 1)

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

    def test_cli_reports_non_string_finding_paths_without_crashing(self) -> None:
        for invalid_path in ([], {}, ["src/example.ts"], {"path": "src/example.ts"}):
            with self.subTest(path=invalid_path), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                review = finding_review()
                review["findings"][0]["path"] = invalid_path
                bundle_path = root / "bundle.json"
                review_path = root / "review.json"
                output_path = root / "validation.json"
                repository, head = make_repository(root / "repo")
                current = {**bundle(), "repository": repository, "base_sha": head}
                current["evidence_id"] = validate_round.canonical_evidence_id(current)
                review["evidence_id"] = current["evidence_id"]
                bundle_path.write_text(json.dumps(current), encoding="utf-8")
                review_path.write_text(json.dumps(review), encoding="utf-8")
                with patch.object(validate_round, "STATE_ROOT", root / "state"):
                    code, printed = run_validator(
                        "--bundle", str(bundle_path), "--review", str(review_path),
                        "--output", str(output_path),
                    )
                self.assertEqual(code, 2)
                report = json.loads(output_path.read_text(encoding="utf-8"))
                self.assertEqual(printed, report)
                self.assertFalse(report["valid"])
                self.assertFalse(report["clean"])
                self.assertIn(
                    "findings[0].path must be a non-empty string", report["errors"]
                )

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
            "files must account for every selected review (path, status) identity exactly once",
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
        accepted, supplemental, unaccepted = build_review_bundle.partition_excluded_files(
            excluded, []
        )
        self.assertEqual(accepted, ["default_path", "user_exclude"])
        self.assertEqual([entry["path"] for entry in supplemental], ["README.md"])
        self.assertEqual(
            [entry["path"] for entry in unaccepted],
            ["unknown.txt"],
        )

    def test_partition_exclusions_promotes_markdown_for_supplemental_review(self) -> None:
        excluded = [
            {"path": "README.md", "status": "modified", "exclude_reason": "unsupported_ext"},
            {"path": "docs/plan.mdx", "status": "added", "exclude_reason": "unsupported_ext"},
            {"path": "config.yaml", "status": "modified", "exclude_reason": "unsupported_ext"},
            {"path": "asset.png", "status": "modified", "exclude_reason": "binary"},
        ]
        accepted, supplemental, unaccepted = (
            build_review_bundle.partition_excluded_files(excluded, [])
        )
        self.assertEqual(accepted, ["default_path", "user_exclude"])
        self.assertEqual(
            [entry["path"] for entry in supplemental],
            ["README.md", "docs/plan.mdx"],
        )
        self.assertEqual(
            [entry["path"] for entry in unaccepted],
            ["config.yaml", "asset.png"],
        )

    def test_partition_exclusions_keeps_same_identity_binary_unaccepted(self) -> None:
        excluded = [
            {
                "path": "README.md",
                "status": "modified",
                "exclude_reason": "unsupported_ext",
            },
            {
                "path": "README.md",
                "status": "modified",
                "exclude_reason": "binary",
            },
        ]
        _, supplemental, unaccepted = build_review_bundle.partition_excluded_files(
            excluded, []
        )
        self.assertEqual(
            [entry["exclude_reason"] for entry in supplemental],
            ["unsupported_ext"],
        )
        self.assertEqual(
            [entry["exclude_reason"] for entry in unaccepted],
            ["binary"],
        )

    def test_partition_exclusions_accepts_ocr_default_paths_without_user_gate(self) -> None:
        excluded = [
            {"path": "src/example.test.ts", "exclude_reason": "default_path"},
            {"path": "generated.ts", "exclude_reason": "user_exclude"},
            {"path": "README.md", "exclude_reason": "unsupported_ext"},
            {"path": "asset.png", "exclude_reason": "binary"},
            {"path": "unknown.txt"},
        ]
        accepted, supplemental, unaccepted = build_review_bundle.partition_excluded_files(
            excluded, []
        )
        self.assertEqual(accepted, ["default_path", "user_exclude"])
        self.assertEqual([entry["path"] for entry in supplemental], ["README.md"])
        self.assertEqual(
            [entry["path"] for entry in unaccepted],
            ["asset.png", "unknown.txt"],
        )

    def test_partition_exclusions_allows_explicit_reason(self) -> None:
        excluded = [
            {"path": "README.md", "exclude_reason": "unsupported_ext"},
        ]
        accepted, supplemental, unaccepted = build_review_bundle.partition_excluded_files(
            excluded, ["unsupported_ext"]
        )
        self.assertEqual(
            accepted, ["default_path", "unsupported_ext", "user_exclude"]
        )
        self.assertEqual([entry["path"] for entry in supplemental], ["README.md"])
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
