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


if __name__ == "__main__":
    unittest.main()
