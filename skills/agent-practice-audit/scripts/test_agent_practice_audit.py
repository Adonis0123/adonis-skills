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
             {"type": "tool_use", "name": "Bash", "input": {"command": "pnpm test && git worktree add ../wt-x"}},
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
        for tag in ("bash:test", "bash:worktree", "Agent:Explore"):
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
        self.assertEqual(r["shape"], EX.prompt_shape("fix the flaky test"))
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
        self.assertEqual(r["shape"], EX.prompt_shape("add tests"))
        self.assertEqual(r["tools"]["bash:test"], 1)
        self.assertEqual(r["tools"]["ask_user_question"], 1)
        self.assertEqual(r["denials"], 1)
        self.assertEqual(r["interrupts"], 1)
        self.assertEqual(r["compactions"], 2)
        self.assertIn("yolo", r["modes"])
        self.assertEqual(r["cwd"], "(outside ~)/app")
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
        self.assertEqual({k: steps[0][k] for k in ("grade", "score", "add", "total")},
                         {"grade": "A", "score": 83, "add": ["n1"], "total": 1})
        self.assertEqual(steps[0]["fixes"], [{"id": "n1", "fixKind": None, "heuristic": False}])
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


def git_branch(root: Path, branch: str) -> None:
    """Make root a git work tree on `branch` (no commits needed for the branch check)."""
    import subprocess
    subprocess.run(["git", "init", "-q", "-b", branch, str(root)], check=True, capture_output=True)


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
        git_branch(self.tmp, "practices-refresh/test")
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


# ---------------------------------------------------------------- scoring integrity (coverage, trends, evidence)

def mk_practices(dims: dict[str, int], extra: dict | None = None) -> dict:
    """Synthetic practices: dims maps dimension -> count; ids are <dim>-<n>. No sources dir needed."""
    out = []
    for d, n in dims.items():
        for k in range(1, n + 1):
            out.append({"id": f"{d}-{k}", "dimension": d, "title": f"{d} {k}", "detect": "d", "verifiedAt": "2026-10-31",
                        "sources": [{"source": "demo", "page": "Demo", "url": "https://code.claude.com/docs/en/demo",
                                     "quote": "Keep it short.", "fragment": "Keep it short"}], **(extra or {})})
    return {"dimensions": {d: {"en": d, "zh": d} for d in dims}, "practices": out}


def jd(statuses: dict[str, str], lang: str = "en") -> dict:
    return {"lang": lang, "items": {i: {"status": s, "evidence": f"e {i}", "suggestion": "s"} for i, s in statuses.items()}}


def build(practices, statuses, **kw):
    return BR.build_data(practices, jd(statuses), sources_dir=None, **kw)


class CoverageGrade(unittest.TestCase):
    P = mk_practices({"ctx": 10, "safe": 10})

    def statuses(self, ok=0, no=0):
        ids = [p["id"] for p in self.P["practices"]]
        return {i: "ok" if n < ok else "no" if n < ok + no else "na" for n, i in enumerate(ids)}

    def test_one_ok_and_nineteen_na_gets_no_grade(self):
        data = build(self.P, self.statuses(ok=1))
        self.assertEqual(data["score"], 100)
        self.assertIsNone(data["grade"])
        self.assertEqual(data["gradeWithheld"], "low-coverage")
        self.assertEqual(data["coverage"], {"measured": 1, "total": 20, "pct": 5})
        self.assertEqual(data["ladder"], [])
        self.assertEqual(data["neededForGrade"], 12)
        lines = "\n".join(BR.summary_lines(data))
        self.assertIn("coverage too low", lines)
        self.assertIn("coverage 1/20 measured (5%)", lines)
        self.assertNotIn("Hands-off", lines)

    def test_grade_needs_sixty_percent_measured(self):
        self.assertIsNone(build(self.P, self.statuses(ok=11))["grade"])  # 55%
        at = build(self.P, self.statuses(ok=12))  # 60%: exactly enough
        self.assertEqual((at["grade"], at["gradeWithheld"]), ("S", None))
        self.assertIn("grade: S  coverage 12/20 measured (60%)", BR.summary_lines(at)[0])
        self.assertIsNone(build(mk_practices({"ctx": 200}), {f"ctx-{k}": "ok" if k <= 119 else "na"
                                                             for k in range(1, 201)})["grade"])  # 59.5% never rounds up

    def test_dimension_under_half_measured_shows_dash(self):
        st = self.statuses(ok=10, no=4)  # ctx 10/10 measured, safe 4/10
        data = build(self.P, st)
        dims = {d["id"]: d for d in data["dimensions"]}
        self.assertEqual((dims["ctx"]["score"], dims["ctx"]["lowCoverage"]), (100, False))
        self.assertEqual((dims["safe"]["score"], dims["safe"]["grade"], dims["safe"]["lowCoverage"]), (None, None, True))
        self.assertEqual(dims["safe"]["measuredScore"], 0)
        self.assertEqual(dims["safe"]["coverage"]["measured"], 4)
        st[next(i for i, s in st.items() if s == "na")] = "no"  # safe 5/10 = 50%: shown
        self.assertEqual({d["id"]: d["score"] for d in build(self.P, st)["dimensions"]}["safe"], 0)
        self.assertIn("safe — (4/10)", "\n".join(BR.summary_lines(data)))

    def test_html_carries_coverage_and_withheld_grade(self):
        data = build(self.P, self.statuses(ok=1))
        emb = embedded_json(BR.render(data))
        self.assertEqual((emb["grade"], emb["coverage"]["measured"], emb["minCoverage"]), (None, 1, 60))
        tpl = Path(BR.TEMPLATE).read_text(encoding="utf-8")
        for needle in ("测量覆盖不足", "Coverage too low", "lowCovNote", "withheld"):
            self.assertIn(needle, tpl)


