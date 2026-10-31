#!/usr/bin/env python3
"""Tests for agent-practice-audit scripts. All transcripts are synthetic and written to temp dirs."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


EX = load("extract")
AG = load("aggregate")
BR = load("build_report")
CP = load("check_practices")
DG = load("digests")
CO = load("consensus")
CS = load("config_scan")
try:
    SO = load("safe_output")
except FileNotFoundError:  # created by the review fix; keeps the suite importable before it exists
    SO = None
PRACTICES = json.loads((HERE.parent / "references" / "practices.json").read_text(encoding="utf-8"))


def write_jsonl(path: Path, rows: list) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows) + "\n", encoding="utf-8")
    return str(path)


class TmpCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()


# ---------------------------------------------------------------- adapters

def claude_rows(entry="cli"):
    base = {"entrypoint": entry, "cwd": "/work/app", "permissionMode": "default"}
    return [
        {"type": "permission-mode", "permissionMode": "plan"},
        {**base, "type": "user", "timestamp": "2026-10-01T10:00:00Z", "message": {"role": "user", "content": "Add a login page"}},
        {**base, "type": "assistant", "timestamp": "2026-10-01T10:01:00Z", "effort": "high",
         "message": {"model": "model-x", "content": [
             {"type": "tool_use", "name": "Bash", "input": {"command": "pnpm test && git worktree list"}},
             {"type": "tool_use", "name": "Agent", "input": {"subagent_type": "Explore"}},
             {"type": "tool_use", "name": "Read", "input": {"file_path": "/tmp/shot.png"}}]}},
        {**base, "type": "user", "timestamp": "2026-10-01T10:02:00Z",
         "message": {"content": [{"type": "tool_result", "content": "ok"}]}},
        {**base, "type": "user", "timestamp": "2026-10-01T10:03:00Z",
         "message": {"content": [{"type": "text", "text": "<system-reminder>injected</system-reminder>"}]}},
        {**base, "type": "user", "timestamp": "2026-10-01T10:04:00Z",
         "message": {"content": "<command-name>/clear</command-name>"}},
        {**base, "type": "user", "timestamp": "2026-10-01T10:05:00Z",
         "message": {"content": [{"type": "text", "text": "[Request interrupted by user]"}]}},
        {**base, "type": "system", "subtype": "compact_boundary", "timestamp": "2026-10-01T10:06:00Z"},
        {**base, "type": "user", "timestamp": "2026-10-01T10:30:00Z", "message": {"content": "不对，重新做"}},
    ]


class ClaudeAdapter(TmpCase):
    def test_human_session(self):
        p = write_jsonl(self.tmp / ".claude-2" / "projects" / "p" / "s.jsonl", claude_rows())
        r = EX.claude(p)
        self.assertEqual(r["kind"], "human")
        self.assertEqual(r["account"], ".claude-2")
        self.assertEqual(r["prompts"], 2)
        self.assertEqual(r["corrections"], 1)
        self.assertEqual(r["cmds"]["clear"], 1)
        self.assertEqual(r["interrupts"], 1)
        self.assertEqual(r["compactions"], 1)
        self.assertIn("plan", r["modes"])
        for tag in ("bash:test", "bash:worktree", "bash:screenshot", "Agent:Explore"):
            self.assertEqual(r["tools"][tag], 1, tag)
        self.assertEqual(r["start"], "2026-10-01T10:00:00Z")
        self.assertEqual(r["end"], "2026-10-01T10:30:00Z")

    def test_headless_and_subagent(self):
        self.assertEqual(EX.claude(write_jsonl(self.tmp / "a.jsonl", claude_rows("sdk-cli")))["kind"], "headless")
        sub = write_jsonl(self.tmp / ".claude" / "projects" / "p" / "x" / "subagents" / "a.jsonl", claude_rows())
        self.assertEqual(EX.claude(sub)["kind"], "subagent")


class CodexAdapter(TmpCase):
    def rows(self, originator, with_event):
        rows = [
            {"type": "session_meta", "timestamp": "2026-10-02T09:00:00Z", "payload": {"originator": originator, "cwd": "/work/app"}},
            {"type": "turn_context", "timestamp": "2026-10-02T09:00:01Z",
             "payload": {"effort": "low", "model": "m", "approval_policy": "never", "sandbox_policy": {"type": "danger-full-access"}}},
            {"type": "response_item", "timestamp": "2026-10-02T09:00:02Z",
             "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "# AGENTS.md instructions"}]}},
            {"type": "response_item", "timestamp": "2026-10-02T09:00:03Z",
             "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "fix the flaky test"}]}},
            {"type": "response_item", "timestamp": "2026-10-02T09:00:04Z",
             "payload": {"type": "function_call", "name": "exec_command", "arguments": json.dumps({"cmd": "pytest -q"})}},
            {"type": "event_msg", "timestamp": "2026-10-02T09:10:00Z", "payload": {"type": "turn_aborted"}},
        ]
        if with_event:
            rows.append({"type": "event_msg", "timestamp": "2026-10-02T09:11:00Z",
                         "payload": {"type": "user_message", "message": "try again please"}})
        return rows

    def test_desktop_fallback_reads_response_item_user_messages(self):
        r = EX.codex(write_jsonl(self.tmp / ".codex" / "sessions" / "a.jsonl", self.rows("Codex Desktop", False)))
        self.assertEqual(r["kind"], "human")
        self.assertEqual(r["prompts"], 1)  # the "# AGENTS.md" injection is skipped
        self.assertEqual(r["first"], "fix the flaky test")
        self.assertEqual(r["tools"]["bash:test"], 1)
        self.assertEqual(r["interrupts"], 1)
        self.assertIn("approval=never", r["modes"])
        self.assertIn("sandbox=danger-full-access", r["modes"])

    def test_user_message_events_win_over_fallback(self):
        r = EX.codex(write_jsonl(self.tmp / "b.jsonl", self.rows("codex-tui", True)))
        self.assertEqual(r["prompts"], 1)
        self.assertEqual(r["corrections"], 1)
        self.assertEqual(EX.codex(write_jsonl(self.tmp / "c.jsonl", self.rows("codex_exec", True)))["kind"], "headless")


class GrokAdapter(TmpCase):
    def make(self, kind=None, relationship="primary"):
        d = self.tmp / ".grok-1" / "sessions" / "enc%2Fpath" / "0001"
        write_jsonl(d / "chat_history.jsonl", [
            {"type": "system", "content": "system prompt"},
            {"type": "user", "content": [{"type": "text", "text": "<system-reminder>ctx</system-reminder>"}]},
            {"type": "user", "content": [{"type": "text", "text": "<user_info>os</user_info>\n<user_query>\nadd tests\n</user_query>"}]},
            {"type": "assistant", "content": "", "model_id": "grok-x", "reasoning_effort": "high",
             "tool_calls": [{"id": "1", "name": "run_terminal_command", "arguments": json.dumps({"command": "pytest"})},
                            {"id": "2", "name": "ask_user_question", "arguments": "{}"}]},
            {"type": "tool_result", "tool_call_id": "1", "content": "ok"},
            {"type": "user", "content": [{"type": "text", "text": "This session is being continued from a previous conversation"}]},
        ])
        write_jsonl(d / "events.jsonl", [
            {"ts": "2026-10-03T08:00:00Z", "type": "turn_started", "yolo_mode": True, "session_relationship": relationship},
            {"ts": "2026-10-03T08:00:01Z", "type": "phase_changed", "phase": "x"},
            {"ts": "2026-10-03T08:00:02Z", "type": "permission_resolved", "decision": "deny"},
            {"ts": "2026-10-03T08:20:00Z", "type": "turn_ended", "outcome": "cancelled"},
        ])
        summary = {"info": {"cwd": "/work/app"}, "created_at": "2026-10-03T07:59:00Z", "sandbox_profile": "off"}
        if kind:
            summary["session_kind"] = kind
        (d / "summary.json").write_text(json.dumps(summary))
        (d / "signals.json").write_text(json.dumps({"compactionCount": 2, "cancellationCount": 0}))
        (d / "prompt_context.json").write_text(json.dumps({"is_non_interactive": kind == "headless"}))
        return str(d / "chat_history.jsonl")

    def test_interactive_session(self):
        r = EX.grok(self.make())
        self.assertEqual(r["kind"], "human")
        self.assertEqual(r["account"], ".grok-1")
        self.assertEqual(r["prompts"], 1)
        self.assertEqual(r["first"], "add tests")
        self.assertEqual(r["tools"]["bash:test"], 1)
        self.assertEqual(r["tools"]["ask_user_question"], 1)
        self.assertEqual(r["denials"], 1)
        self.assertEqual(r["interrupts"], 1)
        self.assertEqual(r["compactions"], 2)
        self.assertIn("yolo", r["modes"])
        self.assertEqual(r["cwd"], "/work/app")
        self.assertEqual(r["end"], "2026-10-03T08:20:00Z")

    def test_headless_and_subagent(self):
        self.assertEqual(EX.grok(self.make("headless"))["kind"], "headless")
        self.assertEqual(EX.grok(self.make(None, "child"))["kind"], "subagent")


class WorkBuddyAdapter(TmpCase):
    def rows(self, automation):
        rows = [
            {"type": "session-meta", "id": "s", "sessionId": "s", "timestamp": 1790000000000, "meta": {"codebuddy.ai/hostKind": "unopted"}},
            {"type": "message", "role": "user", "timestamp": 1790000001000, "cwd": "/work/app",
             "content": [{"type": "input_text", "text": "<system-reminder>x</system-reminder><user_query>写个脚本，你没跑测试</user_query>"}]},
            {"type": "message", "role": "user", "timestamp": 1790000002000,
             "content": [{"type": "input_text", "text": "<system-reminder>only injected</system-reminder>"}]},
            {"type": "function_call", "timestamp": 1790000003000, "name": "Bash",
             "arguments": json.dumps({"command": "npx vitest run"}), "providerData": {"model": "wb-model"}},
            {"type": "function_call_result", "timestamp": 1790000004000, "name": "Bash", "status": "completed"},
            {"type": "message", "role": "user", "timestamp": 1790000005000,
             "content": [{"type": "input_text", "text": "<cb_summary>summary</cb_summary>"}]},
        ]
        if automation:
            rows.append({"type": "function_call", "timestamp": 1790000006000, "name": "send_automation_result", "arguments": "{}"})
        return rows

    def test_human_session(self):
        r = EX.workbuddy(write_jsonl(self.tmp / ".workbuddy" / "projects" / "p" / "a.jsonl", self.rows(False)))
        self.assertEqual(r["kind"], "human")
        self.assertEqual(r["prompts"], 1)
        self.assertEqual(r["corrections"], 1)
        self.assertEqual(r["tools"]["bash:test"], 1)
        self.assertEqual(r["compactions"], 1)
        self.assertEqual(r["entry"], "unopted")
        self.assertTrue(r["start"].endswith("Z"))

    def test_automation_is_headless(self):
        r = EX.workbuddy(write_jsonl(self.tmp / "b.jsonl", self.rows(True)))
        self.assertEqual(r["kind"], "headless")


class Discovery(TmpCase):
    def test_env_override_and_missing_roots(self):
        write_jsonl(self.tmp / "c" / "x.jsonl", claude_rows())
        env = {"AGENT_PRACTICE_AUDIT_CLAUDE_GLOBS": str(self.tmp / "c" / "*.jsonl"),
               "AGENT_PRACTICE_AUDIT_GROK_GLOBS": str(self.tmp / "nope" / "*.jsonl")}
        with mock.patch.dict(os.environ, env):
            items, report = EX.discover(["claude", "grok"], 0, {})
        self.assertEqual(items, [("claude", str(self.tmp / "c" / "x.jsonl"))])
        self.assertTrue(report["claude"]["found"])
        self.assertFalse(report["grok"]["found"])

    def test_work_reports_errors_instead_of_raising(self):
        r = EX.work(("claude", str(self.tmp / "missing.jsonl")))
        self.assertIn("error", r)


class Aggregate(TmpCase):
    def test_summary_per_host_and_concepts(self):
        rows = [EX.claude(write_jsonl(self.tmp / "a.jsonl", claude_rows())),
                EX.claude(write_jsonl(self.tmp / "b.jsonl", claude_rows("sdk-cli")))]
        rows = [json.loads(json.dumps(r, default=dict)) for r in rows]  # round-trip like the JSONL file
        s = AG.aggregate(rows, errors=1)
        self.assertEqual(s["files"], 3)
        self.assertEqual(s["kinds"], {"claude/human": 1, "claude/headless": 1})
        h = s["hosts"]["claude"]
        self.assertEqual(h["sessions"], 1)
        self.assertEqual(h["concepts_pct"]["subagent"], 100.0)
        self.assertEqual(h["concepts_pct"]["plan_mode"], 100.0)
        self.assertEqual(h["pct_session_bash_tags"]["test"], 100.0)
        self.assertEqual(h["median_minutes"], 30.0)
        self.assertEqual(s["headless"]["sessions"], 1)


# ---------------------------------------------------------------- scoring and report

class Scoring(unittest.TestCase):
    def test_score_math(self):
        self.assertEqual(BR.score(["ok", "part", "no", "na"]), 50)
        self.assertEqual(BR.score(["ok", "ok", "part"]), 83)
        self.assertIsNone(BR.score(["na", "na"]))

    def test_grade_boundaries(self):
        cases = {100: "S", 90: "S", 89: "A", 80: "A", 79: "B", 70: "B", 69: "C", 60: "C", 59: "D", 0: "D"}
        for value, letter in cases.items():
            self.assertEqual(BR.grade(value), letter, value)
        self.assertIsNone(BR.grade(None))

    def test_ladder_takes_fewest_fixes(self):
        items = [{"id": f"o{i}", "status": "ok", "dimension": "ctx"} for i in range(6)]
        items += [{"id": "p1", "status": "part", "dimension": "ctx"}, {"id": "n1", "status": "no", "dimension": "safe"},
                  {"id": "n2", "status": "no", "dimension": "doc"}, {"id": "x", "status": "na", "dimension": "doc"}]
        self.assertEqual(BR.score([i["status"] for i in items]), 72)  # 65 / 90
        steps = BR.ladder(items, {"safe": 0, "doc": 50, "ctx": 93})
        self.assertEqual(steps[0], {"grade": "A", "score": 83, "add": ["n1"], "total": 1})
        self.assertEqual(steps[1]["grade"], "S")
        self.assertEqual(steps[1]["add"], ["n2"])
        self.assertEqual(steps[-1]["total"], 2)
        self.assertEqual(BR.ladder([{"id": "a", "status": "ok", "dimension": "ctx"}]), [])

    def test_trend(self):
        self.assertEqual(BR.trend(None, "ok"), "new")
        self.assertEqual(BR.trend("no", "part"), "up")
        self.assertEqual(BR.trend("ok", "no"), "down")
        self.assertEqual(BR.trend("ok", "ok"), "same")
        self.assertEqual(BR.trend("na", "ok"), "changed")


def judgments(status_for, lang="en"):
    return {"lang": lang, "headline": "h", "lead": "l", "window_days": 30,
            "items": {p["id"]: {"status": status_for(p), "evidence": f"evidence {p['id']}", "suggestion": "s"}
                      for p in PRACTICES["practices"]}}


class BuildReport(TmpCase):
    def test_previous_vs_current_trend(self):
        prev = BR.build_data(PRACTICES, judgments(lambda p: "no"), date="2026-09-01")
        cur = BR.build_data(PRACTICES, judgments(lambda p: "ok" if p["dimension"] == "ctx" else "no"), previous=prev,
                            date="2026-10-01")
        trends = {i["id"]: i["trend"] for i in cur["items"]}
        for p in PRACTICES["practices"]:
            self.assertEqual(trends[p["id"]], "up" if p["dimension"] == "ctx" else "same")
        dims = {d["id"]: d for d in cur["dimensions"]}
        self.assertEqual(dims["ctx"]["delta"], 100)
        self.assertEqual(dims["safe"]["delta"], 0)
        self.assertEqual(cur["scoreDelta"], cur["score"] - prev["score"])
        self.assertEqual(cur["previous"], "2026-09-01")

    def test_missing_and_invalid_judgments(self):
        j = judgments(lambda p: "ok")
        j["items"].pop(PRACTICES["practices"][0]["id"])
        with self.assertRaises(BR.InputError):
            BR.build_data(PRACTICES, j)
        data = BR.build_data(PRACTICES, j, allow_missing=True)
        self.assertEqual(data["items"][0]["status"], "na")
        bad = judgments(lambda p: "maybe")
        with self.assertRaises(BR.InputError):
            BR.build_data(PRACTICES, bad)

    def test_html_contains_every_practice_and_escapes_script(self):
        j = judgments(lambda p: "part", lang="zh")
        first = PRACTICES["practices"][0]["id"]
        j["items"][first]["evidence"] = "</script><script>alert(1)</script>"
        data = BR.build_data(PRACTICES, j, config={"theme": {"accent": "#123456", "accentDark": "red;}"}})
        html = BR.render(data)
        for p in PRACTICES["practices"]:
            self.assertIn(f'"id": "{p["id"]}"', html)
        self.assertNotIn("</script><script>alert", html)
        self.assertNotIn("__REPORT_DATA__", html)
        self.assertEqual(data["theme"], {"accent": "#123456"})  # non-hex colour dropped
        self.assertEqual(data["items"][0]["title"], PRACTICES["practices"][0]["title_zh"])

    def test_main_writes_report_and_finds_previous(self):
        base = self.tmp / "apa"
        jpath = self.tmp / "j.json"
        jpath.write_text(json.dumps(judgments(lambda p: "no")))
        with mock.patch.dict(os.environ, {"AGENT_PRACTICE_AUDIT_DIR": str(base)}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(BR.main(["--judgments", str(jpath), "--date", "2026-09-01"]), 0)
            jpath.write_text(json.dumps(judgments(lambda p: "ok")))
            self.assertEqual(BR.main(["--judgments", str(jpath), "--date", "2026-10-01"]), 0)
        out = base / "reports" / "2026-10-01"
        data = json.loads((out / "report-data.json").read_text())
        self.assertEqual(data["previous"], "2026-09-01")
        self.assertEqual(data["score"], 100)
        self.assertEqual(data["scoreDelta"], 100)
        self.assertTrue((out / "report.html").read_text().startswith("<!doctype html>"))

    def test_main_copies_brand_logo_and_illustration(self):
        base = self.tmp / "apa"
        base.mkdir()
        (self.tmp / "logo.svg").write_text("<svg/>")
        (self.tmp / "hero.webp").write_bytes(b"RIFF")
        (base / "config.json").write_text(json.dumps({
            "brand": {"name": "Demo", "logo": str(self.tmp / "logo.svg"), "logoDark": str(self.tmp / "missing.svg")},
            "illustration": str(self.tmp / "hero.webp")}))
        jpath = self.tmp / "j.json"
        jpath.write_text(json.dumps(judgments(lambda p: "ok")))
        with mock.patch.dict(os.environ, {"AGENT_PRACTICE_AUDIT_DIR": str(base)}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(BR.main(["--judgments", str(jpath), "--date", "2026-10-01"]), 0)
        out = base / "reports" / "2026-10-01"
        data = json.loads((out / "report-data.json").read_text())
        self.assertEqual(data["brand"], {"name": "Demo", "logo": "img/logo.svg", "logoDark": None})  # missing file skipped
        self.assertEqual(data["illustration"], "img/hero.webp")
        self.assertTrue((out / "img" / "logo.svg").is_file())


class PracticesFile(unittest.TestCase):
    def test_shipped_practices_are_valid(self):
        self.assertEqual(CP.validate(PRACTICES, DG.SOURCES_DIR), [])
        self.assertEqual(set(PRACTICES["dimensions"]), set(CP.DIMENSIONS))

    def test_validation_catches_bad_entries(self):
        bad = {"practices": [{"id": "x", "dimension": "nope", "title": "t", "detect": "d", "verifiedAt": "2026-01-01",
                              "sources": [{"page": "p", "url": "https://example.com/a", "fragment": "zzz",
                                           "quote": " ".join(["word"] * 30)}]}]}
        msgs = "\n".join(CP.validate(bad))
        for needle in ("dimension must be", "30 words", "fragment is not part", "not on the official allowlist"):
            self.assertIn(needle, msgs)
        self.assertTrue(CP.allowed("https://github.com/google-gemini/gemini-cli"))
        self.assertFalse(CP.allowed("https://github.com/someone/blog"))


DIGEST = """---
slug: demo
title: Demo page
publisher: Example
url: https://code.claude.com/docs/en/demo
fetchedAt: 2026-10-01
lastVerifiedAt: 2026-10-01
linkStatus: {status}
finalUrl:
---

