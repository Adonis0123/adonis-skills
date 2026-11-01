"""Hard limits the ledger enforces instead of trusting the prompt: round budget, Run budget,
disjoint writable files and no self-review."""

from __future__ import annotations

import json
import os
import unittest

import dispatch_board as board
from test_dispatch_board import BoardTestCase


class TestHarnessLimits(BoardTestCase):
    def init(self, *extra: str) -> str:
        code, out, err = self.run_cli("init", "--objective", "o", "--run-id", "h", *extra)
        self.assertEqual(code, 0, err)
        return out.strip()

    def test_fourth_round_is_refused_with_a_way_out(self):
        run_dir = self.init()
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--role", "write", "--state", "working")
        for n in (2, 3):
            code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", str(n))
            self.assertEqual(code, 0, err)
        code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "4")
        self.assertEqual(code, 2)
        self.assertIn("3-round budget", err)
        self.assertIn("lane add --id A-v2", err)
        self.assertEqual(board.load_run(run_dir)["lanes"][0]["round"], 3)

    def test_budget_refuses_new_lanes_once_spent_and_can_be_raised(self):
        run_dir = self.init("--budget-usd", "5")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--cost", "3")
        code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "B", "--cost", "2.5")
        self.assertEqual(code, 0, err)  # spend was $3 when B started
        code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "C")
        self.assertEqual(code, 2)
        self.assertIn("$5.50 of real API money against its $5.00 budget", err)
        self.assertIn("run set --budget-usd", err)
        _, line, _ = self.run_cli("--run", run_dir, "show", "--line")
        self.assertIn("API 实付 $5.50 / 预算 $5.00，已到上限", line)
        self.assertEqual(self.run_cli("--run", run_dir, "run", "set", "--budget-usd", "10")[0], 0)
        self.assertEqual(self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "C")[0], 0)

    def test_budget_counts_stream_cost_and_subagents_are_not_blocked(self):
        run_dir = self.init("--budget-usd", "1")
        stream = os.path.join(run_dir, "A.jsonl")
        with open(stream, "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "result", "subtype": "success", "total_cost_usd": 1.2, "session_id": "s1"}) + "\n")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--output", stream)
        self.assertEqual(self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "B")[0], 2)
        code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--id", "S1", "--kind", "subagent", "--parent", "coordinator")
        self.assertEqual(code, 0, err)

    def write_result(self, path: str, cost: float | None, session: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "system", "subtype": "init", "session_id": session}) + "\n")
            if cost is not None:
                f.write(json.dumps({"type": "result", "subtype": "success", "total_cost_usd": cost, "session_id": session}) + "\n")

    def test_resumed_round_keeps_earlier_spend_while_running(self):
        run_dir = self.init("--budget-usd", "100")
        r1, r2 = os.path.join(run_dir, "A.jsonl"), os.path.join(run_dir, "A-2.jsonl")
        self.write_result(r1, 6.0, "s1")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--output", r1)
        self.write_result(r2, None, "s1")  # resumed, same session, still running: no cost yet
        self.assertEqual(self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2", "--output", r2)[0], 0)
        self.assertAlmostEqual(board.run_spend(board.load_run(run_dir)), 6.0)
        self.write_result(r2, 9.0, "s1")  # cumulative when it ends: counted once, not 6 + 9
        self.assertAlmostEqual(board.run_spend(board.load_run(run_dir)), 9.0)
        _, line, _ = self.run_cli("--run", run_dir, "show", "--line")
        self.assertIn("API 实付 $9.00", line)

    def test_fresh_session_rounds_add_up(self):
        run_dir = self.init()
        r1, r2 = os.path.join(run_dir, "A.jsonl"), os.path.join(run_dir, "A-2.jsonl")
        self.write_result(r1, 4.0, "s1")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--output", r1)
        self.write_result(r2, 1.5, "s2")
        self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2", "--output", r2)
        self.assertAlmostEqual(board.run_spend(board.load_run(run_dir)), 5.5)

    def test_mixed_sessions_take_max_per_session(self):  # history 2, 3 on s1, then fresh s2 with 1 -> 4
        run_dir = self.init()
        paths = [os.path.join(run_dir, f"A{n}.jsonl") for n in (1, 2, 3)]
        self.write_result(paths[0], 2.0, "s1")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--output", paths[0])
        self.write_result(paths[1], 3.0, "s1")
        self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2", "--output", paths[1])
        self.write_result(paths[2], 1.0, "s2")
        self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "3", "--output", paths[2])
        self.assertAlmostEqual(board.run_spend(board.load_run(run_dir)), 4.0)

    def test_manual_per_round_costs_add_up(self):  # Codex: --cost 2 then --cost 3 -> 5
        run_dir = self.init()
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "C", "--state", "working", "--cost", "2")
        self.run_cli("--run", run_dir, "lane", "set", "--id", "C", "--round", "2", "--cost", "3")
        self.assertAlmostEqual(board.run_spend(board.load_run(run_dir)), 5.0)
        _, line, _ = self.run_cli("--run", run_dir, "show", "--line")
        self.assertNotIn("$", line)  # no budget set: show --line prints no spend

    def test_stream_cost_wins_over_a_copied_manual_cost(self):  # hand-entered copy of the stream total
        run_dir = self.init("--budget-usd", "100")
        r1, r2 = os.path.join(run_dir, "A.jsonl"), os.path.join(run_dir, "A-2.jsonl")
        self.write_result(r1, 6.0, "s1")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--output", r1, "--cost", "6")
        self.write_result(r2, 9.0, "s1")
        self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2", "--output", r2)
        self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--cost", "9")
        self.assertAlmostEqual(board.run_spend(board.load_run(run_dir)), 9.0)
        _, line, _ = self.run_cli("--run", run_dir, "show", "--line")
        self.assertIn("$9.00", line)

    def test_subagent_rounds_obey_the_budget(self):
        run_dir = self.init("--budget-usd", "5")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--cost", "5")
        self.run_cli("--run", run_dir, "lane", "add", "--id", "S1", "--kind", "subagent", "--parent", "coordinator")
        code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "S1", "--round", "2")
        self.assertEqual(code, 2)
        self.assertIn("may not start", err)
        self.assertEqual(self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--state", "done")[0], 0)

    def test_budget_refuses_a_fix_round_once_spent(self):
        run_dir = self.init("--budget-usd", "5")
        r1 = os.path.join(run_dir, "A.jsonl")
        self.write_result(r1, 5.2, "s1")
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--state", "working", "--output", r1)
        code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2",
                                    "--output", os.path.join(run_dir, "A-2.jsonl"))
        self.assertEqual(code, 2)
        self.assertIn("round 2 of A may not start", err)
        self.assertEqual(self.run_cli("--run", run_dir, "run", "set", "--budget-usd", "10")[0], 0)
        code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--round", "2",
                                    "--output", os.path.join(run_dir, "A-2.jsonl"))
        self.assertEqual(code, 0, err)

    def test_run_set_needs_a_field(self):
        run_dir = self.init()
        code, _, err = self.run_cli("--run", run_dir, "run", "set")
        self.assertEqual(code, 2)
        self.assertIn("--budget-usd", err)

    def test_run_set_moves_the_coordinator_after_a_handoff(self):
        run_dir = self.init("--account", "claude:002", "--coordinator-session", "old-session")
        code, _, err = self.run_cli("--run", run_dir, "run", "set", "--account", "claude:main",
                                    "--coordinator-session", "new-session")
        self.assertEqual(code, 0, err)
        run = board.load_run(run_dir)
        self.assertEqual((run["coordinator"], run["coordinator_session"]), ("claude:main", "new-session"))

    def test_overlapping_writers_are_refused_disjoint_ones_pass(self):
        run_dir = self.init()
        add = lambda i, owns, *x: self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", i, "--role", "write",
                                               "--state", "working", "--owns", owns, *x)
        self.assertEqual(add("A", "packages/core/**")[0], 0)
        self.assertEqual(add("B", "packages/web/src/a.ts,docs/x.md")[0], 0)
        code, _, err = add("C", "packages/core/src/types.ts")
        self.assertEqual(code, 2)
        self.assertIn("overlaps A's packages/core/**", err)
        self.assertIn("merge the two into one Lane", err)
        self.assertEqual(add("D", "./docs/x.md")[0], 2)
        # a finished writer no longer holds its files
        self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--state", "done")
        self.assertEqual(add("E", "packages/core/src/types.ts")[0], 0)
        # widening an existing Lane into another's files is refused too
        code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "B", "--owns", "packages/core/src/**")
        self.assertEqual(code, 2)
        self.assertIn("overlaps E's", err)

    def test_owns_overlap_rules(self):
        cases = [("a/**", "a/b.ts", True), ("a/*.ts", "a/b.ts", True), ("a/b.ts", "a/c.ts", False),
                 ("a/**", "ab/c.ts", False), ("**", "x.ts", True), ("src/*.ts", "src/x/y.ts", True), ("a/b", "a/b", True)]
        for left, right, expected in cases:
            with self.subTest(left=left, right=right):
                self.assertEqual(board.owns_overlap(left, right), expected)
                self.assertEqual(board.owns_overlap(right, left), expected)

    def test_reviewer_in_the_writers_session_is_refused(self):
        run_dir = self.init()
        self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "A", "--role", "write", "--session", "s-1", "--state", "working")
        code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "R", "--role", "review", "--reviews", "A", "--session", "s-1")
        self.assertEqual(code, 2)
        self.assertIn("never reviews its own diff", err)
        self.assertEqual(self.run_cli("--run", run_dir, "lane", "add", "--billing", "api", "--id", "R", "--role", "review", "--reviews", "A", "--session", "s-2")[0], 0)
        code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "R", "--session", "s-1")
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