class TrendIntegrity(unittest.TestCase):
    P = mk_practices({"ctx": 10, "safe": 10})

    def test_na_shift_cannot_look_like_a_jump(self):
        ids = [p["id"] for p in self.P["practices"]]
        prev = build(self.P, {i: "ok" if n == 0 else "no" for n, i in enumerate(ids)}, date="2026-09-01")  # 1/19 = 5
        cur = build(self.P, {i: "ok" if n == 0 else "na" for n, i in enumerate(ids)}, previous=prev)  # 1/1 = 100
        self.assertEqual((prev["score"], cur["score"]), (5, 100))
        c = cur["comparison"]
        self.assertEqual((cur["scoreDelta"], c["compared"]), (0, 1))  # only ctx-1 was measured both times
        self.assertEqual((c["coverageBefore"]["pct"], c["coverageAfter"]["pct"], c["coverageDelta"]), (100, 5, -95))
        self.assertEqual(len(c["noLongerMeasured"]), 19)
        lines = "\n".join(BR.summary_lines(cur))
        self.assertIn("delta +0 on 1 practice(s) measured both times", lines)
        self.assertIn("coverage 100% -> 5% (-95)", lines)

    def test_added_and_removed_practices_are_listed_not_scored(self):
        prev = build(mk_practices({"ctx": 3}), {"ctx-1": "no", "ctx-2": "no", "ctx-3": "no"}, date="2026-09-01")
        cur = build(mk_practices({"ctx": 2, "safe": 1}), {"ctx-1": "ok", "ctx-2": "no", "safe-1": "ok"}, previous=prev)
        c = cur["comparison"]
        self.assertEqual((c["added"], c["removed"], c["compared"]), (["safe-1"], ["ctx-3"], 2))
        self.assertEqual(cur["scoreDelta"], 50)  # ctx-1 no->ok over the 2 shared practices, not 67 - 0
        dims = {d["id"]: d for d in cur["dimensions"]}
        self.assertEqual(dims["ctx"]["delta"], 50)
        self.assertIsNone(dims["safe"]["delta"])  # nothing to compare against


class EvidenceEnforcement(TmpCase):
    P = mk_practices({"ctx": 4})

    def test_missing_text_fails_with_actionable_message(self):
        j = jd({"ctx-1": "ok", "ctx-2": "part", "ctx-3": "na", "ctx-4": "no"})
        j["items"]["ctx-1"]["evidence"] = " "
        j["items"]["ctx-2"]["suggestion"] = ""
        j["items"]["ctx-3"] = {"status": "na"}
        j["items"]["ctx-4"].pop("suggestion")
        with self.assertRaises(BR.InputError) as cm:
            BR.build_data(self.P, j, sources_dir=None)
        msg = str(cm.exception)
        self.assertIn("ctx-1 (status ok): field `evidence` is empty", msg)
        self.assertIn("ctx-2 (status part): field `suggestion` is empty", msg)
        self.assertIn("ctx-3 (status na): fields `evidence` and `caveat` are both empty", msg)
        self.assertIn("ctx-4 (status no): field `suggestion`", msg)
        self.assertIn("naming the file, flag or command", msg)

    def test_na_with_caveat_and_ok_without_suggestion_pass(self):
        j = jd({"ctx-1": "ok", "ctx-2": "na", "ctx-3": "na", "ctx-4": "no"})
        j["items"]["ctx-1"]["suggestion"] = ""
        j["items"]["ctx-2"] = {"status": "na", "caveat": "Codex does not log plan mode."}
        j["items"]["ctx-3"] = {"status": "na", "evidence": "No Grok sessions in the window."}
        self.assertEqual(BR.build_data(self.P, j, sources_dir=None)["counts"]["na"], 2)

    def test_allow_missing_still_fills_unjudged_as_na(self):
        j = jd({"ctx-1": "ok"})
        data = BR.build_data(self.P, j, allow_missing=True, sources_dir=None)
        self.assertEqual([i["status"] for i in data["items"]], ["ok", "na", "na", "na"])

    def test_main_reports_gap_and_exits_2(self):
        pfile, jfile = self.tmp / "p.json", self.tmp / "j.json"
        pfile.write_text(json.dumps(self.P))
        j = jd({f"ctx-{k}": "no" for k in range(1, 5)})
        j["items"]["ctx-2"]["suggestion"] = ""
        jfile.write_text(json.dumps(j))
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = BR.main(["--judgments", str(jfile), "--practices", str(pfile), "--out-dir", str(self.tmp / "r"),
                          "--previous", "none"])
        self.assertEqual(rc, 2)
        self.assertIn("ctx-2 (status no): field `suggestion` is empty", err.getvalue())
        self.assertFalse((self.tmp / "r" / "report.html").exists())