# Demo page

## Summary

- First point in our own words.
- Second point.
- Third point.
- Fourth point.
- Fifth point.

## Cited quotes

- "Keep it short." (demo-practice)
"""


def demo_practices(basis="live"):
    return {"dimensions": {"ctx": {"en": "Context", "zh": "上下文"}},
            "practices": [{"id": "demo-practice", "dimension": "ctx", "title": "Keep it short", "detect": "d",
                           "verifiedAt": "2026-10-01", "basis": basis,
                           "consensus": {"verifiers": ["a", "b"], "agree": 2, "total": 2, "checkedAt": "2026-10-01"},
                           "sources": [{"source": "demo", "page": "Demo", "url": "https://code.claude.com/docs/en/demo",
                                        "quote": "Keep it short.", "fragment": "Keep it short"}]}]}


class Digests(TmpCase):
    def write(self, status="ok"):
        d = self.tmp / "sources"
        d.mkdir(exist_ok=True)
        (d / "demo.md").write_text(DIGEST.format(status=status), encoding="utf-8")
        return str(d)

    def test_frontmatter_parsing(self):
        fields, body = DG.parse_frontmatter(DIGEST.format(status="ok"))
        self.assertEqual(fields["slug"], "demo")
        self.assertEqual(fields["finalUrl"], "")
        self.assertTrue(body.startswith("# Demo page"))
        self.assertEqual(len(DG.section_bullets(body, "Summary")), 5)
        self.assertEqual(DG.parse_frontmatter("no frontmatter"), ({}, "no frontmatter"))
        d = DG.load_digest("demo", self.write())
        self.assertEqual(DG.problems("demo", d), [])
        self.assertEqual(d["path"], "references/sources/demo.md")
        bad = DG.load_digest("demo", self.write("gone"))
        self.assertIn("linkStatus must be", "\n".join(DG.problems("demo", bad)))
        self.assertIn("missing", DG.problems("nope", None)[0])

    def test_update_frontmatter_keeps_body(self):
        src = self.write()
        DG.update_frontmatter(DG.digest_path("demo", src), {"linkStatus": "redirected", "finalUrl": "https://code.claude.com/x"})
        d = DG.load_digest("demo", src)
        self.assertEqual((d["linkStatus"], d["finalUrl"]), ("redirected", "https://code.claude.com/x"))
        self.assertEqual(len(d["summary"]), 5)

    def test_validation_requires_quote_in_digest(self):
        src = self.write()
        self.assertEqual(CP.validate(demo_practices(), src), [])
        p = demo_practices()
        p["practices"][0]["sources"][0]["quote"] = "Keep it short and sweet."
        p["practices"][0]["sources"][0]["fragment"] = "Keep it short"
        self.assertIn("Cited quotes", "\n".join(CP.validate(p, src)))

    def test_link_status(self):
        self.assertEqual(CP.link_status("https://a.dev/x", None, "https://a.dev/x/"), "ok")
        self.assertEqual(CP.link_status("https://a.dev/x", None, "https://a.dev/y"), "redirected")
        self.assertEqual(CP.link_status("https://a.dev/x", "unreachable (timeout)", "https://a.dev/x"), "unreachable")

    def test_unreachable_source_renders_digest(self):
        src = self.write("unreachable")
        j = {"lang": "zh", "items": {"demo-practice": {"status": "ok", "evidence": "e"}}}
        data = BR.build_data(demo_practices("digest"), j, sources_dir=src)
        s = data["items"][0]["sources"][0]
        self.assertEqual(s["linkStatus"], "unreachable")
        self.assertEqual(s["digestSummary"][0], "First point in our own words.")
        self.assertEqual(data["items"][0]["basis"], "digest")
        html = BR.render(data)
        self.assertIn("First point in our own words.", html)
        self.assertIn('"linkStatus": "unreachable"', html)
        live = BR.build_data(demo_practices(), j, sources_dir=self.write("ok"))
        self.assertNotIn("digestSummary", live["items"][0]["sources"][0])


def verdict(v="accept", found=True, reason="r"):
    return {"verdict": v, "quote_found": found, "faithful": v == "accept", "checkable": True, "reason": reason}


class Consensus(unittest.TestCase):
    def test_two_of_three_accept(self):
        r = CO.decide([verdict(), verdict(), verdict("reject")], ["claude", "codex", "grok"])
        self.assertEqual(r["decision"], "accept")
        self.assertEqual((r["consensus"]["agree"], r["consensus"]["total"]), (2, 3))

    def test_one_of_three_rejects(self):
        self.assertEqual(CO.decide([verdict(), verdict("reject"), verdict("reject")])["decision"], "reject")

    def test_quote_not_found_vetoes(self):
        r = CO.decide([verdict(), verdict(), verdict("reject", found=False)], ["a", "b", "c"])
        self.assertEqual(r["decision"], "reject")
        self.assertEqual(r["vetoed_by"], ["c"])

    def test_fewer_than_two_verifiers_is_pending(self):
        self.assertEqual(CO.decide([verdict()])["decision"], "pending-consensus")
        r = CO.decide([verdict(), None], ["a", "b"])  # unparseable output counts as a verifier that did not agree
        self.assertEqual(r["decision"], "reject")
        self.assertEqual(r["unusable"], ["b"])
        self.assertEqual(CO.decide([verdict(), verdict()])["decision"], "accept")
        self.assertEqual(CO.decide([verdict(), verdict(), verdict("reject"), verdict("reject")])["decision"], "reject")

    def test_parse_verdict_from_noisy_output(self):
        text = 'Sure.\n```json\n{"verdict": "accept", "quote_found": true, "faithful": true, "checkable": true, "reason": "ok"}\n```'
        self.assertEqual(CO.parse_verdict(text)["verdict"], "accept")
        self.assertIsNone(CO.parse_verdict("I think it is fine"))
        self.assertFalse(CO.parse_verdict('{"verdict": "reject", "quote_found": false}')["quote_found"])

    def test_prompt_template_fills_placeholders(self):
        out = CO.render_prompt({"id": "x"}, "PAGE BODY", "digest")
        self.assertIn("PAGE BODY", out)
        self.assertIn('"id": "x"', out)
        self.assertNotIn("{{", out)


# ---------------------------------------------------------------- review regressions

def make_repo(base: Path, as_file: bool = False) -> Path:
    repo = base / "repo"
    (repo / "sub").mkdir(parents=True)
    if as_file:
        (repo / ".git").write_text("gitdir: /elsewhere/.git/worktrees/x\n")
    else:
        (repo / ".git").mkdir()
    return repo


class OutputSafety(TmpCase):
    def judgments_file(self):
        j = self.tmp / "j.json"
        j.write_text(json.dumps(judgments(lambda p: "ok")))
        return str(j)

    def test_build_report_refuses_out_dir_inside_git_repo(self):
        repo = make_repo(self.tmp)
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = BR.main(["--judgments", self.judgments_file(), "--out-dir", str(repo / "sub" / "r")])
        self.assertNotEqual(rc, 0)
        self.assertFalse((repo / "sub" / "r").exists())
        self.assertIn("git", err.getvalue())

    def test_build_report_refuses_env_base_inside_worktree_file(self):
        repo = make_repo(self.tmp, as_file=True)
        with mock.patch.dict(os.environ, {"AGENT_PRACTICE_AUDIT_DIR": str(repo / "sub")}), \
                contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            rc = BR.main(["--judgments", self.judgments_file(), "--date", "2026-10-31"])
        self.assertNotEqual(rc, 0)
        self.assertFalse((repo / "sub" / "reports").exists())

    def test_build_report_rejects_date_traversal(self):
        with mock.patch.dict(os.environ, {"AGENT_PRACTICE_AUDIT_DIR": str(self.tmp / "base")}), \
                contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            rc = BR.main(["--judgments", self.judgments_file(), "--date", "../../escape"])
        self.assertNotEqual(rc, 0)

    def test_other_writers_refuse_git_repo(self):
        repo = make_repo(self.tmp)
        sessions = self.tmp / "s.jsonl"
        sessions.write_text("")
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):
                EX.main([str(repo / "out.jsonl"), "--hosts", "claude", "--days", "1"])
            self.assertNotEqual(AG.main([str(sessions), "-o", str(repo / "sum.json")]), 0)
            self.assertNotEqual(CS.main(["-o", str(repo / "cfg.json")]), 0)
        self.assertEqual(sorted(p.name for p in repo.iterdir()), [".git", "sub"])

    def test_symlink_into_repo_is_resolved(self):
        repo = make_repo(self.tmp)
        link = self.tmp / "link"
        link.symlink_to(repo / "sub")
        with self.assertRaises(SO.UnsafeOutput):
            SO.safe_output_path(str(link / "x" / "report.html"))
        self.assertTrue(SO.safe_output_path(str(self.tmp / "plain" / "a.json")).endswith("a.json"))


class ConfigScanSecrets(TmpCase):
    def test_deny_rules_reported_as_counts_and_coverage_only(self):
        root = self.tmp / ".claude"
        root.mkdir()
        (root / "settings.json").write_text(json.dumps({"permissions": {"deny": [
            "Bash(curl -H 'Authorization: " + "Bearer SECRET123' https://x)", "Read(~/.ssh/**)", "Read(./.env*)",
            "Bash(rm -rf:*)"]}, "env": {"API_TOKEN": "SECRET456"}}))
        out = CS.claude_settings(str(root))
        text = json.dumps(out)
        self.assertNotIn("SECRET123", text)
        self.assertNotIn("SECRET456", text)
        self.assertNotIn("Authorization", text)
        s = out["settings.json"]
        self.assertEqual(s["deny_count"], 4)
        self.assertTrue(s["deny_coverage"]["ssh"])
        self.assertTrue(s["deny_coverage"]["env_files"])
        self.assertTrue(s["deny_coverage"]["destructive_bash"])
        self.assertFalse(s["deny_coverage"]["aws"])
        self.assertNotIn("deny", s)


def raw(**kw):
    base = {"verdict": "accept", "quote_found": True, "faithful": True, "checkable": True, "reason": "ok"}
    base.update(kw)
    return json.dumps(base)


class ConsensusStrict(unittest.TestCase):
    def test_bare_accept_is_invalid(self):
        v = [CO.parse_verdict('{"verdict": "accept"}'), CO.parse_verdict('{"verdict": "accept"}')]
        r = CO.decide(v, ["a", "b"])
        self.assertEqual((r["decision"], r["consensus"]["agree"]), ("reject", 0))

    def test_string_false_does_not_bypass_veto(self):
        bad = CO.parse_verdict(raw(verdict="reject", quote_found="false"))
        self.assertIsNotNone(bad)
        self.assertTrue(bad.get("invalid"))
        r = CO.decide([CO.parse_verdict(raw()), CO.parse_verdict(raw()), bad], ["a", "b", "c"])
        self.assertEqual(r["consensus"]["agree"], 2)
        self.assertIn("c", r["invalid"])

    def test_accept_needs_all_three_true(self):
        v = CO.parse_verdict(raw(faithful=False))
        self.assertTrue(v.get("invalid"))
        r = CO.decide([v, CO.parse_verdict(raw()), CO.parse_verdict(raw(verdict="reject", faithful=False))], ["a", "b", "c"])
        self.assertEqual(r["decision"], "reject")

    def test_quote_not_found_veto_is_strict_boolean(self):
        veto = CO.parse_verdict(raw(verdict="reject", quote_found=False, faithful=False))
        r = CO.decide([CO.parse_verdict(raw()), CO.parse_verdict(raw()), veto], ["a", "b", "c"])
        self.assertEqual((r["decision"], r["vetoed_by"]), ("reject", ["c"]))

    def test_names_must_match_and_be_unique(self):
        vs = [CO.parse_verdict(raw()), CO.parse_verdict(raw()), CO.parse_verdict(raw(verdict="reject", quote_found=False, faithful=False))]
        with self.assertRaises(ValueError):
            CO.decide(vs, ["a", "b"])
        with self.assertRaises(ValueError):
            CO.decide(vs[:2], ["claude", "claude"])

    def test_reason_with_braces_does_not_recurse(self):
        text = 'Note: example {x} here. ' + raw(reason="example {x} and {y: 1}")
        v = CO.parse_verdict(text)
        self.assertEqual(v["verdict"], "accept")
        self.assertFalse(v.get("invalid"))
        self.assertIsNone(CO.parse_verdict("only {x} braces {"))


class ExtractRegressions(TmpCase):
    def test_codex_fallback_keeps_markdown_and_xml_prompts(self):
        def msg(t):
            return {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": t}]}}
        rows = [{"type": "session_meta", "payload": {"originator": "Codex Desktop"}},
                msg("# AGENTS.md instructions for /repo\n..."), msg("<environment_context>cwd</environment_context>"),
                msg("<user_instructions>x</user_instructions>"), msg("<INSTRUCTIONS>x</INSTRUCTIONS>"),
                msg("# Plan\nRefactor the parser"), msg("<task>fix the login bug</task>")]
        r = EX.codex(write_jsonl(self.tmp / "c.jsonl", rows))
        self.assertEqual(r["prompts"], 2)

    def test_truncated_mode_line_does_not_lose_session(self):
        p = self.tmp / "t.jsonl"
        good = json.dumps({"type": "user", "entrypoint": "cli", "timestamp": "2026-10-01T00:00:00Z",
                           "message": {"content": "hello"}}, separators=(",", ":"))
        p.write_text('{"type":"permission-mode","permissionMo\n' + good + "\n")
        r = EX.claude(str(p))
        self.assertEqual(r["prompts"], 1)


def embedded_json(html: str) -> dict:
    start = html.index('<script type="application/json" id="report-data">') + len('<script type="application/json" id="report-data">')
    return json.loads(html[start:html.index("</script>", start)])


class RenderRegressions(unittest.TestCase):
    def test_embedded_json_round_trips_with_html_markers(self):
        j = judgments(lambda p: "part")
        nasty = "<!-- c --> </script> & \u2028 \u2029 <b>"
        j["items"][PRACTICES["practices"][0]["id"]]["evidence"] = nasty
        html = BR.render(BR.build_data(PRACTICES, j))
        self.assertEqual(embedded_json(html)["items"][0]["evidence"], nasty)
        self.assertNotIn("<!--", html.split('id="report-data">', 1)[1].split("</script>", 1)[0])

    def test_all_na_has_no_score_or_grade(self):
        data = BR.build_data(PRACTICES, judgments(lambda p: "na"))
        self.assertIsNone(data["score"])
        self.assertIsNone(data["grade"])
        self.assertEqual(data["ladder"], [])
        self.assertTrue(all(d["score"] is None and d["grade"] is None for d in data["dimensions"]))
        html = BR.render(data)
        self.assertIsNone(embedded_json(html)["score"])
        self.assertIn("noData", html)


class GateSemantics(TmpCase):
    PAGE = "<html><body>" + ("filler text " * 60) + "Keep it short. More words.</body></html>"

    def run_gate(self, fetch_result, digest_status=None):
        src = self.tmp / "sources"
        src.mkdir(exist_ok=True)
        if digest_status:
            (src / "demo.md").write_text(DIGEST.format(status=digest_status), encoding="utf-8")
        pfile = self.tmp / "p.json"
        pfile.write_text(json.dumps(demo_practices()))
        out = io.StringIO()
        with mock.patch.object(CP, "fetch", return_value=fetch_result), contextlib.redirect_stdout(out):
            rc = CP.main([str(pfile), "--fetch", "--sources-dir", str(src)])
        return rc, out.getvalue()

    def test_unreachable_page_with_digest_passes_as_digest_verified(self):
        rc, out = self.run_gate((None, "unreachable (timeout)", "https://code.claude.com/docs/en/demo"), "unreachable")
        self.assertEqual(rc, 0, out)
        self.assertIn("digest-verified", out)

    def test_unreachable_page_without_digest_fails(self):
        src = self.tmp / "sources"
        src.mkdir()
        pfile = self.tmp / "p.json"
        pfile.write_text(json.dumps(demo_practices()))
        with mock.patch.object(CP, "fetch", return_value=(None, "dead (HTTP 404)", "u")), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(CP.check_gate(CP.check_live(demo_practices(), str(src))), 1)

    def test_reachable_page_missing_quote_fails(self):
        page = "<html><body>" + ("filler text " * 60) + "</body></html>"
        rc, out = self.run_gate((page, None, "https://code.claude.com/docs/en/demo"), "ok")
        self.assertEqual(rc, 1, out)

    def test_reachable_page_with_quote_passes(self):
        rc, out = self.run_gate((self.PAGE, None, "https://code.claude.com/docs/en/demo"), "ok")
        self.assertEqual(rc, 0, out)


class ReReviewRegressions(TmpCase):
    def test_symlinked_report_file_into_repo_is_refused(self):
        repo = make_repo(self.tmp)
        target = repo / "sub" / "victim.html"
        target.write_text("original")
        out = self.tmp / "out"
        out.mkdir()
        (out / "report.html").symlink_to(target)
        j = self.tmp / "j.json"
        j.write_text(json.dumps(judgments(lambda p: "ok")))
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            rc = BR.main(["--judgments", str(j), "--out-dir", str(out), "--previous", "none"])
        self.assertNotEqual(rc, 0)
        self.assertEqual(target.read_text(), "original")
        self.assertFalse((out / "report-data.json").exists())

    def test_symlinked_file_target_is_refused_even_outside_repo(self):
        (self.tmp / "real.json").write_text("{}")
        (self.tmp / "link.json").symlink_to(self.tmp / "real.json")
        with self.assertRaises(SO.UnsafeOutput):
            SO.safe_file_target(str(self.tmp / "link.json"))
        self.assertTrue(SO.safe_file_target(str(self.tmp / "new.json")).endswith("new.json"))

    def test_veto_applies_to_invalid_verdicts(self):
        bad = CO.parse_verdict(raw(verdict="reject", quote_found=False, faithful="false"))
        self.assertTrue(bad["invalid"])
        r = CO.decide([CO.parse_verdict(raw()), CO.parse_verdict(raw()), bad], ["a", "b", "c"])
        self.assertEqual(r["decision"], "reject")
        self.assertEqual(r["vetoed_by"], ["c"])

    def test_veto_applies_without_verdict_key(self):
        bad = CO.parse_verdict('{"quote_found": false, "faithful": true, "checkable": true}')
        self.assertIsNotNone(bad)
        self.assertTrue(bad["invalid"])
        r = CO.decide([CO.parse_verdict(raw()), CO.parse_verdict(raw()), bad], ["a", "b", "c"])
        self.assertEqual(r["decision"], "reject")
        self.assertEqual(r["vetoed_by"], ["c"])

    def test_unparseable_outputs_count_toward_total(self):
        r = CO.decide([CO.parse_verdict(raw()), CO.parse_verdict(raw()), None, None], ["a", "b", "c", "d"])
        self.assertEqual(r["consensus"]["total"], 4)
        self.assertEqual(r["decision"], "reject")
        r = CO.decide([CO.parse_verdict(raw()), CO.parse_verdict(raw()), None], ["a", "b", "c"])
        self.assertEqual(r["decision"], "accept")  # 2 of 3 is a majority


class LaneBRegressions(TmpCase):
    def test_non_object_log_lines_do_not_discard_session(self):
        cases = {
            "claude": claude_rows(),
            "codex": [{"type": "session_meta", "payload": {"originator": "codex-tui"}},
                      {"type": "event_msg", "payload": {"type": "user_message", "message": "你好"}}],
            "grok": [{"type": "user", "content": "<user_query>你好</user_query>"}],
            "workbuddy": [{"type": "message", "role": "user", "content": "<user_query>你好</user_query>"}],
        }
        for host, rows in cases.items():
            with self.subTest(host=host):
                path = write_jsonl(self.tmp / host / "s.jsonl", [None, ["session_meta"], *rows])
                result = EX.work((host, path))
                self.assertNotIn("error", result)
                self.assertGreater(result["prompts"], 0)

    def test_claude_mode_is_independent_of_json_spacing(self):
        path = self.tmp / "session.jsonl"
        path.write_text(json.dumps({"type": "permission-mode", "permissionMode": "plan"}) + "\n" +
                        "\n".join(json.dumps(r) for r in claude_rows()[1:]))
        self.assertEqual(EX.claude(str(path))["modes"]["plan"], 1)

    def test_discovery_overlapping_globs_count_file_once(self):
        path = write_jsonl(self.tmp / "s.jsonl", claude_rows())
        with mock.patch.dict(os.environ, {"AGENT_PRACTICE_AUDIT_CLAUDE_GLOBS": str(self.tmp / "*.jsonl")}):
            items, report = EX.discover(["claude"], 0, {"extraRoots": {"claude": [path]}})
        self.assertEqual(items, [("claude", path)])
        self.assertEqual(report["claude"]["files"], 1)

    def test_report_rejects_duplicate_practice_ids(self):
        practices = {**PRACTICES, "practices": PRACTICES["practices"] + [PRACTICES["practices"][0]]}
        with self.assertRaisesRegex(BR.InputError, "duplicate"):
            BR.build_data(practices, judgments(lambda p: "part"))

    def test_previous_report_ignores_invalid_statuses(self):
        previous = {"items": [{"id": p["id"], "status": "unknown"} for p in PRACTICES["practices"]]}
        data = BR.build_data(PRACTICES, judgments(lambda p: "ok"), previous=previous)
        self.assertIsNone(data["scoreDelta"])
        self.assertTrue(all(i["trend"] == "new" for i in data["items"]))

    def test_codex_fallback_does_not_read_env_values(self):
        (self.tmp / "config.toml").write_text('[mcp_servers.demo.env]\nmodel = "SYNTHETIC_SECRET"\n')
        with mock.patch.object(CS, "tomllib", None):
            self.assertNotIn("SYNTHETIC_SECRET", json.dumps(CS.codex_config(str(self.tmp))))

    def test_codex_allowlisted_keys_do_not_emit_nested_secrets(self):
        (self.tmp / "config.toml").write_text('model = { api_key = "SYNTHETIC_SECRET" }\n')
        self.assertNotIn("SYNTHETIC_SECRET", json.dumps(CS.codex_config(str(self.tmp))))
        (self.tmp / "config.toml").write_text("model = { api_key = 'SYNTHETIC_SECRET' }\n")
        with mock.patch.object(CS, "tomllib", None):
            self.assertNotIn("SYNTHETIC_SECRET", json.dumps(CS.codex_config(str(self.tmp))))


class SessionWindow(TmpCase):
    CUTOFF = EX.epoch("2026-10-15T00:00:00Z")

    def test_fresh_mtime_with_old_events_is_dropped(self):
        path = write_jsonl(self.tmp / "s.jsonl", claude_rows())  # events on 2026-10-01, mtime now
        self.assertFalse(EX.in_window(EX.claude(path), self.CUTOFF))

    def test_session_running_into_window_is_kept_and_marked(self):
        r = {"start": "2026-10-14T23:00:00Z", "end": "2026-10-15T01:00:00Z"}
        self.assertTrue(EX.in_window(r, self.CUTOFF))
        self.assertTrue(r["spansCutoff"])

    def test_session_inside_window_is_not_marked(self):
        r = {"start": "2026-10-20T10:00:00+08:00", "end": "2026-10-20T11:00:00+08:00"}
        self.assertTrue(EX.in_window(r, self.CUTOFF))
        self.assertNotIn("spansCutoff", r)

    def test_session_without_timestamps_falls_back_to_mtime(self):
        self.assertTrue(EX.in_window({"start": None, "end": None}, self.CUTOFF))
        self.assertTrue(EX.in_window({"start": None, "end": "not a date"}, self.CUTOFF))


if __name__ == "__main__":
    unittest.main()
