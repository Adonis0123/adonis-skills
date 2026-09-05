"""Exercise report extraction against disposable Git repositories."""

import os
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import git_analyzer, report_generator, storage


class GitAnalyzerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="weekly-report-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.env = {
            **os.environ,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "TZ": "UTC",
        }
        self.environment = patch.dict(os.environ, self.env)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.git("init", "-q")
        self.git("config", "user.name", "Report Author")
        self.git("config", "user.email", "report@example.invalid")

    def git(self, *args, cwd=None, env=None):
        result = subprocess.run(
            ["git", "-c", "core.hooksPath=/dev/null", *args],
            cwd=cwd or self.repo,
            env={**self.env, **(env or {})},
            text=True,
            capture_output=True,
            check=True,
        )
        return result.stdout

    def commit(self, message="fix: report data", stamp="2026-09-02T12:00:00+08:00", **identity):
        self.git("commit", "--allow-empty", "-m", message, env={
            "GIT_AUTHOR_DATE": stamp,
            "GIT_COMMITTER_DATE": stamp,
            **identity,
        })

    def read(self, author=None):
        return git_analyzer.get_commits(self.repo, date(2026, 8, 31), date(2026, 9, 6), author)

    def test_combined_author_pattern_matches_name_or_email(self):
        self.commit(GIT_AUTHOR_NAME="Report Author", GIT_AUTHOR_EMAIL="old@example.invalid")
        self.commit(GIT_AUTHOR_NAME="New Alias", GIT_AUTHOR_EMAIL="report@example.invalid")
        self.commit(GIT_AUTHOR_NAME="Unrelated", GIT_AUTHOR_EMAIL="unrelated@example.invalid")
        pattern = git_analyzer.build_author_pattern("Report Author", "report@example.invalid")
        self.assertEqual(len(self.read(pattern)), 2)

    def test_author_regex_metacharacters_are_literal(self):
        self.commit(GIT_AUTHOR_NAME="Report (UI)+", GIT_AUTHOR_EMAIL="report+ui@example.invalid")
        pattern = git_analyzer.build_author_pattern("Report (UI)+", "report+ui@example.invalid")
        self.assertEqual(len(self.read(pattern)), 1)

    def test_date_range_covers_whole_days_in_report_timezone(self):
        for label, stamp in [
            ("before", "2026-08-30T23:59:59+08:00"),
            ("start", "2026-08-31T00:00:00+08:00"),
            ("end", "2026-09-06T23:59:59+08:00"),
            ("after", "2026-09-07T00:00:00+08:00"),
        ]:
            self.commit(label, stamp)
        commits = self.read()
        self.assertEqual({c["message"] for c in commits}, {"start", "end"})
        self.assertEqual({c["date"] for c in commits}, {"2026-08-31", "2026-09-06"})

    def test_pipe_in_subject_does_not_shift_fields(self):
        self.commit("fix: local | remote")
        commit = self.read()[0]
        self.assertEqual(commit["message"], "fix: local | remote")
        self.assertEqual(commit["author"], "Report Author")
        self.assertEqual(commit["date"], "2026-09-02")

    def test_git_failure_is_not_empty_history(self):
        self.assertEqual(self.read(), [])
        with self.assertRaises(RuntimeError):
            git_analyzer.get_commits(self.root / "missing", date(2026, 8, 31), date(2026, 9, 6))

    def test_worktree_is_a_repo(self):
        self.commit()
        linked = self.root / "linked"
        self.git("worktree", "add", "--detach", str(linked))
        self.assertTrue(git_analyzer.is_git_repo(linked))
        self.assertEqual(len(git_analyzer.get_all_commits_from_repos(
            [linked], date(2026, 8, 31), date(2026, 9, 6)
        )["linked"]), 1)

    def test_missing_auto_author_does_not_collect_everyone(self):
        self.commit()
        self.git("config", "--unset", "user.name")
        self.git("config", "--unset", "user.email")
        with self.assertRaises(RuntimeError):
            git_analyzer.get_all_commits_from_repos([self.repo], date(2026, 8, 31), date(2026, 9, 6))

    def test_duplicate_repo_names_cannot_silently_overwrite(self):
        self.commit()
        parent = self.root / "second"
        parent.mkdir()
        duplicate = parent / "repo"
        self.git("clone", "--quiet", str(self.repo), str(duplicate))
        with self.assertRaises(ValueError):
            git_analyzer.get_all_commits_from_repos(
                [self.repo, duplicate], date(2026, 8, 31), date(2026, 9, 6), "Report Author"
            )

    def test_repo_and_subdirectory_share_one_report_project(self):
        self.commit()
        subdirectory = self.repo / "src"
        subdirectory.mkdir()
        commits = git_analyzer.get_all_commits_from_repos(
            [subdirectory, self.repo], date(2026, 8, 31), date(2026, 9, 6)
        )
        self.assertEqual(list(commits), ["repo"])
        self.assertEqual(len(commits["repo"]), 1)
        self.assertEqual(commits["repo"][0]["project"], "repo")

    def test_repo_root_preserves_trailing_space_in_directory_name(self):
        self.commit()
        spaced = self.root / "repo "
        self.git("clone", "--quiet", str(self.repo), str(spaced))
        self.assertEqual(git_analyzer.get_repo_root(spaced), spaced.resolve())
        self.assertEqual(len(git_analyzer.scan_repos([self.repo, spaced])), 2)
        commits = git_analyzer.get_all_commits_from_repos(
            [self.repo, spaced], date(2026, 8, 31), date(2026, 9, 6), "Report Author"
        )
        self.assertEqual(set(commits), {"repo", "repo "})

    def test_existing_next_week_plan_stays_after_report_body(self):
        existing = "# Weekly\n\nProject\n  - Shipped renderer\n\n下周计划\nProject\n  - Verify playback\n"
        new = "# Weekly\n\nProject\n  - Fixed timeline\n\n下周计划\nProject\n-\n"
        merged = storage.merge_report_content(existing, new)
        body, plan = merged.split("下周计划\n", 1)
        self.assertIn("Fixed timeline", body)
        self.assertNotIn("Verify playback", body)
        self.assertIn("Project\n  - Verify playback", plan)
        self.assertNotIn("\n-\n", plan)

    def test_new_plan_projects_and_manual_details_are_preserved(self):
        existing = "# Weekly\n\nProject\n  - First\n\n下周计划\nProject\n  - Validate playback\n    - Include audio\n"
        new = "# Weekly\n\nOther\n  - Second\n\n下周计划\nProject\n  - Check loading\nOther\n-\n"
        merged = storage.merge_report_content(existing, new)
        self.assertIn("  - Validate playback\n    - Include audio\n  - Check loading", merged)
        self.assertTrue(merged.endswith("Other\n-\n"))
        self.assertEqual(storage.merge_report_content(merged, new), merged)

    def test_emoji_conventional_commit_retains_meaning(self):
        message = "✨ feat(editor): preserve asynchronous media playback synchronization"
        self.assertEqual(git_analyzer.parse_commit_message(message)["type"], "feat")
        self.assertEqual(
            report_generator.summarize_commit(message),
            "preserve asynchronous media playback synchronization",
        )


if __name__ == "__main__":
    unittest.main()
