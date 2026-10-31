#!/usr/bin/env python3
"""The Lane state table (references/run-board.md § Lane states): one test per row, precedence, and the Ask dedupe."""

from __future__ import annotations

import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import dispatch_board as board
from test_dispatch_board import BoardTestCase, write_jsonl


def facts(**overrides) -> dict:
    """A working Lane with nothing to report: the last row of the table."""
    base = {"state": "working", "open_asks": [], "session": None, "outcome": None, "answered": False,
            "stream_ended": False, "stream_failed": False, "orca_exited": False, "waiting_on": [], "silent_for": 10}
    return base | overrides


def state(**overrides) -> str:
    return board.lane_state(facts(**overrides))[0]


class TableRows(BoardTestCase):
    def test_row1_ended_keeps_the_ledger_state(self):
        for ledger in ("done", "failed", "stopped"):
            self.assertEqual(state(state=ledger), ledger)

    def test_row2_waits_on_a_person(self):
        self.assertEqual(state(open_asks=["A1"]), "needs-you")
        self.assertEqual(state(state="needs-you"), "needs-you")
        self.assertEqual(state(session="needs-you"), "needs-you")
        self.assertEqual(state(outcome="blocked", stream_ended=True), "needs-you")

    def test_row3_needs_the_coordinator(self):
        cases = {
            "跑报错了": facts(stream_ended=True, stream_failed=True),
            "窗口已关闭": facts(orca_exited=True),
            "交回给主控": facts(outcome="handback"),
            "没做完": facts(outcome="failed"),
            "回答已收到": facts(outcome="blocked", answered=True),
        }
        for words, row in cases.items():
            with self.subTest(words):
                got, reason = board.lane_state(row)
                self.assertEqual(got, "attention")
                self.assertIn(words, reason)

    def test_row4_finished_waits_for_integration(self):
        self.assertEqual(state(stream_ended=True), "finished")
        self.assertEqual(state(outcome="succeeded"), "finished")
        self.assertEqual(state(stream_ended=True, session="idle"), "finished")

    def test_row5_queued_or_dependency_not_done(self):
        self.assertEqual(state(state="queued"), "queued")
        self.assertEqual(state(waiting_on=["部署 test"]), "queued")

    def test_row6_quiet_too_long_without_a_session_status(self):
        for session in (None, "unknown"):
            self.assertEqual(state(session=session, silent_for=board.STALE_SECONDS), "stale")
        self.assertEqual(state(silent_for=board.STALE_SECONDS - 1), "working")
        self.assertEqual(state(session="idle", silent_for=3600), "working")  # a usable status says what the session does

    def test_row7_working(self):
        self.assertEqual(state(), "working")
        self.assertEqual(state(silent_for=None), "working")


class Precedence(BoardTestCase):
    def test_each_row_beats_the_rows_below(self):
        self.assertEqual(state(state="done", open_asks=["A1"], session="needs-you"), "done")
        self.assertEqual(state(open_asks=["A1"], stream_ended=True, stream_failed=True), "needs-you")
        self.assertEqual(state(outcome="handback", stream_ended=True), "attention")
        self.assertEqual(state(state="queued", stream_ended=True), "finished")
        self.assertEqual(state(state="queued", silent_for=3600), "queued")
        self.assertEqual(state(silent_for=3600), "stale")

    def test_a_busy_session_hides_readings_from_an_older_turn(self):
        for old in (dict(stream_ended=True), dict(stream_ended=True, stream_failed=True), dict(orca_exited=True),
                    dict(outcome="blocked"), dict(outcome="succeeded"), dict(outcome="handback")):
            with self.subTest(old):
                self.assertEqual(state(session="busy", **old), "working")
        self.assertEqual(state(session="busy", open_asks=["A1"]), "needs-you")  # an open Ask still waits on the user

    def test_every_combination_lands_on_exactly_one_known_state(self):
        for ledger in board.LANE_STATES:
            for session in (None, "busy", "idle", "needs-you", "unknown"):
                for outcome in (None, "succeeded", "failed", "blocked", "handback"):
                    for ended in (False, True):
                        got = state(state=ledger, session=session, outcome=outcome, stream_ended=ended,
                                    stream_failed=ended, silent_for=3600)
                        self.assertIn(got, board.VIEW_LANE_STATES)


class DeriveFollowsTheTable(BoardTestCase):
    def test_blocked_report_then_answered_ask_then_new_round(self):
        run_dir, run = self.new_run()
        board.add_lane(run, {"id": "A", "title": "卡片", "state": "working", "output": os.path.join(run_dir, "A.jsonl")}, now=1_000_000.0)
        write_jsonl(os.path.join(run_dir, "A.jsonl"), [{"type": "result", "subtype": "success", "result": "OUTCOME: blocked\n要不要改接口？"}])
        self.assertEqual(board.derive(run)["lanes"][0]["state"], "needs-you")
        board.add_ask(run, {"id": "A1", "lane": "A", "question": "改接口吗", "recommend": "改", "evidence": "e", "blocks": "A"}, now=1_000_100.0)
        lane = board.derive(run)["lanes"][0]
        self.assertEqual((lane["state"], lane["open_asks"]), ("needs-you", ["A1"]))
        board.answer_ask(run, "A1", "按推荐", now=1_000_200.0)
        lane = board.derive(run)["lanes"][0]
        self.assertEqual(lane["state"], "attention")
        self.assertIn("回答已收到", lane["flags"][-1])
        board.set_lane(run, "A", {"round": 2, "output": os.path.join(run_dir, "A2.jsonl")}, now=1_000_300.0)
        self.assertEqual(board.derive(run, now=1_000_310.0)["lanes"][0]["state"], "working")

    def test_handback_report_needs_the_coordinator_not_the_user(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "state": "working", "result": "OUTCOME: handback\n要改 May edit 以外的文件。"})
        view = board.derive(run)
        self.assertEqual(view["lanes"][0]["state"], "attention")
        self.assertIn("不用管", board.render_html(view))

    def test_watch_wakes_when_an_idle_session_finishes(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "title": "卡片", "state": "working", "session": "s"})
        run["lanes"][0]["result"] = "OUTCOME: succeeded\n好了。"
        view = board.derive(run, sessions={"sessions": [{"sessionId": "s", "status": "idle"}]})
        self.assertEqual(view["lanes"][0]["state"], "finished")
        self.assertEqual(board.watch_events(view)["A"][0], "ended")


class AskDedupe(BoardTestCase):
    def needs_tile(self, view) -> str:
        return re.search(r'需要你吗</div><div class="v num">([^<]*)<', board.render_html(view)).group(1)

    def test_a_workers_question_that_became_an_ask_counts_once(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "state": "needs-you"})
        board.add_ask(run, {"id": "A1", "lane": "A", "question": "q", "recommend": "r", "evidence": "e", "blocks": "b"})
        self.assertEqual(self.needs_tile(board.derive(run)), "1 件事等你")
        board.add_lane(run, {"id": "B", "state": "needs-you"})  # a question not yet recorded as an Ask
        board.add_ask(run, {"id": "A2", "question": "q", "recommend": "r", "evidence": "e", "blocks": "b"})  # one for no Lane
        self.assertEqual(self.needs_tile(board.derive(run)), "3 件事等你")


if __name__ == "__main__":
    import unittest
    unittest.main()
