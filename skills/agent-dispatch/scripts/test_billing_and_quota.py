"""Spend is split by billing: the dollar budget gates API Lanes only, subscription Lanes are gated by the
account's quota window, nothing already running is stopped, and a Lane whose context grows too long is flagged."""

from __future__ import annotations

import json
import os
import subprocess
import unittest
from unittest import mock

import dispatch_board as board
from test_dispatch_board import BoardTestCase


def quota_json(used_5h: float, used_7d: float = 10, named: float = 0) -> str:
    return json.dumps({"schemaVersion": 1, "accounts": [{
        "ref": "claude:001", "kind": "subscription",
        "quota": {"status": "ok", "windows": [
            {"label": "5h", "usedPercent": used_5h, "resetsAt": "2026-11-01T18:20:00.000Z"},
            {"label": "7d", "usedPercent": used_7d, "resetsAt": "2026-11-06T23:00:00.000Z"},
            {"label": "7d", "name": "Fable", "usedPercent": named},
        ]}}]})


class TestBilling(BoardTestCase):
    def init(self, *extra: str) -> str:
        code, out, err = self.run_cli("init", "--objective", "o", "--run-id", "b", *extra)
        self.assertEqual(code, 0, err)
        return out.strip()

    def test_budget_needs_a_billing_kind(self):
        run_dir = self.init("--budget-usd", "5")
        code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--id", "A")
        self.assertEqual(code, 2)
        self.assertIn("--billing api or --billing subscription", err)

    def test_subscription_spend_never_trips_the_dollar_budget(self):
        run_dir = self.init("--budget-usd", "5")
        with mock.patch("dispatch_board.account_quota", return_value=None):
            self.run_cli("--run", run_dir, "lane", "add", "--billing", "subscription", "--id", "S", "--state", "working", "--cost", "40")
            code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--billing", "subscription", "--id", "S2")
            self.assertEqual(code, 0, err)
            code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "S", "--round", "2")
            self.assertEqual(code, 0, err)
        self.assertEqual(self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A")[0], 0)
        _, line, _ = self.run_cli("--run", run_dir, "show", "--line")
        self.assertIn("API 实付 $0.00 / 预算 $5.00", line)
        self.assertIn("订阅按 token 折算 $40.00（不扣钱）", line)

    def test_api_budget_hit_points_to_a_subscription_account(self):
        run_dir = self.init("--budget-usd", "5")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--cost", "6")
        code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2")
        self.assertEqual(code, 2)
        self.assertIn("finished and running work is kept", err)
        self.assertIn("--billing subscription --account", err)
        with mock.patch("dispatch_board.account_quota", return_value=None):  # the next round moves to a subscription account
            code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2",
                                        "--billing", "subscription", "--account", "cc001")
        self.assertEqual(code, 0, err)

    def test_switching_billing_keeps_each_round_in_its_own_bucket(self):
        run_dir = self.init("--budget-usd", "5")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--cost", "6")
        with mock.patch("dispatch_board.account_quota", return_value=None):
            code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2",
                                        "--billing", "subscription", "--account", "cc001", "--cost", "2")
        self.assertEqual(code, 0, err)
        run = board.load_run(run_dir)
        self.assertAlmostEqual(board.run_spend(run, api_only=True), 6.0)  # round 1 stays API money
        self.assertAlmostEqual(board.run_spend(run), 8.0)
        code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "B")
        self.assertEqual(code, 2)
        self.assertIn("$6.00 of real API money", err)
        _, line, _ = self.run_cli("--run", run_dir, "show", "--line")
        self.assertIn("API 实付 $6.00 / 预算 $5.00", line)
        self.assertIn("订阅按 token 折算 $2.00", line)
        self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--state", "done")
        _, text, _ = self.run_cli("--run", run_dir, "show")
        self.assertIn("$6.00（API 实付）+ $2.00（订阅按 token 折算）", text)

    def test_one_session_resumed_under_another_billing_splits_its_increments(self):
        run_dir = self.init()
        r1, r2 = os.path.join(run_dir, "A.jsonl"), os.path.join(run_dir, "A-2.jsonl")
        for path, cost in ((r1, 6.0), (r2, 8.0)):
            with open(path, "w", encoding="utf-8") as f:
                f.write(json.dumps({"type": "result", "subtype": "success", "total_cost_usd": cost, "session_id": "s1"}) + "\n")
        with mock.patch("dispatch_board.account_quota", return_value=None):
            self.run_cli("--run", run_dir, "lane", "add", "--billing", "subscription", "--id", "A", "--state", "working", "--output", r1)
        self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2", "--billing", "api", "--output", r2)
        run = board.load_run(run_dir)
        self.assertAlmostEqual(board.run_spend(run, api_only=True), 2.0)  # only what the API round added
        self.assertAlmostEqual(board.run_spend(run), 8.0)

    def test_finished_lanes_label_their_cost(self):
        run_dir = self.init()
        with mock.patch("dispatch_board.account_quota", return_value=None):
            self.run_cli("--run", run_dir, "lane", "add", "--billing", "subscription", "--id", "S", "--state", "done", "--cost", "3")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "done", "--cost", "1")
        _, text, _ = self.run_cli("--run", run_dir, "show")
        self.assertIn("$3.00（订阅按 token 折算）", text)
        self.assertIn("$1.00（API 实付）", text)