class ConsensusVisibility(unittest.TestCase):
    def test_badge_data_and_rule(self):
        p = mk_practices({"ctx": 3})
        p["practices"][0].update({"needs-consensus": True,
                                  "consensus": {"verifiers": ["claude"], "agree": 1, "total": 1, "checkedAt": "2026-10-31"},
                                  "rule": {"text": "ok when under 200 tool calls (heuristic)", "params": {"max_tools": 200}}})
        p["practices"][1].update({"consensus": {"verifiers": ["codex", "gemini", "grok"], "agree": 2, "total": 3,
                                                "checkedAt": "2026-10-31"},
                                  "rule": {"text": "ok when every session uses plan mode", "params": {}}})
        data = build(p, {"ctx-1": "ok", "ctx-2": "ok", "ctx-3": "ok"})
        a, b, c = data["items"]
        self.assertEqual((a["verifiedBy"], a["needsConsensus"]), ("single", True))
        self.assertEqual(a["rule"], {"text": "ok when under 200 tool calls", "params": {"max_tools": 200}, "heuristic": True})
        self.assertEqual((b["verifiedBy"], b["consensus"]["agree"], b["consensus"]["total"]), ("multi", 2, 3))
        self.assertFalse(b["rule"]["heuristic"])
        self.assertEqual((c["verifiedBy"], c["rule"], c["consensus"]), ("single", None, None))  # no record yet
        self.assertEqual(data["consensusCounts"], {"multi": 1, "single": 2})
        self.assertIn("1 multi-model verified, 2 single reviewer awaiting consensus", "\n".join(BR.summary_lines(data)))
        emb = embedded_json(BR.render(data))
        self.assertEqual(emb["items"][1]["verifiedBy"], "multi")
        tpl = Path(BR.TEMPLATE).read_text(encoding="utf-8")
        for needle in ("多模型核验", "单人核对，待共识", "Multi-model verified", "Single reviewer, awaiting consensus",
                       "启发式阈值", "Heuristic threshold"):
            self.assertIn(needle, tpl)


# ---------------------------------------------------------------- check_practices: consensus, rule, pages

class PracticeSchemaIntegrity(TmpCase):
    def one(self, **kw):
        p = demo_practices()
        p["practices"][0].update(kw)
        return "\n".join(CP.validate(p))

    def test_active_practice_must_meet_accept_rule(self):
        self.assertEqual(self.one(), "")  # 2/2
        single = {"verifiers": ["claude"], "agree": 1, "total": 1, "checkedAt": "2026-10-31"}
        self.assertIn("does not meet the accept rule", self.one(consensus=single))
        self.assertEqual(self.one(consensus=single, **{"needs-consensus": True}), "")  # seeds may wait
        self.assertIn("repeats a name", self.one(consensus={"verifiers": ["a", "a"], "agree": 2, "total": 2, "checkedAt": "x"}))
        self.assertIn("does not meet", self.one(consensus={"verifiers": ["a", "b", "c", "d"], "agree": 2, "total": 4, "checkedAt": "x"}))
        self.assertIn("total is 3 but 2", self.one(consensus={"verifiers": ["a", "b"], "agree": 2, "total": 3, "checkedAt": "x"}))
        self.assertIn("veto", self.one(consensus={"verifiers": ["a", "b", "c"], "agree": 2, "total": 3, "checkedAt": "x",
                                                  "vetoed_by": ["c"]}))
        self.assertIn("needs-consensus must be true or false", self.one(**{"needs-consensus": "yes"}))

    def test_rule_is_optional_but_validated(self):
        self.assertEqual(self.one(rule={"text": "ok when < 200 (heuristic)", "params": {"max": 200, "ratio": 0.2}}), "")
        self.assertEqual(self.one(rule={"text": "ok when plan mode is used"}), "")  # params may be absent
        self.assertIn("rule.text must be a non-empty string", self.one(rule={"text": " ", "params": {}}))
        self.assertIn("values must be numbers (not for: max)", self.one(rule={"text": "t", "params": {"max": "200"}}))
        self.assertIn("not for: flag", self.one(rule={"text": "t", "params": {"flag": True}}))
        self.assertIn("rule.params must be an object", self.one(rule={"text": "t", "params": [1]}))
        self.assertIn("rule must be an object", self.one(rule="text"))

    def test_schema_line_counts_awaiting_consensus(self):
        p = demo_practices()
        p["practices"][0]["needs-consensus"] = True
        src = self.tmp / "sources"
        src.mkdir()
        (src / "demo.md").write_text(DIGEST.format(status="ok"), encoding="utf-8")
        (self.tmp / "p.json").write_text(json.dumps(p))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(CP.main([str(self.tmp / "p.json"), "--sources-dir", str(src)]), 0)
        self.assertIn("awaiting consensus: 1", out.getvalue())


