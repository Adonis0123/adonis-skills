#!/usr/bin/env python3
"""Black-box tests for build_review_handoff.py."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
BUILDER = SCRIPT_DIR / "build_review_handoff.py"


class ReviewHandoffBuilderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Flow Test")
        self.git("config", "user.email", "flow@example.invalid")

        (self.repo / "partial.txt").write_text(
            "staged=old\nunstaged=old\n",
            encoding="utf-8",
        )
        (self.repo / "blob.bin").write_bytes(b"old\x00binary\x01")
        self.git("add", ".")
        self.git("commit", "-m", "initial")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def git(self, *args: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=cwd or self.repo,
            check=True,
            capture_output=True,
            text=True,
        )

    def prepare_mixed_changes(self) -> None:
        (self.repo / "partial.txt").write_text(
            "staged=new\nunstaged=old\n",
            encoding="utf-8",
        )
        self.git("add", "partial.txt")
        (self.repo / "partial.txt").write_text(
            "staged=new\nunstaged=new\n",
            encoding="utf-8",
        )
        (self.repo / "blob.bin").write_bytes(b"new\x00binary\x02")
        (self.repo / "untracked.txt").write_text(
            "new untracked review input\n",
            encoding="utf-8",
        )

    def run_builder(
        self,
        scope: str,
        output_dir: Path,
        *extra_args: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(BUILDER),
                "--repo",
                str(self.repo),
                "--scope",
                scope,
                "--output-dir",
                str(output_dir),
                *extra_args,
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    def clone_head(self, name: str) -> Path:
        receiver = self.root / name
        subprocess.run(
            ["git", "clone", "--quiet", str(self.repo), str(receiver)],
            check=True,
            capture_output=True,
            text=True,
        )
        return receiver

    def test_all_uncommitted_builds_replayable_bundle_without_git_mutation(self) -> None:
        self.prepare_mixed_changes()
        status_before = self.git("status", "--short").stdout
        output_dir = self.root / "all-bundle"

        result = self.run_builder(
            "all-uncommitted",
            output_dir,
            "--check-command",
            "pnpm test",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["scope"], "all-uncommitted")
        self.assertEqual(
            {item["name"] for item in payload["artifacts"]},
            {"tracked.patch", "untracked-files.tar.gz", "manifest.md"},
        )
        self.assertEqual(self.git("status", "--short").stdout, status_before)

        receiver = self.clone_head("all-receiver")
        subprocess.run(
            ["git", "apply", "--binary", str(output_dir / "tracked.patch")],
            cwd=receiver,
            check=True,
        )
        with tarfile.open(output_dir / "untracked-files.tar.gz", "r:gz") as archive:
            archive.extractall(receiver)

        self.assertEqual(
            (receiver / "partial.txt").read_text(encoding="utf-8"),
            "staged=new\nunstaged=new\n",
        )
        self.assertEqual((receiver / "blob.bin").read_bytes(), b"new\x00binary\x02")
        self.assertEqual(
            (receiver / "untracked.txt").read_text(encoding="utf-8"),
            "new untracked review input\n",
        )
        manifest = (output_dir / "manifest.md").read_text(encoding="utf-8")
        self.assertIn("Scope: `all-uncommitted`", manifest)
        self.assertIn("pnpm test", manifest)

    def test_staged_only_excludes_unstaged_and_untracked_changes(self) -> None:
        self.prepare_mixed_changes()
        output_dir = self.root / "staged-bundle"

        result = self.run_builder("staged-only", output_dir)

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            {item["name"] for item in payload["artifacts"]},
            {"tracked.patch", "manifest.md"},
        )
        receiver = self.clone_head("staged-receiver")
        subprocess.run(
            ["git", "apply", "--binary", str(output_dir / "tracked.patch")],
            cwd=receiver,
            check=True,
        )
        self.assertEqual(
            (receiver / "partial.txt").read_text(encoding="utf-8"),
            "staged=new\nunstaged=old\n",
        )
        self.assertEqual((receiver / "blob.bin").read_bytes(), b"old\x00binary\x01")
        self.assertFalse((output_dir / "untracked-files.tar.gz").exists())

    def test_unstaged_only_adds_out_of_scope_prerequisite_for_partial_stage(self) -> None:
        self.prepare_mixed_changes()
        output_dir = self.root / "unstaged-bundle"

        result = self.run_builder("unstaged-only", output_dir)

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            {item["name"] for item in payload["artifacts"]},
            {"prerequisite-staged.patch", "tracked.patch", "manifest.md"},
        )
        receiver = self.clone_head("unstaged-receiver")
        for patch_name in ["prerequisite-staged.patch", "tracked.patch"]:
            subprocess.run(
                ["git", "apply", "--binary", str(output_dir / patch_name)],
                cwd=receiver,
                check=True,
            )
        self.assertEqual(
            (receiver / "partial.txt").read_text(encoding="utf-8"),
            "staged=new\nunstaged=new\n",
        )
        self.assertEqual((receiver / "blob.bin").read_bytes(), b"new\x00binary\x02")
        self.assertFalse((output_dir / "untracked-files.tar.gz").exists())
        manifest = (output_dir / "manifest.md").read_text(encoding="utf-8")
        self.assertIn("not part of the review scope", manifest)

    def test_untracked_only_excludes_all_tracked_changes(self) -> None:
        self.prepare_mixed_changes()
        output_dir = self.root / "untracked-bundle"

        result = self.run_builder("untracked-only", output_dir)

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            {item["name"] for item in payload["artifacts"]},
            {"untracked-files.tar.gz", "manifest.md"},
        )
        receiver = self.clone_head("untracked-receiver")
        with tarfile.open(output_dir / "untracked-files.tar.gz", "r:gz") as archive:
            archive.extractall(receiver)
        self.assertEqual(
            (receiver / "partial.txt").read_text(encoding="utf-8"),
            "staged=old\nunstaged=old\n",
        )
        self.assertEqual((receiver / "blob.bin").read_bytes(), b"old\x00binary\x01")
        self.assertEqual(
            (receiver / "untracked.txt").read_text(encoding="utf-8"),
            "new untracked review input\n",
        )
        self.assertFalse((output_dir / "tracked.patch").exists())

    def test_rejects_output_directory_inside_repository(self) -> None:
        self.prepare_mixed_changes()
        status_before = self.git("status", "--short").stdout
        output_dir = self.repo / "handoff"

        result = self.run_builder("all-uncommitted", output_dir)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("outside the repository", result.stderr)
        self.assertFalse(output_dir.exists())
        self.assertEqual(self.git("status", "--short").stdout, status_before)

    def test_blocks_sensitive_untracked_files_without_printing_secret(self) -> None:
        secret = "do-not-print-this-secret"
        (self.repo / ".env").write_text(f"API_TOKEN={secret}\n", encoding="utf-8")
        output_dir = self.root / "sensitive-bundle"

        result = self.run_builder("untracked-only", output_dir)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sensitive", result.stderr.lower())
        self.assertIn(".env", result.stderr)
        self.assertNotIn(secret, result.stderr)
        self.assertFalse(output_dir.exists())


if __name__ == "__main__":
    unittest.main()
