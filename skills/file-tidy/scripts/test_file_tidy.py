#!/usr/bin/env python3
"""Tests for file_tidy.py: black-box CLI runs plus a few in-process checks."""

from __future__ import annotations

import importlib.util
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent / "file_tidy.py"
SKILL_DIR = SCRIPT.parents[1]
SPEC = importlib.util.spec_from_file_location("file_tidy", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
FT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FT)

class Sandbox(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.root = self.home / "Files"
        self.inbox = self.home / "Downloads"
        self.inbox.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_cli(self, *args: str, ok: bool = True, env: dict | None = None) -> subprocess.CompletedProcess:
        full_env = {**os.environ, "HOME": str(self.home), **(env or {})}
        full_env.pop("FILE_TIDY_ROOT", None)
        result = subprocess.run([sys.executable, "-I", str(SCRIPT), *args],
                                capture_output=True, text=True, encoding="utf-8", env=full_env)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def write_plan(self, items: list[dict]) -> Path:
        plan = self.home / "plan.json"
        plan.write_text(json.dumps({"root": str(self.root), "items": items}), encoding="utf-8")
        return plan

    def init_root(self) -> None:
        self.run_cli("init", "--root", str(self.root), "--apply")

    def apply(self, items: list[dict]) -> dict:
        return json.loads(self.run_cli("apply", str(self.write_plan(items)), "--apply").stdout)


class InitAndScanTests(Sandbox):
    def test_init_creates_categories_and_config_and_is_idempotent(self) -> None:
        dry = self.run_cli("init", "--root", str(self.root))
        self.assertFalse(self.root.exists())
        self.assertIn("30_finance/invoices/company", dry.stdout)
        self.init_root()
        self.assertTrue((self.root / "99_sensitive" / "credentials").is_dir())
        config = json.loads((self.root / "_system" / "config.json").read_text())
        self.assertEqual(config["inboxes"]["capture"], f"{self.root}/00_inbox")
        again = json.loads(self.run_cli("init", "--root", str(self.root), "--apply").stdout)
        self.assertEqual(again["config"], "existing")
        self.assertEqual(again["create"], [])

    def test_scan_lists_items_skips_dotfiles_and_hashes_on_request(self) -> None:
        (self.inbox / ".hidden").write_text("h")
        (self.inbox / "v.MP4").write_text("1234")
        (self.inbox / "copy.mp4").write_text("1234")
        report = json.loads(self.run_cli("scan", str(self.inbox), "--hash").stdout)
        items = {i["name"]: i for i in report[0]["items"]}
        self.assertEqual(sorted(items), ["copy.mp4", "v.MP4"])
        self.assertEqual(items["v.MP4"]["ext"], ".mp4")
        self.assertEqual(items["v.MP4"]["sha256_tree"], items["copy.mp4"]["sha256_tree"],
                         "same bytes under different names must hash equal so duplicates are found")

    def test_scan_missing_directory_fails_cleanly(self) -> None:
        err = self.run_cli("scan", str(self.home / "nope"), ok=False).stderr
        self.assertIn("not a directory", err)
        self.assertNotIn("Traceback", err)

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0, "root can read everything")
    def test_scan_hash_reports_unreadable_items_and_keeps_going(self) -> None:
        locked = self.inbox / "locked"
        (locked / "inner").mkdir(parents=True)
        (self.inbox / "ok.txt").write_text("ok")
        os.chmod(locked / "inner", 0)
        try:
            report = json.loads(self.run_cli("scan", str(self.inbox), "--hash").stdout)
        finally:
            os.chmod(locked / "inner", 0o755)
        items = {i["name"]: i for i in report[0]["items"]}
        self.assertIn("error", items["locked"])
        self.assertIn("sha256_tree", items["ok.txt"])

    def test_non_ascii_output_survives_a_legacy_codepage(self) -> None:
        (self.inbox / "发票.pdf").write_text("x")
        out = self.run_cli("scan", str(self.inbox), env={"PYTHONIOENCODING": "cp1252"}).stdout
        self.assertIn("发票.pdf", out)


