"""Unit tests for the benchmark's pure parts: prompts, stream reading and the comparison verdict."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare  # noqa: E402
import run_bench  # noqa: E402


def row(task: str, arm: str, rep: int, ok: bool, wall: float, cost: float | None = 1.0, **extra) -> dict:
    return {"task": task, "arm": arm, "rep": rep, "pass": ok, "wall_s": wall, "total_known_cost_usd": cost, **extra}


class TestPrompts(unittest.TestCase):
    def test_arms_share_the_task_and_differ_only_in_the_arm_line(self):
        task = {"prompt": "  Fix the thing.\n"}
        solo, dispatch = run_bench.build_prompt(task, "solo"), run_bench.build_prompt(task, "dispatch")
        self.assertTrue(solo.startswith("Fix the thing.\n\n") and dispatch.startswith("Fix the thing.\n\n"))
        self.assertIn("Do not delegate", solo)
        self.assertIn("/agent-dispatch", dispatch)
        for text in (solo, dispatch):
            self.assertIn("Do not push", text)

    def test_unknown_task_ids_are_reported(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"tasks": [{"id": "T1"}]}, f)
        with self.assertRaises(SystemExit) as ctx:
            run_bench.load_tasks(f.name, ["T9"])
        self.assertIn("T9", str(ctx.exception))
        os.unlink(f.name)


    def test_skip_done_reads_recorded_trials(self):
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(run_bench.done_trials(out), set())
            with open(os.path.join(out, "results.jsonl"), "w", encoding="utf-8") as f:
                f.write(json.dumps(row("T1", "solo", 1, True, 10)) + "\n\n" + json.dumps(row("T2", "dispatch", 3, False, 10)) + "\n")
            self.assertEqual(run_bench.done_trials(out), {("T1", "solo", 1), ("T2", "dispatch", 3)})


class TestStream(unittest.TestCase):
    def test_reads_model_cost_and_final_text(self):
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            f.write(json.dumps({"type": "system", "subtype": "init", "model": "m1"}) + "\nnot json\n")
            f.write(json.dumps({"type": "result", "total_cost_usd": 2.5, "num_turns": 7, "is_error": False,
                                "result": "Dispatch: L1 — one module"}) + "\n")
        info = run_bench.read_stream(f.name)
        os.unlink(f.name)
        self.assertEqual((info["model"], info["cost_usd"], info["turns"]), ("m1", 2.5, 7))
        self.assertEqual(run_bench.dispatch_facts("/nonexistent", info["final"])["tier"], "L1")
        self.assertEqual(run_bench.dispatch_facts("/nonexistent", "分工：判为 L1，自己写")["tier"], "L1")
        self.assertIsNone(run_bench.dispatch_facts("/nonexistent", "改完了，HTML5 页面")["tier"])


class TestCompare(unittest.TestCase):
    def test_holds_when_no_task_is_worse_and_dispatch_is_faster(self):
        rows = [row("T1", "solo", r, True, 600) for r in (1, 2, 3)] + [row("T1", "dispatch", r, True, 400) for r in (1, 2, 3)]
        s = compare.summarize(rows, "solo", "dispatch")
        self.assertTrue(s["holds"])
        self.assertIn("Verdict (dispatch vs solo): holds", compare.render(s))

    def test_a_worse_task_fails_the_verdict_and_one_run_flips_ask_for_the_transcript(self):
        rows = ([row("T1", "solo", r, True, 600) for r in (1, 2, 3)] + [row("T1", "dispatch", r, r != 2, 300) for r in (1, 2, 3)]
                + [row("T2", "solo", r, False, 600) for r in (1, 2, 3)] + [row("T2", "dispatch", r, True, 300) for r in (1, 2, 3)])
        s = compare.summarize(rows, "solo", "dispatch")
        flips = {e["task"]: e["flip"] for e in s["per_task"]}
        self.assertEqual(flips["T1"], "worse (one run: check transcript)")
        self.assertEqual(flips["T2"], "better")
        self.assertFalse(s["holds"])
        self.assertIn("worse on T1", "; ".join(s["reasons"]))

    def test_not_faster_fails_and_unknown_costs_are_not_zero(self):
        rows = [row("T1", "solo", 1, True, 300, cost=None), row("T1", "dispatch", 1, True, 900, cost=None, lanes_without_cost=2)]
        s = compare.summarize(rows, "solo", "dispatch")
        self.assertFalse(s["holds"])
        self.assertIsNone(s["totals"]["dispatch"]["cost_usd"])
        self.assertIn("lanes without a reported cost", compare.render(s))


if __name__ == "__main__":
    unittest.main()