def tree_state(root: Path) -> dict:
    return {str(p): (p.stat().st_mtime_ns, p.read_bytes()) for p in sorted(root.rglob("*")) if p.is_file()}


class SavePages(TmpCase):
    PAGE = ("<html><head><script>var x = 1;</script><style>p{}</style></head><body><h1>Best practices</h1>"
            + "<p>" + ("Filler sentence here. " * 30) + "</p><p>Keep it <code>short</code>. More &amp; more.</p></body></html>")

    def setup_files(self, practices=None):
        src = self.tmp / "sources"
        src.mkdir(exist_ok=True)
        (src / "demo.md").write_text(DIGEST.format(status="ok"), encoding="utf-8")
        pfile = self.tmp / "p.json"
        pfile.write_text(json.dumps(practices or demo_practices()))
        return pfile, src

    def run_cp(self, argv, fetch_result):
        out = io.StringIO()
        fake = fetch_result if callable(fetch_result) else (lambda url, timeout=20: fetch_result)
        with mock.patch.object(CP, "fetch", side_effect=fake), contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(io.StringIO()):
            rc = CP.main(argv)
        return rc, out.getvalue()

    def test_saves_verbatim_rendered_text(self):
        pfile, src = self.setup_files()
        pages = self.tmp / "pages"
        rc, out = self.run_cp([str(pfile), "--sources-dir", str(src), "--save-pages", str(pages), "--fetch"],
                              (self.PAGE, None, "https://code.claude.com/docs/en/demo"))
        self.assertEqual(rc, 0, out)
        text = (pages / "demo.txt").read_text(encoding="utf-8")
        self.assertIn("Keep it short. More & more.", text)  # case, punctuation and entities kept, tags dropped
        self.assertIn("Best practices\n", text)
        self.assertNotIn("var x", text)
        self.assertTrue(text.startswith("https://code.claude.com/docs/en/demo\n"))
        self.assertIn("page demo: saved", out)
        self.assertIn("live: 1/1 ok", out)  # the gate reused the saved fetch

    def test_unreachable_and_script_rendered_pages_are_not_saved(self):
        p = demo_practices()
        p["pending"] = [{"id": "new-one", "sources": [{"source": "spa", "url": "https://cursor.com/docs/spa"},
                                                       {"source": "evil", "url": "https://example.com/x"}]}]
        pfile, src = self.setup_files(p)
        pages = self.tmp / "pages"

        def fake(url, timeout=20):
            if "spa" in url:
                return "<html><body><div id=root></div></body></html>", None, url
            return None, "unreachable (timeout)", url

        rc, out = self.run_cp([str(pfile), "--sources-dir", str(src), "--save-pages", str(pages)], fake)
        self.assertEqual(rc, 0, out)
        self.assertEqual(sorted(x.name for x in pages.iterdir()), ["manifest.json"])
        self.assertIn("page demo: not saved, unreachable", out)
        self.assertIn("page spa: not saved, looks script-rendered", out)
        self.assertIn("evil: https://example.com/x is not on the official allowlist; not fetched", out)

    def test_candidates_file_adds_pages_and_repo_target_is_refused(self):
        pfile, src = self.setup_files()
        cands = self.tmp / "cands.json"
        cands.write_text(json.dumps([{"id": "c1", "sources": [{"source": "codex-x", "url": "https://developers.openai.com/codex/x"}]}]))
        rc, out = self.run_cp([str(pfile), "--sources-dir", str(src), "--save-pages", str(self.tmp / "pages"),
                               "--candidates", str(cands)], lambda url, timeout=20: (self.PAGE, None, url))
        self.assertEqual(rc, 0, out)
        self.assertEqual(sorted(x.name for x in (self.tmp / "pages").iterdir()), ["codex-x.txt", "demo.txt", "manifest.json"])
        repo = make_repo(self.tmp)
        rc, _ = self.run_cp([str(pfile), "--sources-dir", str(src), "--save-pages", str(repo / "sub" / "pages")],
                            (self.PAGE, None, "u"))
        self.assertEqual(rc, 2)
        self.assertFalse((repo / "sub" / "pages").exists())

    def test_plain_fetch_writes_nothing(self):
        git_branch(self.tmp, "practices-refresh/test")
        pfile, src = self.setup_files()
        before = tree_state(self.tmp)
        for result in ((self.PAGE, None, "https://code.claude.com/docs/en/demo"),
                       (None, "unreachable (timeout)", "https://code.claude.com/docs/en/demo"),
                       (self.PAGE, None, "https://code.claude.com/docs/en/moved")):
            self.run_cp([str(pfile), "--sources-dir", str(src), "--fetch", "--json"], result)
        self.assertEqual(tree_state(self.tmp), before)
        self.run_cp([str(pfile), "--sources-dir", str(src), "--fetch", "--update-digests"],
                    (self.PAGE, None, "https://code.claude.com/docs/en/moved"))
        self.assertNotEqual(tree_state(self.tmp), before)  # only --update-digests writes

    def test_rendered_text_is_searchable_like_page_text(self):
        self.assertEqual(CP.loose(CP.rendered_text(self.PAGE)), CP.page_text(self.PAGE))
        self.assertEqual(CP.rendered_text("<td>a</td><td>b</td>"), "a\nb")  # cells do not run together


