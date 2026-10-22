"""Regressions for reproduced defects: hangs, slow parsing, shared boards, lost runs and reports, late sessions, stale states."""

import os
import subprocess
import sys
import tempfile
import time
from unittest import mock

import dispatch_board as board
from sideby_cli import bounded_run
from test_dispatch_board import BoardTestCase, write_jsonl


class BugRegressions(BoardTestCase):
    def test_timeout_does_not_wait_for_a_descendant_that_left_the_group(self):
        # the child ignores SIGTERM and starts a setsid grandchild that keeps stdout open for 8 s
        script = ("import os,signal,subprocess,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                  "subprocess.Popen([sys.executable,'-c','import time; time.sleep(8)'], start_new_session=True); time.sleep(30)")
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            bounded_run([sys.executable, "-c", script], timeout=0.5)
        self.assertLess(time.monotonic() - started, 4)

    def test_long_grok_answers_parse_in_linear_time(self):
        events = [{"type": "text", "data": "字" * 20} for _ in range(20000)]
        started = time.monotonic()
        info = board.summarize_events(events)
        self.assertLess(time.monotonic() - started, 1)
        self.assertTrue(info["activity"].startswith("AI 说：字"))

    def test_claude_session_is_known_while_the_worker_runs(self):
        info = board.summarize_events([{"type": "system", "subtype": "init", "session_id": "live-1"},
                                       {"type": "assistant", "message": {"content": [{"type": "text", "text": "在改"}]}}])
        self.assertEqual(info["session"], "live-1")

    def test_relative_run_dir_stays_in_the_registry(self):
        _, text, _ = self.run_cli("init", "--objective", "相对", "--run-id", "rel1")
        rd = text.strip()
        relative = os.path.relpath(rd, self.plain)
        self.assertEqual(self.run_cli("--run", relative, "lane", "add", "--id", "L")[0], 0)
        self.assertTrue(all(os.path.isabs(r["dir"]) for r in board.load_registry()))

    def test_close_keeps_reports_when_paths_go_through_a_symlink(self):
        real = tempfile.mkdtemp(dir=self.root)
        link = os.path.join(self.root, "link")
        os.symlink(real, link)
        rd = os.path.join(link, "runs", "c1")
        os.makedirs(rd)
        run = {"version": 1, "id": "c1", "objective": "o", "state": "active", "created_at": board.now_iso(),
               "lanes": [], "waits": [], "asks": [], "grants": []}
        stream = os.path.join(os.path.realpath(rd), "w.jsonl")  # recorded through the real path
        write_jsonl(stream, [{"type": "result", "subtype": "success", "result": "FINAL REPORT"}])
        board.add_lane(run, {"id": "W", "output": stream, "state": "done"})
        archive = board.close_run(rd, run)
        self.assertTrue(board.load_run(archive)["lanes"][0]["output"].startswith(archive))
        self.assertEqual(board.lane_result(board.load_run(archive), board.load_run(archive)["lanes"][0]), "FINAL REPORT")

    def test_ending_a_lane_refreshes_the_open_board(self):
        _, text, _ = self.run_cli("init", "--objective", "o", "--run-id", "s1")
        rd = text.strip()
        self.run_cli("--run", rd, "lane", "add", "--id", "L", "--title", "卡片", "--state", "working")
        self.run_cli("--run", rd, "lane", "set", "--id", "L", "--state", "done")
        page = open(board.board_path(rd), encoding="utf-8").read()
        self.assertNotIn('class="pill working"', page)

    def test_unchanged_streams_are_parsed_once_per_change(self):
        path = os.path.join(self.root, "big.jsonl")
        write_jsonl(path, [{"type": "assistant"}])
        with mock.patch.object(board, "_read_tail", wraps=board._read_tail) as parse:
            board.read_tail(path)
            board.read_tail(path)
            self.assertEqual(parse.call_count, 1)
            with open(path, "a", encoding="utf-8") as f:
                f.write('{"type": "result"}\n')
            board.read_tail(path)
            self.assertEqual(parse.call_count, 2)

    def test_relative_streams_and_logs_live_in_the_run_dir(self):
        _, text, _ = self.run_cli("init", "--objective", "o", "--run-id", "relout")
        rd = text.strip()
        self.run_cli("--run", rd, "lane", "add", "--id", "B9", "--output", "B9.jsonl")
        self.run_cli("--run", rd, "lane", "set", "--id", "B9", "--round", "2", "--output", "B9-2.jsonl")
        self.run_cli("--run", rd, "wait", "add", "--id", "W", "--log", "deploy.log")
        run = board.load_run(rd)
        self.assertEqual(run["lanes"][0]["output"], os.path.join(rd, "B9-2.jsonl"))  # not the shell's cwd
        self.assertEqual(run["waits"][0]["log"], os.path.join(rd, "deploy.log"))
