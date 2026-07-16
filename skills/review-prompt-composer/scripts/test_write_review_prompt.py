#!/usr/bin/env python3
"""Black-box tests for write_review_prompt.py."""

from __future__ import annotations

import json
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
WRITER = SCRIPT_DIR / "write_review_prompt.py"
WRITER_SPEC = importlib.util.spec_from_file_location("review_prompt_writer", WRITER)
assert WRITER_SPEC is not None and WRITER_SPEC.loader is not None
WRITER_MODULE = importlib.util.module_from_spec(WRITER_SPEC)
sys.modules[WRITER_SPEC.name] = WRITER_MODULE
if WRITER.exists():
    WRITER_SPEC.loader.exec_module(WRITER_MODULE)

FIXED_NOW = datetime(2026, 7, 15, 6, 30, tzinfo=timezone.utc)
REVIEW_BODY = """# 审核任务：测试改动

## 工作区与范围

仓库与范围来自当前测试仓库。

## 待验证目标

验证行为没有回归。

## 改动清单

1. `tracked.txt` — modified

## 审核重点

- 正确性与回归风险。

## 输出要求

审核结果第一行必须原样返回：

Review-Prompt-ID: `{{REVIEW_PROMPT_ID}}`
"""


class ReviewPromptWriterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Prompt Test")
        self.git("config", "user.email", "prompt@example.invalid")
        (self.repo / "tracked.txt").write_text("original\n", encoding="utf-8")
        self.git("add", "tracked.txt")
        self.git("commit", "-m", "initial")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
        )

    def run_writer(
        self,
        scope: str,
        body_file: Path,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(WRITER),
                "--repo",
                str(self.repo),
                "--scope",
                scope,
                "--body-file",
                str(body_file),
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    def dirty_tracked_file(self) -> None:
        (self.repo / "tracked.txt").write_text("changed\n", encoding="utf-8")

    def create_direct(
        self,
        now: datetime,
        body: str = REVIEW_BODY,
    ):
        return WRITER_MODULE.create_review_prompt(
            self.repo,
            "all-uncommitted",
            body,
            now,
        )

    def prompt_body(self, path: Path) -> str:
        return path.read_text(encoding="utf-8").split("---\n", 2)[2]

    def test_writes_single_prompt_under_repo_local_branch_inbox(self) -> None:
        self.assertTrue(WRITER.exists(), "write_review_prompt.py must exist")
        self.dirty_tracked_file()
        body_file = self.root / "body.md"
        body_file.write_text(REVIEW_BODY, encoding="utf-8")

        result = self.run_writer("all-uncommitted", body_file)

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        prompt_path = Path(payload["prompt_path"])
        self.assertEqual(
            prompt_path.parent,
            self.repo.resolve() / ".review-handoff/prompts/active/main",
        )
        self.assertRegex(
            prompt_path.name,
            r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-all-uncommitted\.md$",
        )
        prompt = prompt_path.read_text(encoding="utf-8")
        self.assertIn("artifact_type: review_prompt", prompt)
        self.assertIn(f'prompt_id: "{payload["prompt_id"]}"', prompt)
        self.assertIn(f'Review-Prompt-ID: `{payload["prompt_id"]}`', prompt)
        self.assertNotIn("{{REVIEW_PROMPT_ID}}", prompt)
        self.assertNotIn("tracked.patch", prompt)
        self.assertNotIn("manifest.md", prompt)
        created_at = datetime.fromisoformat(payload["created_at"].replace("Z", "+00:00"))
        expires_at = datetime.fromisoformat(payload["expires_at"].replace("Z", "+00:00"))
        self.assertEqual((expires_at - created_at).total_seconds(), 24 * 60 * 60)
        self.assertNotIn(".review-handoff", self.git("status", "--short").stdout)

    def test_archives_expired_prompt_without_changing_body(self) -> None:
        self.dirty_tracked_file()
        first = self.create_direct(FIXED_NOW)
        original_body = self.prompt_body(first.prompt_path)

        second = self.create_direct(FIXED_NOW + timedelta(hours=25))

        archived = (
            self.repo.resolve()
            / ".review-handoff/prompts/archive/main"
            / first.prompt_path.name
        )
        self.assertFalse(first.prompt_path.exists())
        self.assertTrue(archived.exists())
        self.assertIn(
            "lifecycle_state: expired",
            archived.read_text(encoding="utf-8"),
        )
        self.assertEqual(self.prompt_body(archived), original_body)
        self.assertIn(archived, second.archived_paths)

    def test_keeps_unexpired_prompt_active(self) -> None:
        self.dirty_tracked_file()
        first = self.create_direct(FIXED_NOW)

        self.create_direct(FIXED_NOW + timedelta(hours=23))

        self.assertTrue(first.prompt_path.exists())
        self.assertIn(
            "lifecycle_state: active",
            first.prompt_path.read_text(encoding="utf-8"),
        )

    def test_collision_adds_numeric_suffix(self) -> None:
        self.dirty_tracked_file()
        first = self.create_direct(FIXED_NOW)

        second = self.create_direct(FIXED_NOW)

        self.assertNotEqual(first.prompt_path, second.prompt_path)
        self.assertTrue(
            second.prompt_path.name.endswith("-all-uncommitted-02.md"),
        )

    def test_malformed_active_prompt_is_preserved_and_reported(self) -> None:
        self.dirty_tracked_file()
        malformed = (
            self.repo
            / ".review-handoff/prompts/active/main/2026-07-14_06-30-broken.md"
        )
        malformed.parent.mkdir(parents=True)
        malformed.write_text(
            "---\nexpires_at: not-a-date\n---\nbroken\n",
            encoding="utf-8",
        )

        artifact = self.create_direct(FIXED_NOW)

        self.assertTrue(malformed.exists())
        self.assertTrue(
            any(malformed.name in warning for warning in artifact.warnings),
        )

    def test_mismatched_prompt_id_is_preserved_and_reported(self) -> None:
        self.dirty_tracked_file()
        first = self.create_direct(FIXED_NOW)
        content = first.prompt_path.read_text(encoding="utf-8")
        first.prompt_path.write_text(
            content.replace(
                f'prompt_id: "{first.prompt_id}"',
                'prompt_id: "other/2026-07-15_14-30-all-uncommitted"',
            ),
            encoding="utf-8",
        )

        artifact = self.create_direct(FIXED_NOW + timedelta(hours=25))

        self.assertTrue(first.prompt_path.exists())
        self.assertTrue(
            any("prompt_id does not match" in warning for warning in artifact.warnings),
        )

    def test_existing_unanchored_exclude_is_not_duplicated(self) -> None:
        self.dirty_tracked_file()
        exclude_file = self.repo / ".git/info/exclude"
        exclude_file.write_text(".review-handoff/\n", encoding="utf-8")

        self.create_direct(FIXED_NOW)

        self.assertEqual(
            exclude_file.read_text(encoding="utf-8"),
            ".review-handoff/\n",
        )

    def test_sensitive_body_fails_without_printing_secret(self) -> None:
        self.dirty_tracked_file()
        secret = "https://alice:do-not-print@example.invalid/private"
        body = REVIEW_BODY.replace("验证行为没有回归。", secret)

        with self.assertRaises(WRITER_MODULE.WriterError) as raised:
            self.create_direct(FIXED_NOW, body)

        self.assertIn("credential-bearing URL", str(raised.exception))
        self.assertNotIn("do-not-print", str(raised.exception))
        prompt_root = self.repo / ".review-handoff/prompts"
        self.assertFalse(prompt_root.exists())


if __name__ == "__main__":
    unittest.main()