class BatchVerdicts(unittest.TestCase):
    def test_rule_faithful_required_only_with_rule(self):
        self.assertFalse(CO.parse_verdict(raw())["invalid"])
        self.assertTrue(CO.parse_verdict(raw(), rule_required=True)["invalid"])
        self.assertTrue(CO.parse_verdict(raw(rule_faithful="true"), rule_required=True)["invalid"])
        v = CO.parse_verdict(raw(rule_faithful=False), rule_required=True)
        self.assertTrue(v["invalid"])  # accept with an unfaithful rule
        self.assertIn("rule_faithful", " ".join(v["problems"]))
        self.assertFalse(CO.parse_verdict(raw(verdict="reject", rule_faithful=False), rule_required=True)["invalid"])
        self.assertFalse(CO.parse_verdict(raw(rule_faithful=True), rule_required=True)["invalid"])

    def test_split_batch(self):
        a, b = json.loads(raw(id="a")), json.loads(raw(id="b"))
        found, problem = CO.split_batch("ok:\n```json\n" + json.dumps([a, b]) + "\n```", ["a", "b"])
        self.assertEqual((sorted(found), problem), (["a", "b"], None))
        found, problem = CO.split_batch(json.dumps([a]), ["a", "b"])
        self.assertEqual((list(found), problem), (["a"], "no verdict for b"))
        _, problem = CO.split_batch(json.dumps([a, b, dict(a, id="zzz")]), ["a", "b"])
        self.assertIn("unknown id 'zzz'", problem)
        veto = dict(a, verdict="reject", quote_found=False)
        found, problem = CO.split_batch(json.dumps([a, b, veto]), ["a", "b"])
        self.assertIn("duplicate id a", problem)
        self.assertIs(found["a"]["quote_found"], False)  # a duplicate never hides a veto
        self.assertEqual(CO.split_batch(raw(), ["a"]), ({"a": json.loads(raw())}, None))  # single: bare object
        self.assertIsNotNone(CO.split_batch(raw(id="b"), ["a"])[1])
        self.assertEqual(CO.split_batch("nothing here", ["a", "b"]), ({}, "no JSON array of per-candidate verdicts found"))

    def test_prompt_lists_all_candidates_once_with_page_once(self):
        c1 = {"id": "c1", "title": "t", "detect": "d", "rule": {"text": "r (heuristic)", "params": {}},
              "sources": [{"source": "p1", "quote": "Q1"}, {"source": "p2", "quote": "Q2"}]}
        c2 = {"id": "c2", "title": "t", "detect": "d", "consensus": {"agree": 1}, "sources": [{"source": "p1", "quote": "Q3"}]}
        out = CO.render_prompt([c1, c2], "PAGE ONE", "live", slug="p1")
        self.assertEqual(out.count("PAGE ONE"), 1)
        block = json.loads(out.split("<<<CANDIDATES", 1)[1].split("CANDIDATES>>>", 1)[0])
        self.assertEqual([e["id"] for e in block], ["c1", "c2"])
        self.assertEqual(block[0]["check_sources"], [{"source": "p1", "quote": "Q1"}])
        self.assertEqual(block[0]["quotes_on_other_pages"], [{"source": "p2", "quote": "Q2"}])
        self.assertEqual(block[0]["rule"]["text"], "r (heuristic)")
        self.assertNotIn("consensus", block[1])
        self.assertIn("rule_faithful", out)



