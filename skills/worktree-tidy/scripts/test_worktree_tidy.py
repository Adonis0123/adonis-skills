#!/usr/bin/env python3
"""Tests for worktree_tidy.py: real temporary git repositories, hosts and Orca faked in-process."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent / "worktree_tidy.py"
SPEC = importlib.util.spec_from_file_location("worktree_tidy", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
WT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WT)

OLD = time.time() - 30 * 86400
ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t",
       "GIT_COMMITTER_EMAIL": "t@example.com", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


def sh(*args: str, cwd: str, date: float = OLD) -> str:
    stamp = f"@{int(date)} +0000"
    env = {**os.environ, **ENV, "GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp}
    return subprocess.run(args, cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout


class Repo:
    """A main repository with one old commit; worktrees are aged to look idle unless told otherwise."""

    def __init__(self, base: Path, name: str = "app"):
        self.path = str(base / name)
        os.makedirs(self.path)
        sh("git", "init", "-q", "-b", "main", cwd=self.path)
        Path(self.path, "a.txt").write_text("a")
        sh("git", "add", ".", cwd=self.path)
        sh("git", "commit", "-qm", "init", cwd=self.path)

    def worktree(self, name: str, *, branch: bool = True, idle: bool = True) -> str:
        wt = str(Path(self.path) / ".worktrees" / name)
        if branch:
            sh("git", "worktree", "add", "-q", "-b", name, wt, cwd=self.path)
        else:
            sh("git", "worktree", "add", "-q", "--detach", wt, cwd=self.path)
        if idle:
            self.age(wt)
        return wt

    @staticmethod
    def age(wt: str, when: float = OLD) -> None:
        gitdir = sh("git", "rev-parse", "--absolute-git-dir", cwd=wt).strip()
        for p in (Path(gitdir) / "logs" / "HEAD", Path(gitdir) / "index"):
            if p.exists():
                os.utime(p, (when, when))


def by_path(report: dict) -> dict:
    return {w["path"]: w for r in report["repos"] for w in r["worktrees"]}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(os.path.realpath(self.tmp.name))
        patches = [mock.patch.dict(os.environ, {"WORKTREE_TIDY_ORCA": "", "XDG_CONFIG_HOME": str(self.base / "cfg")})]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)
        self.repo = Repo(self.base)

    def scan(self, **kw) -> dict:
        return WT.scan([self.repo.path], kw.pop("days", 7), remote=kw.pop("remote", False),
                       use_orca=kw.pop("use_orca", False), **kw)


class ScanTests(Base):
    def test_idle_clean_worktree_is_removable_and_main_is_never_listed(self):
        wt = self.repo.worktree("idle")
        report = self.scan()
        rows = by_path(report)
        self.assertEqual(list(rows), [wt])
        self.assertTrue(rows[wt]["removable"], rows[wt]["blockers"])
        self.assertEqual(report["summary"]["removable"], 1)

    def test_parallel_scan_matches_serial_order_and_results(self):
        other = Repo(self.base, "other")
        mine = [self.repo.worktree(f"w{i}", idle=i % 2 == 0) for i in range(6)]
        theirs = [other.worktree(f"o{i}") for i in range(3)]
        Path(mine[1], "new.txt").write_text("x")
        repos = [self.repo.path, other.path]
        with mock.patch.object(WT, "SCAN_WORKERS", 4):
            report = WT.scan(repos, 7, remote=False, use_orca=False)
        serial = [WT.scan_repo(r, {}, report["generatedAt"], 7, False, False) for r in repos]
        self.assertEqual([r["path"] for r in report["repos"]], repos)
        self.assertEqual([[w["path"] for w in r["worktrees"]] for r in report["repos"]], [mine, theirs])
        strip = lambda rs: [[{k: v for k, v in w.items() if k not in ("ageDays",)} for w in r["worktrees"]] for r in rs]
        self.assertEqual(strip(report["repos"]), strip(serial))

    def test_recent_activity_blocks_removal(self):
        wt = self.repo.worktree("busy", idle=False)
        self.assertEqual(by_path(self.scan())[wt]["blockers"], ["recent"])

    def test_threshold_follows_days(self):
        wt = self.repo.worktree("idle")
        self.assertIn("recent", by_path(self.scan(days=60))[wt]["blockers"])

    def test_uncommitted_changes_block_and_count_as_activity(self):
        wt = self.repo.worktree("dirty")
        Path(wt, "new.txt").write_text("x")
        os.utime(Path(wt, "new.txt"), (OLD, OLD))
        row = by_path(self.scan())[wt]
        self.assertEqual(row["blockers"], ["dirty"])
        self.assertEqual(row["dirty"], 1)
        Path(wt, "new.txt").write_text("y")  # fresh edit
        self.assertEqual(by_path(self.scan())[wt]["blockers"], ["dirty", "recent"])

    def test_scanning_does_not_make_a_worktree_look_active(self):
        wt = self.repo.worktree("idle")
        self.scan()
        self.assertTrue(by_path(self.scan())[wt]["removable"])

    def test_missing_folder_is_pruned_and_dry_run_only_reports(self):
        wt = self.repo.worktree("gone")
        subprocess.run(["rm", "-rf", wt], check=True)
        report = self.scan(dry_run=True)
        self.assertEqual(report["repos"][0]["pruned"], ["gone"])
        self.assertEqual(by_path(report)[wt]["blockers"], ["missing"])
        report = self.scan()
        self.assertEqual(report["repos"][0]["pruned"], ["gone"])
        self.assertEqual(by_path(self.scan()), {})

    def test_detached_head_needs_a_ref(self):
        saved = self.repo.worktree("saved", branch=False)
        self.assertTrue(by_path(self.scan())[saved]["removable"])
        orphan = self.repo.worktree("orphan", branch=False)
        Path(orphan, "b.txt").write_text("b")
        sh("git", "add", ".", cwd=orphan)
        sh("git", "commit", "-qm", "only here", cwd=orphan)
        Repo.age(orphan)
        self.assertEqual(by_path(self.scan())[orphan]["blockers"], ["unsaved-head"])

    def test_locked_worktree_is_kept(self):
        wt = self.repo.worktree("locked")
        sh("git", "worktree", "lock", wt, cwd=self.repo.path)
        self.assertIn("locked", by_path(self.scan())[wt]["blockers"])

    def test_orca_pin_blocks_and_orca_activity_counts(self):
        wt = self.repo.worktree("idle")
        fake = {os.path.realpath(wt): {"pinned": True, "activity": 0.0}}
        with mock.patch.object(WT, "orca_worktrees", return_value=fake):
            self.assertEqual(by_path(self.scan(use_orca=True))[wt]["blockers"], ["pinned"])
        fake = {os.path.realpath(wt): {"pinned": False, "activity": time.time()}}
        with mock.patch.object(WT, "orca_worktrees", return_value=fake):
            self.assertEqual(by_path(self.scan(use_orca=True))[wt]["blockers"], ["recent"])

    def test_branch_deletable_only_when_request_is_done(self):
        done = self.repo.worktree("done")
        open_ = self.repo.worktree("open")
        unknown = self.repo.worktree("unknown")
        states = {"done": {"state": "merged", "url": "u"}, "open": {"state": "open", "url": None},
                  "unknown": {"state": "unknown", "url": None}}
        with mock.patch.object(WT, "request_states", side_effect=lambda repo, bs, since=0: {b: states[b] for b in bs}):
            rows = by_path(self.scan(remote=True))
        self.assertTrue(rows[done]["branchDeletable"])
        self.assertFalse(rows[open_]["branchDeletable"])
        self.assertFalse(rows[unknown]["branchDeletable"])

    def test_unknown_host_means_unknown_request(self):
        wt = self.repo.worktree("idle")
        self.assertEqual(by_path(self.scan(remote=True))[wt]["request"]["state"], "unknown")


class RemoveTests(Base):
    def test_dry_run_changes_nothing(self):
        wt = self.repo.worktree("idle")
        res = WT.remove([wt], 7, delete_branch=False, use_orca=False, yes=False)
        self.assertTrue(res["dryRun"])
        self.assertTrue(res["results"][0]["wouldRemove"])
        self.assertTrue(os.path.isdir(wt))

    def test_remove_keeps_the_branch_by_default(self):
        wt = self.repo.worktree("idle")
        res = WT.remove([wt], 7, delete_branch=False, use_orca=False, yes=True)
        self.assertTrue(res["results"][0]["removed"])
        self.assertFalse(os.path.exists(wt))
        self.assertIn("idle", sh("git", "branch", "--list", "idle", cwd=self.repo.path))

    def test_remove_rechecks_and_refuses_dirty_or_recent(self):
        dirty = self.repo.worktree("dirty")
        Path(dirty, "x.txt").write_text("x")
        busy = self.repo.worktree("busy", idle=False)
        res = WT.remove([dirty, busy, str(self.base / "nope")], 7, delete_branch=False, use_orca=False, yes=True)
        self.assertEqual(res["failed"], 3)
        self.assertTrue(os.path.isdir(dirty) and os.path.isdir(busy))
        self.assertIn("dirty", res["results"][0]["error"])
        self.assertIn("recent", res["results"][1]["error"])

    def test_main_worktree_is_never_removed(self):
        res = WT.remove([self.repo.path], 0, delete_branch=False, use_orca=False, yes=True)
        self.assertEqual(res["failed"], 1)
        self.assertTrue(os.path.isdir(self.repo.path))

    def test_branch_deleted_only_when_request_is_merged_or_closed(self):
        merged = self.repo.worktree("merged")
        Path(merged, "m.txt").write_text("m")  # an unmerged commit, as after a squash merge
        sh("git", "add", ".", cwd=merged)
        sh("git", "commit", "-qm", "work", cwd=merged)
        sh("git", "tag", "saved-merged", cwd=merged)
        Repo.age(merged)
        opened = self.repo.worktree("opened")
        states = {"merged": "merged", "opened": "open"}
        with mock.patch.object(WT, "request_states",
                               side_effect=lambda repo, bs, since=0: {b: {"state": states[b], "url": None} for b in bs}):
            res = WT.remove([merged, opened], 7, delete_branch=True, use_orca=False, yes=True)
        r1, r2 = res["results"]
        self.assertTrue(r1["removed"] and r1["branchDeleted"])
        self.assertTrue(r2["removed"] and not r2["branchDeleted"])
        branches = sh("git", "branch", "--format=%(refname:short)", cwd=self.repo.path).split()
        self.assertNotIn("merged", branches)
        self.assertIn("opened", branches)


class AllowRecentTests(Base):
    def remove(self, wt, **kw):
        return WT.remove([wt], 7, kw.pop("delete_branch", False), kw.pop("use_orca", False),
                         kw.pop("yes", True), allow_recent=True)["results"][0]

    def test_recent_requires_opt_in_and_keeps_branch(self):
        wt = self.repo.worktree("recent", idle=False)
        self.assertEqual(by_path(self.scan())[wt]["blockers"], ["recent"])
        self.assertEqual(WT.remove([wt], 7, False, False, True)["failed"], 1)
        self.assertTrue(self.remove(wt, yes=False)["wouldRemove"])
        self.assertTrue(Path(wt).exists())
        self.assertTrue(self.remove(wt)["removed"])
        self.assertFalse(Path(wt).exists())
        self.assertIn("recent", sh("git", "branch", "--list", "recent", cwd=self.repo.path))

    def test_other_blockers_still_refuse_with_recent(self):
        for blocker in ("dirty", "ignored", "unsaved-head", "locked", "pinned", "unreadable"):
            with self.subTest(blocker=blocker):
                wt = self.repo.worktree(blocker, idle=False, branch=blocker != "unsaved-head")
                if blocker == "dirty":
                    Path(wt, "a.txt").write_text("keep edit")
                if blocker == "ignored":
                    Path(self.repo.path, ".git/info/exclude").write_text("local-data/\n")
                    Path(wt, "local-data").mkdir()
                    Path(wt, "local-data/notes.txt").write_text("keep data")
                if blocker == "unsaved-head":
                    sh("git", "commit", "--allow-empty", "-qm", "only here", cwd=wt)
                if blocker == "locked":
                    sh("git", "worktree", "lock", wt, cwd=self.repo.path)
                orca = {wt: {"pinned": blocker == "pinned", "activity": time.time()}}
                original = WT.dirty_paths
                with mock.patch.object(WT, "orca_worktrees", return_value=orca), mock.patch.object(
                        WT, "dirty_paths", side_effect=lambda path: None if blocker == "unreadable" else original(path)):
                    row = by_path(self.scan(use_orca=True))[wt]
                    self.assertIn(blocker, row["blockers"])
                    self.assertIn("recent", row["blockers"])
                    result = self.remove(wt, use_orca=True)
                self.assertIn(blocker, result["error"])
                self.assertFalse(result["removed"])
                self.assertTrue(Path(wt).exists())

    def test_main_missing_and_locked_alone_refuse(self):
        self.assertFalse(self.remove(self.repo.path)["removed"])
        self.assertFalse(self.remove(str(self.base / "missing"))["removed"])
        wt = self.repo.worktree("locked")
        sh("git", "worktree", "lock", wt, cwd=self.repo.path)
        self.assertEqual(by_path(self.scan())[wt]["blockers"], ["locked"])
        self.assertIn("locked", self.remove(wt)["error"])

    def test_rescan_changes_to_stale_or_dirty(self):
        stale = self.repo.worktree("stale", idle=False)
        dirty = self.repo.worktree("dirty", idle=False)
        self.assertEqual(by_path(self.scan())[stale]["blockers"], ["recent"])
        Repo.age(stale)
        Path(dirty, "new.txt").write_text("keep me")
        self.assertTrue(self.remove(stale)["removed"])
        self.assertIn("dirty", self.remove(dirty)["error"])
        self.assertEqual(Path(dirty, "new.txt").read_text(), "keep me")

    def test_change_during_request_lookup_refuses(self):
        for ignored in (False, True):
            with self.subTest(ignored=ignored):
                wt = self.repo.worktree("late" + str(ignored), idle=False)
                Path(self.repo.path, ".git/info/exclude").write_text(".env\n")
                target = Path(wt, ".env" if ignored else "new.txt")
                def late(repo, branches, since=0):
                    target.write_text("keep me")
                    return {b: {"state": "merged", "url": None} for b in branches}
                with mock.patch.object(WT, "request_states", side_effect=late):
                    result = self.remove(wt, delete_branch=True)
                self.assertEqual(result["error"], "not removable: changed since it was checked")
                self.assertEqual(target.read_text(), "keep me")

    def test_branch_deletion_still_requires_done_request_and_saved_tip(self):
        for state, saved, deleted in (("merged", True, True), ("closed", True, True),
                                      ("open", True, False), ("unknown", True, False),
                                      ("merged", False, False)):
            with self.subTest(state=state, saved=saved):
                name = state + str(saved)
                wt = self.repo.worktree(name, idle=False)
                sh("git", "commit", "--allow-empty", "-qm", name, cwd=wt)
                if saved:
                    sh("git", "tag", "saved-" + name, cwd=wt)
                with mock.patch.object(WT, "request_states", return_value={name: {"state": state, "url": None}}):
                    result = self.remove(wt, delete_branch=True)
                self.assertTrue(result["removed"])
                self.assertEqual(result["branchDeleted"], deleted)
                exists = bool(sh("git", "branch", "--list", name, cwd=self.repo.path).strip())
                self.assertEqual(exists, not deleted)

    def test_cli_flag_and_empty_paths(self):
        wt = self.repo.worktree("cli", idle=False)
        proc = subprocess.run(["python3", str(SCRIPT), "--no-orca", "--json", "remove", wt,
                               "--allow-recent", "--yes"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(json.loads(proc.stdout)["results"][0]["removed"])
        self.assertEqual(WT.remove([], 7, False, False, True, allow_recent=True)["results"], [])


class SafetyContractTests(Base):
    def ignored_worktree(self, name, paths):
        exclude = Path(self.repo.path, ".git", "info", "exclude")
        exclude.write_text(".env\nnode_modules/\n*.log\n.husky/_/\nsrc/generated/\nlocal-assets/\nbuild/\n")
        wt = self.repo.worktree(name)
        for path in paths:
            target = Path(wt, path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("test")
        return wt

    def test_ignored_env_blocks_scan_and_remove(self):
        wt = self.ignored_worktree("env", [".env"])
        row = by_path(self.scan())[wt]
        self.assertEqual(row["ignored"], 1)
        self.assertEqual(row["ignoredFiles"], [".env"])
        self.assertEqual(row["dirtyFiles"], [])
        self.assertEqual(row["blockers"], ["ignored"])
        res = WT.remove([wt], 7, False, False, True)["results"][0]
        self.assertIn("ignored", res["error"])
        self.assertTrue(Path(wt, ".env").exists())

    def test_regenerable_ignored_paths_do_not_block(self):
        wt = self.ignored_worktree("cache", ["node_modules/pkg/index.js", "debug.log"])
        row = by_path(self.scan())[wt]
        self.assertEqual(row["ignoredFiles"], [])
        self.assertEqual(row["ignored"], 0)
        self.assertTrue(row["removable"])

    def test_tool_generated_paths_do_not_block(self):
        wt = self.ignored_worktree("gen", [".husky/_/pre-commit", "src/generated/index.json"])
        row = by_path(self.scan())[wt]
        self.assertEqual((row["ignored"], row["removable"]), (0, True))

    def test_config_adds_regenerable_names_and_prefixes(self):
        wt = self.ignored_worktree("cfg", ["local-assets/a.png"])
        self.assertEqual(by_path(self.scan())[wt]["ignored"], 1)
        saved = (set(WT.REGENERABLE_DIRS), set(WT.REGENERABLE_PREFIXES))
        try:
            WT.add_regenerable(["local-assets/"])
            self.assertEqual(by_path(self.scan())[wt]["ignored"], 0)
        finally:
            WT.REGENERABLE_DIRS.clear(); WT.REGENERABLE_DIRS.update(saved[0])
            WT.REGENERABLE_PREFIXES.clear(); WT.REGENERABLE_PREFIXES.update(saved[1])

    def test_secrets_inside_regenerable_folders_still_block(self):
        wt = self.ignored_worktree("sec", ["build/.env", "src/generated/deploy.pem", "build/app.js"])
        row = by_path(self.scan())[wt]
        self.assertEqual(sorted(row["ignoredFiles"]), ["build/.env", "src/generated/deploy.pem"])
        self.assertIn("ignored", row["blockers"])

    def test_secrets_in_dependency_folders_do_not_block(self):
        wt = self.ignored_worktree("dep", ["node_modules/pkg/.env"])
        self.assertTrue(by_path(self.scan())[wt]["removable"])

    def test_regenerable_config_must_be_a_list(self):
        with self.assertRaises(SystemExit):
            WT.add_regenerable("generated")

    def test_remove_rechecks_ignored_files_right_before_deleting(self):
        wt = self.ignored_worktree("late", [])
        def late_env(repo, names, since=0):
            Path(wt, ".env").write_text("SECRET")
            return {n: {"state": "merged", "url": None} for n in names}
        with mock.patch.object(WT, "request_states", side_effect=late_env):
            res = WT.remove([wt], 7, delete_branch=True, use_orca=False, yes=True)["results"][0]
        self.assertEqual(res.get("error"), "not removable: changed since it was checked")
        self.assertFalse(res["removed"])
        self.assertTrue(Path(wt, ".env").exists())

    def pushed_worktree(self):
        remote = str(self.base / "remote.git")
        sh("git", "init", "--bare", "-q", remote, cwd=self.repo.path)
        sh("git", "remote", "add", "origin", remote, cwd=self.repo.path)
        wt = self.repo.worktree("topic")
        sh("git", "commit", "--allow-empty", "-qm", "published", cwd=wt)
        sh("git", "push", "-qu", "origin", "topic", cwd=wt)
        Repo.age(wt)
        return wt

    @staticmethod
    def done(repo, branches, since=0):
        return {b: {"state": "merged", "url": None} for b in branches}

    def test_pushed_and_unsaved_branch_and_unpushed(self):
        wt = self.pushed_worktree()
        with mock.patch.object(WT, "request_states", side_effect=self.done):
            row = by_path(self.scan(remote=True))[wt]
            self.assertTrue(row["branchSaved"])
            self.assertTrue(row["branchDeletable"])
            self.assertEqual(row["unpushed"], 0)
            self.assertEqual(row["subject"], "published")
            self.assertEqual(row["shortHead"], row["head"][:7])
            sh("git", "commit", "--allow-empty", "-qm", "local only", cwd=wt)
            Repo.age(wt)
            row = by_path(self.scan(remote=True))[wt]
        self.assertFalse(row["branchSaved"])
        self.assertFalse(row["branchDeletable"])
        self.assertTrue(row["removable"])
        self.assertEqual(row["unpushed"], 1)

    def test_unpushed_is_null_without_remote_refs(self):
        wt = self.repo.worktree("topic")
        self.assertIsNone(by_path(self.scan())[wt]["unpushed"])

    def test_remove_rechecks_branch_after_assessment(self):
        wt = self.pushed_worktree()

        def remove_saved_ref(repo, branches, since=0):
            sh("git", "update-ref", "-d", "refs/remotes/origin/topic", cwd=repo)
            return self.done(repo, branches, since)

        with mock.patch.object(WT, "request_states", side_effect=remove_saved_ref):
            res = WT.remove([wt], 7, True, False, True)["results"][0]
        self.assertTrue(res["removed"])
        self.assertFalse(res["branchDeleted"])
        self.assertEqual(res["branchError"], "branch has commits that exist on no other ref; kept")
        self.assertTrue(sh("git", "branch", "--list", "topic", cwd=self.repo.path).strip())

    def test_unsaved_branch_dry_run_does_not_offer_deletion(self):
        wt = self.pushed_worktree()
        sh("git", "commit", "--allow-empty", "-qm", "local only", cwd=wt)
        Repo.age(wt)
        with mock.patch.object(WT, "request_states", side_effect=self.done):
            res = WT.remove([wt], 7, True, False, False)["results"][0]
            actual = WT.remove([wt], 7, True, False, True)["results"][0]
        self.assertFalse(res["wouldDeleteBranch"])
        self.assertTrue(actual["removed"])
        self.assertFalse(actual["branchDeleted"])
        self.assertEqual(actual["branchError"], "branch has commits that exist on no other ref; kept")

    def test_path_samples_counts_rename_and_status_call_budget(self):
        wt = self.ignored_worktree("samples", [".env"])
        sh("git", "mv", "a.txt", "renamed.txt", cwd=wt)
        for n in range(12):
            Path(wt, "file-%02d" % n).write_text("test")
        with mock.patch.object(WT, "run", wraps=WT.run) as run:
            row = by_path(self.scan())[wt]
        self.assertEqual(row["dirty"], 13)
        self.assertEqual(len(row["dirtyFiles"]), 10)
        self.assertIn("renamed.txt", row["dirtyFiles"])
        calls = [c.args[0] for c in run.call_args_list if wt in c.args[0]]
        self.assertLessEqual(len(calls), 6)  # previous four calls plus saved-ref and unpushed checks
        statuses = [c for c in calls if "status" in c]
        self.assertEqual(len(statuses), 1)
        self.assertIn("--no-optional-locks", statuses[0])
        self.assertIn("--ignored=matching", statuses[0])

    def test_missing_and_unreadable_facts_are_safe(self):
        wt = self.repo.worktree("missing")
        with mock.patch.object(WT, "dirty_paths", return_value=None):
            self.assertIn("unreadable", by_path(self.scan())[wt]["blockers"])
        with mock.patch.object(WT.os.path, "isdir", return_value=False):
            row = WT.assess({"path": wt, "branch": "missing"}, {}, time.time(), 7)
        for key, value in {"shortHead": "", "subject": "", "dirtyFiles": [], "ignored": 0,
                           "ignoredFiles": [], "branchSaved": False, "unpushed": None}.items():
            self.assertEqual(row[key], value)


class DiscoveryAndHostTests(Base):
    def test_roots_list_first_level_main_repos_only(self):
        other = Repo(self.base, "other")
        self.repo.worktree("idle")
        Path(self.base, "plain").mkdir()
        self.assertEqual(WT.repos_under(str(self.base)), [self.repo.path, other.path])

    def test_repo_argument_resolves_a_linked_worktree_to_its_main_repo(self):
        wt = self.repo.worktree("idle")
        self.assertEqual(WT.discover_repos([], [wt, self.repo.path]), [self.repo.path])

    def test_config_supplies_roots_and_days(self):
        self.repo.worktree("idle")
        cfg = self.base / "cfg" / "worktree-tidy" / "config.json"
        cfg.parent.mkdir(parents=True)
        cfg.write_text(json.dumps({"roots": [str(self.base)], "days": 60}))
        out = subprocess.run(["python3", str(SCRIPT), "--json", "scan", "--no-remote"], capture_output=True,
                             text=True, env={**os.environ}, cwd=str(self.base), check=True).stdout
        report = json.loads(out)
        self.assertEqual(report["days"], 60)
        self.assertEqual(report["summary"], {"repos": 1, "worktrees": 1, "removable": 0,
                                             "branchDeletable": 0, "pruned": 0})

    def test_remote_parsing(self):
        cases = {
            "git@github.com:owner/repo.git": ("github", "owner/repo"),
            "https://github.com/owner/repo": ("github", "owner/repo"),
            "https://cnb.cool/org/group/repo.git": ("cnb", "org/group/repo"),
            "git@gitlab.com:group/sub/repo.git": ("gitlab", "group/sub/repo"),
            "https://example.com/a/b.git": (None, None),
        }
        sh("git", "remote", "add", "origin", "x", cwd=self.repo.path)
        for url, want in cases.items():
            sh("git", "remote", "set-url", "origin", url, cwd=self.repo.path)
            self.assertEqual(WT.remote_of(self.repo.path), want, url)

    def test_cnb_pages_until_every_branch_is_found(self):
        pages = {
            "1": {"data": [{"number": "9", "state": "open", "is_merged": False, "head": {"ref": "refs/heads/a"}},
                           {"number": "8", "state": "closed", "is_merged": True, "head": {"ref": "refs/heads/a"}}]},
            "2": {"data": [{"number": "5", "state": "closed", "is_merged": True, "head": {"ref": "refs/heads/b"}}]},
            "3": {"data": []},
        }
        calls = []

        def fake_run(cmd, cwd=None, timeout=60):
            if cmd[1] == "users":
                return 0, json.dumps({"data": {"username": "me"}})
            self.assertEqual(cmd[cmd.index("--authors") + 1], "me")
            page = cmd[cmd.index("--page") + 1]
            calls.append(page)
            return 0, json.dumps(pages[page])

        with mock.patch.object(WT, "run", side_effect=fake_run), mock.patch.object(WT, "_cnb_user", []):
            got = WT.cnb_states("org/repo", ["a", "b", "c"])
        self.assertEqual(got["a"]["state"], "open")  # newest request wins
        self.assertEqual(got["b"], {"state": "merged", "url": "https://cnb.cool/org/repo/-/pulls/5"})
        self.assertEqual(got["c"]["state"], "none")
        self.assertEqual(calls, ["1", "2", "3"])

    def test_failing_cnb_cli_leaves_branches_unknown(self):
        with mock.patch.object(WT, "run", return_value=(1, "env: node: No such file or directory")), \
                mock.patch.object(WT, "_cnb_user", []):
            self.assertEqual(WT.cnb_states("org/repo", ["a"]), {})
        sh("git", "remote", "add", "origin", "https://cnb.cool/org/repo.git", cwd=self.repo.path)
        with mock.patch.object(WT, "run", return_value=(1, "")), mock.patch.object(WT.shutil, "which", return_value="/x/cnb"), \
                mock.patch.object(WT, "_cnb_user", []):
            self.assertEqual(WT.request_states(self.repo.path, ["a"]), {"a": {"state": "unknown", "url": None}})

    def test_pick_state_prefers_open_then_merged(self):
        self.assertEqual(WT.pick_state([("closed", "c"), ("merged", "m")])["state"], "merged")
        self.assertEqual(WT.pick_state([("merged", "m"), ("open", "o")])["state"], "open")
        self.assertEqual(WT.pick_state([])["state"], "none")


if __name__ == "__main__":
    unittest.main()