class ApplyTests(Sandbox):
    def test_dry_run_moves_nothing(self) -> None:
        self.init_root()
        (self.inbox / "a.pdf").write_text("x")
        out = self.run_cli("apply", str(self.write_plan([{"src": str(self.inbox / "a.pdf"),
                                                           "dest": "30_finance/bills/a.pdf"}]))).stdout
        self.assertIn("Dry-run passed: 1 items", out)
        self.assertTrue((self.inbox / "a.pdf").exists())

    def test_refuses_existing_destination_and_moves_nothing(self) -> None:
        self.init_root()
        (self.inbox / "a.pdf").write_text("new")
        (self.inbox / "b.pdf").write_text("b")
        (self.root / "30_finance" / "bills" / "a.pdf").write_text("old")
        plan = self.write_plan([
            {"src": str(self.inbox / "b.pdf"), "dest": "30_finance/bills/b.pdf"},
            {"src": str(self.inbox / "a.pdf"), "dest": "30_finance/bills/a.pdf"},
        ])
        self.assertIn("refusing to overwrite", self.run_cli("apply", str(plan), "--apply", ok=False).stderr)
        self.assertTrue((self.inbox / "b.pdf").exists())
        self.assertEqual((self.root / "30_finance" / "bills" / "a.pdf").read_text(), "old")

    def test_destinations_differing_only_in_case_are_rejected(self) -> None:
        self.init_root()
        (self.inbox / "a1").mkdir()
        (self.inbox / "a2").mkdir()
        (self.inbox / "a1" / "r.pdf").write_text("one")
        (self.inbox / "a2" / "r.pdf").write_text("two")
        plan = self.write_plan([
            {"src": str(self.inbox / "a1" / "r.pdf"), "dest": "40_media/R.pdf"},
            {"src": str(self.inbox / "a2" / "r.pdf"), "dest": "40_media/r.pdf"},
        ])
        self.assertIn("ignoring case", self.run_cli("apply", str(plan), ok=False).stderr)

    def test_destination_appearing_after_dry_run_is_not_overwritten(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("mine")
        dest = self.root / "40_media" / "a.txt"
        real_snapshot = FT.snapshot

        def racing_snapshot(path: Path) -> dict:
            result = real_snapshot(path)
            if path == self.inbox / "a.txt" and not dest.exists():
                dest.write_text("theirs")
            return result

        with mock.patch.object(FT, "snapshot", racing_snapshot), self.assertRaises(FileExistsError):
            FT.safe_move(self.inbox / "a.txt", dest)
        self.assertEqual(dest.read_text(), "theirs")
        self.assertEqual((self.inbox / "a.txt").read_text(), "mine")

    def test_cross_volume_move_copies_verifies_then_removes_source(self) -> None:
        self.init_root()
        folder = self.inbox / "proj"
        (folder / "sub").mkdir(parents=True)
        (folder / "sub" / "f.txt").write_text("content")
        dest = self.root / "20_work" / "projects" / "proj"
        with mock.patch.object(FT, "same_volume", return_value=False):
            FT.safe_move(folder, dest)
        self.assertFalse(folder.exists())
        self.assertEqual((dest / "sub" / "f.txt").read_text(), "content")
        self.assertFalse(any(p.name.startswith(".file-tidy-partial-") for p in dest.parent.iterdir()))

    def test_cross_volume_bad_copy_keeps_source(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("content")
        dest = self.root / "40_media" / "a.txt"

        def corrupt_copy(src, dst, follow_symlinks=True):
            Path(dst).write_text("corrupt")

        with mock.patch.object(FT, "same_volume", return_value=False), \
                mock.patch.object(FT.shutil, "copy2", corrupt_copy), self.assertRaises(OSError):
            FT.safe_move(self.inbox / "a.txt", dest)
        self.assertEqual((self.inbox / "a.txt").read_text(), "content")
        self.assertFalse(dest.exists())

    def test_rejects_nested_sources_and_destinations_inside_sources(self) -> None:
        self.init_root()
        (self.inbox / "q").mkdir()
        (self.inbox / "q" / "inner.txt").write_text("x")
        (self.inbox / "other.txt").write_text("y")
        nested = self.write_plan([
            {"src": str(self.inbox / "q"), "dest": "20_work/q"},
            {"src": str(self.inbox / "q" / "inner.txt"), "dest": "20_work/inner.txt"},
        ])
        self.assertIn("inside item 0's source", self.run_cli("apply", str(nested), ok=False).stderr)
        into_src = self.write_plan([
            {"src": str(self.inbox / "other.txt"), "dest": str(self.inbox / "q" / "other.txt")},
            {"src": str(self.inbox / "q"), "dest": "20_work/q"},
        ])
        self.assertIn("destination is inside item 1's source", self.run_cli("apply", str(into_src), ok=False).stderr)

    def test_rejects_protected_paths_and_escaping_destinations(self) -> None:
        self.init_root()
        (self.home / "Desktop").mkdir()
        (self.inbox / "a.txt").write_text("x")
        (self.home / "Library" / "Application Support" / "App").mkdir(parents=True)
        cases = {
            "Default Folder": {"src": str(self.home / "Desktop"), "action": "trash"},
            "Default Folder via ..": {"src": f"{self.home}/x/../Desktop", "action": "trash"},
            "App Data": {"src": str(self.home / "Library" / "Application Support" / "App"), "dest": "90_archive/app"},
            "_system destination": {"src": str(self.inbox / "a.txt"), "dest": "_system/manifests/x.json"},
            "home directory": {"src": str(self.home), "dest": "90_archive/home"},
            "_system": {"src": str(self.root / "_system" / "plans"), "dest": "90_archive/plans"},
            "escapes the Root": {"src": str(self.inbox / "a.txt"), "dest": "../../a.txt"},
        }
        messages = {"Default Folder via ..": "Default Folder", "_system destination": "_system folder"}
        for label, item in cases.items():
            with self.subTest(label):
                err = self.run_cli("apply", str(self.write_plan([item])), ok=False).stderr
                self.assertIn(messages.get(label, label), err)
        self.assertTrue((self.home / "Desktop").is_dir())

    def test_default_folder_check_ignores_letter_case(self) -> None:
        self.init_root()
        (self.home / "desktop").mkdir()
        err = self.run_cli("apply", str(self.write_plan([{"src": str(self.home / "desktop"), "action": "trash"}])),
                           ok=False).stderr
        self.assertIn("Default Folder", err)

    def test_outside_root_paths_from_config_are_protected(self) -> None:
        self.init_root()
        notes = self.home / "notes"
        notes.mkdir()
        (notes / "n.md").write_text("n")
        config_path = self.root / "_system" / "config.json"
        config = json.loads(config_path.read_text())
        config["outside_root"]["notes"] = ["~/notes"]
        config_path.write_text(json.dumps(config))
        err = self.run_cli("apply", str(self.write_plan([{"src": str(notes / "n.md"), "dest": "20_work/n.md"}])),
                           ok=False).stderr
        self.assertIn("outside_root", err)

    def test_warns_about_a_top_level_relative_link(self) -> None:
        self.init_root()
        (self.home / "Desktop").mkdir()
        (self.inbox / "target.txt").write_text("t")
        os.symlink("../Downloads/target.txt", self.home / "Desktop" / "rel-link")
        plan = self.write_plan([{"src": str(self.home / "Desktop" / "rel-link"), "dest": "40_media/rel-link"}])
        self.assertIn("will point elsewhere", self.run_cli("apply", str(plan)).stdout)

    def test_warns_about_relative_links_that_would_break(self) -> None:
        self.init_root()
        (self.inbox / "target.txt").write_text("t")
        (self.inbox / "lk").mkdir()
        os.symlink("../target.txt", self.inbox / "lk" / "l")
        out = self.run_cli("apply", str(self.write_plan([{"src": str(self.inbox / "lk"), "dest": "20_work/lk"}]))).stdout
        self.assertIn("WARN", out)
        self.assertIn("will point elsewhere", out)

    def test_two_runs_never_share_a_manifest(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        (self.inbox / "b.txt").write_text("b")
        first = self.apply([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        second = self.apply([{"src": str(self.inbox / "b.txt"), "dest": "40_media/b.txt"}])
        self.assertNotEqual(first["manifest"], second["manifest"])
        self.assertEqual(len(json.loads(Path(first["manifest"]).read_text())["items"]), 1)

    def test_failure_mid_run_reports_manifest_and_progress(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        (self.inbox / "b.txt").write_text("b")
        plan = self.write_plan([
            {"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"},
            {"src": str(self.inbox / "b.txt"), "dest": "40_media/b.txt"},
        ])
        real_move = FT.safe_move
        calls = {"n": 0}

        def flaky(src, dest):
            calls["n"] += 1
            if calls["n"] == 2:
                raise OSError("disk full")
            return real_move(src, dest)

        with mock.patch.object(FT, "safe_move", flaky), \
                mock.patch.dict(os.environ, {"HOME": str(self.home)}), \
                mock.patch("builtins.print") as printed:
            code = FT.main(["apply", str(plan), "--apply"])
        self.assertEqual(code, 1)
        report = json.loads(printed.call_args.args[0])
        self.assertEqual((report["moved"], report["remaining"]), (1, 1))
        manifest = json.loads(Path(report["manifest"]).read_text())
        self.assertEqual(len(manifest["items"]), 1)
        self.assertTrue((self.inbox / "b.txt").exists())

    def run_main(self, *argv: str) -> tuple[int, dict]:
        with mock.patch.dict(os.environ, {"HOME": str(self.home)}), mock.patch("builtins.print") as printed:
            code = FT.main(list(argv))
        return code, json.loads(printed.call_args.args[0])

    def test_item_that_changed_while_moving_is_still_recorded(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        dest = self.root / "40_media" / "a.txt"
        real_snapshot = FT.snapshot

        def drifting(path: Path) -> dict:
            result = real_snapshot(path)
            return {**result, "sha256_tree": "changed"} if path == dest else result

        plan = self.write_plan([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        with mock.patch.object(FT, "snapshot", drifting):
            code, report = self.run_main("apply", str(plan), "--apply")
        self.assertEqual((code, report["moved"]), (1, 1))
        entry = json.loads(Path(report["manifest"]).read_text())["items"][0]
        self.assertFalse(entry["verified"])
        self.assertEqual(entry["after"]["sha256_tree"], "changed")

    def test_cross_volume_source_that_cannot_be_removed_is_recorded(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        plan = self.write_plan([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        with mock.patch.object(FT, "same_volume", return_value=False), \
                mock.patch.object(FT, "_remove", side_effect=PermissionError("locked")):
            code, report = self.run_main("apply", str(plan), "--apply")
        self.assertEqual((code, report["moved"]), (1, 1))
        entry = json.loads(Path(report["manifest"]).read_text())["items"][0]
        self.assertIs(entry["source_removed"], False)
        self.assertTrue((self.inbox / "a.txt").exists())
        self.assertTrue((self.root / "40_media" / "a.txt").exists())
        out = self.run_cli("rollback", report["manifest"], "--apply", ok=False).stdout
        self.assertIn("unfinished cross-volume move", out)

    @unittest.skipUnless(platform.system() in {"Darwin", "Linux"}, "trash supported on macOS/Linux only")
    def test_trashing_two_items_with_the_same_name(self) -> None:
        self.init_root()
        for folder in ("x", "y"):
            (self.inbox / folder).mkdir()
            (self.inbox / folder / "dup.txt").write_text(folder)
        result = self.apply([
            {"src": str(self.inbox / "x" / "dup.txt"), "action": "trash"},
            {"src": str(self.inbox / "y" / "dup.txt"), "action": "trash"},
        ])
        names = [Path(e["destination"]).name for e in json.loads(Path(result["manifest"]).read_text())["items"]]
        self.assertEqual(names, ["dup.txt", "001-dup.txt"])

    @unittest.skipUnless(platform.system() in {"Darwin", "Linux"}, "trash supported on macOS/Linux only")
    def test_trash_moves_into_dated_bundle_without_deleting(self) -> None:
        self.init_root()
        (self.inbox / "App.dmg").write_text("bin")
        result = self.apply([{"src": str(self.inbox / "App.dmg"), "action": "trash", "reason": "installed"}])
        self.assertEqual(result["trashed"], 1)
        entry = json.loads(Path(result["manifest"]).read_text())["items"][0]
        self.assertRegex(entry["destination"], r"file-tidy-\d{8}-\d{6}-\d{6}/App\.dmg$")
        self.assertEqual(Path(entry["destination"]).read_text(), "bin")


class RollbackTests(Sandbox):
    def test_apply_then_rollback_restores_directory_tree(self) -> None:
        self.init_root()
        folder = self.inbox / "project"
        (folder / "sub").mkdir(parents=True)
        (folder / "sub" / "f.txt").write_text("content")
        result = self.apply([{"src": str(folder), "dest": "20_work/company/project", "reason": "work"}])
        manifest = json.loads(Path(result["manifest"]).read_text())
        self.assertTrue(all(e["verified"] for e in manifest["items"]))
        self.assertEqual((self.root / "20_work/company/project/sub/f.txt").read_text(), "content")
        self.run_cli("rollback", result["manifest"])
        self.assertFalse(folder.exists())
        self.run_cli("rollback", result["manifest"], "--apply")
        self.assertEqual((folder / "sub" / "f.txt").read_text(), "content")
        restored = json.loads(Path(result["manifest"]).read_text())
        self.assertTrue(all(e.get("restored_at") for e in restored["items"]))

    def test_rollback_refuses_when_content_changed(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("v1")
        result = self.apply([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        (self.root / "40_media" / "a.txt").write_text("v2")
        self.assertIn("content changed", self.run_cli("rollback", result["manifest"], "--apply", ok=False).stderr)
        self.assertFalse((self.inbox / "a.txt").exists())

    def test_rollback_refuses_when_original_is_occupied(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("v1")
        result = self.apply([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        (self.inbox / "a.txt").write_text("newer")
        self.assertIn("occupied", self.run_cli("rollback", result["manifest"], ok=False).stderr)

    def test_rollback_handles_items_moved_into_another_items_destination(self) -> None:
        self.init_root()
        (self.inbox / "proj").mkdir()
        (self.inbox / "proj" / "a.txt").write_text("a")
        (self.inbox / "note.txt").write_text("n")
        result = self.apply([
            {"src": str(self.inbox / "proj"), "dest": "20_work/proj"},
            {"src": str(self.inbox / "note.txt"), "dest": "20_work/proj/note.txt"},
        ])
        self.run_cli("rollback", result["manifest"])
        self.run_cli("rollback", result["manifest"], "--apply")
        self.assertEqual(sorted(p.name for p in (self.inbox / "proj").iterdir()), ["a.txt"])
        self.assertEqual((self.inbox / "note.txt").read_text(), "n")

    def test_rollback_records_progress_when_a_restore_reports_a_problem(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        result = self.apply([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        real_move = FT.safe_move

        def move_with_warning(src, dest):
            moved = real_move(src, dest)
            return {**moved, "error": "could not re-read the destination"}

        with mock.patch.object(FT, "safe_move", move_with_warning), \
                mock.patch.dict(os.environ, {"HOME": str(self.home)}), mock.patch("builtins.print"):
            code = FT.main(["rollback", result["manifest"], "--apply"])
        self.assertEqual(code, 1)
        self.assertTrue((self.inbox / "a.txt").exists())
        entry = json.loads(Path(result["manifest"]).read_text())["items"][0]
        self.assertTrue(entry["restored_at"])
        self.assertIn("restore_error", entry)

    @unittest.skipUnless(platform.system() in {"Darwin", "Linux"}, "trash supported on macOS/Linux only")
    def test_rollback_skip_missing_restores_the_rest_after_trash_was_emptied(self) -> None:
        self.init_root()
        (self.inbox / "keep.txt").write_text("k")
        (self.inbox / "junk.dmg").write_text("j")
        result = self.apply([
            {"src": str(self.inbox / "keep.txt"), "dest": "40_media/keep.txt"},
            {"src": str(self.inbox / "junk.dmg"), "action": "trash"},
        ])
        trashed = Path(json.loads(Path(result["manifest"]).read_text())["items"][1]["destination"])
        trashed.unlink()
        self.assertIn("--skip-missing", self.run_cli("rollback", result["manifest"], ok=False).stderr)
        self.run_cli("rollback", result["manifest"], "--apply", "--skip-missing")
        self.assertEqual((self.inbox / "keep.txt").read_text(), "k")


class PublicPortabilityTests(unittest.TestCase):
    def test_package_has_no_machine_paths(self) -> None:
        current = Path(__file__).resolve()
        for path in SKILL_DIR.rglob("*"):
            if not path.is_file() or path.resolve() == current or "__pycache__" in path.parts:
                continue
            text = path.read_text(encoding="utf-8")
            for label, pattern in {
                "macOS user directory": r"/Users/[A-Za-z0-9._-]+/",
                "Linux user directory": r"/home/[A-Za-z0-9._-]+/",
                "Windows user directory": r"[A-Za-z]:\\Users\\[^\\]+\\",
                "email address": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}",
            }.items():
                with self.subTest(file=path.name, label=label):
                    self.assertIsNone(re.search(pattern, text), f"{label} in {path}")


if __name__ == "__main__":
    unittest.main()
