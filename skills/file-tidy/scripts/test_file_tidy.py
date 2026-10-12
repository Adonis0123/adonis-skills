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

# Built by joining so no "/Users/<name>" literal trips the repo privacy scan.
WSL_USERS = Path("/mnt/c") / "Users"


def wsl(on: bool = True):
    """Pretend to run inside WSL (or not); is_wsl() is the single switch the script consults."""
    return mock.patch.object(FT, "is_wsl", return_value=on)


def start_wsl(test: unittest.TestCase, on: bool = True) -> None:
    patch = wsl(on)
    patch.start()
    test.addCleanup(patch.stop)


WINDOWS_TEMPLATE = {
    "version": 1, "naming": "zh",
    "categories": [{"id": "00_收件箱", "children": []}, {"id": "10_个人", "children": ["health"]},
                   {"id": "99_敏感", "children": ["keys"]}],
    "inboxes": {"download": "%USERPROFILE%\\Downloads", "capture": None,
                "workbench": "%USERPROFILE%\\Desktop"},
    "known_folders": ["%USERPROFILE%\\Desktop", "%USERPROFILE%\\Pictures\\Screenshots"],
    "outside_root": {"app_data": ["D:\\appdata"]},
}


def write_windows_template(folder: Path) -> Path:
    """A Windows-style template like the old example: Chinese categories, capture inbox, %USERPROFILE% inboxes."""
    template = json.loads(json.dumps(WINDOWS_TEMPLATE))
    template["root"] = str(folder / "TemplateRoot")
    template["inboxes"]["capture"] = str(folder / "TemplateRoot" / "00_收件箱")
    path = folder / "template.json"
    path.write_text(json.dumps(template, ensure_ascii=False), encoding="utf-8")
    return path


def home_env(home: Path) -> dict:
    """HOME for POSIX and USERPROFILE for native Windows, where expanduser ignores HOME."""
    return {"HOME": str(home), "USERPROFILE": str(home)}


