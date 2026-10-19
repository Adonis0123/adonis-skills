#!/usr/bin/env python3
"""Tests for agent-dispatch probe discovery."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from unittest import mock

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import probe_agents


class TestProbeAgents(unittest.TestCase):
    def test_accounts_file_with_two_pools(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            acc_file = os.path.join(tmpdir, "accounts.json")
            with open(acc_file, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "accounts": [
                            {"product": "claude", "command": "claude", "pool": "personal"},
                            {"product": "claude", "command": "CLAUDE_CONFIG_DIR=~/.claude-work claude", "pool": "work"},
                        ]
                    },
                    f,
                )
            with mock.patch.dict(
                os.environ,
                {
                    "AGENT_DISPATCH_ACCOUNTS": acc_file,
                    "PATH": tmpdir,
                },
                clear=True,
            ):
                with mock.patch("probe_agents.ADAPTERS", []):
                    result = probe_agents.probe()
                    self.assertEqual(result["source"], "accounts_file")
                    self.assertIn("claude", result["products"])
                    self.assertEqual(result["products"]["claude"]["quota_pools"], 2)
                    self.assertEqual(len(result["products"]["claude"]["accounts"]), 2)
                    self.assertEqual(result["products"]["claude"]["accounts"][0]["command"], "claude")
                    self.assertEqual(result["products"]["claude"]["accounts"][0]["pool"], "personal")
                    self.assertEqual(
                        result["products"]["claude"]["accounts"][1]["command"],
                        "CLAUDE_CONFIG_DIR=~/.claude-work claude",
                    )
                    self.assertEqual(result["products"]["claude"]["accounts"][1]["pool"], "work")
                    self.assertEqual(result["max_parallel_workers"], 1)

    def test_same_pool_counted_once(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            acc_file = os.path.join(tmpdir, "accounts.json")
            with open(acc_file, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "accounts": [
                            {"product": "claude", "command": "claude", "pool": "shared"},
                            {"product": "claude", "command": "CLAUDE_CONFIG_DIR=~/.claude-alt claude", "pool": "shared"},
                        ]
                    },
                    f,
                )
            with mock.patch.dict(
                os.environ,
                {
                    "AGENT_DISPATCH_ACCOUNTS": acc_file,
                    "PATH": tmpdir,
                },
                clear=True,
            ):
                with mock.patch("probe_agents.ADAPTERS", []):
                    result = probe_agents.probe()
                    self.assertIn("claude", result["products"])
                    self.assertEqual(result["products"]["claude"]["quota_pools"], 1)
                    self.assertEqual(len(result["products"]["claude"]["accounts"]), 2)
                    self.assertEqual(result["max_parallel_workers"], 0)

    def test_path_only_fallback(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = os.path.join(tmpdir, "bin")
            os.makedirs(bin_dir)
            fake_claude = os.path.join(bin_dir, "claude")
            with open(fake_claude, "w", encoding="utf-8") as f:
                f.write("#!/bin/sh\nexit 0\n")
            os.chmod(fake_claude, 0o755)

            with mock.patch.dict(
                os.environ,
                {
                    "HOME": os.path.join(tmpdir, "home"),
                    "XDG_CONFIG_HOME": os.path.join(tmpdir, "config"),
                    "PATH": bin_dir,
                },
                clear=True,
            ):
                result = probe_agents.probe()
                self.assertEqual(result["source"], "path")
                self.assertEqual(result["code_products"], ["claude"])
                self.assertEqual(result["max_parallel_workers"], 0)
                self.assertEqual(result["products"]["claude"]["quota_pools"], 1)
                self.assertEqual(result["products"]["claude"]["accounts"][0]["command"], "claude")
                self.assertIn("single-product: reviewer is a fresh session of the same product", result["fallback"][0])

    def test_api_key_accounts_excluded_from_manager_kept_in_accounts_file(self):
        # 1. Manager adapter excludes API-key accounts
        manager_data = {
            "accounts": [
                {
                    "family": "claude",
                    "ref": "claude:acc1",
                    "hostInstalled": True,
                    "login": "logged-in",
                    "kind": "subscription",
                },
                {
                    "family": "claude",
                    "ref": "claude:acc2",
                    "hostInstalled": True,
                    "login": "not-needed",
                    "kind": "api",
                },
                {
                    "family": "claude",
                    "ref": "claude:acc3",
                    "hostInstalled": True,
                    "login": "logged-in",
                    "kind": "api",
                },
            ]
        }
        with mock.patch("shutil.which", return_value="/usr/local/bin/manager"):
            with mock.patch("subprocess.run") as mock_run:
                mock_run.return_value = mock.Mock(
                    stdout=json.dumps(manager_data), returncode=0
                )
                manager_adapter = probe_agents.ADAPTERS[0]
                mgr_result = manager_adapter()
                self.assertIsNotNone(mgr_result)
                accounts, _ = mgr_result
                # Only subscription account kept; api accounts excluded
                self.assertEqual(len(accounts), 1)
                self.assertEqual(accounts[0]["product"], "claude")
                self.assertIn("claude:acc1", accounts[0]["command"])

        # 2. When listed in accounts file, API-key account is kept
        with tempfile.TemporaryDirectory() as tmpdir:
            acc_file = os.path.join(tmpdir, "accounts.json")
            with open(acc_file, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "accounts": [
                            {"product": "claude", "command": "CLAUDE_API_KEY=test claude", "pool": "api"}
                        ]
                    },
                    f,
                )
            with mock.patch.dict(
                os.environ,
                {
                    "AGENT_DISPATCH_ACCOUNTS": acc_file,
                    "PATH": tmpdir,
                },
                clear=True,
            ):
                with mock.patch("probe_agents.ADAPTERS", []):
                    result = probe_agents.probe()
                    self.assertIn("claude", result["products"])
                    self.assertEqual(len(result["products"]["claude"]["accounts"]), 1)
                    self.assertEqual(result["products"]["claude"]["accounts"][0]["command"], "CLAUDE_API_KEY=test claude")
                    self.assertEqual(result["products"]["claude"]["accounts"][0]["pool"], "api")


    def _probe_with_file(self, payload: dict, env: dict | None = None) -> dict:
        with tempfile.TemporaryDirectory() as tmpdir:
            acc_file = os.path.join(tmpdir, "accounts.json")
            with open(acc_file, "w", encoding="utf-8") as f:
                json.dump(payload, f)
            with mock.patch.dict(
                os.environ,
                {"AGENT_DISPATCH_ACCOUNTS": acc_file, "PATH": tmpdir, **(env or {})},
                clear=True,
            ):
                with mock.patch("probe_agents.ADAPTERS", []):
                    return probe_agents.probe()

    FOUR_CLAUDE = {
        "accounts": [
            {"id": "claude:001", "product": "claude", "command": "sideby run claude:001", "pool": "p1"},
            {"id": "claude:main", "product": "claude", "command": "sideby run claude:main", "pool": "p1"},
            {"id": "claude:002", "product": "claude", "command": "sideby run claude:002", "pool": "p2"},
            {"id": "claude:003", "product": "claude", "command": "sideby run claude:003", "pool": "p3"},
            {"id": "codex:002", "product": "codex", "command": "sideby run codex:002", "pool": "c2"},
        ]
    }

    def test_default_one_session_per_pool(self):
        result = self._probe_with_file(self.FOUR_CLAUDE)
        self.assertEqual(result["sessions_per_pool"], 1)
        self.assertEqual(result["allow"], [])
        # 3 claude pools + 1 codex pool, coordinator keeps one, capped at 3
        self.assertEqual(result["max_parallel_workers"], 3)
        self.assertEqual(result["products"]["claude"]["accounts"][0]["id"], "claude:001")

    def test_sessions_per_pool_from_file_lifts_cap(self):
        payload = {**self.FOUR_CLAUDE, "sessions_per_pool": 2}
        result = self._probe_with_file(payload)
        self.assertEqual(result["sessions_per_pool"], 2)
        # 4 pools x 2 sessions, minus the coordinator's own slot
        self.assertEqual(result["max_parallel_workers"], 7)

    def test_sessions_per_pool_env_overrides_file_and_ignores_bad_values(self):
        payload = {**self.FOUR_CLAUDE, "sessions_per_pool": 3}
        result = self._probe_with_file(payload, {"AGENT_DISPATCH_SESSIONS_PER_POOL": "2"})
        self.assertEqual(result["sessions_per_pool"], 2)
        result = self._probe_with_file(payload, {"AGENT_DISPATCH_SESSIONS_PER_POOL": "zero"})
        self.assertEqual(result["sessions_per_pool"], 3)
        result = self._probe_with_file({**self.FOUR_CLAUDE, "sessions_per_pool": 0})
        self.assertEqual(result["sessions_per_pool"], 1)

    def test_one_pool_with_several_sessions_runs_in_parallel(self):
        payload = {
            "accounts": [{"id": "claude:001", "product": "claude", "command": "claude", "pool": "p1"}],
            "sessions_per_pool": 2,
        }
        result = self._probe_with_file(payload)
        self.assertEqual(result["max_parallel_workers"], 1)
        self.assertTrue(any("share one rate limit" in f for f in result["fallback"]))
        self.assertFalse(any("one after another" in f for f in result["fallback"]))

    def test_allow_list_in_file_filters_accounts(self):
        payload = {**self.FOUR_CLAUDE, "allow": ["claude:001", "claude:003"]}
        result = self._probe_with_file(payload)
        self.assertEqual(result["code_products"], ["claude"])
        ids = [a["id"] for a in result["products"]["claude"]["accounts"]]
        self.assertEqual(ids, ["claude:001", "claude:003"])
        self.assertEqual(result["products"]["claude"]["quota_pools"], 2)
        self.assertEqual(result["max_parallel_workers"], 1)
        self.assertEqual(result["allow_unmatched"], [])

    def test_allow_env_overrides_file_and_reports_unmatched(self):
        payload = {**self.FOUR_CLAUDE, "allow": ["claude:001"]}
        result = self._probe_with_file(payload, {"AGENT_DISPATCH_ALLOW": "claude:002, codex cc009"})
        self.assertEqual(result["allow"], ["claude:002", "codex", "cc009"])
        self.assertEqual([a["id"] for a in result["products"]["claude"]["accounts"]], ["claude:002"])
        # a bare product name allows every account of that product
        self.assertEqual([a["id"] for a in result["products"]["codex"]["accounts"]], ["codex:002"])
        self.assertEqual(result["allow_unmatched"], ["cc009"])


    def test_allow_accepts_short_commands_from_manager_and_file(self):
        manager_aliases = {
            "cc001": "claude:001",
            "codex002": "codex:002",
            "cc002": "claude:999",
        }
        payload = {**self.FOUR_CLAUDE, "aliases": {"cc002": "claude:002"}}
        with mock.patch("probe_agents.from_sideby_aliases", return_value=manager_aliases):
            result = self._probe_with_file(payload, {"AGENT_DISPATCH_ALLOW": "cc001 cc002 codex002 cc009"})
        # the accounts file's alias wins over the manager's for the same name
        self.assertEqual([a["id"] for a in result["products"]["claude"]["accounts"]], ["claude:001", "claude:002"])
        self.assertEqual([a["id"] for a in result["products"]["codex"]["accounts"]], ["codex:002"])
        self.assertEqual(result["allow"], ["cc001", "cc002", "codex002", "cc009"])
        self.assertEqual(result["allow_unmatched"], ["cc009"])

    def test_sideby_aliases_parsed_from_config_json(self):
        config = {
            "schemaVersion": 1,
            "key": "aliases",
            "value": {"cc008": "claude:008", "pi-glm": {"account": "pi:main", "args": []}, "bad": 3},
        }
        with mock.patch("shutil.which", return_value="/usr/local/bin/sideby"):
            with mock.patch("subprocess.run") as mock_run:
                mock_run.return_value = mock.Mock(stdout=json.dumps(config), returncode=0)
                aliases = probe_agents.from_sideby_aliases()
        self.assertEqual(aliases, {"cc008": "claude:008", "pi-glm": "pi:main"})
        self.assertEqual(mock_run.call_args[0][0], ["sideby", "config", "get", "aliases", "--json"])


if __name__ == "__main__":
    unittest.main()
