#!/usr/bin/env python3
"""Tests for the agent-dispatch Run ledger and Board.

Event lines are trimmed from real runs on 2026-10-19: Claude Code 2.1.301
(stream-json), codex-cli 0.163.0 (exec --json) and Grok Build (streaming-json).
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock
from unittest.mock import patch
from pathlib import Path

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import dispatch_board as board
from isolated_case import REAL_HOME, IsolatedTestCase, is_under

CLAUDE = [
    {"type": "system", "subtype": "init"},
    {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "ls skills/agent-dispatch", "description": "List skill files"}}]}},
    {"type": "user", "message": {"content": [{"type": "tool_result", "content": "SKILL.md"}]}},
    {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Agent", "input": {"subagent_type": "Explore", "description": "find tests"}}]}},
]
CLAUDE_RESULT = {"type": "result", "subtype": "success", "is_error": False, "total_cost_usd": 1.1455394, "num_turns": 2}

CODEX = [
    {"type": "thread.started", "thread_id": "01a15409"},
    {"type": "item.completed", "item": {"id": "item_0", "type": "error", "message": "Under-development features enabled: chronicle."}},
    {"type": "turn.started"},
    {"type": "item.started", "item": {"id": "item_1", "type": "command_execution", "command": "/bin/zsh -lc 'ls skills/agent-dispatch'", "status": "in_progress"}},
]
CODEX_DONE = [
    {"type": "item.completed", "item": {"id": "item_2", "type": "agent_message", "text": "5"}},
    {"type": "turn.completed", "usage": {"input_tokens": 52901, "output_tokens": 43}},
]
CODEX_LEGACY = [{"type": "item.completed", "item": {"id": "item_2", "item_type": "assistant_message", "text": "legacy shape"}}]

GROK = [
    {"type": "thought", "data": "Running `ls skills/agent-dispatch`"},
    {"type": "tool_call", "toolCallId": "call-1", "title": "run_terminal_command", "kind": "execute", "status": "pending", "toolName": "run_terminal_command", "rawInput": {"command": "ls skills/agent-dispatch"}},
    {"type": "text", "data": "里有"},
    {"type": "text", "data": " 5 个条目"},
]
GROK_END = {"type": "end", "stopReason": "end_turn", "sessionId": "01a1540b"}


def write_jsonl(path: str, events: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
        f.write("not json, e.g. a stderr line\n")


class TestIsolation(IsolatedTestCase):
    def test_state_dir_is_never_the_real_home(self):
        self.assertFalse(is_under(board.state_dir(), REAL_HOME))
        for key in ("AGENT_DISPATCH_STATE_DIR",):
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop(key)
                self.assertFalse(is_under(board.state_dir(), REAL_HOME), "XDG_STATE_HOME fallback")
                os.environ.pop("XDG_STATE_HOME")
                self.assertFalse(is_under(board.state_dir(), REAL_HOME), "HOME fallback")

    def test_every_test_class_is_isolated(self):
        import test_probe_agents
        for module in (sys.modules[__name__], test_probe_agents):
            for name, value in vars(module).items():
                if isinstance(value, type) and issubclass(value, unittest.TestCase) and value is not unittest.TestCase:
                    self.assertTrue(issubclass(value, IsolatedTestCase), f"{module.__name__}.{name} must extend IsolatedTestCase")


class BoardTestCase(IsolatedTestCase):
    def setUp(self) -> None:
        super().setUp()
        detection = mock.patch("dispatch_board.detect_coordinator", return_value=None)
        detection.start()
        self.addCleanup(detection.stop)
        session_patch = mock.patch.object(board.SESSION_READER, "read", return_value=None)
        session_patch.start()
        self.addCleanup(session_patch.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        env = mock.patch.dict(os.environ, {"AGENT_DISPATCH_STATE_DIR": os.path.join(self.root, "state")}, clear=False)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("AGENT_DISPATCH_RUN", None)
        self.plain = os.path.join(self.root, "plain")
        os.makedirs(self.plain)

    def run_cli(self, *argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err), mock.patch("os.getcwd", return_value=self.plain):
            code = board.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def new_run(self, **kwargs) -> tuple[str, dict]:
        run_dir = board.init_run("demo", self.plain, run_id="r1", now=1_000_000.0, **kwargs)
        return run_dir, board.load_run(run_dir)


class TestEventStreams(BoardTestCase):
    def test_claude_activity_subagents_and_result(self):
        info = board.summarize_events(CLAUDE)
        self.assertEqual(info["activity"], "Agent: find tests")
        self.assertEqual(info["subagents"], ["Explore"])
        self.assertFalse(info["ended"])
        info = board.summarize_events(CLAUDE + [CLAUDE_RESULT])
        self.assertTrue(info["ended"])
        self.assertFalse(info["failed"])
        self.assertAlmostEqual(info["cost"], 1.1455394)

    def test_claude_error_result_is_failure(self):
        info = board.summarize_events([{"type": "result", "subtype": "error_max_turns", "is_error": True}])
        self.assertTrue(info["ended"] and info["failed"])

    def test_codex_error_item_is_not_failure(self):
        info = board.summarize_events(CODEX)
        self.assertEqual(info["activity"], "运行了命令：/bin/zsh -lc 'ls skills/agent-dispatch'")
        self.assertFalse(info["ended"])
        self.assertFalse(info["failed"])
        info = board.summarize_events(CODEX + CODEX_DONE)
        self.assertTrue(info["ended"])
        self.assertFalse(info["failed"])
        self.assertEqual(info["activity"], "AI 说：5")

    def test_codex_legacy_shape_and_turn_failed(self):
        self.assertEqual(board.summarize_events(CODEX_LEGACY)["activity"], "AI 说：legacy shape")
        info = board.summarize_events([{"type": "turn.failed", "error": {"message": "boom"}}])
        self.assertTrue(info["ended"] and info["failed"])

    def test_grok_tool_text_and_end(self):
        info = board.summarize_events(GROK)
        self.assertEqual(info["activity"], "AI 说：里有 5 个条目")
        info = board.summarize_events(GROK[:2])
        self.assertEqual(info["activity"], "run_terminal_command: ls skills/agent-dispatch")
        info = board.summarize_events(GROK + [GROK_END])
        self.assertTrue(info["ended"])
        self.assertFalse(info["failed"])
        self.assertTrue(board.summarize_events([{"type": "end", "stopReason": "cancelled"}])["failed"])

    def test_activity_is_first_plain_line(self):
        text = "共 **1,676 行**，未修改任何文件。\n\n| 文件 | 行数 |\n| --- | ---: |"
        info = board.summarize_events([{"type": "item.completed", "item": {"type": "agent_message", "text": text}}])
        self.assertEqual(info["activity"], "AI 说：共 1,676 行，未修改任何文件。")
        self.assertEqual(board.short("| a | b |\n| --- |\n- 第二行"), "第二行")

    def test_wait_shows_last_log_line(self):
        _, run = self.new_run()
        log = os.path.join(self.root, "build.log")
        with open(log, "w", encoding="utf-8") as f:
            f.write("step 1\nstep 2\n\n")
        board.add_wait(run, {"id": "build", "title": "构建", "log": log})
        wait = board.derive(run)["waits"][0]
        self.assertEqual(wait["last_line"], "step 2")
        self.assertIn("最新一行输出：step 2", board.render_text(board.derive(run)))
        self.assertEqual(board.tail_path("/a/b/c/d.log"), "…/c/d.log")

    def test_read_tail_skips_non_json_lines(self):
        path = os.path.join(self.root, "w.jsonl")
        write_jsonl(path, CODEX)
        self.assertEqual(len(board.read_tail(path)), len(CODEX))
        self.assertEqual(board.read_tail(os.path.join(self.root, "missing.jsonl")), [])


class TestDerivedState(BoardTestCase):
    def test_stale_only_when_working_and_silent_past_five_minutes(self):
        run_dir, run = self.new_run()
        out = os.path.join(self.root, "a.jsonl")
        write_jsonl(out, CODEX)
        os.utime(out, (1_000_000.0, 1_000_000.0))
        board.add_lane(run, {"id": "A", "state": "working", "output": out}, now=1_000_000.0)
        self.assertFalse(board.derive(run, now=1_000_000.0 + 299)["lanes"][0]["stale"])
        lane = board.derive(run, now=1_000_000.0 + 300)["lanes"][0]
        self.assertTrue(lane["stale"])
        self.assertIn("5 分钟没新进展，主控 AI 会去催问", lane["flags"])
        board.set_lane(run, "A", {"state": "needs-you"})
        self.assertFalse(board.derive(run, now=1_000_000.0 + 3600)["lanes"][0]["stale"])

    def test_ended_stream_is_not_stale_and_flags_integration(self):
        _, run = self.new_run()
        out = os.path.join(self.root, "a.jsonl")
        write_jsonl(out, CODEX + CODEX_DONE)
        os.utime(out, (1_000_000.0, 1_000_000.0))
        board.add_lane(run, {"id": "A", "state": "working", "output": out}, now=1_000_000.0)
        lane = board.derive(run, now=1_000_000.0 + 3600)["lanes"][0]
        self.assertFalse(lane["stale"])
        self.assertIn("这部分做完了，等主控 AI 汇总验收", lane["flags"])

    def test_finished_lane_prefers_coordinator_note(self):
        _, run = self.new_run()
        out = os.path.join(self.root, "a.jsonl")
        write_jsonl(out, CODEX + CODEX_DONE)
        board.add_lane(run, {"id": "A", "state": "done", "output": out, "note": "集成：共 5 个"})
        lane = board.derive(run)["lanes"][0]
        self.assertEqual((lane["activity_label"], lane["activity"]), ("结果", "集成：共 5 个"))
        self.assertIn('<span class="now-label">做出了什么</span>集成：共 5 个', board.render_html(board.derive(run)))

    def test_lane_without_output_uses_ledger_time(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "S", "kind": "subagent", "parent": "coordinator", "state": "working"}, now=1_000_000.0)
        self.assertTrue(board.derive(run, now=1_000_000.0 + 400)["lanes"][0]["stale"])

    def test_reviewer_on_writer_pool_is_flagged(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "W", "role": "write", "pool": "claude:002", "state": "done"})
        board.add_lane(run, {"id": "R", "role": "review", "pool": "claude:002", "reviews": "W", "state": "working"})
        board.add_lane(run, {"id": "R2", "role": "review", "pool": "codex:002", "reviews": "W", "state": "working"})
        lanes = {l["id"]: l for l in board.derive(run)["lanes"]}
        self.assertIn("写代码和审代码用了同一个账号，自己审自己可能漏看问题", lanes["R"]["flags"])
        self.assertNotIn("写代码和审代码用了同一个账号，自己审自己可能漏看问题", lanes["R2"]["flags"])

    def test_orca_exited_worker_is_flagged(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "state": "working", "dispatch": "ctx_1"})
        view = board.derive(run, orca={"ctx_1": {"liveness": "exited", "activity": "idle"}})
        self.assertIn("这个 AI 窗口已关闭（Orca 进程退出），主控 AI 会接手检查", view["lanes"][0]["flags"])

    def test_state_line_counts_running_waits_and_open_asks(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "state": "working"})
        board.add_lane(run, {"id": "B", "state": "done"})
        board.add_wait(run, {"id": "deploy", "title": "部署 test"})
        board.add_wait(run, {"id": "ci", "title": "CI", "state": "done"})
        board.add_ask(run, {"id": "A1", "question": "部署吗？", "recommend": "是", "evidence": "diff", "blocks": "WP6"})
        view = board.derive(run)
        self.assertEqual(board.state_line(view, "/x/board.html"), "正在忙：1 个任务在做 · 1 项等外部结果 · 1 个问题等你答复 · 看板文件：/x/board.html")
        board.set_lane(run, "A", {"state": "done"})
        board.set_wait(run, "deploy", {"state": "done"})
        board.answer_ask(run, "A1", "是")
        self.assertTrue(board.state_line(board.derive(run)).startswith("目前没有正在跑的任务"))


class TestLedgerRules(BoardTestCase):
    def test_ask_requires_recommendation_evidence_and_blocks(self):
        _, run = self.new_run()
        with self.assertRaises(board.BoardError) as ctx:
            board.add_ask(run, {"id": "A1", "question": "部署吗？"})
        self.assertIn("--recommend --evidence --blocks", str(ctx.exception))

    def test_outward_ask_requires_recipient_channel_and_draft(self):
        _, run = self.new_run()
        base = {"id": "A2", "question": "发群消息吗？", "recommend": "发", "evidence": "WP5 已完成", "blocks": "联调", "outward": True}
        with self.assertRaises(board.BoardError) as ctx:
            board.add_ask(run, dict(base))
        self.assertIn("--recipient --channel --draft", str(ctx.exception))
        ask = board.add_ask(run, dict(base, recipient="前端群", channel="飞书", draft="大家好，WP5 已上 test。"))
        self.assertEqual(ask["state"], "open")

    def test_outward_grant_lasts_only_this_run(self):
        _, run = self.new_run()
        g1 = board.add_grant(run, "部署到 test，按同样流程", "以后都按照推荐的来改吧", outward=True)
        g2 = board.add_grant(run, "代码风格按推荐改", "以后都按推荐", outward=False)
        self.assertEqual((g1["id"], g1["lasts"]), ("G1", "this Run"))
        self.assertEqual((g2["id"], g2["lasts"]), ("G2", "until the user withdraws it"))

    def test_lane_rules(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A"})
        with self.assertRaises(board.BoardError):
            board.add_lane(run, {"id": "A"})
        with self.assertRaises(board.BoardError):
            board.add_lane(run, {"id": "S", "kind": "subagent"})
        with self.assertRaises(board.BoardError):
            board.set_lane(run, "A", {"state": "almost"})
        with self.assertRaises(board.BoardError):
            board.set_lane(run, "missing", {"state": "done"})

    def test_outside_git_uses_state_dir_and_registry(self):
        run_dir, run = self.new_run()
        self.assertTrue(run_dir.startswith(os.path.join(self.root, "state", "runs")))
        self.assertEqual([r["id"] for r in board.load_registry()], ["r1"])
        archive = board.close_run(run_dir, run)
        self.assertFalse(os.path.exists(run_dir))
        self.assertTrue(os.path.exists(os.path.join(archive, "run.json")))
        self.assertEqual(board.load_registry()[0]["state"], "closed")
        self.assertEqual(board.render_all(board.load_registry()), "现在没有正在跑的任务；派活后这里会显示进度。\n")

    def test_inside_git_uses_repo_dir_and_info_exclude(self):
        repo = os.path.join(self.root, "repo")
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        run_dir = board.init_run("demo", repo, run_id="g1")
        top = board.git(repo, "rev-parse", "--show-toplevel")
        self.assertEqual(run_dir, os.path.join(top, ".agent-dispatch", "runs", "g1"))
        with open(os.path.join(repo, ".git", "info", "exclude"), encoding="utf-8") as f:
            self.assertEqual(f.read().splitlines().count("/.agent-dispatch/"), 1)
        board.init_run("again", repo, run_id="g2")
        with open(os.path.join(repo, ".git", "info", "exclude"), encoding="utf-8") as f:
            self.assertEqual(f.read().splitlines().count("/.agent-dispatch/"), 1)
        status = subprocess.run(["git", "-C", repo, "status", "--short"], capture_output=True, text=True).stdout
        self.assertEqual(status, "")


class TestRenderAndCli(BoardTestCase):
    def test_cli_round_trip_writes_html(self):
        code, run_dir, _ = self.run_cli("init", "--objective", "演示 <b>", "--run-id", "cli")
        run_dir = run_dir.strip()
        self.assertEqual(code, 0)
        out = os.path.join(self.root, "lane.jsonl")
        write_jsonl(out, CLAUDE)
        self.assertEqual(self.run_cli("lane", "add", "--id", "B9", "--title", "B9 卡片", "--role", "write", "--account", "cc003", "--state", "working", "--output", out)[0], 0)
        self.assertEqual(self.run_cli("wait", "add", "--id", "deploy", "--title", "部署 test", "--stage", "web 构建中")[0], 0)
        code, _, err = self.run_cli("ask", "add", "--id", "A1", "--question", "部署吗？")
        self.assertEqual(code, 2)
        self.assertIn("--recommend", err)
        self.run_cli("ask", "add", "--id", "A1", "--question", "部署吗？", "--recommend", "是", "--evidence", "同样流程", "--blocks", "WP6")
        self.run_cli("grant", "add", "--scope", "部署到 test", "--words", "以后都按推荐", "--outward")
        code, text, _ = self.run_cli("show", "--html")
        self.assertEqual(code, 0)
        self.assertIn("B9 卡片 · 正在改代码 · cc003", text)
        self.assertIn("正在：Agent: find tests", text)
        self.assertIn("含 1 个小任务", text)
        self.assertIn("部署 test  当前第几步：web 构建中", text)
        self.assertIn("AI 建议：是", text)
        self.assertIn("（本 Run）", text)
        page_path = os.path.join(self.root, "state", "boards", "cli.html")
        with open(page_path, encoding="utf-8") as f:
            page = f.read()
        self.assertIn("演示 &lt;b&gt;", page)
        self.assertNotIn("演示 <b>", page)
        self.run_cli("ask", "answer", "--id", "A1", "--answer", "按推荐")
        with open(page_path, encoding="utf-8") as f:
            self.assertNotIn("A1 部署吗？", f.read())
        self.run_cli("ask", "add", "--id", "A1b", "--question", "部署吗？", "--recommend", "是", "--evidence", "同样流程", "--blocks", "WP6")
        code, line, _ = self.run_cli("show", "--line")
        self.assertEqual(line.strip(), "正在忙：1 个任务在做 · 1 项等外部结果 · 1 个问题等你答复")  # leads a reply: no path
        self.assertEqual(json.loads(self.run_cli("show", "--json")[1])["board"], page_path)
        self.assertIn("cli", self.run_cli("show", "--all")[1])
        code, _, err = self.run_cli("close")  # an open question or running wait blocks the close
        self.assertNotEqual(code, 0)
        self.assertIn("A1b", err)
        self.assertEqual(self.run_cli("close", "--force")[0], 0)
        self.assertIn("现在没有正在跑的任务", self.run_cli("show", "--all")[1])
        with open(page_path, encoding="utf-8") as f:
            closed = f.read()
        self.assertIn("已结束", closed)
        self.assertNotIn('http-equiv="refresh"', closed)

    def test_missing_run_is_an_error_and_stop_pauses_dispatch(self):
        code, _, err = self.run_cli("--run", os.path.join(self.root, "nope"), "show")
        self.assertEqual(code, 2)
        self.assertIn("no ledger", err)
        _, run_dir, _ = self.run_cli("init", "--objective", "s", "--run-id", "s")
        run_dir = run_dir.strip()
        self.run_cli("--run", run_dir, "lane", "add", "--id", "A", "--title", "A 写", "--state", "working")
        open(os.path.join(run_dir, "STOP"), "w").close()
        code, _, err = self.run_cli("--run", run_dir, "lane", "add", "--id", "X")
        self.assertEqual(code, 2)
        self.assertIn("no new Lane", err)
        code, out, _ = self.run_cli("--run", run_dir, "show", "--html", "--line")
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("正在叫停：不再派新活，正等 1 个任务"), out)
        self.run_cli("--run", run_dir, "lane", "set", "--id", "A", "--summary", "paused")
        with open(os.path.join(self.root, "state", "boards", "s.html"), encoding="utf-8") as f:
            page = f.read()
        self.assertIn("已叫停", page)
        self.assertIn("A 写", page)  # still-running work stays visible after 停

    def test_cli_needs_explicit_run_when_several_are_active(self):
        self.run_cli("init", "--objective", "a", "--run-id", "a")
        self.run_cli("init", "--objective", "b", "--run-id", "b")
        code, _, err = self.run_cli("show")
        self.assertEqual(code, 2)
        self.assertIn("pass --run <dir>", err)



class TestReviewFindings(BoardTestCase):
    """Regression tests for the cross-model review of 2026-10-19."""

    def test_run_id_cannot_escape_or_be_reused(self):
        for bad in ("/outside", "../../escape", "x/y", ".hidden", "-x", "a b"):
            with self.assertRaises(board.BoardError, msg=bad):
                board.init_run("demo", self.plain, run_id=bad)
        self.assertFalse(os.path.exists(os.path.join(self.root, "escape")))
        run_dir = board.init_run("demo", self.plain, run_id="r1")
        board.close_run(run_dir, board.load_run(run_dir))
        with self.assertRaises(board.BoardError) as ctx:
            board.init_run("again", self.plain, run_id="r1")
        self.assertIn("already used", str(ctx.exception))

    def test_default_ids_do_not_collide(self):
        a = board.init_run("a", self.plain, now=1_000_000.0)
        b = board.init_run("b", self.plain, now=1_000_000.0)
        self.assertNotEqual(a, b)

    def test_a_run_id_is_not_reused_in_another_base(self):
        board.init_run("a", self.plain, run_id="same")
        repo = os.path.join(self.root, "repo")
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        with self.assertRaisesRegex(board.BoardError, "already used"):  # both would write boards/same.html
            board.init_run("b", repo, run_id="same")
        self.assertEqual([r["objective"] for r in board.load_registry()], ["a"])

    def test_every_ledger_field_is_escaped(self):
        _, run = self.new_run()
        evil = "<img src=x onerror=alert(1)>"
        board.add_lane(run, {"id": "A", "title": evil, "account": evil, "branch": evil, "state": "working", "note": evil})
        run["lanes"][0]["round"] = evil  # a hand-edited ledger bypasses the CLI's int check
        board.add_wait(run, {"id": "W", "title": evil, "stage": evil, "after": "A"})
        board.add_ask(run, {"id": evil, "question": evil, "recommend": evil, "evidence": evil, "blocks": evil, "outward": True, "recipient": evil, "channel": evil, "draft": evil})
        board.add_grant(run, evil, evil, outward=True)
        page = board.render_html(board.derive(run))
        self.assertNotIn("<img", page)
        self.assertIn("第 1 次（最多 3 次）", page)

    def test_orca_activity_fills_in_without_event_stream(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "state": "working", "dispatch": "ctx_1"}, now=1_000_000.0)
        orca = {"ctx_1": {"liveness": "live", "activity": "working", "observed_at": 1_000_590.0}}
        lane = board.derive(run, now=1_000_600.0, orca=orca)["lanes"][0]
        self.assertEqual(lane["activity"], "Orca：working（live）")
        self.assertFalse(lane["stale"])

    def test_resumed_stream_clears_end(self):
        resumed = CODEX + CODEX_DONE + [{"type": "turn.started"}, CODEX[3]]
        info = board.summarize_events(resumed)
        self.assertFalse(info["ended"])
        self.assertFalse(board.summarize_events(CLAUDE + [CLAUDE_RESULT] + CLAUDE[1:2])["ended"])
        grok = board.summarize_events(GROK + [GROK_END] + GROK[1:2])
        self.assertFalse(grok["ended"])

    def test_malformed_events_are_skipped(self):
        bad = [
            {"type": "assistant", "message": {"content": ["bad"]}},
            {"type": "assistant", "message": "bad"},
            {"type": "item.started", "item": "bad"},
            {"type": "item.completed", "item": {"type": "file_change", "changes": "bad"}},
            {"type": "tool_call", "rawInput": "bad"},
            {"type": "result"},
        ]
        info = board.summarize_events(bad)
        self.assertFalse(info["ended"])
        path = os.path.join(self.root, "bad.jsonl")
        with open(path, "wb") as f:
            f.write(b"[1,2]\n\xff\xfe not utf8\n" + json.dumps(CODEX[3]).encode() + b"\n")
        self.assertEqual(len(board.read_tail(path)), 1)

    def test_long_final_event_is_kept(self):
        path = os.path.join(self.root, "long.jsonl")
        write_jsonl(path, CLAUDE + [dict(CLAUDE_RESULT, result="x" * 300_000)])
        self.assertTrue(board.summarize_events(board.read_tail(path))["ended"])

    def test_relative_paths_are_stored_absolute(self):
        _, run = self.new_run()
        old = os.getcwd()
        os.chdir(self.plain)
        try:
            board.add_lane(run, {"id": "A", "output": "lane.jsonl"})
            board.add_wait(run, {"id": "W", "log": "build.log"})
        finally:
            os.chdir(old)
        for path, name in ((run["lanes"][0]["output"], "lane.jsonl"), (run["waits"][0]["log"], "build.log")):
            self.assertTrue(os.path.isabs(path))
            self.assertEqual(os.path.realpath(path), os.path.join(os.path.realpath(self.plain), name))

    def test_after_shows_what_a_step_waits_on(self):
        _, run = self.new_run()
        board.add_wait(run, {"id": "deploy", "title": "部署 test"})
        board.add_lane(run, {"id": "R", "title": "联调", "state": "queued", "after": "deploy, A"})
        view = board.derive(run)
        lane = [l for l in view["lanes"] if l["id"] == "R"][0]
        self.assertEqual(lane["waiting_on"], ["部署 test", "A"])
        self.assertIn("正等着：部署 test、A", board.render_text(view))
        board.set_wait(run, "deploy", {"state": "done"})
        lane = [l for l in board.derive(run)["lanes"] if l["id"] == "R"][0]
        self.assertEqual(lane["waiting_on"], ["A"])

    def test_subagents_render_under_their_parent(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "title": "A", "state": "working"})
        board.add_lane(run, {"id": "B", "title": "B", "state": "working"})
        board.add_lane(run, {"id": "S", "title": "S", "kind": "subagent", "parent": "A", "state": "working"})
        board.add_lane(run, {"id": "C", "title": "C", "kind": "subagent", "parent": "coordinator", "state": "working"})
        self.assertEqual([l["id"] for l in board.derive(run)["lanes"]], ["A", "S", "B", "C"])

    def test_role_and_account_are_not_repeated(self):
        self.assertEqual(board.lane_name({"id": "x", "title": "看板 · 审", "role": "review", "account": "codex:002"}), "看板 · 审 · codex:002")

    def test_new_working_lane_says_starting(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "state": "working", "output": os.path.join(self.root, "none.jsonl")})
        self.assertEqual(board.derive(run)["lanes"][0]["activity"], "AI 刚接手，正在准备，几十秒后会有动静")

    def test_corrupt_ledger_says_how_to_fix(self):
        run_dir, _ = self.new_run()
        with open(os.path.join(run_dir, "run.json"), "w", encoding="utf-8") as f:
            f.write("{")
        with self.assertRaises(board.BoardError) as ctx:
            board.load_run(run_dir)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_linked_worktree_shares_the_exclude_line(self):
        repo = os.path.join(self.root, "main")
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        subprocess.run(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], check=True)
        wt = os.path.join(self.root, "wt")
        subprocess.run(["git", "-C", repo, "worktree", "add", "-q", wt], check=True)
        board.init_run("in worktree", wt, run_id="w1")
        with open(os.path.join(repo, ".git", "info", "exclude"), encoding="utf-8") as f:
            self.assertIn("/.agent-dispatch/", f.read().splitlines())
        self.assertEqual(subprocess.run(["git", "-C", wt, "status", "--short"], capture_output=True, text=True).stdout, "")


class TestReviewRound2(BoardTestCase):
    """Regression tests for review round 2 (interleavings the first fixes missed)."""

    def test_concurrent_registrations_are_all_kept(self):
        import multiprocessing as mp
        ctx = mp.get_context("fork")
        procs = [ctx.Process(target=board.register, args=({"id": f"r{i}", "objective": str(i), "state": "active"}, os.path.join(self.root, f"d{i}"))) for i in range(12)]
        for proc in procs:
            proc.start()
        for proc in procs:
            proc.join()
        self.assertEqual(len(board.load_registry()), 12)

    def test_close_moves_event_paths_with_the_run(self):
        run_dir, run = self.new_run()
        out = os.path.join(run_dir, "A.jsonl")
        write_jsonl(out, CLAUDE + [CLAUDE_RESULT])
        board.add_lane(run, {"id": "A", "state": "done", "output": out})
        board.add_wait(run, {"id": "W", "state": "done", "log": os.path.join(self.root, "outside.log")})
        archive = board.close_run(run_dir, run)
        closed = board.load_run(archive)
        self.assertEqual(closed["lanes"][0]["output"], os.path.join(archive, "A.jsonl"))
        self.assertEqual(closed["waits"][0]["log"], os.path.join(self.root, "outside.log"))
        lane = board.derive(closed)["lanes"][0]
        self.assertAlmostEqual(lane["cost"], 1.1455394)

    def test_closed_ledger_read_before_the_move_keeps_the_final_page(self):
        run_dir, run = self.new_run()
        out = os.path.join(run_dir, "A.jsonl")
        write_jsonl(out, CLAUDE + [CLAUDE_RESULT])
        board.add_lane(run, {"id": "A", "state": "done", "output": out})
        board.save_run(run_dir, run)
        args = board.build_parser().parse_args(["show", "--html"])
        real_save = board.save_run
        seen = {}

        def save_then_race(rd, r, now=None):
            real_save(rd, r, now)
            if r.get("state") == "closed":
                with redirect_stdout(io.StringIO()):
                    seen["active"] = board.show_once(rd, args)  # a reader sees the closed ledger before the move

        with redirect_stdout(io.StringIO()):
            board.show_once(run_dir, args)
        with mock.patch.object(board, "save_run", side_effect=save_then_race):
            archive = board.close_run(run_dir, board.load_run(run_dir))
        self.assertFalse(seen["active"])
        with open(board.board_path(run_dir), encoding="utf-8") as f:
            page = f.read()
        self.assertNotIn('http-equiv="refresh"', page)
        self.assertIn(archive, page)
        self.assertIn("$1.15", page)

    def test_closed_ledger_before_the_move_never_overwrites_the_page(self):
        run_dir, run = self.new_run()
        run["state"] = "closed"  # close wrote the ledger; the move and the final page are still to come
        board.save_run(run_dir, run)
        board.atomic_write(board.board_path(run_dir), "final page from close")
        args = board.build_parser().parse_args(["show", "--html"])
        with redirect_stdout(io.StringIO()):
            self.assertFalse(board.show_once(run_dir, args))
        with open(board.board_path(run_dir), encoding="utf-8") as f:
            self.assertEqual(f.read(), "final page from close")

    def test_huge_final_event_beyond_the_window_is_read(self):
        path = os.path.join(self.root, "huge.jsonl")
        write_jsonl(path, CLAUDE)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(dict(CLAUDE_RESULT, result="x" * 50_000)) + "\n\n")
        events = board.read_tail(path, max_bytes=10_000)
        self.assertTrue(board.summarize_events(events)["ended"])
        for tail in ("\n \n", "warning: not json\n", "\n"):
            with open(path, "a", encoding="utf-8") as f:
                f.write(tail)
            self.assertTrue(board.summarize_events(board.read_tail(path, max_bytes=10_000))["ended"], repr(tail))

    def test_lane_and_wait_ids_share_one_namespace(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "deploy", "state": "done"})
        with self.assertRaises(board.BoardError):
            board.add_wait(run, {"id": "deploy"})
        board.add_wait(run, {"id": "ci"})
        with self.assertRaises(board.BoardError):
            board.add_lane(run, {"id": "ci"})

    def test_subagent_names_its_parent_when_shown_apart(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "title": "A", "state": "done"})
        board.add_lane(run, {"id": "B", "title": "B", "state": "working"})
        board.add_lane(run, {"id": "S", "title": "S", "kind": "subagent", "parent": "A", "state": "working"})
        board.add_lane(run, {"id": "C", "title": "C", "kind": "subagent", "parent": "coordinator", "state": "working"})
        board.add_lane(run, {"id": "T", "title": "T", "kind": "subagent", "parent": "B", "state": "working"})
        view = board.derive(run)
        text = board.render_text(view)
        self.assertIn("└ A 派出的 S", text)
        self.assertIn("└ 主控 AI 派出的 C", text)
        self.assertIn("  └ T", text)
        self.assertNotIn("B 的 T", text)
        self.assertIn("A 派出的 S", board.render_html(view))



class TestNoviceUser(BoardTestCase):
    def test_open_prefers_orca_then_system_browser(self):
        run_dir, _ = self.new_run()
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, stdout='{"ok": true}', stderr="")

        with mock.patch.object(board, "orca_reachable", return_value=True), mock.patch.object(board.subprocess, "run", side_effect=fake_run):
            self.assertEqual(board.open_board(board.board_path(run_dir)), "orca")
        self.assertEqual(calls[0][:3], ["orca", "tab", "list"])
        self.assertEqual(calls[1][:3], ["orca", "tab", "create"])
        self.assertTrue(calls[1][4].startswith("file:///"))
        calls.clear()
        url = board.file_url(board.board_path(run_dir))
        tabs = {"ok": True, "result": {"tabs": [{"browserPageId": "p1", "url": url + "#s=0"}]}}

        def reuse(cmd, **kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(tabs if cmd[1:3] == ["tab", "list"] else {"ok": True}), stderr="")

        with mock.patch.object(board, "orca_reachable", return_value=True), mock.patch.object(board.subprocess, "run", side_effect=reuse):
            self.assertEqual(board.open_board(board.board_path(run_dir)), "orca")
        self.assertEqual(calls[1], ["orca", "goto", "--url", url, "--page", "p1", "--json"])  # reloads the same tab
        self.assertEqual(calls[2][:5], ["orca", "tab", "switch", "--page", "p1"])
        self.assertNotIn("create", [part for cmd in calls for part in cmd])
        calls.clear()
        with mock.patch.object(board, "orca_reachable", return_value=False), mock.patch.object(board.subprocess, "run", side_effect=fake_run), mock.patch.object(board.sys, "platform", "darwin"):
            self.assertEqual(board.open_board("/x/b.html"), "browser")
        self.assertEqual(calls[0], ["open", "/x/b.html"])

    def test_open_reports_failure_instead_of_success(self):
        failed = subprocess.CompletedProcess([], 1, stdout="", stderr="no app")
        with mock.patch.object(board, "orca_reachable", return_value=False), mock.patch.object(board.subprocess, "run", return_value=failed), mock.patch.object(board.sys, "platform", "darwin"):
            self.assertEqual(board.open_board("/x/b.html"), "none")
        orca_err = subprocess.CompletedProcess([], 0, stdout='{"ok": false}', stderr="")
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd[0])
            return orca_err if cmd[0] == "orca" else subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with mock.patch.object(board, "orca_reachable", return_value=True), mock.patch.object(board.subprocess, "run", side_effect=fake_run), mock.patch.object(board.sys, "platform", "darwin"):
            self.assertEqual(board.open_board("/x/b.html"), "browser")
        self.assertEqual(calls, ["orca", "orca", "open"])
        _, run_dir, _ = self.run_cli("init", "--objective", "o", "--run-id", "o")
        with mock.patch.object(board, "open_board", return_value="none"):
            code, out, _ = self.run_cli("--run", run_dir.strip(), "open")
        self.assertEqual(code, 3)
        self.assertIn("别让主人自己找文件", out)

    def test_orca_reachable_reads_the_real_status_shape(self):
        status = {"id": "x", "ok": True, "result": {"app": {"running": True}, "runtime": {"state": "ready", "reachable": True}}}
        done = subprocess.CompletedProcess([], 0, stdout=json.dumps(status), stderr="")
        with mock.patch.object(board.shutil, "which", return_value="/bin/orca"), mock.patch.object(board.subprocess, "run", return_value=done):
            self.assertTrue(board.orca_reachable())
        status["result"]["runtime"]["reachable"] = False
        done = subprocess.CompletedProcess([], 0, stdout=json.dumps(status), stderr="")
        with mock.patch.object(board.shutil, "which", return_value="/bin/orca"), mock.patch.object(board.subprocess, "run", return_value=done):
            self.assertFalse(board.orca_reachable())

    def test_page_speaks_plain_words(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "WP6", "title": "WP6 卡片", "state": "queued", "after": "M3b"})
        board.add_lane(run, {"id": "M3b", "title": "M3b 修复", "state": "working"})
        page = board.render_html(board.derive(run))
        self.assertIn("排队中", page)
        self.assertIn("等：M3b 修复", page)
        self.assertIn("如「A1 按推荐」", page)
        self.assertIn("「停」", page)
        for jargon in ("Lane", "Wait</h2>", "quota pool", "pool "):
            self.assertNotIn(jargon, page.split("<main>", 1)[1])


class TestReviewSkillCreator2(BoardTestCase):
    def test_wait_can_be_stopped(self):
        _, run = self.new_run()
        board.add_wait(run, {"id": "deploy", "title": "部署"})
        board.set_wait(run, "deploy", {"state": "stopped"})
        self.assertEqual(board.derive(run)["running_waits"], [])

    def test_relative_paths_resolve_against_the_ledger(self):
        src = os.path.join(SCRIPT_DIR, "..", "fixtures", "run-midrun")
        import shutil
        copy = os.path.join(self.root, "copy")
        shutil.copytree(src, copy)
        old = os.getcwd()
        os.chdir(self.root)
        try:
            view = board.derive(board.load_run(copy))
        finally:
            os.chdir(old)
        lanes = {l["id"]: l for l in view["lanes"]}
        self.assertIn("ChapterEditorSurface.tsx", lanes["B9"]["activity"])
        self.assertEqual(view["waits"][0]["last_line"], "web: building chunk 42/60")
        self.assertNotIn("_dir", json.load(open(os.path.join(copy, "run.json"), encoding="utf-8")))
        run = board.load_run(copy)
        board.save_run(copy, run)
        self.assertNotIn("_dir", json.load(open(os.path.join(copy, "run.json"), encoding="utf-8")))



class TestShortPath(IsolatedTestCase):
    def test_file_name_always_survives(self):
        deep = "/very/long/parent/directory/name/that/keeps/going/packages/web/src/components/ChapterEditorSurface.tsx"
        for limit in (20, 30, 50):
            out = board.short_path(deep, limit)
            self.assertLessEqual(len(out), limit)
            self.assertTrue(out.endswith("ChapterEditorSurface.tsx") or limit <= len("ChapterEditorSurface.tsx") + 1, out)
        self.assertEqual(board.short_path("src/a.ts"), "src/a.ts")
        huge = "/x/" + "N" * 80 + ".tsx"
        self.assertTrue(board.short_path(huge).endswith(".tsx"))
        ev = [{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Edit", "input": {"file_path": deep}}]}}]
        self.assertTrue(board.summarize_events(ev)["activity"].endswith("ChapterEditorSurface.tsx"))




class SessionTests(IsolatedTestCase):
    def test_sessions_cache_and_failures(self):
        from sideby_sessions import SessionReader
        payload = {'schemaVersion': 1, 'sessions': [], 'problems': []}
        runner = mock.Mock(return_value=mock.Mock(returncode=0, stdout=json.dumps(payload)))
        reader = SessionReader(runner)
        self.assertEqual(reader.read(now=0), payload)
        reader.read(now=14)
        self.assertEqual(runner.call_count, 1)
        reader.read(now=15)
        self.assertEqual(runner.call_count, 2)
        for result in ['no json', '[]', '{"schemaVersion":1,"sessions":[{}]}']:
            self.assertIsNone(SessionReader(mock.Mock(return_value=mock.Mock(returncode=0, stdout=result))).read())
        for error in [FileNotFoundError(), subprocess.TimeoutExpired('sideby', 5)]:
            self.assertIsNone(SessionReader(mock.Mock(side_effect=error)).read())

    def test_mapping_and_copy(self):
        run = {'id': 'test', 'objective': 'test', 'state': 'active', 'lanes': [{'id': 'L', 'title': 'Work', 'state': 'working', 'session': 'abcdef123', 'account': 'claude:002'}], 'waits': [], 'asks': [], 'grants': []}
        session = {'sessionId': 'abcdef123', 'label': 'cc002 · Work · abcdef12', 'status': 'needs-you', 'resumeCommand': 'sideby resume abcdef123'}
        view = board.derive(run, sessions={'sessions': [session]})
        self.assertEqual(view['lanes'][0]['state'], 'needs-you')
        page = board.render_html(view)
        self.assertIn("execCommand('copy')", page)
        self.assertIn('等你回答', page)
        for duplicate in ['复制给主控 AI', '复制对话编号', '复制恢复命令', 'sideby resume']:
            self.assertNotIn(duplicate, page)  # the Panel owns live sessions
        with mock.patch.object(board, 'read_tail', return_value=[{'type':'result','subtype':'success','session_id':'abcdef123'}]):
            run['lanes'][0]['output'] = 'missing'
            session['status'] = 'idle'
            view = board.derive(run, sessions={'sessions':[session]})
            self.assertEqual(view['lanes'][0]['state'], 'finished')
            self.assertIn('等主控 AI 汇总验收', view['lanes'][0]['flags'][0])

class SessionIntegrationTests(BoardTestCase):
    def test_ledger_command_persists_result_session(self):
        run_dir = board.init_run("test", self.tmp.name, "session-persist")
        run = board.load_run(run_dir)
        board.add_lane(run, {"id":"L", "state":"working", "output":os.path.join(run_dir,"L.jsonl")})
        board.save_run(run_dir, run)
        write_jsonl(os.path.join(run_dir,"L.jsonl"), [{"type":"result","session_id":"persist-me"}])
        with redirect_stdout(io.StringIO()):
            self.run_cli("--run", run_dir, "lane", "set", "--id", "L", "--note", "learn")
        self.assertEqual(board.load_run(run_dir)["lanes"][0]["session"], "persist-me")

    def test_status_fallback_and_busy_overrides_old_end(self):
        run = {"id":"test", "objective":"test", "state":"active", "lanes":[{"id":"L", "state":"working", "session":"s", "updated_at":"2020-01-01T00:00:00Z", "output":"missing"}], "waits":[], "asks":[], "grants":[]}
        for status in ("busy", "idle", "unknown", "needs-you"):
            with self.subTest(status=status), mock.patch.object(board, "read_tail", return_value=[]):
                lane = board.derive(run, sessions={"sessions":[{"sessionId":"s","status":status}]})["lanes"][0]
                self.assertEqual(lane["stale"], status == "unknown")
        with mock.patch.object(board, "read_tail", return_value=[{"type":"result","subtype":"success"}]):
            lane = board.derive(run, sessions={"sessions":[{"sessionId":"s","status":"busy"}]})["lanes"][0]
            self.assertEqual(lane["state"], "working")
            self.assertFalse(lane["flags"])
        with mock.patch.object(board, "read_tail", return_value=[]):
            self.assertTrue(board.derive(run)["lanes"][0]["stale"])

    def test_copy_button_escaping(self):
        button = board.copy_button("copy", '<script>"&')
        self.assertNotIn("<script>", button)
        self.assertIn("&quot;", button)

class FixRoundTests(IsolatedTestCase):
    def test_labels_and_chinese_actions(self):
        fixture = os.path.join(SCRIPT_DIR, "..", "fixtures", "run-sessions")
        run = board.load_run(fixture)
        with open(os.path.join(fixture, "sessions.json")) as f:
            sessions = json.load(f)
        row = sessions["sessions"][0]
        row["accountLabel"] = "cc003"
        row["sessionId"] = "6e9c249d-9a58-427f-bd46-95697fc8897a"
        run["lanes"][0]["session"] = row["sessionId"]
        row.pop("label")
        view = board.derive(run, sessions=sessions)
        self.assertEqual(view["lanes"][0]["session_label"], "cc003 · B9 卡片 · 6e9c249d")
        row["label"] = "custom label"
        self.assertEqual(board.derive(run, sessions=sessions)["lanes"][0]["session_label"], "custom label")
        page = board.render_html(board.derive(run, sessions=sessions))
        self.assertIn(f'data-copy="{run["asks"][0]["id"]}：按推荐办">复制推荐答复</button>', page)
        self.assertIn("复制后粘贴回主控 AI 的对话", page)
        self.assertNotIn("回复状态", page)
        self.assertEqual(page.count("<button"), 2)  # the open Ask's answer and the footer progress, nothing else

    def test_slow_background_read_keeps_last_good(self):
        import threading
        from sideby_sessions import SessionReader
        started, release = threading.Event(), threading.Event()
        payload = {"schemaVersion":1,"sessions":[],"problems":[]}
        def slow(*args, **kwargs):
            self.assertEqual(kwargs["timeout"], 10)
            started.set()
            release.wait(2)
            raise subprocess.TimeoutExpired("sideby",10)
        reader = SessionReader(slow)
        reader.cached = payload
        try:
            self.assertEqual(reader.read(now=0, background=True), payload)
            self.assertTrue(started.wait(1))
            self.assertEqual(reader.read(now=16, background=True), payload)
        finally:
            release.set()
            reader.close()
        self.assertEqual(reader.cached, payload)


class RichBoard(IsolatedTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.run = dict(id='sample', objective='<goal>', state='active', lanes=[], waits=[], asks=[], grants=[], _dir=str(self.root))
        board.add_lane(self.run, dict(id='L', title='任务', state='done'))

    def cli(self, *args):
        (self.root / 'run.json').write_text(json.dumps(self.run))
        with patch.object(board.SESSION_READER, 'read', return_value={}), patch.object(board, 'save_registry'), patch.object(board, 'existing_board', return_value=None):
            self.assertEqual(board.main(['--run', str(self.root), *args]), 0)
        self.run = board.load_run(str(self.root))

    def test_cli_and_render(self):
        self.cli('step', 'add', '--id', 'S1', '--title', '<步骤>', '--state', 'queued')
        self.cli('step', 'set', '--id', 'S1', '--state', 'done', '--note', '好了')
        self.cli('decision', 'add', '--what', '<决定>', '--choice', '本地', '--why', '隐私', '--options', '网络')
        image = self.root / 'a #图.png'
        image.write_bytes(b'png')
        self.cli('artifact', 'add', '--lane', 'L', '--path', str(image), '--label', '<图片>')
        self.cli('artifact', 'add', '--lane', 'L', '--path', str(self.root / 'gone'), '--label', '旧文件')
        self.cli('commit', 'add', '--repo', str(self.root), '--hash', 'abc', '--subject', '<提交>')
        self.cli('lane', 'set', '--id', 'L', '--result', '<成果>\n第二行', '--evidence', '<测试通过>', '--files', 'a.py,board.py', '--round', '2', '--note', '第一轮')
        self.cli('lane', 'set', '--id', 'L', '--round', '3', '--note', '第二轮')
        history = self.run['lanes'][0]['history']
        self.assertEqual([h['note'] for h in history if not h.get('archived')], ['第一轮', '第二轮'])
        self.assertEqual([h['round'] for h in history if h.get('archived')], [1, 2])  # each new round files the old one
        self.assertNotIn('result', self.run['lanes'][0])  # round 3 starts without round 2's result
        page = board.render_html(board.derive(self.run), board_file=str(self.root / 'board.html'))
        for text in ('进度', 'AI 替你拿的主意', '已提交', '做出了什么', '&lt;成果&gt;', '&lt;步骤&gt;', '&lt;测试通过&gt;', '&lt;提交&gt;', '文件已被移走或删除', 'a%20%23', '第一轮', '第二轮'):
            self.assertIn(text, page)
        self.assertNotIn('<成果>', page)
        self.assertIn(board.CHANGED_CLOCK + ' 更新', page)

    def test_results_and_old_ledger(self):
        output = self.root / 'claude.jsonl'
        output.write_text(json.dumps({'type':'result','result':'<final>\n' + '\n'.join(str(i) for i in range(30))}))
        self.run['lanes'][0]['output'] = str(output)
        page = board.render_html(board.derive(self.run))
        self.assertIn('&lt;final&gt;', page)
        self.assertNotIn('\n29', page)
        output = self.root / 'codex.md'
        output.write_text('Codex 最终结果\n第二行')
        self.run['lanes'][0]['output'] = str(output)
        self.assertIn('Codex 最终结果', board.render_html(board.derive(self.run)))
        self.cli('lane','set','--id','L','--result-file',str(output))
        output.unlink()
        self.assertIn('Codex 最终结果', board.render_html(board.derive(self.run)))

    def test_git_files_and_finished_disclosure(self):
        self.run['lanes'][0]['worktree'] = str(self.root)
        with patch.object(board, 'git', return_value=' M changed.py\n?? <new>.py') as git:
            page = board.render_html(board.derive(self.run))
            git.assert_called_with(str(self.root), 'status', '--short')
        self.assertIn('changed.py', page)
        self.assertIn('&lt;new&gt;.py', page)
        self.assertIn('<details class="lane-details" id="details-L">', page)
        self.assertNotIn('<details id="finished-L" open', page)
        self.run['lanes'][0]['files'] = ['explicit.py']
        with patch.object(board, 'git') as git:
            self.assertIn('explicit.py', board.render_html(board.derive(self.run)))
            git.assert_not_called()
        self.run['lanes'][0]['worktree'] = str(self.root / 'gone')
        del self.run['lanes'][0]['files']
        self.assertNotIn('id="produced-L"', board.render_html(board.derive(self.run)))

    def test_bad_cli_is_atomic(self):
        from contextlib import redirect_stderr
        import io
        (self.root / 'run.json').write_text(json.dumps(self.run))
        before = (self.root / 'run.json').read_bytes()
        for argv in [ ['step','add','--id','S'],
                      ['step','set','--id','unknown','--state','done'],
                      ['artifact','add','--lane','unknown','--path','a','--label','a'],
                      ['lane','set','--id','L','--result-file',str(self.root / 'missing')] ]:
            with redirect_stderr(io.StringIO()):
                self.assertEqual(board.main(['--run',str(self.root),*argv]),2)
            self.assertEqual((self.root / 'run.json').read_bytes(),before)

    def test_archive_moves_artifact_paths(self):
        path = self.root / 'image.png'
        path.write_bytes(b'png')
        self.run['artifacts'] = [dict(lane='L',path=str(path),label='预览')]
        archive = str(self.root / 'archived')
        with patch.object(board,'archive_of',return_value=archive), patch.object(board,'save_run'), patch.object(board.shutil,'move'), patch.object(board,'register'), patch.object(board,'write_closed_board'), patch.object(board,'rebuild_index'):
            board.close_run(str(self.root),self.run)
        self.assertEqual(self.run['artifacts'][0]['path'], str(Path(archive)/'image.png'))




class QuietBoardFiles(BoardTestCase):
    """The Board must not disturb a session that once read it: no rewrites for time alone, no file in the repo."""

    def board_run(self):
        run_dir, run = self.new_run()
        board.add_lane(run, {"id": "L", "title": "写功能", "state": "working"}, now=1_000_000.0)
        board.save_run(run_dir, run, now=1_000_000.0)
        return run_dir, board.load_run(run_dir)

    def test_no_rewrite_when_only_time_passes(self):
        run_dir, run = self.board_run()
        path = board.write_board(run_dir, board.derive(run, now=1_000_100.0), now=1_000_100.0)
        first = Path(path).read_text(encoding="utf-8")
        self.assertIn(board.local_time(1_000_100.0)[:5] + " 更新", first)
        self.assertIn('<meta name="board-fingerprint"', first)
        self.assertNotIn(board.CHANGED_CLOCK, first)
        before = os.stat(path).st_mtime_ns
        with mock.patch("time.time", return_value=1_009_000.0):  # hours later, past the silence flag too
            board.write_board(run_dir, board.derive(run, now=1_009_000.0), now=1_009_000.0)
        self.assertEqual(os.stat(path).st_mtime_ns, before)
        self.assertEqual(Path(path).read_text(encoding="utf-8"), first)
        run["lanes"][0]["note"] = "第二步"
        board.write_board(run_dir, board.derive(run, now=1_000_290.0), now=1_000_290.0)
        second = Path(path).read_text(encoding="utf-8")
        self.assertIn("第二步", second)
        self.assertIn(board.local_time(1_000_290.0)[:5] + " 更新", second)

    def test_board_lives_outside_the_repository_and_migrates_once(self):
        repo = os.path.join(self.root, "repo")
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        run_dir = board.init_run("demo", repo, run_id="g1", now=1_000_000.0)
        legacy = os.path.join(repo, ".agent-dispatch", "boards", "g1.html")
        os.makedirs(os.path.dirname(legacy))
        Path(legacy).write_text("<html>old board</html>", encoding="utf-8")
        code, out, err = self.run_cli("--run", run_dir, "lane", "add", "--id", "L", "--title", "写", "--state", "working")
        self.assertEqual(code, 0, err)
        code, out, err = self.run_cli("--run", run_dir, "step", "add", "--id", "S1", "--title", "开工", "--state", "working")
        self.assertEqual(code, 0, err)
        new = os.path.join(self.root, "state", "boards", "g1.html")
        self.assertTrue(os.path.isfile(new))
        self.assertIn(new, out)
        stub = Path(legacy).read_text(encoding="utf-8")
        self.assertIn(board.MOVED_MARK, stub)
        self.assertIn("file://" + new, stub)
        self.assertNotIn("写", stub, "the stub carries no Run content")
        before = os.stat(legacy).st_mtime_ns
        self.run_cli("--run", run_dir, "lane", "set", "--id", "L", "--note", "下一步")
        self.run_cli("--run", run_dir, "show", "--html", "--line")
        self.assertEqual(os.stat(legacy).st_mtime_ns, before, "the stub is written once and never again")
        self.assertEqual(os.listdir(os.path.dirname(legacy)), ["g1.html"])

    def test_new_run_in_repository_writes_nothing_into_it(self):
        repo = os.path.join(self.root, "repo2")
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        run_dir = board.init_run("demo", repo, run_id="g2", now=1_000_000.0)
        self.run_cli("--run", run_dir, "show", "--html", "--line")
        self.assertFalse(os.path.exists(os.path.join(repo, ".agent-dispatch", "boards")))
        self.assertTrue(os.path.isfile(os.path.join(self.root, "state", "boards", "g2.html")))

    def test_summary_file_shows_at_most_twelve_lines(self):
        run_dir, _ = self.board_run()
        summary = os.path.join(self.root, "summary.md")
        Path(summary).write_text("结论：可以复用现成方案。其余见报告。\n" + "\n".join(f"- 第 {i} 条" for i in range(2, 31)), encoding="utf-8")
        report = os.path.join(self.root, "report.md")
        Path(report).write_text("# 完整报告\n\n" + "\n".join(f"| 行 {i} |" for i in range(200)), encoding="utf-8")
        code, _, err = self.run_cli("--run", run_dir, "lane", "set", "--id", "L", "--state", "done", "--summary-file", summary, "--result-file", report)
        self.assertEqual(code, 0, err)
        run = board.load_run(run_dir)
        shown = board.lane_summary(run, run["lanes"][0]).splitlines()
        self.assertEqual(len(shown), board.SUMMARY_LINES)
        page = board.render_html(board.derive(run), reports={"L": "r1.L.report.html"})
        self.assertIn("- 第 12 条", page)
        self.assertNotIn("- 第 13 条", page)
        self.assertNotIn("| 行 0 |", page, "the full report never sits on the Board")
        self.assertIn('<span class="now-label">做出了什么</span>结论：可以复用现成方案。<', page)
        self.assertIn('href="r1.L.report.html"', page)
        self.assertIn("查看完整报告", page)
        self.assertEqual(self.run_cli("--run", run_dir, "lane", "set", "--id", "L", "--summary-file", os.path.join(self.root, "nope"))[0], 2)

    def test_old_ledger_summary_comes_from_the_report_opening(self):
        run = {"id": "old", "lanes": [{"id": "L", "state": "done", "result": "结论：不用从零写。还要补一段。\n\n## Q1 现成方案\n\n| a | b |\n|---|---|"}]}
        self.assertEqual(board.lane_summary(run, run["lanes"][0]), "结论：不用从零写。还要补一段。")
        self.assertEqual(board.first_sentence("**结论**：不用 `从零` 写。还要补。"), "结论：不用 从零 写。")
        self.assertEqual(board.first_sentence("Version 1.2 ships. Next"), "Version 1.2 ships.")
        # the report's machine line is skipped; alone it becomes a plain word
        self.assertEqual(board.first_sentence("OUTCOME: succeeded\n\n主题 102 个色号全部存在。只新增文件"), "主题 102 个色号全部存在。")
        self.assertEqual(board.first_sentence("**OUTCOME:** failed"), "没做完，详见完整报告。")
        self.assertEqual(board.first_sentence("OUTCOME: succeeded"), "已完成。")
        self.assertTrue(board.has_full_report(run, run["lanes"][0]))

    def test_report_page_is_written_once_per_change(self):
        run_dir, run = self.board_run()
        run["lanes"][0]["result"] = "一句话结论。"
        board.write_board(run_dir, board.derive(run), now=1_000_100.0)
        page_path = board.report_path(run_dir, "L")
        self.assertFalse(os.path.exists(page_path), "a report no longer than its summary gets no page")
        run["lanes"][0]["result"] = "## 报告\n\n<script>alert(1)</script>\n\n## 细节\n\n正文"
        board.write_board(run_dir, board.derive(run), now=1_000_100.0)
        page = Path(page_path).read_text(encoding="utf-8")
        self.assertIn("data-md>## 报告", page)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", page)
        self.assertIn('href="r1.html"', page)
        self.assertIn("markdownit", page, "the vendored renderer is inlined, no network")
        self.assertNotIn("sourceMappingURL", page)
        before = os.stat(page_path).st_mtime_ns
        board.write_board(run_dir, board.derive(run), now=1_000_900.0)
        self.assertEqual(os.stat(page_path).st_mtime_ns, before)
        run["lanes"][0]["result"] = "## 报告 v2\n\n## 细节"
        board.write_board(run_dir, board.derive(run), now=1_000_900.0)
        self.assertIn("报告 v2", Path(page_path).read_text(encoding="utf-8"))
        self.assertTrue(board.report_path(run_dir, "a/b").endswith(".report.html"))
        self.assertNotIn("/b", os.path.basename(board.report_path(run_dir, "a/b")))

    def test_header_has_one_freshness_line_and_short_tiles(self):
        run_dir, run = self.board_run()
        run["lanes"][0]["cost"] = 2.65
        board.add_lane(run, {"id": "C", "title": "c", "account": "codex:main", "state": "working"})
        page = Path(board.write_board(run_dir, board.derive(run), now=1_000_100.0)).read_text(encoding="utf-8")
        self.assertEqual(page.count('class="fresh"'), 1)
        self.assertNotIn("秒前", page)
        self.assertIn(f'{board.local_time(1_000_100.0)[:5]} 更新</div>', page)
        self.assertIn('已知花费 $2.65（另有 1 个任务没有报价）', page)
        self.assertIn('title="已统计 1/2 个任务的花费，不含 Codex 花费"', page)
        self.assertNotIn('data-since', page, "a report shows times, it does not count them")
        self.assertIn("开始于 ", page)


class StaticReport(BoardTestCase):
    """The Board is a milestone report: no server, no polling, and written only when its content changes."""

    def setUp(self) -> None:
        super().setUp()
        _, run_dir, _ = self.run_cli("init", "--objective", "汇报", "--run-id", "m1", "--coordinator-session", "coord-1")
        self.run_dir = run_dir.strip()
        self.page = os.path.join(self.root, "state", "boards", "m1.html")

    def cli(self, *args: str) -> None:
        code, _, err = self.run_cli("--run", self.run_dir, *args)
        self.assertEqual(code, 0, err)

    def stamp(self) -> int | None:
        return os.stat(self.page).st_mtime_ns if os.path.exists(self.page) else None

    def test_only_milestone_commands_write_the_page(self):
        self.assertIsNotNone(self.stamp())
        self.cli("lane", "add", "--id", "L", "--title", "写", "--state", "working", "--session", "worker-1")
        quiet = [("lane", "set", "--id", "L", "--note", "在改第二个文件"),
                 ("wait", "add", "--id", "W", "--title", "部署"),
                 ("grant", "add", "--scope", "部署 test", "--words", "随便部署")]
        for args in quiet:
            before = self.stamp()
            self.cli(*args)
            self.assertEqual(self.stamp(), before, args)
        milestones = [("step", "add", "--id", "S1", "--title", "开工", "--state", "working"),
                      ("step", "set", "--id", "S1", "--state", "done"),
                      ("lane", "set", "--id", "L", "--summary", "做完了：卡片改好了。"),
                      ("decision", "add", "--what", "颜色", "--choice", "蓝", "--why", "品牌色"),
                      ("artifact", "add", "--lane", "L", "--path", self.run_dir + "/run.json", "--label", "账本"),
                      ("commit", "add", "--repo", self.root, "--hash", "abc1234", "--subject", "改卡片"),
                      ("ask", "add", "--id", "A1", "--question", "上线吗？", "--recommend", "上", "--evidence", "测过", "--blocks", "发布"),
                      ("ask", "answer", "--id", "A1", "--answer", "按推荐")]
        for args in milestones:
            before = self.stamp()
            self.cli(*args)
            self.assertIsNotNone(self.stamp(), args)
            self.assertNotEqual(self.stamp(), before, args)
        before = self.stamp()
        self.cli("lane", "set", "--id", "L", "--note", "只是备注")  # a note alone is not a milestone
        self.assertEqual(self.stamp(), before)
        self.cli("lane", "set", "--id", "L", "--state", "failed")  # an ended Lane must not keep reading 进行中
        self.assertNotEqual(self.stamp(), before)
        page = Path(self.page).read_text(encoding="utf-8")
        name = os.path.basename(self.root.rstrip("/"))
        self.assertIn(f'<code title="{self.root}">{name} · abc1234</code>', page)  # repository by name, path on hover
        self.assertNotIn("_blank", page)  # embedded browsers such as Orca's refuse popups
        self.run_cli("--run", self.run_dir, "close", "--force")
        self.assertIn("本次任务已结束", Path(self.page).read_text(encoding="utf-8"))

    def test_no_file_write_when_content_is_unchanged(self):
        self.cli("step", "add", "--id", "S1", "--title", "开工", "--state", "working")
        before, content = self.stamp(), Path(self.page).read_text(encoding="utf-8")
        for _ in range(2):
            self.cli("show", "--html", "--line")
            self.cli("step", "set", "--id", "S1", "--state", "working")  # same content again
        self.assertEqual(self.stamp(), before)
        self.assertEqual(Path(self.page).read_text(encoding="utf-8"), content)

    def test_static_page_never_fetches_or_reloads(self):
        self.cli("lane", "add", "--id", "L", "--title", "写", "--state", "working")
        self.cli("ask", "add", "--id", "A1", "--question", "上线吗？", "--recommend", "上", "--evidence", "测过", "--blocks", "发布")
        page = Path(self.page).read_text(encoding="utf-8")
        vendor = board_render_asset(board_render_module().MARKDOWN_IT)
        own = page.replace(vendor, "")
        for forbidden in ("fetch(", "XMLHttpRequest", "EventSource", "WebSocket",
                          'http-equiv="refresh"', ".alive.js", "<script src=", "/api/", "127.0.0.1", "token=", "cookie"):
            self.assertFalse(forbidden in own, forbidden)
        self.assertIn("location.reload", own)
        self.assertEqual(own.count("<button"), 2)  # the open Ask's answer and the footer progress
        self.assertIn("复制本次进度给 AI", own)
        hint = "看谁在做什么、给某个 AI 发消息：打开 sideby 面板的「会话」页"
        with mock.patch.object(board_render_module().shutil, "which", return_value="/bin/sideby"):
            self.assertIn(hint, board.render_html(board.derive(board.load_run(self.run_dir))))
        with mock.patch.object(board_render_module().shutil, "which", return_value=None):
            self.assertNotIn(hint, board.render_html(board.derive(board.load_run(self.run_dir))))

    def test_no_server_or_socket_code_is_left(self):
        scripts = Path(SCRIPT_DIR)
        self.assertFalse((scripts / "board_server.py").exists())
        for path in [*scripts.glob("*.py"), *scripts.glob("*.js")]:
            if path.name.startswith("test_"):
                continue
            # the only allowed mention: the names of retired files that writing a board deletes
            text = "\n".join(l for l in path.read_text(encoding="utf-8").splitlines() if not l.startswith("LEFTOVERS = "))
            for pattern in ("http.server", "ThreadingHTTPServer", "import socket", "socketserver", "board_server",
                            "/api/", "serve.json", "alive.js", "--watch", "fetch("):
                self.assertNotIn(pattern, text, f"{path.name}: {pattern}")
            if path.name != "board_interaction.js":
                self.assertNotIn("location.reload", text, path.name)

    def test_writing_the_board_removes_live_leftovers(self):
        alive = os.path.join(self.root, "state", "boards", "m1.alive.js")
        serve = os.path.join(self.run_dir, "serve.json")
        os.makedirs(os.path.dirname(alive), exist_ok=True)
        Path(alive).write_text("window.boardHeartbeat={};", encoding="utf-8")
        Path(serve).write_text('{"url": "http://127.0.0.1:1/"}', encoding="utf-8")
        self.cli("step", "add", "--id", "S1", "--title", "开工", "--state", "working")
        self.assertFalse(os.path.exists(alive))
        self.assertFalse(os.path.exists(serve))
        self.assertNotIn("alive.js", Path(self.page).read_text(encoding="utf-8"))
        Path(alive).write_text("x", encoding="utf-8")
        self.cli("step", "set", "--id", "S1", "--state", "working")  # unchanged content still clears a leftover
        self.assertFalse(os.path.exists(alive))

    def test_session_index_is_rebuilt_from_active_ledgers(self):
        index_path = os.path.join(self.root, "state", "session-index.json")
        index = json.loads(Path(index_path).read_text(encoding="utf-8"))
        self.assertEqual(index["schemaVersion"], 1)
        self.assertEqual(index["sessions"]["coord-1"]["entries"][0]["role"], "coordinator")
        first = index["revision"]
        self.cli("lane", "add", "--id", "L", "--title", "写卡片", "--role", "review", "--session", "worker-1")
        index = json.loads(Path(index_path).read_text(encoding="utf-8"))
        self.assertEqual(index["revision"], first + 1)
        entry = index["sessions"]["worker-1"]["entries"][0]
        self.assertEqual((entry["run"], entry["lane"], entry["laneTitle"], entry["role"], entry["runTitle"]), ("m1", "L", "写卡片", "review", "汇报"))
        self.assertTrue(entry["url"].startswith("file://") and entry["url"].endswith(".html#lane-L"))
        self.assertNotIn("token", json.dumps(index))
        before = os.stat(index_path).st_mtime_ns
        self.cli("lane", "set", "--id", "L", "--note", "进展")  # no session change: no rewrite, same revision
        self.assertEqual(os.stat(index_path).st_mtime_ns, before)
        _, other, _ = self.run_cli("init", "--objective", "另一个", "--run-id", "m2", "--coordinator-session", "coord-2")
        self.run_cli("--run", other.strip(), "lane", "add", "--id", "X", "--session", "worker-1")
        index = json.loads(Path(index_path).read_text(encoding="utf-8"))
        self.assertEqual(sorted(e["run"] for e in index["sessions"]["worker-1"]["entries"]), ["m1", "m2"])
        self.run_cli("--run", self.run_dir, "close")
        index = json.loads(Path(index_path).read_text(encoding="utf-8"))
        self.assertNotIn("coord-1", index["sessions"])
        self.assertEqual([e["run"] for e in index["sessions"]["worker-1"]["entries"]], ["m2"])
        self.assertGreater(index["revision"], first + 2)


def board_render_module():
    import board_render
    return board_render


def board_render_asset(name: str) -> str:
    return board_render_module().asset(name)


if __name__ == "__main__":
    unittest.main()
