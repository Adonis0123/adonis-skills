"""Fix rounds, Codex sessions and usage, unregistered streams, the watch command and the Board's finished-only results."""

import os
from unittest import mock

import board_render
import dispatch_board as board
from test_dispatch_board import BoardTestCase, write_jsonl


class RoundsAndWatch(BoardTestCase):
    def start(self, lane="A"):
        _, text, _ = self.run_cli("init", "--objective", "测试", "--run-id", "r1")
        rd = text.strip()
        stream = os.path.join(rd, f"{lane}.jsonl")
        write_jsonl(stream, [{"type": "result", "subtype": "success", "session_id": "s1", "total_cost_usd": 2.0,
                              "result": "OUTCOME: succeeded\n\n第一轮做好了卡片。"}])
        code, out, _ = self.run_cli("--run", rd, "lane", "add", "--id", lane, "--title", "卡片", "--account", "claude:003",
                                    "--pool", "claude:003", "--output", stream, "--state", "working")
        self.assertEqual(code, 0)
        return rd, stream

    def test_a_new_round_needs_a_new_stream_and_files_the_old_result(self):
        rd, stream = self.start()
        code, _, err = self.run_cli("--run", rd, "lane", "set", "--id", "A", "--round", "2")
        self.assertEqual(code, 2)
        self.assertIn("needs a new --output", err)
        second = os.path.join(rd, "A2.jsonl")
        write_jsonl(second, [{"type": "assistant", "message": {"content": [{"type": "text", "text": "正在修复审查发现"}]}}])
        self.assertEqual(self.run_cli("--run", rd, "lane", "set", "--id", "A", "--round", "2", "--output", second)[0], 0)
        run = board.load_run(rd)
        lane = run["lanes"][0]
        self.assertEqual(lane["state"], "working")
        self.assertEqual(lane["history"][0]["note"], "第 1 轮结果：第一轮做好了卡片。")
        view = board.derive(run)
        self.assertEqual(view["lanes"][0]["flags"], [])  # no "做完了" from the round-1 stream
        self.assertEqual(view["lanes"][0]["cost"], 2.0)  # round 1 is a different session: its cost is kept
        page = board.render_html(view, board_file=os.path.join(rd, "b.html"))
        self.assertNotIn("已经做出来的", page)  # a Lane being reworked has produced nothing new yet

    def test_a_resumed_claude_session_is_not_counted_twice(self):
        rd, _ = self.start()
        second = os.path.join(rd, "A2.jsonl")
        write_jsonl(second, [{"type": "result", "subtype": "success", "session_id": "s1", "total_cost_usd": 5.0, "result": "好了。"}])
        self.run_cli("--run", rd, "lane", "set", "--id", "A", "--round", "2", "--output", second)
        self.assertEqual(board.derive(board.load_run(rd))["lanes"][0]["cost"], 5.0)  # cumulative, same session

    def test_codex_thread_id_and_usage_are_read(self):
        info = board.summarize_events([
            {"type": "thread.started", "thread_id": "th-9"},
            {"type": "item.completed", "item": {"type": "agent_message", "text": "OUTCOME: succeeded\n引擎接好了"}},
            {"type": "turn.completed", "usage": {"input_tokens": 1_500_000, "cached_input_tokens": 1_400_000, "output_tokens": 2000}}])
        self.assertEqual(info["session"], "th-9")
        self.assertEqual(info["tokens"], {"input": 1_500_000, "output": 2000})
        self.assertEqual(info["activity"], "AI 说：引擎接好了")
        self.assertEqual(board.said("OUTCOME: failed"), "AI 交回了结果")
        self.assertEqual(board_render.tokens(1_500_000), "1.50M")

    def test_summary_drops_the_outcome_line(self):
        run = {"id": "x", "lanes": []}
        self.assertEqual(board.lane_summary(run, {"id": "A", "summary": "OUTCOME: succeeded\n接好了。\n测过。"}), "接好了。\n测过。")
        self.assertEqual(board.lane_summary(run, {"id": "A", "summary": "OUTCOME: failed"}), "没做完，详见完整报告。")

    def test_show_names_unregistered_streams_and_missing_milestones(self):
        rd, _ = self.start()
        write_jsonl(os.path.join(rd, "E3.jsonl"), [])
        _, text, _ = self.run_cli("--run", rd, "show")
        self.assertIn("E3.jsonl 没有登记", text)
        self.assertNotIn("A.jsonl 没有登记", text)
        self.assertIn("还没有里程碑", text)

    def test_dispatch_prints_the_watch_hint_and_done_without_result_warns(self):
        rd, _ = self.start("B")
        _, out, _ = self.run_cli("--run", rd, "ask", "add", "--id", "A1", "--question", "q", "--recommend", "r", "--evidence", "e", "--blocks", "b")
        self.assertIn("watch", out)
        _, _, err = self.run_cli("--run", rd, "lane", "add", "--id", "R2", "--kind", "subagent", "--parent", "coordinator", "--state", "done")
        self.assertIn("R2 已完成但没有成果", err)

    def test_watch_wakes_on_a_new_end_only(self):
        rd, stream = self.start()
        write_jsonl(stream, [{"type": "assistant", "message": {"content": [{"type": "text", "text": "在改"}]}}])
        def finish(_seconds):
            write_jsonl(stream, [{"type": "result", "subtype": "success", "result": "好了。"}])
        with mock.patch.object(board.time, "sleep", side_effect=finish):
            code, out, _ = self.run_cli("--run", rd, "watch", "--timeout", "60", "--interval", "1")
        self.assertEqual(code, 0)
        self.assertIn("卡片：做完了", out)
        # already pending at start is not news: watch keeps waiting and times out instead of spinning
        clock = iter(range(0, 10_000, 50))
        with mock.patch.object(board.time, "sleep"), mock.patch.object(board.time, "time", side_effect=lambda: next(clock)):
            _, out, _ = self.run_cli("--run", rd, "watch", "--timeout", "60", "--interval", "1")
        self.assertIn("内没有任务结束", out)

    def test_technical_details_skip_duplicates_and_short_times_read_plainly(self):
        rd, _ = self.start()
        self.run_cli("--run", rd, "lane", "set", "--id", "A", "--state", "done")
        page = open(board.write_board(rd, board.derive(board.load_run(rd))), encoding="utf-8").read()
        self.assertNotIn("账号额度", page)  # pool equals account
        self.assertIn("不到 1 分钟", page)
        self.assertEqual(page.count('class="report-link"'), 2)  # once on the card, once among the results


if __name__ == "__main__":
    import unittest
    unittest.main()
