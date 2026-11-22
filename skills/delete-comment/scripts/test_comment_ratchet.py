#!/usr/bin/env python3
"""Tests for comment_ratchet.py against real temporary git repositories and the real cloc."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "comment_ratchet.py"
SPEC = importlib.util.spec_from_file_location("comment_ratchet", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
CR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CR)

ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


def git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, env=ENV, check=True, capture_output=True)


def run(root: Path, *argv: str) -> tuple[int, str]:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = CR.main(["--root", str(root), *argv])
    return code, buf.getvalue()


@unittest.skipIf(shutil.which("cloc") is None, "cloc not installed")
class RatchetTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        git("init", "-q", cwd=self.root)
        self.write("src/a.ts", "// sets x\nconst x = 1;\n// WHY: upstream bug #12\nfoo();\n")
        self.write("src/b.py", "# loop\nfor i in range(3):\n    pass  # trailing\n")
        self.write("vendor/c.js", "// vendored\nbar();\n")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        git("add", rel, cwd=self.root)

    def baseline(self) -> dict:
        return json.loads((self.root / CR.DEFAULT_BASELINE).read_text())

    def test_report_counts_and_subtracts_markers(self) -> None:
        code, out = run(self.root, "report", "--json")
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertEqual(data["commentLines"], 4)
        self.assertEqual(data["allowedLines"], 1)
        self.assertEqual(data["countedLines"], 3)

    def test_snapshot_respects_exclude_and_markers(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        files = self.baseline()["files"]
        self.assertEqual(files, {"src/a.ts": 1, "src/b.py": 1})
        self.assertEqual(self.baseline()["config"]["exclude"], ["^vendor/"])

    def test_check_fails_when_comments_grow(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        self.write("src/a.ts", "// sets x\n// again\nconst x = 1;\n")
        code, out = run(self.root, "check")
        self.assertEqual(code, 1)
        self.assertIn("src/a.ts: 1 -> 2", out)
        self.assertIn("Fix:", out)

    def test_check_fails_for_new_file_with_comments(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        self.write("src/new.ts", "// hello\nx();\n")
        code, out = run(self.root, "check")
        self.assertEqual(code, 1)
        self.assertIn("src/new.ts: 0 -> 1", out)

    def test_marked_comment_does_not_trip_check(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        self.write("src/new.ts", "// WHY: keeps order stable for the API\nx();\n")
        code, _ = run(self.root, "check")
        self.assertEqual(code, 0)

    def test_multiline_marked_block_does_not_trip_check(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        self.write(
            "src/new.ts",
            "// WHY: the API sorts by insertion order,\n// so callers rely on it\n// across releases.\nx();\n"
            "/**\n * Resumes the session by id\n * (ADR-0009).\n */\ny();\n",
        )
        code, out = run(self.root, "check")
        self.assertEqual(code, 0, out)

    def test_unmarked_block_after_code_still_counts(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        self.write("src/new.ts", "// WHY: reason\nx();\n// sets y\ny();\n")
        code, out = run(self.root, "check")
        self.assertEqual(code, 1)
        self.assertIn("src/new.ts: 0 -> 1", out)

    def test_plain_comment_touching_marked_jsdoc_still_counts(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        self.write("src/new.ts", "/**\n * Resumes (ADR-0009).\n */\n// sets the value\nx();\n")
        code, out = run(self.root, "check")
        self.assertEqual(code, 1)
        self.assertIn("src/new.ts: 0 -> 1", out)

    def test_rename_does_not_trip_check(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        git("mv", "src/a.ts", "src/renamed.ts", cwd=self.root)
        code, out = run(self.root, "check")
        self.assertEqual(code, 0, out)

    def test_check_rejects_subpath(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            run(self.root, "check", "src")

    def test_tighten_lowers_baseline(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        self.write("src/a.ts", "const x = 1;\n")
        code, out = run(self.root, "check", "--tighten")
        self.assertEqual(code, 0)
        self.assertIn("tightened by 1", out)
        self.assertEqual(self.baseline()["files"], {"src/b.py": 1})

    def test_untracked_files_are_ignored(self) -> None:
        run(self.root, "snapshot", "--exclude", "^vendor/")
        (self.root / "src/scratch.ts").write_text("// note\n")
        code, _ = run(self.root, "check")
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