# ---------------------------------------------------------------- round 3 regressions

class RefreshWriteBoundary(TmpCase):
    def digest(self, root: Path) -> Path:
        d = root / "sources"
        d.mkdir(parents=True, exist_ok=True)
        f = d / "demo.md"
        f.write_text(DIGEST.format(status="ok"), encoding="utf-8")
        return f

    def test_guard_rules(self):
        outside = self.digest(self.tmp / "installed")
        self.assertIn("installed copy", DG.refresh_write_problem(str(outside)))
        with self.assertRaises(DG.RefreshWriteRefused):
            DG.update_frontmatter(str(outside), {"linkStatus": "ok"})
        repo = self.tmp / "clone"
        repo.mkdir()
        git_branch(repo, "main")
        f = self.digest(repo)
        self.assertIn("default branch main", DG.refresh_write_problem(str(f)))
        self.assertIsNone(DG.refresh_write_problem(str(f), allow_default_branch=True))
        import subprocess
        subprocess.run(["git", "-C", str(repo), "checkout", "-q", "-b", "practices-refresh/x"], check=True)
        self.assertIsNone(DG.refresh_write_problem(str(f)))
        link = repo / "sources" / "link.md"
        link.symlink_to(f)
        self.assertIn("is a symlink", DG.refresh_write_problem(str(link)))
        skills = self.tmp / "home" / "skills"
        skills.mkdir(parents=True)
        (skills / "apa").symlink_to(repo)  # an install that links into the clone
        self.assertIn("symlink", DG.refresh_write_problem(str(skills / "apa" / "sources" / "demo.md")))

    def test_update_digests_refused_on_default_branch_before_fetch(self):
        repo = self.tmp / "clone"
        repo.mkdir()
        git_branch(repo, "main")
        f = self.digest(repo)
        before = f.read_text()
        pfile = self.tmp / "p.json"
        pfile.write_text(json.dumps(demo_practices()))
        err = io.StringIO()
        with mock.patch.object(CP, "fetch") as fetch, contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = CP.main([str(pfile), "--fetch", "--update-digests", "--sources-dir", str(repo / "sources")])
        self.assertEqual(rc, 2)
        fetch.assert_not_called()
        self.assertIn("--allow-default-branch", err.getvalue())
        self.assertEqual(f.read_text(), before)
        page = "<html><body>" + ("filler text " * 60) + "Keep it short.</body></html>"
        with mock.patch.object(CP, "fetch", return_value=(page, None, "https://code.claude.com/docs/en/demo")), \
                contextlib.redirect_stdout(io.StringIO()):
            rc = CP.main([str(pfile), "--fetch", "--update-digests", "--allow-default-branch", "--sources-dir", str(repo / "sources")])
        self.assertEqual(rc, 0)
        self.assertIn(f"lastVerifiedAt: {__import__('datetime').date.today().isoformat()}", f.read_text())


class PageManifest(TmpCase):
    def test_failed_fetch_marks_old_file_stale(self):
        pages = self.tmp / "pages"
        page = "<html><body>" + ("filler text " * 60) + "Keep it short.</body></html>"
        url = "https://code.claude.com/docs/en/demo"
        CP.save_pages({"demo": url}, {url: (page, None, url)}, str(pages))
        m = json.loads((pages / DG.MANIFEST).read_text())["pages"]["demo"]
        self.assertEqual(m["status"], "fresh")
        self.assertEqual(m["sha256"], DG.sha256_file(str(pages / "demo.txt")))
        self.assertEqual(list(DG.fresh_pages(str(pages))[0]), ["demo"])
        CP.save_pages({"demo": url}, {url: (None, "unreachable (timeout)", url)}, str(pages))
        self.assertTrue((pages / "demo.txt").exists())  # the old file is still there ...
        self.assertEqual(DG.fresh_pages(str(pages))[0], {})  # ... but no longer counts as live
        self.assertEqual(json.loads((pages / DG.MANIFEST).read_text())["pages"]["demo"]["status"], "unreachable")