class TestQuotaGate(BoardTestCase):
    def init(self, *extra: str) -> str:
        code, out, err = self.run_cli("init", "--objective", "o", "--run-id", "q", *extra)
        self.assertEqual(code, 0, err)
        return out.strip()

    def sideby(self, payload: str):
        done = subprocess.CompletedProcess(["sideby"], 0, stdout=payload, stderr="")
        return mock.patch.multiple("dispatch_board", shutil=mock.Mock(which=mock.Mock(return_value="/bin/sideby")),
                                   subprocess=mock.Mock(run=mock.Mock(return_value=done), TimeoutExpired=subprocess.TimeoutExpired))

    def test_account_quota_reads_the_fullest_unnamed_window(self):
        with self.sideby(quota_json(used_5h=30, used_7d=60, named=99)):
            quota = board.account_quota("cc001")
        self.assertEqual((quota["used"], quota["window"], quota["account"]), (60, "7d", "claude:001"))

    def test_account_quota_unknown_without_sideby(self):
        with mock.patch("dispatch_board.shutil.which", return_value=None):
            self.assertIsNone(board.account_quota("cc001"))

    def test_a_full_account_takes_no_new_lane(self):
        run_dir = self.init()
        with self.sideby(quota_json(used_5h=85)):
            code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--billing", "subscription", "--account", "cc001", "--id", "A")
        self.assertEqual(code, 2)
        self.assertIn("85% of its 5h quota window, which resets at ", err)
        self.assertIn("sideby next", err)
        self.assertIn("running Lanes are not stopped", err)
        with self.sideby(quota_json(used_5h=50)):
            code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--billing", "subscription", "--account", "cc001", "--id", "A")
        self.assertEqual(code, 0, err)

    def test_threshold_is_configurable(self):
        run_dir = self.init("--quota-stop-percent", "90")
        with self.sideby(quota_json(used_5h=85)):
            code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--billing", "subscription", "--account", "cc001", "--id", "A")
        self.assertEqual(code, 0, err)

    def test_a_fix_round_on_the_same_account_is_never_stopped(self):
        run_dir = self.init()
        with self.sideby(quota_json(used_5h=10)):
            self.run_cli("--run", run_dir, "lane", "add", "--billing", "subscription", "--account", "cc001", "--id", "A", "--state", "working")
        with self.sideby(quota_json(used_5h=95)):
            code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2")
            self.assertEqual(code, 0, err)
            code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "3", "--account", "cc001")
            self.assertEqual(code, 0, err)  # naming the same account again is still the same account
        run_dir2 = self.run_cli("init", "--objective", "o", "--run-id", "q2")[1].strip()
        with self.sideby(quota_json(used_5h=10)):
            self.run_cli("--run", run_dir2, "lane", "add", "--billing", "subscription", "--account", "cc001", "--id", "B", "--state", "working")
        with self.sideby(quota_json(used_5h=95)):
            code, _, err = self.run_cli("--run", run_dir2, "lane", "set", "--id", "B", "--round", "2", "--account", "cc002")
        self.assertEqual(code, 2)  # moving to another account: that start is gated
        self.assertIn("round 2 of B may not start", err)


class TestContextHandoff(BoardTestCase):
    def stream(self, run_dir: str, context: int) -> str:
        path = os.path.join(run_dir, "A.jsonl")
        usage = {"input_tokens": 10, "cache_read_input_tokens": context - 1010, "cache_creation_input_tokens": 1000}
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "assistant", "message": {"usage": usage, "content": [{"type": "text", "text": "working"}]}}) + "\n")
        return path

    def test_long_context_is_flagged_for_handoff(self):
        run_dir = self.run_cli("init", "--objective", "o", "--run-id", "c")[1].strip()
        self.run_cli("--run", run_dir, "lane", "add", "--id", "A", "--state", "working", "--output", self.stream(run_dir, 160_000))
        _, text, _ = self.run_cli("--run", run_dir, "show")
        self.assertIn("上下文已到 16 万 token", text)
        self.assertIn("换新会话", text)

    def test_short_context_and_custom_threshold(self):
        run_dir = self.run_cli("init", "--objective", "o", "--run-id", "c", "--context-handoff-tokens", "300000")[1].strip()
        self.run_cli("--run", run_dir, "lane", "add", "--id", "A", "--state", "working", "--output", self.stream(run_dir, 160_000))
        _, text, _ = self.run_cli("--run", run_dir, "show")
        self.assertNotIn("上下文已到", text)


if __name__ == "__main__":
    unittest.main()
