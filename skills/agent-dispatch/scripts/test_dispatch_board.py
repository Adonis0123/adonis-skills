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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import dispatch_board as board

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


class BoardTestCase(unittest.TestCase):
    def setUp(self) -> None:
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
        self.assertEqual(info["activity"], "命令: /bin/zsh -lc 'ls skills/agent-dispatch'")
        self.assertFalse(info["ended"])
        self.assertFalse(info["failed"])
        info = board.summarize_events(CODEX + CODEX_DONE)
        self.assertTrue(info["ended"])
        self.assertFalse(info["failed"])
        self.assertEqual(info["activity"], "说：5")

    def test_codex_legacy_shape_and_turn_failed(self):
        self.assertEqual(board.summarize_events(CODEX_LEGACY)["activity"], "说：legacy shape")
        info = board.summarize_events([{"type": "turn.failed", "error": {"message": "boom"}}])
        self.assertTrue(info["ended"] and info["failed"])

    def test_grok_tool_text_and_end(self):
        info = board.summarize_events(GROK)
        self.assertEqual(info["activity"], "说：里有 5 个条目")
        info = board.summarize_events(GROK[:2])
        self.assertEqual(info["activity"], "run_terminal_command: ls skills/agent-dispatch")
        info = board.summarize_events(GROK + [GROK_END])
        self.assertTrue(info["ended"])
        self.assertFalse(info["failed"])
        self.assertTrue(board.summarize_events([{"type": "end", "stopReason": "cancelled"}])["failed"])

    def test_activity_is_first_plain_line(self):
        text = "共 **1,676 行**，未修改任何文件。\n\n| 文件 | 行数 |\n| --- | ---: |"
        info = board.summarize_events([{"type": "item.completed", "item": {"type": "agent_message", "text": text}}])
        self.assertEqual(info["activity"], "说：共 1,676 行，未修改任何文件。")
        self.assertEqual(board.short("| a | b |\n| --- |\n- 第二行"), "第二行")

    def test_wait_shows_last_log_line(self):
        _, run = self.new_run()
        log = os.path.join(self.root, "build.log")
        with open(log, "w", encoding="utf-8") as f:
            f.write("step 1\nstep 2\n\n")
        board.add_wait(run, {"id": "build", "title": "构建", "log": log})
        wait = board.derive(run)["waits"][0]
        self.assertEqual(wait["last_line"], "step 2")
        self.assertIn("日志最后一行：step 2", board.render_text(board.derive(run)))
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
        self.assertIn("5 分钟没有新动静，协调者会去查看", lane["flags"])
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
        self.assertIn("输出已结束，待协调者集成", lane["flags"])

    def test_finished_lane_prefers_coordinator_note(self):
        _, run = self.new_run()
        out = os.path.join(self.root, "a.jsonl")
        write_jsonl(out, CODEX + CODEX_DONE)
        board.add_lane(run, {"id": "A", "state": "done", "output": out, "note": "集成：共 5 个"})
        lane = board.derive(run)["lanes"][0]
        self.assertEqual((lane["activity_label"], lane["activity"]), ("结果", "集成：共 5 个"))
        self.assertIn("结果：集成：共 5 个", board.render_html(board.derive(run)))

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
        self.assertIn("审查和编写用的是同一个账号额度，复审不够独立", lanes["R"]["flags"])
        self.assertNotIn("审查和编写用的是同一个账号额度，复审不够独立", lanes["R2"]["flags"])

    def test_orca_exited_worker_is_flagged(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "state": "working", "dispatch": "ctx_1"})
        view = board.derive(run, orca={"ctx_1": {"liveness": "exited", "activity": "idle"}})
        self.assertIn("Orca 报告进程已退出", view["lanes"][0]["flags"])

    def test_state_line_counts_running_waits_and_open_asks(self):
        _, run = self.new_run()
        board.add_lane(run, {"id": "A", "state": "working"})
        board.add_lane(run, {"id": "B", "state": "done"})
        board.add_wait(run, {"id": "deploy", "title": "部署 test"})
        board.add_wait(run, {"id": "ci", "title": "CI", "state": "done"})
        board.add_ask(run, {"id": "A1", "question": "部署吗？", "recommend": "是", "evidence": "diff", "blocks": "WP6"})
        view = board.derive(run)
        self.assertEqual(board.state_line(view, "/x/board.html"), "进行中：1 项任务在做 · 1 项外部等待 · 1 个问题等你回答 · 看板 /x/board.html")
        board.set_lane(run, "A", {"state": "done"})
        board.set_wait(run, "deploy", {"state": "done"})
        board.answer_ask(run, "A1", "是")
        self.assertTrue(board.state_line(board.derive(run)).startswith("暂时没有在做的事"))


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
        self.assertEqual(board.render_all(board.load_registry()), "没有进行中的 Run。\n")

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
        self.assertIn("B9 卡片 · 写 · cc003", text)
        self.assertIn("正在：Agent: find tests", text)
        self.assertIn("子任务 1", text)
        self.assertIn("部署 test  阶段：web 构建中", text)
        self.assertIn("推荐：是", text)
        self.assertIn("有效期：本 Run", text)
        page_path = os.path.join(self.root, "state", "boards", "cli.html")
        with open(page_path, encoding="utf-8") as f:
            page = f.read()
        self.assertIn('http-equiv="refresh"', page)
        self.assertIn("演示 &lt;b&gt;", page)
        self.assertNotIn("演示 <b>", page)
        self.run_cli("ask", "answer", "--id", "A1", "--answer", "按推荐")
        with open(page_path, encoding="utf-8") as f:
            self.assertNotIn("A1 部署吗？", f.read())
        self.run_cli("ask", "add", "--id", "A1b", "--question", "部署吗？", "--recommend", "是", "--evidence", "同样流程", "--blocks", "WP6")
        code, line, _ = self.run_cli("show", "--line")
        self.assertEqual(line.strip(), f"进行中：1 项任务在做 · 1 项外部等待 · 1 个问题等你回答 · 看板 {page_path}")
        self.assertIn("cli", self.run_cli("show", "--all")[1])
        self.assertEqual(self.run_cli("close")[0], 0)
        self.assertIn("没有进行中的 Run", self.run_cli("show", "--all")[1])
        with open(page_path, encoding="utf-8") as f:
            closed = f.read()
        self.assertIn("已结束", closed)
        self.assertNotIn('http-equiv="refresh"', closed)

    def test_watch_reports_missing_run_as_error_and_stop_pauses_dispatch(self):
        code, _, err = self.run_cli("--run", os.path.join(self.root, "nope"), "show", "--watch", "0.01")
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
        self.assertTrue(out.startswith("已暂停派新任务：还有 1 项任务"), out)
        with open(os.path.join(self.root, "state", "boards", "s.html"), encoding="utf-8") as f:
            page = f.read()
        self.assertIn("已暂停派新任务", page)
        self.assertIn("A 写", page)  # still-running work stays visible after 停

    def test_watch_exits_when_run_is_closed_meanwhile(self):
        _, run_dir, _ = self.run_cli("init", "--objective", "w", "--run-id", "w")
        run_dir = run_dir.strip()
        self.run_cli("--run", run_dir, "show", "--html")
        calls = {"n": 0}
        real = board.show_once

        def close_after_first(rd, args):
            calls["n"] += 1
            if calls["n"] == 2:
                board.close_run(rd, board.load_run(rd))
            return real(rd, args)

        with mock.patch.object(board, "show_once", side_effect=close_after_first):
            code, out, _ = self.run_cli("--run", run_dir, "show", "--watch", "0.01")
        self.assertEqual(code, 0)
        self.assertIn("已结束", out)
        with open(os.path.join(self.root, "state", "boards", "w.html"), encoding="utf-8") as f:
            self.assertIn("已结束", f.read())

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

    def test_registry_keeps_same_id_from_two_bases(self):
        board.init_run("a", self.plain, run_id="same")
        repo = os.path.join(self.root, "repo")
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        board.init_run("b", repo, run_id="same")
        self.assertEqual(sorted(r["objective"] for r in board.load_registry()), ["a", "b"])

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
        self.assertIn("第 1/3 轮", page)

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
        self.assertIn("等：部署 test、A", board.render_text(view))
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
        self.assertEqual(board.derive(run)["lanes"][0]["activity"], "启动中，还没有输出")

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
                    seen["active"] = board.show_once(rd, args)  # the watcher reads the closed ledger before the move

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
        self.assertIn("└ A 的 S", text)
        self.assertIn("└ 协调者 的 C", text)
        self.assertIn("  └ T", text)
        self.assertNotIn("B 的 T", text)
        self.assertIn("A 的 S", board.render_html(view))



class TestNoviceUser(BoardTestCase):
    def test_open_prefers_orca_then_system_browser(self):
        run_dir, _ = self.new_run()
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, stdout='{"ok": true}', stderr="")

        with mock.patch.object(board, "orca_reachable", return_value=True), mock.patch.object(board.subprocess, "run", side_effect=fake_run):
            self.assertEqual(board.open_board(board.board_path(run_dir)), "orca")
        self.assertEqual(calls[0][:3], ["orca", "tab", "create"])
        self.assertTrue(calls[0][4].startswith("file:///"))
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
        self.assertEqual(calls, ["orca", "open"])
        _, run_dir, _ = self.run_cli("init", "--objective", "o", "--run-id", "o")
        with mock.patch.object(board, "open_board", return_value="none"):
            code, out, _ = self.run_cli("--run", run_dir.strip(), "open")
        self.assertEqual(code, 3)
        self.assertIn("不要让用户自己找路径", out)

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
        self.assertIn("例如：A1 按推荐", page)
        self.assertIn("“停”", page)
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



class TestShortPath(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