class RuleChangeTrend(unittest.TestCase):
    def test_changed_rule_is_marked_and_left_out_of_delta(self):
        p = mk_practices({"ctx": 3})
        for x in p["practices"]:
            x["rule"] = {"text": "ok when under 200 (heuristic)", "params": {"max": 200}}
        prev = build(p, {"ctx-1": "no", "ctx-2": "no", "ctx-3": "ok"}, date="2026-09-01")
        self.assertTrue(all(len(i["criteriaHash"]) == 16 for i in prev["items"]))
        q = json.loads(json.dumps(p))
        q["practices"][0]["rule"]["params"]["max"] = 100  # stricter threshold: old status means something else
        q["practices"][1]["detect"] = "new detect text"
        cur = build(q, {"ctx-1": "ok", "ctx-2": "ok", "ctx-3": "ok"}, previous=prev)
        trends = {i["id"]: i["trend"] for i in cur["items"]}
        self.assertEqual(trends, {"ctx-1": "changed-rule", "ctx-2": "changed-rule", "ctx-3": "same"})
        c = cur["comparison"]
        self.assertEqual((c["changedRule"], c["compared"], cur["scoreDelta"]), (["ctx-1", "ctx-2"], 1, 0))
        self.assertIn("rule changed, not in delta: ctx-1, ctx-2", "\n".join(BR.summary_lines(cur)))
        # An older report without hashes cannot show a change, so nothing is excluded.
        old = json.loads(json.dumps(prev))
        for i in old["items"]:
            i.pop("criteriaHash")
        self.assertEqual(build(q, {"ctx-1": "ok", "ctx-2": "ok", "ctx-3": "ok"}, previous=old)["comparison"]["compared"], 3)


class ConfigErrors(TmpCase):
    def test_broken_config_is_a_clear_error(self):
        base = self.tmp / "apa"
        base.mkdir()
        jpath = self.tmp / "j.json"
        jpath.write_text(json.dumps(judgments(lambda p: "ok")))
        for content, needle in (("{not json", "not valid JSON (line 1"), ("[1, 2]", "must hold a JSON object"),
                                ('{"theme": "blue"}', "theme must be an object")):
            (base / "config.json").write_text(content)
            err = io.StringIO()
            with mock.patch.dict(os.environ, {"AGENT_PRACTICE_AUDIT_DIR": str(base)}), \
                    contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                rc = BR.main(["--judgments", str(jpath), "--date", "2026-10-01", "--previous", "none"])
            self.assertEqual(rc, 2, content)
            self.assertIn(needle, err.getvalue())


class LadderFixKinds(unittest.TestCase):
    def test_config_and_vendor_backed_fixes_first_on_ties(self):
        p = mk_practices({"ctx": 6})
        kinds = {"ctx-1": ("habit", False), "ctx-2": ("config", True), "ctx-3": ("config", False), "ctx-4": (None, False)}
        for x in p["practices"]:
            kind, heur = kinds.get(x["id"], (None, False))
            if kind:
                x["fix_kind"] = kind
            x["rule"] = {"text": "rule (heuristic)" if heur else "rule", "params": {}}
        st = {"ctx-1": "no", "ctx-2": "no", "ctx-3": "no", "ctx-4": "no", "ctx-5": "ok", "ctx-6": "ok"}
        data = build(p, st)
        order = [f["id"] for s in data["ladder"] for f in s["fixes"]]
        self.assertEqual(order[:2], ["ctx-3", "ctx-2"])  # config before habit; vendor-backed before heuristic
        fixes = {f["id"]: f for s in data["ladder"] for f in s["fixes"]}
        self.assertEqual(fixes["ctx-2"], {"id": "ctx-2", "fixKind": "config", "heuristic": True})
        self.assertIsNone(fixes["ctx-4"]["fixKind"])  # practices without fix_kind are accepted
        self.assertIn("ctx-2 [config, heuristic]", "\n".join(BR.summary_lines(data)))
        # Bigger gains still win over kind: a no beats a config part.
        p["practices"][4]["fix_kind"] = "config"
        st2 = dict(st, **{"ctx-5": "part", "ctx-3": "ok", "ctx-2": "ok"})
        first = build(p, st2)["ladder"][0]["fixes"][0]["id"]
        self.assertIn(first, ("ctx-1", "ctx-4"))
        tpl = Path(BR.TEMPLATE).read_text(encoding="utf-8")
        for needle in ("配置改动", "习惯改动", "config change", "habit change", "f.heuristic"):
            self.assertIn(needle, tpl)


class TemplateLegibility(unittest.TestCase):
    def test_meter_never_uses_stamp_foreground_and_labels_are_neutral(self):
        tpl = Path(BR.TEMPLATE).read_text(encoding="utf-8")
        self.assertIn("const c = barColor(d.grade);", tpl)
        bar = tpl.split("const barColor", 1)[1].split("\n", 1)[0]
        self.assertNotIn("--s-fg", bar)
        self.assertIn("white-space:nowrap", tpl.split(".dims .val{", 1)[1].split("}", 1)[0])
        self.assertIn('<span class="nw">${esc(it.verifiedAt)}</span>', tpl)
        for word in ("Hands-off", "Trusted partner", "放心交办", "默契搭档"):
            self.assertNotIn(word, tpl)



# ---------------------------------------------------------------- round 4 regressions

