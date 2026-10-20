#!/usr/bin/env python3
"""Tests for disk_tidy.py: real temporary git repositories, running processes faked in-process."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent / "disk_tidy.py"
SPEC = importlib.util.spec_from_file_location("disk_tidy", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
DT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DT)

ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


def git(*args: str, cwd: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, env=ENV, check=True, capture_output=True)


def make(path: Path, size: int = 2048) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


def run(*argv: str) -> tuple:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = DT.main(list(argv))
    return code, out.getvalue()


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.repo = self.tmp / "app"
        self.repo.mkdir()
        git("init", "-q", cwd=str(self.repo))
        (self.repo / ".gitignore").write_text(".next/\n.turbo/\ntarget/\n")
        self.cwds = mock.patch.object(DT, "process_cwds", return_value={})
        self.cwds_mock = self.cwds.start()

    def tearDown(self) -> None:
        self.cwds.stop()
        subprocess.run(["rm", "-rf", str(self.tmp)])


class FindArtifacts(Base):
    def test_finds_build_output_and_skips_dependencies(self) -> None:
        make(self.repo / "web/.next/cache/a")
        make(self.repo / ".turbo/b")
        make(self.repo / "node_modules/pkg/.next/c")
        make(self.repo / "web/.next/nested/.turbo/d")
        found = DT.find_artifacts([str(self.tmp)])
        self.assertEqual(found, [str(self.repo / ".turbo"), str(self.repo / "web/.next")])

    def test_finds_bundler_cache_inside_node_modules_only(self) -> None:
        make(self.repo / "web/node_modules/.cache/webpack/a")
        make(self.repo / "web/node_modules/pkg/index.js")
        found = DT.find_artifacts([str(self.tmp)])
        self.assertEqual(found, [str(self.repo / "web/node_modules/.cache")])

    def test_linked_node_modules_is_not_followed(self) -> None:
        make(self.repo / "node_modules/.cache/a")
        (self.repo / "wt").mkdir()
        os.symlink(self.repo / "node_modules", self.repo / "wt/node_modules")
        found = DT.find_artifacts([str(self.tmp)])
        self.assertEqual(found, [str(self.repo / "node_modules/.cache")])

    def test_target_counts_only_next_to_cargo_toml(self) -> None:
        make(self.repo / "rust/Cargo.toml", 10)
        make(self.repo / "rust/target/debug/x")
        make(self.repo / "docs/target/keep.md")
        found = DT.find_artifacts([str(self.tmp)])
        self.assertEqual(found, [str(self.repo / "rust/target")])


class Assess(Base):
    def test_ignored_and_idle_is_cleanable(self) -> None:
        make(self.repo / "web/.next/a")
        fact = DT.assess(str(self.repo / "web/.next"), {})
        self.assertTrue(fact["cleanable"])
        self.assertTrue(fact["ignored"])

    def test_not_ignored_blocks(self) -> None:
        make(self.repo / "pkg/.vite/a")
        fact = DT.assess(str(self.repo / "pkg/.vite"), {})
        self.assertEqual(fact["blockers"], ["not-ignored"])

    def test_outside_git_blocks(self) -> None:
        make(self.tmp / "loose/.next/a")
        fact = DT.assess(str(self.tmp / "loose/.next"), {})
        self.assertEqual(fact["blockers"], ["not-in-git"])

    def test_process_in_owning_package_blocks(self) -> None:
        make(self.repo / "web/.next/a")
        cwds = {str(self.repo / "web"): ["91855: next-server"]}
        fact = DT.assess(str(self.repo / "web/.next"), cwds)
        self.assertEqual(fact["blockers"], ["busy"])
        self.assertEqual(fact["busy"], ["91855: next-server"])

    def test_dev_server_in_package_blocks_its_node_modules_cache(self) -> None:
        (self.repo / ".gitignore").write_text("node_modules/\n")
        make(self.repo / "web/node_modules/.cache/a")
        cwds = {str(self.repo / "web"): ["5: next dev"]}
        fact = DT.assess(str(self.repo / "web/node_modules/.cache"), cwds)
        self.assertEqual(fact["blockers"], ["busy"])

    def test_editor_or_agent_in_repo_root_does_not_block(self) -> None:
        (self.repo / ".gitignore").write_text("node_modules/\n.turbo/\n")
        make(self.repo / "node_modules/.cache/a")
        cwds = {str(self.repo): ["1: /Applications/Code.app/Contents/MacOS/Electron", "2: claude --resume",
                                 "3: npm exec @modelcontextprotocol/server-github", "4: -/bin/zsh -l"]}
        self.assertTrue(DT.assess(str(self.repo / "node_modules/.cache"), cwds)["cleanable"])

    def test_any_process_inside_the_folder_blocks(self) -> None:
        make(self.repo / "web/.next/cache/a")
        cwds = {str(self.repo / "web/.next/cache"): ["8: -/bin/zsh"]}
        self.assertEqual(DT.assess(str(self.repo / "web/.next"), cwds)["blockers"], ["busy"])

    def test_dev_server_in_nested_worktree_does_not_block_main_checkout(self) -> None:
        (self.repo / "a.txt").write_text("a")
        git("add", ".", cwd=str(self.repo))
        git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init", cwd=str(self.repo))
        wt = self.repo / ".worktrees/feat"
        git("worktree", "add", "-q", str(wt), cwd=str(self.repo))
        (self.repo / ".gitignore").write_text(".turbo/\n.worktrees/\n")
        make(self.repo / ".turbo/a")
        (wt / "web").mkdir()
        cwds = {str(wt / "web"): ["9: node node_modules/.bin/next dev"]}
        self.assertTrue(DT.assess(str(self.repo / ".turbo"), cwds)["cleanable"])
        cwds = {str(self.repo / "web"): ["10: next-server (v16.3.0)"]}
        (self.repo / "web").mkdir()
        self.assertEqual(DT.assess(str(self.repo / ".turbo"), cwds)["blockers"], ["busy"])

    def test_process_in_sibling_folder_does_not_block(self) -> None:
        make(self.repo / "web/.next/a")
        cwds = {str(self.repo / "webapp"): ["1: node"], str(self.repo / "server"): ["2: node"]}
        self.assertTrue(DT.assess(str(self.repo / "web/.next"), cwds)["cleanable"])


class Clean(Base):
    def report(self) -> str:
        make(self.repo / "web/.next/a")
        make(self.repo / "pkg/.vite/b")
        out = str(self.tmp / "report.json")
        code, _ = run("artifacts", str(self.repo), "--out", out)
        self.assertEqual(code, 0)
        return out

    def test_dry_run_deletes_nothing(self) -> None:
        code, out = run("clean", self.report())
        self.assertEqual(code, 0)
        self.assertIn("would delete", out)
        self.assertTrue((self.repo / "web/.next").exists())

    def test_yes_deletes_only_cleanable(self) -> None:
        code, out = run("clean", self.report(), "--yes")
        self.assertEqual(code, 0, out)
        self.assertFalse((self.repo / "web/.next").exists())
        self.assertTrue((self.repo / "pkg/.vite").exists())
        self.assertIn("gained_gib", out)

    def test_rechecks_busy_before_deleting(self) -> None:
        report = self.report()
        self.cwds_mock.return_value = {str(self.repo / "web"): ["7: next dev"]}
        code, out = run("clean", report, "--yes")
        self.assertEqual(code, 0)
        self.assertIn("skipped", out)
        self.assertTrue((self.repo / "web/.next").exists())

    def test_refuses_unknown_folder_name_in_edited_report(self) -> None:
        keep = self.repo / "src"
        make(keep / "main.ts")
        report = self.tmp / "edited.json"
        report.write_text(json.dumps({"items": [{"path": str(keep), "cleanable": True, "blockers": []}]}))
        code, out = run("clean", str(report), "--yes")
        self.assertEqual(code, 1)
        self.assertIn("refused", out)
        self.assertTrue((keep / "main.ts").exists())


class Known(unittest.TestCase):
    def test_reports_existing_locations_above_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            make(Path(home) / ".npm/_cacache/x", 3 * 1024 * 1024)
            with mock.patch.dict(os.environ, {"HOME": home}):
                code, out = run("known", "--min-mib", "1", "--json")
        # Absolute system paths in the list are real on this machine; look only at the fake home.
        rows = [r for r in json.loads(out) if r["path"].startswith(home)]
        self.assertEqual(code, 0)
        self.assertEqual([r["what"] for r in rows], ["npm cache and npx packages"])
        self.assertEqual(rows[0]["tier"], "A")


class Free(unittest.TestCase):
    def setUp(self) -> None:
        self.state = tempfile.mkdtemp()
        self.env = mock.patch.dict(os.environ, {"DISK_TIDY_STATE": self.state})
        self.env.start()

    def tearDown(self) -> None:
        self.env.stop()
        subprocess.run(["rm", "-rf", self.state])

    def test_first_snapshot_has_no_previous(self) -> None:
        code, out = run("free", "--path", tempfile.gettempdir())
        data = json.loads(out)
        self.assertEqual(code, 0)
        self.assertGreater(data["total_gib"], 0)
        self.assertIsNone(data["previous"])

    def test_second_snapshot_compares_with_the_first(self) -> None:
        run("free", "--path", tempfile.gettempdir(), "--note", "before")
        _, out = run("free", "--path", tempfile.gettempdir())
        data = json.loads(out)
        self.assertEqual(data["previous"]["note"], "before")
        self.assertIn("free_change_gib", data)
        lines = (Path(self.state) / "free.jsonl").read_text().splitlines()
        self.assertEqual(len(lines), 2)

    def test_no_record_leaves_history_untouched(self) -> None:
        run("free", "--path", tempfile.gettempdir(), "--no-record")
        self.assertFalse((Path(self.state) / "free.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