class Sandbox(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(os.path.realpath(self.tmp.name))
        self.root = self.home / "Files"
        self.inbox = self.home / "Downloads"
        self.inbox.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_cli(self, *args: str, ok: bool = True, env: dict | None = None) -> subprocess.CompletedProcess:
        full_env = {**os.environ, **home_env(self.home), **(env or {})}
        full_env.pop("FILE_TIDY_ROOT", None)
        full_env.pop("XDG_DATA_HOME", None)  # keep the Linux trash inside the sandbox home
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
        self.assertEqual(Path(config["inboxes"]["capture"]), self.root / "00_inbox")
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
    @unittest.skipIf(os.name == "nt", "chmod cannot make a folder unreadable on Windows")
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

        def racing_snapshot(path: Path, verify: str = "sha256") -> dict:
            result = real_snapshot(path, verify)
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
            "Default Folder": {"src": str(self.home / "Desktop"), "dest": "90_archive/d"},
            "Default Folder via ..": {"src": f"{self.home}/x/../Desktop", "dest": "90_archive/d"},
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
        err = self.run_cli("apply", str(self.write_plan([{"src": str(self.home / "desktop"), "dest": "90_archive/d"}])),
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

    @unittest.skipIf(os.name == "nt", "symlinks need extra rights on Windows")
    def test_warns_about_a_top_level_relative_link(self) -> None:
        self.init_root()
        (self.home / "Desktop").mkdir()
        (self.inbox / "target.txt").write_text("t")
        os.symlink("../Downloads/target.txt", self.home / "Desktop" / "rel-link")
        plan = self.write_plan([{"src": str(self.home / "Desktop" / "rel-link"), "dest": "40_media/rel-link"}])
        self.assertIn("will point elsewhere", self.run_cli("apply", str(plan)).stdout)

    @unittest.skipIf(os.name == "nt", "symlinks need extra rights on Windows")
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
                mock.patch.dict(os.environ, home_env(self.home)), \
                mock.patch("builtins.print") as printed:
            code = FT.main(["apply", str(plan), "--apply"])
        self.assertEqual(code, 1)
        report = json.loads(printed.call_args.args[0])
        self.assertEqual((report["moved"], report["remaining"]), (1, 1))
        manifest = json.loads(Path(report["manifest"]).read_text())
        self.assertEqual(len(manifest["items"]), 1)
        self.assertTrue((self.inbox / "b.txt").exists())

    def run_main(self, *argv: str) -> tuple[int, dict]:
        with mock.patch.dict(os.environ, home_env(self.home)), mock.patch("builtins.print") as printed:
            code = FT.main(list(argv))
        return code, json.loads(printed.call_args.args[0])

    def test_item_that_changed_while_moving_is_still_recorded(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        dest = self.root / "40_media" / "a.txt"
        real_snapshot = FT.snapshot

        def drifting(path: Path, verify: str = "sha256") -> dict:
            result = real_snapshot(path, verify)
            return {**result, "stat_tree": "changed"} if path == dest else result

        plan = self.write_plan([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        with mock.patch.object(FT, "snapshot", drifting):
            code, report = self.run_main("apply", str(plan), "--apply")
        self.assertEqual((code, report["moved"]), (1, 1))
        entry = json.loads(Path(report["manifest"]).read_text())["items"][0]
        self.assertFalse(entry["verified"])
        self.assertEqual(entry["after"]["stat_tree"], "changed")

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

    def manifest_items(self, result: dict) -> list[dict]:
        return json.loads(Path(result["manifest"]).read_text(encoding="utf-8"))["items"]

    @unittest.skipUnless(platform.system() == "Darwin", "macOS trash bundle")
    def test_macos_trashing_two_items_with_the_same_name(self) -> None:
        self.init_root()
        for folder in ("x", "y"):
            (self.inbox / folder).mkdir()
            (self.inbox / folder / "dup.txt").write_text(folder)
        result = self.apply([
            {"src": str(self.inbox / "x" / "dup.txt"), "action": "trash"},
            {"src": str(self.inbox / "y" / "dup.txt"), "action": "trash"},
        ])
        names = [Path(e["destination"]).name for e in self.manifest_items(result)]
        self.assertEqual(names, ["dup.txt", "001-dup.txt"])

    @unittest.skipUnless(platform.system() == "Darwin", "macOS trash bundle")
    def test_macos_trash_moves_into_dated_bundle_without_deleting(self) -> None:
        self.init_root()
        (self.inbox / "App.dmg").write_text("bin")
        result = self.apply([{"src": str(self.inbox / "App.dmg"), "action": "trash", "reason": "installed"}])
        self.assertEqual(result["trashed"], 1)
        entry = self.manifest_items(result)[0]
        self.assertRegex(entry["destination"], r"file-tidy-\d{8}-\d{6}-\d{6}/App\.dmg$")
        self.assertEqual(Path(entry["destination"]).read_text(), "bin")

    @unittest.skipUnless(platform.system() == "Linux", "freedesktop trash")
    def test_linux_trash_writes_trashinfo_next_to_a_flat_entry(self) -> None:
        self.init_root()
        src = self.inbox / "My App 100%.dmg"
        src.write_text("bin")
        result = self.apply([{"src": str(src), "action": "trash", "reason": "installed"}])
        trash = self.home / ".local" / "share" / "Trash"
        entry = self.manifest_items(result)[0]
        self.assertEqual(Path(entry["destination"]), trash / "files" / src.name)
        self.assertEqual((trash / "files" / src.name).read_text(), "bin")
        info = trash / "info" / f"{src.name}.trashinfo"
        self.assertEqual(entry["trashinfo"], str(info))
        lines = info.read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines[0], "[Trash Info]")
        self.assertEqual(lines[1], "Path=" + str(src).replace(" ", "%20").replace("%.", "%25."))
        self.assertRegex(lines[2], r"^DeletionDate=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$")
        self.assertFalse(any((trash / "files").glob("file-tidy-*")))

    @unittest.skipUnless(platform.system() == "Linux", "freedesktop trash")
    def test_linux_trash_name_clashes_get_a_suffix(self) -> None:
        self.init_root()
        trash = self.home / ".local" / "share" / "Trash"
        (trash / "files").mkdir(parents=True)
        (trash / "files" / "dup.txt").write_text("already trashed")
        (trash / "info").mkdir()
        (trash / "info" / "dup.3.txt.trashinfo").write_text("[Trash Info]\n")  # orphan info reserves the name
        for folder in ("x", "y"):
            (self.inbox / folder).mkdir()
            (self.inbox / folder / "dup.txt").write_text(folder)
        result = self.apply([
            {"src": str(self.inbox / "x" / "dup.txt"), "action": "trash"},
            {"src": str(self.inbox / "y" / "dup.txt"), "action": "trash"},
        ])
        names = [Path(e["destination"]).name for e in self.manifest_items(result)]
        self.assertEqual(names, ["dup.2.txt", "dup.4.txt"])
        self.assertEqual((trash / "files" / "dup.txt").read_text(), "already trashed")
        for name, folder in zip(names, ("x", "y")):
            self.assertEqual((trash / "files" / name).read_text(), folder)
            self.assertIn(f"Path={self.inbox / folder / 'dup.txt'}",
                          (trash / "info" / f"{name}.trashinfo").read_text())

    @unittest.skipUnless(platform.system() == "Linux", "freedesktop trash")
    def test_linux_rollback_restores_and_removes_trashinfo(self) -> None:
        self.init_root()
        (self.inbox / "old").mkdir()
        (self.inbox / "old" / "a.txt").write_text("a")
        result = self.apply([{"src": str(self.inbox / "old"), "action": "trash"}])
        info = Path(self.manifest_items(result)[0]["trashinfo"])
        self.assertTrue(info.exists())
        self.run_cli("rollback", result["manifest"], "--apply")
        self.assertEqual((self.inbox / "old" / "a.txt").read_text(), "a")
        self.assertFalse(info.exists())
        self.assertFalse((self.home / ".local" / "share" / "Trash" / "files" / "old").exists())

    @unittest.skipUnless(platform.system() == "Linux", "freedesktop trash")
    def test_linux_failed_trash_move_leaves_no_trashinfo(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        plan = self.write_plan([{"src": str(self.inbox / "a.txt"), "action": "trash"}])
        env = {**home_env(self.home), "XDG_DATA_HOME": str(self.home / ".local" / "share")}
        with mock.patch.object(FT, "safe_move", side_effect=OSError("disk gone")), \
                mock.patch.dict(os.environ, env), mock.patch("sys.stdout"):
            self.assertEqual(FT.main(["apply", str(plan), "--apply"]), 1)
        self.assertEqual(list((self.home / ".local" / "share" / "Trash" / "info").iterdir()), [])
        self.assertTrue((self.inbox / "a.txt").exists())

    def test_trashinfo_path_percent_encodes_non_utf8_bytes(self) -> None:
        if os.name == "nt":
            self.skipTest("POSIX byte file names")
        dest = self.home / "Trash" / "files" / "x"
        info = FT.write_trashinfo(dest, Path(os.fsdecode(b"/srv/caf\xe9 1.txt")))
        self.assertIn("Path=/srv/caf%E9%201.txt\n", info.read_text(encoding="utf-8"))

    def test_relative_xdg_data_home_is_ignored(self) -> None:
        env = {**home_env(self.home), "XDG_DATA_HOME": "relative/share"}
        with mock.patch.object(FT.platform, "system", return_value="Linux"), mock.patch.dict(os.environ, env):
            self.assertEqual(FT.trash_dir(), Path.home() / ".local" / "share" / "Trash" / "files")

    def test_trash_from_another_mount_is_rejected(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        plan = self.write_plan([{"src": str(self.inbox / "a.txt"), "action": "trash"}])
        with mock.patch.object(FT, "freedesktop_trash", return_value=True), \
                mock.patch.object(FT, "on_trash_volume", return_value=False), \
                self.assertRaisesRegex(SystemExit, "use move instead"):
            self.run_main("apply", str(plan), "--apply")
        self.assertTrue((self.inbox / "a.txt").exists())

    @unittest.skipUnless(platform.system() in {"Darwin", "Linux"}, "trash supported on macOS/Linux only")
    def test_dry_run_shows_a_stamp_placeholder_not_a_time(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        with mock.patch.object(FT, "freedesktop_trash", return_value=False), \
                mock.patch.dict(os.environ, home_env(self.home)), \
                mock.patch("sys.stdout", new_callable=__import__("io").StringIO) as out:
            FT.main(["apply", str(self.write_plan([{"src": str(self.inbox / "a.txt"), "action": "trash"}]))])
        text = out.getvalue()
        self.assertIn("file-tidy-<stamp>", text)
        self.assertIn("<stamp> is replaced by the run's timestamp when --apply runs.", text)
        self.assertNotRegex(text, r"\d{8}-\d{6}-\d{6}")
        self.assertTrue((self.inbox / "a.txt").exists())


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
                mock.patch.dict(os.environ, home_env(self.home)), mock.patch("builtins.print"):
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


class VerifyModeTests(Sandbox):
    """Same-volume moves are verified by metadata; content is unchanged by a rename."""

    def manifest_items(self, result: dict) -> list[dict]:
        return json.loads(Path(result["manifest"]).read_text())["items"]

    def test_same_volume_move_uses_stat_and_reads_no_content(self) -> None:
        self.init_root()
        (self.inbox / "big").mkdir()
        (self.inbox / "big" / "a.bin").write_bytes(b"x" * 100)
        with mock.patch.object(FT, "_file_sha256", side_effect=AssertionError("content was read")):
            moved = FT.safe_move(self.inbox / "big", self.root / "40_media" / "big")
        self.assertEqual(moved["verify"], "stat")
        self.assertIn("stat_tree", moved["before"])
        self.assertNotIn("sha256_tree", moved["before"])
        self.assertTrue(moved["verified"])

    def test_manifest_marks_same_volume_entries_stat(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        entry = self.manifest_items(self.apply([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}]))[0]
        self.assertEqual(entry["verify"], "stat")
        self.assertIn("stat_tree", entry)

    def test_cross_volume_move_uses_sha256(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        plan = self.write_plan([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        with mock.patch.object(FT, "same_volume", return_value=False), \
                mock.patch.dict(os.environ, home_env(self.home)), mock.patch("builtins.print") as printed:
            self.assertEqual(FT.main(["apply", str(plan), "--apply"]), 0)
        entry = self.manifest_items(json.loads(printed.call_args.args[0]))[0]
        self.assertEqual(entry["verify"], "sha256")
        self.assertEqual(entry["sha256_tree"], FT.snapshot(self.root / "40_media" / "a.txt")["sha256_tree"])

    def test_stat_mode_misses_content_edits_that_restore_size_and_mtime(self) -> None:
        """Known trade-off: a same-size edit with the mtime set back is not detected."""
        self.init_root()
        (self.inbox / "a.txt").write_text("v1")
        result = self.apply([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        dest = self.root / "40_media" / "a.txt"
        info = dest.stat()
        dest.write_text("v2")
        os.utime(dest, ns=(info.st_atime_ns, info.st_mtime_ns))
        self.run_cli("rollback", result["manifest"], "--apply")
        self.assertEqual((self.inbox / "a.txt").read_text(), "v2")

    def test_stat_mode_detects_size_or_mtime_change(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("v1")
        result = self.apply([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        dest = self.root / "40_media" / "a.txt"
        info = dest.stat()
        os.utime(dest, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
        self.assertIn("content changed", self.run_cli("rollback", result["manifest"], ok=False).stderr)

    def test_old_manifest_without_verify_field_rolls_back_with_sha256(self) -> None:
        self.init_root()
        (self.inbox / "dir").mkdir()
        (self.inbox / "dir" / "a.txt").write_text("a")
        result = self.apply([{"src": str(self.inbox / "dir"), "dest": "40_media/dir"}])
        path = Path(result["manifest"])
        manifest = json.loads(path.read_text())
        entry = manifest["items"][0]
        for key in ("verify", "stat_tree"):
            entry.pop(key)
        entry["sha256_tree"] = FT.snapshot(Path(entry["destination"]))["sha256_tree"]
        path.write_text(json.dumps(manifest))
        self.run_cli("rollback", str(path), "--apply")
        self.assertEqual((self.inbox / "dir" / "a.txt").read_text(), "a")
        entry = json.loads(path.read_text())["items"][0]
        self.assertTrue(entry["restored_at"])

    def test_old_manifest_still_detects_changed_content(self) -> None:
        self.init_root()
        (self.inbox / "a.txt").write_text("v1")
        result = self.apply([{"src": str(self.inbox / "a.txt"), "dest": "40_media/a.txt"}])
        path = Path(result["manifest"])
        manifest = json.loads(path.read_text())
        entry = manifest["items"][0]
        for key in ("verify", "stat_tree"):
            entry.pop(key)
        entry["sha256_tree"] = FT.snapshot(Path(entry["destination"]))["sha256_tree"]
        path.write_text(json.dumps(manifest))
        dest = self.root / "40_media" / "a.txt"
        info = dest.stat()
        dest.write_text("v2")
        os.utime(dest, ns=(info.st_atime_ns, info.st_mtime_ns))
        self.assertIn("content changed", self.run_cli("rollback", str(path), ok=False).stderr)

    @unittest.skipIf(os.name == "nt", "symlinks need extra rights on Windows")
    def test_escaping_links_finds_only_links_leaving_the_folder(self) -> None:
        folder = self.inbox / "proj"
        (folder / "a" / "b").mkdir(parents=True)
        (folder / "a" / "b" / "inside").symlink_to("../../x")
        (folder / "a" / "out").symlink_to("../../elsewhere")
        (folder / "abs").symlink_to("/etc")
        self.assertEqual(FT.escaping_links(folder), [str(Path("a") / "out")])


class WindowsDriveTests(Sandbox):
    """Quarantine and drive guards, with the sandbox standing in for a Windows drive."""

    def setUp(self) -> None:
        super().setUp()
        self.drive = self.home / "drive"
        (self.drive / "games" / "old").mkdir(parents=True)
        (self.drive / "games" / "old" / "data.bin").write_text("payload")
        patches = [mock.patch.object(FT, "volume_root",
                                     lambda p: self.drive if FT.is_within(p, self.drive) else None),
                   mock.patch.dict(os.environ, home_env(self.home / "profile"))]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def run_main(self, *args: str) -> str:
        with mock.patch("sys.stdout", new_callable=__import__("io").StringIO) as out:
            FT.main(list(args))
        return out.getvalue()

    def test_volume_root_parses_wsl_mounts(self) -> None:
        mock.patch.stopall()
        if os.name == "nt":
            self.skipTest("WSL path form")
        start_wsl(self)
        self.assertEqual(FT.volume_root(Path("/mnt/e/个人文件/a.jpg")), Path("/mnt/e"))
        self.assertIsNone(FT.volume_root(Path("/mnt/wsl/x")))
        self.assertIsNone(FT.volume_root(Path("/home/me/a")))

    def test_quarantine_keeps_drive_relative_path_and_rolls_back(self) -> None:
        self.init_root()
        src = self.drive / "games" / "old"
        plan = self.write_plan([{"src": str(src), "action": "quarantine", "reason": "game no longer played"}])
        result = json.loads(self.run_main("apply", str(plan), "--apply"))
        self.assertEqual(result["quarantined"], 1)
        self.assertFalse(src.exists())
        moved = list((self.drive / "_quarantine").glob("*/games/old/data.bin"))
        self.assertEqual(len(moved), 1)
        self.assertEqual(moved[0].read_text(), "payload")
        entry = json.loads(Path(result["manifest"]).read_text())["items"][0]
        self.assertEqual(entry["verify"], "stat")
        self.run_main("rollback", result["manifest"], "--apply")
        self.assertEqual((src / "data.bin").read_text(), "payload")
        self.assertFalse((self.drive / "_quarantine").exists())

    def test_quarantine_outside_a_windows_drive_is_rejected(self) -> None:
        self.init_root()
        (self.inbox / "a.pdf").write_text("x")
        plan = self.write_plan([{"src": str(self.inbox / "a.pdf"), "action": "quarantine"}])
        with self.assertRaisesRegex(SystemExit, "only on Windows drives"):
            self.run_main("apply", str(plan))

    def test_whole_drive_and_system_folders_are_refused(self) -> None:
        self.init_root()
        (self.drive / "Program Files" / "App").mkdir(parents=True)
        for src, message in [(self.drive, "whole drive"),
                             (self.drive / "Program Files" / "App", "Windows system folder")]:
            plan = self.write_plan([{"src": str(src), "dest": "90_archive/x"}])
            with self.subTest(src=src.name), self.assertRaisesRegex(SystemExit, message):
                self.run_main("apply", str(plan))


    @unittest.skipIf(os.name == "nt", "symlinks need extra rights on Windows")
    def test_destination_in_system_folder_drive_root_or_quarantine_is_refused(self) -> None:
        self.init_root()
        (self.drive / "Program Files").mkdir()
        (self.drive / "_quarantine").mkdir()
        (self.root / "90_archive" / "pf").symlink_to(self.drive / "Program Files")
        (self.inbox / "a.txt").write_text("a")
        for dest, message in [(str(self.drive / "Program Files" / "a.txt"), "Windows system folder"),
                              ("90_archive/pf/app/a.txt", "Windows system folder"),
                              (str(self.drive), "whole drive"),
                              (str(self.drive / "_quarantine" / "a.txt"), "quarantine folder")]:
            plan = self.write_plan([{"src": str(self.inbox / "a.txt"), "dest": dest}])
            with self.subTest(dest=dest), self.assertRaisesRegex(SystemExit, message):
                self.run_main("apply", str(plan), "--apply")
        self.assertEqual(list((self.drive / "Program Files").iterdir()), [])
        self.assertTrue((self.inbox / "a.txt").exists())

    def test_trash_on_a_windows_drive_under_wsl_is_rejected(self) -> None:
        if os.name == "nt":
            self.skipTest("WSL only")
        self.init_root()
        plan = self.write_plan([{"src": str(self.drive / "games" / "old"), "action": "trash"}])
        with self.assertRaisesRegex(SystemExit, "use quarantine"):
            self.run_main("apply", str(plan))

    def test_protection_is_reported_before_a_missing_source(self) -> None:
        self.init_root()
        plan = self.write_plan([{"src": str(self.drive / "Program Files" / "gone"), "dest": "90_archive/x"}])
        with self.assertRaisesRegex(SystemExit, "Windows system folder"):
            self.run_main("apply", str(plan))


    def test_template_profiles_do_not_unlock_system_folder_users(self) -> None:
        self.init_root()
        default = self.drive / "Users" / "Default"
        (default / "Documents").mkdir(parents=True)
        (default / "Documents" / "t.txt").write_text("t")
        (self.inbox / "a.txt").write_text("a")
        homes = [FT.expand("~"), default, self.drive / "Users" / "Public"]
        with mock.patch.object(FT, "user_homes", return_value=homes):
            self.assertNotIn(default, FT.guard_homes())
            for item in [{"src": str(self.inbox / "a.txt"), "dest": str(default / "Documents" / "a.txt")},
                         {"src": str(default / "Documents" / "t.txt"), "dest": "90_archive/t.txt"}]:
                plan = self.write_plan([item])
                with self.subTest(item=item), self.assertRaisesRegex(SystemExit, "Windows system folder Users"):
                    self.run_main("apply", str(plan), "--apply")
        self.assertTrue((self.inbox / "a.txt").exists())
        self.assertFalse((default / "Documents" / "a.txt").exists())


class ShortNameTests(unittest.TestCase):
    def test_short_names_expand_to_long_names_and_keep_missing_tail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            short = Path(tmp) / "SHORTN~9"
            short.mkdir()
            long_dir = os.path.join(tmp, "ShortName")
            convert = mock.Mock(side_effect=lambda p: p.replace("SHORTN~9", "ShortName"))
            text = str(short / "Downloads" / "new.txt")
            plain = str(Path(tmp) / "plain")
            with mock.patch.object(FT.os, "name", "nt"):
                self.assertEqual(FT.long_path(text, convert),
                                 os.path.join(long_dir, "Downloads", "new.txt"))
                convert.assert_called_once_with(str(short))
                self.assertEqual(FT.long_path(text, lambda p: None), text)
                self.assertEqual(FT.long_path(plain, convert), plain)
            if os.name != "nt":
                self.assertEqual(FT.long_path(text, convert), text)

    @unittest.skipUnless(os.name == "nt", "real 8.3 names exist only on Windows")
    def test_real_windows_short_name_is_expanded(self) -> None:
        import ctypes
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "LongFolderName12345"
            target.mkdir()
            buf = ctypes.create_unicode_buffer(1024)
            if not ctypes.windll.kernel32.GetShortPathNameW(str(target), buf, 1024) or "~" not in buf.value:
                self.skipTest("8.3 names disabled on this volume")
            got = FT.expand(os.path.join(buf.value, "missing", "x.txt"))
            self.assertEqual(FT.path_key(got), FT.path_key(Path(os.path.realpath(target)) / "missing" / "x.txt"))


class WindowsPathFormTests(Sandbox):
    def setUp(self) -> None:
        super().setUp()
        if os.name == "nt":
            self.skipTest("WSL path mapping")
        start_wsl(self)

    def test_windows_drive_paths_map_to_wsl_mounts(self) -> None:
        self.assertEqual(FT.expand("E:\\Files\\00_收件箱"), Path("/mnt/e/Files/00_收件箱"))
        self.assertEqual(FT.expand("g:/SteamLibrary"), Path("/mnt/g/SteamLibrary"))
        self.assertEqual(FT.expand("D:\\"), Path("/mnt/d"))
        self.assertEqual(FT.expand("relative\\x"), Path("relative\\x"))

    def test_outside_root_windows_paths_are_guarded(self) -> None:
        (self.root / "_system").mkdir(parents=True)
        (self.root / "_system" / "config.json").write_text(
            json.dumps({"outside_root": {"app_data": ["D:\\appdata"]}}), encoding="utf-8")
        self.assertIn(Path("/mnt/d/appdata"), FT.outside_root_paths(self.root))
        self.assertIn("outside_root", FT.protected_reason(Path("/mnt/d/appdata/x"), self.root,
                                                         FT.outside_root_paths(self.root)))

    def test_windows_absolute_dest_is_not_treated_as_relative(self) -> None:
        if not FT._detect_wsl():
            self.skipTest("the CLI subprocess must really run under WSL")
        self.init_root()
        (self.inbox / "a.txt").write_text("x")
        plan = self.write_plan([{"src": str(self.inbox / "a.txt"), "dest": "Q:\\elsewhere\\a.txt"}])
        out = self.run_cli("apply", str(plan)).stdout
        self.assertIn("-> /mnt/q/elsewhere/a.txt", out)


class CaptureInboxTests(unittest.TestCase):
    def test_template_capture_is_kept_and_rebased_onto_the_root(self) -> None:
        cats = [{"id": "00_收件箱"}]
        start_wsl(self)
        self.assertEqual(FT.capture_inbox("E:\\Files\\00_收件箱", "E:\\Files", "F:\\Docs", cats),
                         "F:\\Docs\\00_收件箱")
        self.assertEqual(FT.capture_inbox("E:\\Files\\00_收件箱", "E:\\Files", "/mnt/e/Files", cats),
                         "/mnt/e/Files/00_收件箱")
        self.assertEqual(FT.capture_inbox("Z:\\Scans", "E:\\Files", "/srv/Files", cats), "Z:\\Scans")

    def test_missing_capture_comes_from_the_00_category(self) -> None:
        self.assertEqual(FT.capture_inbox(None, None, "/srv/Files", [{"id": "10_x"}, {"id": "00_收件箱"}]),
                         "/srv/Files/00_收件箱")

    def test_init_with_windows_template_keeps_its_inbox_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Files"
            subprocess.run([sys.executable, "-I", str(SCRIPT), "init", "--root", str(root), "--config",
                            str(write_windows_template(Path(tmp))), "--apply"],
                           check=True, capture_output=True)
            config = json.loads((root / "_system" / "config.json").read_text(encoding="utf-8"))
            self.assertEqual(Path(config["inboxes"]["capture"]), root / "00_收件箱")
            self.assertTrue((root / "00_收件箱").is_dir())
            self.assertTrue((root / "10_个人" / "health").is_dir())


class DupesTests(Sandbox):
    def test_reports_identical_files_only(self) -> None:
        a, b = self.inbox / "a", self.home / "b"
        a.mkdir()
        b.mkdir()
        (a / "x.jpg").write_bytes(b"same-bytes")
        (b / "copy of x.jpg").write_bytes(b"same-bytes")
        (b / "other.jpg").write_bytes(b"diff-bytes")  # same size, different content
        os.link(a / "x.jpg", a / "x-link.jpg")  # a hard link is one file, not a duplicate
        report = json.loads(self.run_cli("dupes", str(a), str(b)).stdout)
        self.assertEqual(report["group_count"], 1)
        group = report["groups"][0]
        self.assertEqual(len(group["paths"]), 2)
        self.assertIn(str(b / "copy of x.jpg"), group["paths"])
        self.assertEqual(report["reclaimable_bytes"], len(b"same-bytes"))

    def test_min_size_and_quarantine_are_skipped(self) -> None:
        (self.inbox / "_quarantine").mkdir()
        (self.inbox / "_quarantine" / "x").write_bytes(b"0123456789")
        (self.inbox / "x").write_bytes(b"0123456789")
        (self.inbox / "s1").write_bytes(b"ab")
        (self.inbox / "s2").write_bytes(b"ab")
        report = json.loads(self.run_cli("dupes", str(self.inbox), "--min-size", "5").stdout)
        self.assertEqual(report["group_count"], 0)


class ReviewFixTests(Sandbox):
    """Guards added after the final review: symlinks, Known Folders, UNC, quarantine, hard links."""

    def set_config(self, **fields) -> None:
        config_file = self.root / "_system" / "config.json"
        config = json.loads(config_file.read_text(encoding="utf-8"))
        config.update(fields)
        config_file.write_text(json.dumps(config), encoding="utf-8")

    def refused(self, item: dict) -> str:
        return self.run_cli("apply", str(self.write_plan([item])), ok=False).stderr

    @unittest.skipIf(os.name == "nt", "symlinks need extra rights on Windows")
    def test_symlinked_parent_does_not_bypass_protection(self) -> None:
        self.init_root()
        (self.home / "AppData" / "sub").mkdir(parents=True)
        (self.home / "winlink").symlink_to(self.home / "AppData")
        err = self.refused({"src": str(self.home / "winlink" / "sub"), "dest": "90_archive/sub"})
        self.assertIn("App Data", err)
        self.assertTrue((self.home / "AppData" / "sub").is_dir())

    @unittest.skipIf(os.name == "nt", "symlinks need extra rights on Windows")
    def test_symlinked_parent_does_not_bypass_outside_root(self) -> None:
        self.init_root()
        notes = self.home / "notes"
        (notes / "n").mkdir(parents=True)
        (self.home / "notelink").symlink_to(notes)
        self.set_config(outside_root={"notes": ["~/notes"]})
        self.assertIn("outside_root", self.refused({"src": str(self.home / "notelink" / "n"), "dest": "20_work/n"}))

    @unittest.skipIf(os.name == "nt", "symlinks need extra rights on Windows")
    def test_link_itself_may_still_move(self) -> None:
        self.init_root()
        (self.home / "AppData").mkdir()
        (self.inbox / "applink").symlink_to(self.home / "AppData")
        self.run_cli("apply", str(self.write_plan([{"src": str(self.inbox / "applink"), "dest": "90_archive/l"}])))

    def test_more_default_folders_and_onedrive_backups_are_refused(self) -> None:
        self.init_root()
        for rel in ("Saved Games", "Contacts", "Favorites", "Links", "3D Objects", "Searches",
                    "OneDrive/Desktop", "OneDrive/Documents", "OneDrive/Pictures"):
            (self.home / rel).mkdir(parents=True)
            with self.subTest(rel):
                self.assertIn("Default Folder", self.refused({"src": str(self.home / rel), "dest": "90_archive/x"}))
        (self.home / "OneDrive" / "Documents" / "a.txt").write_text("a")
        self.run_cli("apply", str(self.write_plan(
            [{"src": str(self.home / "OneDrive" / "Documents" / "a.txt"), "dest": "20_work/a.txt"}])))

    def test_known_folders_are_protected_but_their_contents_move(self) -> None:
        self.init_root()
        shots = self.home / "elsewhere" / "Shots"
        shots.mkdir(parents=True)
        (shots / "s.png").write_text("p")
        self.set_config(known_folders=[str(shots)])
        self.assertIn("known_folders", self.refused({"src": str(shots), "dest": "90_archive/s"}))
        self.assertIn("known_folders", self.refused({"src": str(shots.parent), "dest": "90_archive/e"}))
        self.run_cli("apply", str(self.write_plan([{"src": str(shots / "s.png"), "dest": "40_media/s.png"}])))

    def test_known_folder_with_unexpandable_variable_warns(self) -> None:
        if os.name == "nt":
            self.skipTest("posix expansion")
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        self.set_config(known_folders=["%FILE_TIDY_NO_SUCH_VAR%\\Desktop"])
        out = self.run_cli("apply", str(self.write_plan([{"src": str(self.inbox / "a.txt"),
                                                          "dest": "20_work/a.txt"}]))).stdout
        self.assertIn("WARN config: cannot expand", out)
        self.assertIn("NOT protected", out)

    def test_percent_variables_expand_from_environment_and_wsl_profile(self) -> None:
        if os.name == "nt":
            self.skipTest("posix expansion")
        start_wsl(self)
        with mock.patch.dict(os.environ, {"FT_TEST_DIR": "/srv/x"}):
            self.assertEqual(FT.expand("%FT_TEST_DIR%\\Desktop"), Path("/srv/x/Desktop"))
        env = {k: v for k, v in os.environ.items() if k != "USERPROFILE"}
        profile = (WSL_USERS / "someone")
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(FT, "user_homes", return_value=[FT.expand("~"), profile]):
            self.assertEqual(FT.expand("%USERPROFILE%\\Downloads"), profile / "Downloads")
        templates = [FT.expand("~"), profile, (WSL_USERS / "Default"), (WSL_USERS / "Public")]
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(FT, "user_homes", return_value=templates):
            self.assertEqual(FT.expand("%USERPROFILE%\\Desktop"), profile / "Desktop")
        two = [FT.expand("~"), profile, (WSL_USERS / "b")]
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(FT, "user_homes", return_value=two), \
                mock.patch.object(FT, "_cmd_userprofile", return_value="C:\\Users\\b"):
            self.assertEqual(FT.expand("%USERPROFILE%\\Downloads"), (WSL_USERS / "b" / "Downloads"))
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(FT, "user_homes", return_value=two), \
                mock.patch.object(FT, "_cmd_userprofile", return_value=None):
            self.assertIn("%USERPROFILE%", str(FT.expand("%USERPROFILE%\\Downloads")))
            with self.assertRaises(FT.UnresolvedVariable):
                FT.config_path("%USERPROFILE%\\Downloads")

    def test_unc_paths_are_refused_under_wsl(self) -> None:
        if os.name == "nt":
            self.skipTest("WSL only")
        self.init_root()
        (self.inbox / "a.txt").write_text("a")
        self.assertIn("UNC", self.refused({"src": "\\\\server\\share\\a.txt", "dest": "20_work/a.txt"}))
        self.assertIn("UNC", self.refused({"src": str(self.inbox / "a.txt"), "dest": "\\\\server\\share\\a.txt"}))
        self.assertTrue((self.inbox / "a.txt").exists())

    def test_quarantine_folder_cannot_be_a_move_source(self) -> None:
        self.init_root()
        drive = self.home / "drive"
        stash = drive / "_quarantine" / "20260101-000000" / "old"
        stash.mkdir(parents=True)
        reason = lambda p: FT.protected_reason(p, self.root, [])
        with mock.patch.object(FT, "volume_root", lambda p: drive if FT.is_within(p, drive) else None), \
                mock.patch.dict(os.environ, home_env(self.home)):
            self.assertIn("quarantine", reason(drive / "_quarantine"))
            self.assertIn("quarantine", reason(stash))
            self.assertIsNone(FT.protected_reason(drive / "games", self.root, []))

    def test_capture_inbox_on_another_drive_is_kept(self) -> None:
        with mock.patch.object(FT.os.path, "relpath", side_effect=ValueError("different drives")):
            self.assertEqual(FT.capture_inbox("D:\\Shots", "E:\\Files", "E:\\Docs", []), "D:\\Shots")

    def test_failed_unlink_after_link_leaves_nothing_moved(self) -> None:
        src, dest = self.inbox / "a.txt", self.home / "b.txt"
        src.write_text("a")
        real_unlink = Path.unlink

        def unlink(self_path, *a, **k):
            if self_path == src:
                raise PermissionError("locked")
            return real_unlink(self_path, *a, **k)

        with mock.patch.object(Path, "unlink", unlink), self.assertRaises(PermissionError):
            FT._rename_no_replace(src, dest)
        self.assertTrue(src.exists())
        self.assertFalse(dest.exists())
        self.assertEqual(src.stat().st_nlink, 1)

    def test_windows_example_config_uses_userprofile_inboxes(self) -> None:
        root = self.home / "Files"
        self.run_cli("init", "--root", str(root), "--config", str(write_windows_template(self.home)), "--apply")
        config = json.loads((root / "_system" / "config.json").read_text(encoding="utf-8"))
        self.assertEqual(config["inboxes"]["download"], "%USERPROFILE%\\Downloads")
        self.assertEqual(config["inboxes"]["workbench"], "%USERPROFILE%\\Desktop")
        self.assertIn("%USERPROFILE%\\Desktop", config["known_folders"])


@unittest.skipIf(os.name == "nt", "symlinks need extra rights on Windows")
class DestinationProtectionTests(Sandbox):
    """A destination may not land in a protected folder, written directly or through a symlink."""

    def setUp(self) -> None:
        super().setUp()
        self.init_root()
        (self.inbox / "a.txt").write_text("a")

    def set_config(self, **fields) -> None:
        ReviewFixTests.set_config(self, **fields)

    def refused(self, dest: str) -> str:
        err = self.run_cli("apply", str(self.write_plan([{"src": str(self.inbox / "a.txt"), "dest": dest}])),
                           "--apply", ok=False).stderr
        self.assertTrue((self.inbox / "a.txt").exists())
        return err

    def test_app_data_through_symlink_and_absolute(self) -> None:
        for name in ("AppData", "Library"):
            (self.home / name / "Roaming").mkdir(parents=True)
            (self.root / "90_archive" / f"evil-{name}").symlink_to(self.home / name / "Roaming")
            with self.subTest(name):
                err = self.refused(f"90_archive/evil-{name}/app/a.txt")
                self.assertIn("App Data", err)
                self.assertIn("through a symlink", err)
                self.assertIn("App Data", self.refused(str(self.home / name / "b.txt")))
        self.assertFalse((self.home / "AppData" / "Roaming" / "app").exists())

    def test_system_folder_through_symlink(self) -> None:
        (self.root / "90_archive" / "sys").symlink_to(self.root / "_system")
        self.assertIn("_system folder", self.refused("90_archive/sys/x/a.txt"))
        self.assertIn("_system folder", self.refused(str(self.root / "_system" / "a.txt")))

    def test_outside_root_absolute_and_through_symlink(self) -> None:
        (self.home / "notes").mkdir()
        (self.root / "20_work" / "n").symlink_to(self.home / "notes")
        self.set_config(outside_root={"notes": ["~/notes"]})
        self.assertIn("outside_root", self.refused(str(self.home / "notes" / "a.txt")))
        self.assertIn("outside_root", self.refused("20_work/n/a.txt"))

    def test_known_folder_interior_is_refused_unless_inside_the_root(self) -> None:
        shots = self.home / "elsewhere" / "Shots"
        shots.mkdir(parents=True)
        (self.root / "40_media" / "s").symlink_to(shots)
        inbox = self.root / "00_inbox"
        inbox.mkdir(exist_ok=True)
        self.set_config(known_folders=[str(shots), str(inbox)])
        self.assertIn("known_folders", self.refused(str(shots / "a.txt")))
        self.assertIn("known_folders", self.refused("40_media/s/a.txt"))
        self.run_cli("apply", str(self.write_plan([{"src": str(self.inbox / "a.txt"),
                                                    "dest": "00_inbox/a.txt"}])), "--apply")
        self.assertTrue((inbox / "a.txt").exists())


class LargePlanTests(Sandbox):
    def test_large_plan_dry_run_is_not_quadratic(self) -> None:
        self.init_root()
        many = self.inbox / "many"
        many.mkdir()
        items = []
        for i in range(5000):
            (many / f"f{i}.jpg").write_bytes(b"x")
            items.append({"src": str(many / f"f{i}.jpg"), "dest": f"40_media/images/f{i}.jpg"})
        started = __import__("time").monotonic()
        out = self.run_cli("apply", str(self.write_plan(items))).stdout
        self.assertIn("Dry-run passed: 5000 items", out)
        self.assertLess(__import__("time").monotonic() - started, 30)


SHORTCUTS = SCRIPT.parent / "windows" / "shortcuts.ps1"


def _windows_temp() -> tuple[str, Path] | None:
    """(powershell executable, a temp folder Windows can see), or None when PowerShell is unavailable."""
    import shutil
    if os.name == "nt":
        exe = shutil.which("powershell")
        return (exe, Path(tempfile.gettempdir())) if exe else None
    exe = shutil.which("powershell.exe")
    profile = FT.windows_profile() if exe else None
    temp = profile / "AppData" / "Local" / "Temp" if profile else None
    return (exe, temp) if temp and temp.is_dir() else None


def _win(path: Path) -> str:
    if os.name == "nt":
        return str(path)
    match = re.match(r"^/mnt/([a-z])(/.*)?$", path.as_posix())
    assert match, path
    return f"{match.group(1).upper()}:" + (match.group(2) or "\\").replace("/", "\\")


def _b64(text: str) -> str:
    import base64
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


class ShortcutsScriptTests(unittest.TestCase):
    def test_script_is_ascii_crlf_with_param_first_after_help(self) -> None:
        raw = SHORTCUTS.read_bytes()
        raw.decode("ascii")
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))
        text = raw.decode("ascii")
        after_help = text.split("#>", 1)[1].lstrip()
        self.assertTrue(after_help.startswith("param("), after_help[:40])

    def setUp(self) -> None:
        if self._testMethodName == "test_script_is_ascii_crlf_with_param_first_after_help":
            return
        found = _windows_temp()
        if not found:
            self.skipTest("needs PowerShell and a Windows temp folder")
        self.exe, temp = found
        self.tmp = tempfile.TemporaryDirectory(dir=temp, prefix="ft-lnk-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(os.path.realpath(self.tmp.name))  # long names: .lnk targets are stored long
        self.script = self.base / "shortcuts.ps1"  # a copy Windows can read even when the repo is in WSL
        self.script.write_bytes(SHORTCUTS.read_bytes())

    def ps(self, *args: str, ok: bool = True) -> subprocess.CompletedProcess:
        cwd = None if os.name == "nt" else "/mnt/c"
        out = subprocess.run([self.exe, "-NoProfile", "-ExecutionPolicy", "Bypass", *args],
                             capture_output=True, cwd=cwd, timeout=120)
        if ok:
            self.assertEqual(out.returncode, 0, out.stderr.decode("utf-8", "replace"))
        return out

    def make_link(self, link: Path, target: str) -> None:
        code = ("$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%s'));"
                "$l=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');"
                "$l.TargetPath=$t;$l.WorkingDirectory=(Split-Path $t);$l.Save()") % (_b64(target), _win(link))
        self.ps("-Command", code)

    def read_target(self, link: Path) -> str:
        code = ("[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
                "(New-Object -ComObject WScript.Shell).CreateShortcut('%s').TargetPath") % _win(link)
        return self.ps("-Command", code).stdout.decode("utf-8").strip()

    def run_script(self, src: str, dest: str, *extra: str) -> list:
        out = self.ps("-File", _win(self.script), "-FromBase64", _b64(src), "-ToBase64", _b64(dest),
                      "-Roots", _win(self.base / "links"), *extra)
        return json.loads(out.stdout.decode("utf-8"))

    def test_apply_retargets_a_real_shortcut_with_chinese_names(self) -> None:
        links = self.base / "links"
        links.mkdir()
        for folder in ("旧", "新"):
            (self.base / folder).mkdir()
            (self.base / folder / "照片.txt").write_text("x")
        self.make_link(links / "keep.lnk", _win(self.base / "旧" / "照片.txt"))
        rows = self.run_script(_win(self.base / "旧"), _win(self.base / "新"), "-Apply")
        self.assertEqual([r["status"] for r in rows], ["retargeted"], rows)
        self.assertEqual(self.read_target(links / "keep.lnk"), _win(self.base / "新" / "照片.txt"))

    def get_tail(self, from_base: str, value: str) -> str | None:
        """Run the script's own Get-Tail; WScript.Shell cannot store NFD targets under a CJK codepage."""
        code = ("$ast=[Management.Automation.Language.Parser]::ParseFile('%s',[ref]$null,[ref]$null);"
                "$ast.FindAll({$args[0] -is [Management.Automation.Language.FunctionDefinitionAst]},$true)"
                "|ForEach-Object{Invoke-Expression $_.Extent.Text};"
                "$d={param($b)[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))};"
                "$fromBase=& $d '%s';$t=Get-Tail (& $d '%s');"
                "if($null -eq $t){'NULL'}else{[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('|'+$t))}"
                ) % (_win(self.script), _b64(from_base), _b64(value))
        out = self.ps("-Command", code).stdout.decode("ascii").strip()
        if out == "NULL":
            return None
        import base64
        return base64.b64decode(out).decode("utf-8")[1:]

    def test_tail_comes_from_original_string_and_length_mismatch_is_refused(self) -> None:
        nfc = "C:\\x\\r\u00e9sum\u00e9"
        self.assertEqual(self.get_tail(nfc, "C:\\X\\R\u00c9SUM\u00c9\\e\u0301.txt"), "\\e\u0301.txt")
        self.assertEqual(self.get_tail(nfc, nfc), "")
        self.assertIsNone(self.get_tail(nfc, "C:\\x\\re\u0301sume\u0301\\a.txt"))
        self.assertIsNone(self.get_tail(nfc, "C:\\x\\r\u00e9sum\u00e9s\\a.txt"))

    def test_question_mark_in_roots_is_refused(self) -> None:
        out = self.ps("-File", _win(self.script), "-From", "C:\\x", "-Roots", "C:\\a?b", ok=False)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("-Roots contains", out.stderr.decode("utf-8", "replace") + out.stdout.decode("utf-8", "replace"))


@unittest.skipIf(os.name == "nt", "POSIX path forms")
class PlatformGateTests(Sandbox):
    """Windows rules (drive mounts, %VAR% in plan paths) apply only under WSL or Windows."""

    def test_is_wsl_detection(self) -> None:
        FT._detect_wsl.cache_clear()
        self.addCleanup(FT._detect_wsl.cache_clear)
        env = {k: v for k, v in os.environ.items() if k != "WSL_DISTRO_NAME"}
        with mock.patch.object(FT.platform, "release", return_value="6.8.0-generic"), \
                mock.patch.dict(os.environ, env, clear=True):
            self.assertFalse(FT._detect_wsl())
        FT._detect_wsl.cache_clear()
        with mock.patch.object(FT.platform, "release", return_value="5.15.1-microsoft-standard-WSL2"):
            self.assertTrue(FT._detect_wsl())
        FT._detect_wsl.cache_clear()
        with mock.patch.object(FT.platform, "release", return_value="6.8.0"), \
                mock.patch.dict(os.environ, {"WSL_DISTRO_NAME": "Ubuntu"}):
            self.assertTrue(FT._detect_wsl())

    def test_mnt_letter_is_not_a_windows_drive_outside_wsl(self) -> None:
        with wsl(False):
            self.assertIsNone(FT.volume_root(Path("/mnt/d/backup/a.txt")))
            self.assertIsNone(FT.dest_protected_reason(Path("/mnt/d/Windows/x"), self.root, [], [],
                                                       homes=[self.home]))
        with wsl(True):
            self.assertEqual(FT.volume_root(Path("/mnt/d/backup/a.txt")), Path("/mnt/d"))
            self.assertIsNotNone(FT.dest_protected_reason(Path("/mnt/d/Windows/x"), self.root, [], [],
                                                          homes=[self.home]))

    def test_drive_letter_paths_stay_literal_outside_wsl(self) -> None:
        with wsl(False):
            self.assertEqual(FT.expand("E:\\Files"), Path("E:\\Files"))
            self.assertFalse(FT.expand("E:\\Files").is_absolute())
            self.assertEqual(FT.native("D:\\"), "D:\\")

    @unittest.skipUnless(platform.system() in {"Darwin", "Linux"}, "trash supported on macOS/Linux only")
    def test_trash_allowed_on_mnt_outside_wsl(self) -> None:
        src = Path("/mnt/d/a.txt")
        plan = {"root": str(self.root), "items": [{"src": str(src), "action": "trash"}]}
        env = {**home_env(self.home), "XDG_DATA_HOME": str(self.home / "xdg")}
        with wsl(False), mock.patch.dict(os.environ, env), mock.patch.object(FT, "exists", lambda p: p == src):
            _, items, _ = FT.resolve_plan(plan, "stamp")
            trash = FT.trash_dir()
        self.assertTrue(FT.is_within(Path(items[0]["dest"]), trash))
        with wsl(True), mock.patch.dict(os.environ, env), self.assertRaises(SystemExit) as caught:
            FT.resolve_plan(plan, "stamp")
        self.assertIn("quarantine", str(caught.exception))

    def test_percent_in_plan_names_is_literal_outside_wsl(self) -> None:
        with wsl(False), mock.patch.dict(os.environ, {"USER": "someone"}):
            self.assertEqual(FT.expand("/srv/%USER%report.txt"), Path("/srv/%USER%report.txt"))
            self.assertEqual(FT.config_path("/srv/%USER%"), Path("/srv/someone"))
        with wsl(True), mock.patch.dict(os.environ, {"USER": "someone"}):
            self.assertEqual(FT.expand("/srv/%USER%report.txt"), Path("/srv/someonereport.txt"))

    @unittest.skipIf(FT._detect_wsl(), "the CLI subprocess runs under WSL here")
    def test_percent_file_name_moves_unchanged_on_linux(self) -> None:
        self.init_root()
        (self.inbox / "%USER%report.txt").write_text("r")
        self.apply([{"src": str(self.inbox / "%USER%report.txt"), "dest": "20_work/%USER%report.txt"}])
        self.assertTrue((self.root / "20_work" / "%USER%report.txt").exists())

    def test_unreadable_profile_skips_only_that_profile(self) -> None:
        good, bad = (WSL_USERS / "good"), (WSL_USERS / "locked")
        real_exists = Path.exists

        def fake_exists(self_path, *a, **k):
            if self_path == good / "NTUSER.DAT":
                return True
            if self_path == bad / "NTUSER.DAT":
                raise PermissionError("denied")
            return real_exists(self_path, *a, **k)

        FT._wsl_windows_profiles.cache_clear()
        self.addCleanup(FT._wsl_windows_profiles.cache_clear)
        with wsl(True), mock.patch.object(Path, "is_dir", return_value=True), \
                mock.patch.object(Path, "iterdir", return_value=iter([bad, good])), \
                mock.patch.object(Path, "exists", fake_exists):
            self.assertEqual(FT._wsl_windows_profiles(), (good,))


class DupesSkipAndHashTests(Sandbox):
    def run_dupes(self, *dirs: Path) -> dict:
        import io
        with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
            FT.main(["dupes", *map(str, dirs), "--min-size", "1"])
        return json.loads(out.getvalue())

    def test_system_and_quarantine_folders_are_skipped_case_insensitively(self) -> None:
        (self.inbox / "keep").write_bytes(b"payload")
        for name in ("$RECYCLE.BIN", "system volume information", "_Quarantine"):
            (self.inbox / name).mkdir()
            (self.inbox / name / "copy").write_bytes(b"payload")
        self.assertEqual(self.run_dupes(self.inbox)["group_count"], 0)
        (self.inbox / "real-copy").write_bytes(b"payload")
        self.assertEqual(self.run_dupes(self.inbox)["group_count"], 1)

    def test_small_files_skip_the_head_pass(self) -> None:
        (self.inbox / "a").write_bytes(b"x" * 10)
        (self.inbox / "b").write_bytes(b"x" * 10)
        with mock.patch.object(FT, "_head_sha256", side_effect=AssertionError("head pass on a small file")):
            self.assertEqual(self.run_dupes(self.inbox)["group_count"], 1)

    def test_large_files_still_use_the_head_pass(self) -> None:
        size = FT.HEAD_BYTES + 1
        (self.inbox / "a").write_bytes(b"x" * size)
        (self.inbox / "b").write_bytes(b"x" * (size - 1) + b"y")  # same head, different tail
        with mock.patch.object(FT, "_head_sha256", wraps=FT._head_sha256) as head:
            self.assertEqual(self.run_dupes(self.inbox)["group_count"], 0)
        self.assertEqual(head.call_count, 2)


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