class MixedBasis(unittest.TestCase):
    def test_schema_and_report_label(self):
        p = demo_practices()
        src2 = dict(p["practices"][0]["sources"][0], basis="digest")
        p["practices"][0]["sources"].append(src2)
        p["practices"][0]["basis"] = "mixed"
        self.assertEqual(CP.validate(p), [])
        q = json.loads(json.dumps(p))
        q["practices"][0]["sources"][1]["basis"] = "live"
        self.assertIn("basis mixed needs at least one source", "\n".join(CP.validate(q)))
        q["practices"][0]["sources"][1]["basis"] = "cached"
        self.assertIn("a source basis must be live or digest", "\n".join(CP.validate(q)))
        self.assertEqual(BR.effective_basis(p["practices"][0]), "digest")
        r = json.loads(json.dumps(p))
        r["practices"][0]["basis"] = "live"  # a digest source alone is enough for the label
        self.assertEqual(BR.effective_basis(r["practices"][0]), "digest")
        r["practices"][0]["sources"][1].pop("basis")
        self.assertEqual(BR.effective_basis(r["practices"][0]), "live")


class LastVerifiedOnlyLive(TmpCase):
    def test_only_live_verified_pages_get_a_new_date(self):
        git_branch(self.tmp, "practices-refresh/test")
        src = self.tmp / "sources"
        src.mkdir()
        for slug in ("demo", "dead", "partial"):
            (src / f"{slug}.md").write_text(DIGEST.format(status="ok").replace("slug: demo", f"slug: {slug}"), encoding="utf-8")
        res = [{"source": "demo", "status": "live-verified", "linkStatus": "ok", "finalUrl": "u"},
               {"source": "dead", "status": "digest-verified", "linkStatus": "ok", "finalUrl": "u"},  # script-rendered page
               {"source": "partial", "status": "live-verified", "linkStatus": "ok", "finalUrl": "u"},
               {"source": "partial", "status": "quote-missing", "linkStatus": "ok", "finalUrl": "u"}]
        CP.update_digests(res, str(src))
        today = __import__("datetime").date.today().isoformat()
        got = {s: DG.load_digest(s, str(src))["lastVerifiedAt"] for s in ("demo", "dead", "partial")}
        self.assertEqual(got, {"demo": today, "dead": "2026-10-01", "partial": "2026-10-01"})


class HomePathRedaction(unittest.TestCase):
    def test_home_paths_become_tilde_with_a_warning_per_field(self):
        home = os.path.expanduser("~")
        j = jd({"ctx-1": "no", "ctx-2": "ok"})
        j["items"]["ctx-1"]["suggestion"] = f"Edit {home}/.claude/settings.json and " "/Use" "rs/someone/.codex/config.toml."
        j["items"]["ctx-2"]["evidence"] = "Found /home/dev/.claude/CLAUDE.md (40 lines)."
        j["headline"] = f"Config at {home}/.claude"
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            data = BR.build_data(mk_practices({"ctx": 2}), j, sources_dir=None)
        it = {i["id"]: i for i in data["items"]}
        self.assertEqual(it["ctx-1"]["suggestion"], "Edit ~/.claude/settings.json and ~/.codex/config.toml.")
        self.assertEqual(it["ctx-2"]["evidence"], "Found ~/.claude/CLAUDE.md (40 lines).")
        self.assertEqual(data["headline"], "Config at ~/.claude")
        lines = err.getvalue().splitlines()
        self.assertEqual(sorted(lines), sorted(["warning: headline: replaced a home directory path with ~",
                                                "warning: ctx-1 suggestion: replaced a home directory path with ~",
                                                "warning: ctx-2 evidence: replaced a home directory path with ~"]))
        self.assertIn(home, j["items"]["ctx-1"]["suggestion"])  # the caller's judgments are not modified
        self.assertNotIn(home + "/", json.dumps(data))


class DimensionMinimum(unittest.TestCase):
    def test_one_measured_practice_is_not_a_dimension_score(self):
        p = mk_practices({"ctx": 4, "verify": 2})
        st = {"ctx-1": "ok", "ctx-2": "no", "ctx-3": "no", "ctx-4": "ok", "verify-1": "no", "verify-2": "na"}
        data = build(p, st)
        dims = {d["id"]: d for d in data["dimensions"]}
        self.assertEqual((dims["verify"]["score"], dims["verify"]["lowCoverage"]), (None, True))  # 1/2 = 50% but 1 practice
        self.assertEqual(dims["ctx"]["score"], 50)
        self.assertIn("verify — (1/2)", "\n".join(BR.summary_lines(data)))
        self.assertIn("under 2 measured", "\n".join(BR.summary_lines(data)))
        # Tie-break: verify (no shown score) does not count as weakest; ctx (50) is fixed first.
        first = data["ladder"][0]["fixes"][0]["id"]
        self.assertTrue(first.startswith("ctx-"), data["ladder"])


if __name__ == "__main__":
    unittest.main()
