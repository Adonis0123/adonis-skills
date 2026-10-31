#!/usr/bin/env python3
"""Measurement-validity regressions (review letters A-H). All inputs are synthetic and live in temp dirs."""

from __future__ import annotations

import importlib.util
import json
import os
import plistlib
import subprocess
import sys
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
CS = load("config_scan")
CO = load("consensus")
PJ = load("prejudge")
PRACTICES_DOC = json.loads((HERE.parent / "references" / "practices.json").read_text(encoding="utf-8"))
PRACTICES = PRACTICES_DOC["practices"]


def write_jsonl(path: Path, rows: list) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows) + "\n",
                    encoding="utf-8")
    return str(path)


def tags(*calls) -> dict:
    """Tool counter after the given (name, args) calls on a fresh row."""
    r = EX.new_row("claude", "/x/s.jsonl")
    for name, args in calls:
        EX.tool_call(r, name, args)
    return dict(r["tools"])


def claude_entry(kind, ts, **kw):
    return {"type": kind, "timestamp": ts, "entrypoint": kw.pop("entry", "cli"), "cwd": kw.pop("cwd", "/w/app"), **kw}


def claude_session(prompt="fix it", tools=(), entry="cli", cwd="/w/app", start="2026-10-01T10:00:00Z",
                   end="2026-10-01T10:30:00Z") -> list:
    rows = [claude_entry("user", start, entry=entry, cwd=cwd, message={"role": "user", "content": prompt})]
    if tools:
        rows.append(claude_entry("assistant", start, entry=entry, cwd=cwd, message={"model": "m", "content": [
            {"type": "tool_use", "name": n, "input": a} for n, a in tools]}))
    rows.append(claude_entry("user", end, entry=entry, cwd=cwd, message={"content": [{"type": "tool_result", "content": "ok"}]}))
    return rows


class TmpCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(os.path.realpath(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()


# ---------------------------------------------------------------- A: keyword tagging

class A_Tagging(TmpCase):
    def test_only_shell_tools_at_command_position(self):
        self.assertEqual(tags(("Bash", {"command": "echo pytest"})), {"Bash": 1})
        self.assertEqual(tags(("Bash", {"command": "git commit -m \"run pytest and eslint\""})),
                         {"Bash": 1, "bash:commit": 1})
        self.assertEqual(tags(("Bash", {"command": "cat <<'EOF'\npytest -q\nEOF"}))["Bash"], 1)
        self.assertNotIn("bash:test", tags(("Bash", {"command": "cat <<'EOF'\npytest -q\nEOF"})))
        for cmd, tag in (("cd app && pnpm -s test", "test"), ("ls | xargs -n1 eslint", "lint"),
                         ("npx vitest run", "test"), ("FOO=1 uv run pytest", "test"), ("python3 -m unittest t", "test"),
                         ("pnpm --filter web run typecheck", "typecheck"), ("bash -lc 'go test ./...'", "test"),
                         ("git -C repo diff", "git_diff"), ("claude -p 'hi'", "headless"), ("codex exec -", "headless")):
            self.assertEqual(tags(("Bash", {"command": cmd})).get("bash:" + tag), 1, cmd)
        # Non-shell tools never produce bash:* tags, even with a "command" or "input" argument.
        self.assertEqual(tags(("Monitor", {"command": "pytest"})), {"Monitor": 1})
        self.assertEqual(tags(("WebFetch", {"input": "pnpm test"})), {"WebFetch": 1})

    def test_codex_patch_and_code_cells(self):
        patch = "*** Begin Patch\n*** Update File: a.py\n+# run pytest here\n*** Add File: b.py\n+x\n*** End Patch"
        cell = ('const r = await tools.exec_command({cmd: "pnpm test && git diff"});\n'
                'await tools.apply_patch("' + patch.replace("\n", "\\n") + '");\ntext(r)')
        rows = [{"type": "session_meta", "timestamp": "2026-10-02T09:00:00Z", "payload": {"originator": "codex-tui"}},
                {"type": "event_msg", "payload": {"type": "user_message", "message": "go"}},
                {"type": "response_item", "payload": {"type": "custom_tool_call", "name": "apply_patch", "input": patch}},
                {"type": "response_item", "payload": {"type": "custom_tool_call", "name": "exec", "input": "echo pytest"}},
                {"type": "response_item", "payload": {"type": "custom_tool_call", "name": "exec", "input": cell}}]
        r = EX.codex(write_jsonl(self.tmp / "c.jsonl", rows))
        self.assertEqual(r["tools"]["bash:test"], 1)  # from the exec_command cmd only, not the patch or echo text
        self.assertEqual(r["tools"]["bash:git_diff"], 1)
        self.assertEqual((r["tools"]["exec_command"], r["tools"]["apply_patch"], r["tools"]["exec"]), (1, 2, 1))
        self.assertEqual(r["edited_files"], 2)

    def test_screenshots(self):
        self.assertNotIn("bash:screenshot", tags(("Read", {"file_path": "/tmp/design.png"})))
        self.assertNotIn("bash:screenshot", tags(("mcp__figma__get_screenshot", {})))
        self.assertEqual(tags(("mcp__browser__take_screenshot", {}))["bash:screenshot"], 1)
        self.assertEqual(tags(("mcp__claude-in-chrome__computer", {"action": "screenshot"}))["bash:screenshot"], 1)
        batch = {"actions": [{"name": "navigate", "input": {}}, {"name": "computer", "input": {"action": "screenshot"}}]}
        self.assertEqual(tags(("mcp__claude-in-chrome__browser_batch", batch))["bash:screenshot"], 1)
        # Reading back an image the session produced counts; any other image read does not.
        t = tags(("Bash", {"command": "npm run build && screencapture -x /tmp/shot.png"}),
                 ("Read", {"file_path": "/tmp/shot.png"}), ("Read", {"file_path": "/tmp/other.png"}))
        self.assertEqual(t["bash:screenshot"], 2)

    def test_worktree_sources(self):
        self.assertEqual(tags(("EnterWorktree", {"name": "x"}))["bash:worktree"], 1)
        self.assertEqual(tags(("Bash", {"command": "claude --worktree feat"}))["bash:worktree"], 1)
        self.assertNotIn("bash:worktree", tags(("Bash", {"command": "echo git worktree"})))
        r = EX.claude(write_jsonl(self.tmp / "w.jsonl", claude_session(cwd="/w/app/.claude/worktrees/feat")))
        self.assertEqual(r["tools"]["bash:worktree"], 1)
        s = AG.aggregate([EX.claude(write_jsonl(self.tmp / f"{i}.jsonl", claude_session(cwd=c)))
                          for i, c in enumerate(("/w/app/.claude/worktrees/feat", "/w/app/.worktrees/b", "/w/app"))])
        self.assertEqual(s["hosts"]["claude"]["cwd_top"], [["(outside ~)/app", 3]])


# ---------------------------------------------------------------- B: aggregate

class B_Aggregate(TmpCase):
    def test_subagent_concept(self):
        reads_output = EX.finish(dict(EX.new_row("grok", "/x"), prompts=1, prompt_chars=1))
        reads_output["tools"]["get_command_or_subagent_output"] += 1
        spawns = EX.finish(dict(EX.new_row("grok", "/y"), prompts=1, prompt_chars=1))
        spawns["tools"]["spawn_subagent"] += 1
        self.assertFalse(AG.has_concept(reads_output, "subagent"))
        self.assertTrue(AG.has_concept(spawns, "subagent"))

    def test_malformed_line_is_an_error_not_an_abort(self):
        good = EX.claude(write_jsonl(self.tmp / "a.jsonl", claude_session()))
        path = self.tmp / "sessions.jsonl"
        path.write_text(json.dumps(good, default=dict) + "\n{not json\n[1,2]\n" + json.dumps({"host": "x", "error": "E"}) + "\n")
        rows, errors = AG.load_rows(str(path))
        self.assertEqual((len(rows), errors), (1, 3))
        out = self.tmp / "summary.json"
        self.assertEqual(AG.main([str(path), "-o", str(out)]), 0)
        self.assertEqual(json.loads(out.read_text())["errors"], 3)

    def test_full_access_is_per_turn(self):
        def turn(approval, sandbox):
            return {"type": "turn_context", "payload": {"approval_policy": approval, "sandbox_policy": {"type": sandbox}}}
        base = [{"type": "session_meta", "payload": {"originator": "codex-tui"}},
                {"type": "event_msg", "payload": {"type": "user_message", "message": "go"}}]
        split = EX.codex(write_jsonl(self.tmp / "s.jsonl", base + [turn("never", "workspace-write"),
                                                                    turn("on-request", "danger-full-access")]))
        joint = EX.codex(write_jsonl(self.tmp / "j.jsonl", base + [turn("never", "danger-full-access")]))
        self.assertFalse(AG.full_access(split))
        self.assertTrue(AG.full_access(joint))


# ---------------------------------------------------------------- C: unknown entrypoints

class C_Entrypoints(TmpCase):
    def test_missing_entrypoint_is_unknown(self):
        rows = claude_session()
        for r in rows:
            r.pop("entrypoint")
        unknown = EX.claude(write_jsonl(self.tmp / "u.jsonl", rows))
        self.assertEqual(unknown["kind"], "unknown")
        self.assertEqual(EX.claude(write_jsonl(self.tmp / "n.jsonl", claude_session(entry="new-thing")))["kind"], "unknown")
        self.assertEqual(EX.claude(write_jsonl(self.tmp / "h.jsonl", claude_session(entry="sdk-cli")))["kind"], "headless")
        human = EX.claude(write_jsonl(self.tmp / "c.jsonl", claude_session()))
        s = AG.aggregate([json.loads(json.dumps(r, default=dict)) for r in (unknown, human)])
        self.assertEqual((s["hosts"]["claude"]["sessions"], s["headless"]["sessions"], s["unknown"]["sessions"]), (1, 0, 1))
        self.assertEqual(PJ.prejudge(s, {}, PRACTICES)["counts"]["claude"]["unknown"], 1)

    def test_extract_host_line_reports_unknown(self):
        proj = self.tmp / "c"
        rows = claude_session()
        for r in rows:
            r.pop("entrypoint")
            r["timestamp"] = "2099-01-01T00:00:00Z"
        write_jsonl(proj / "a.jsonl", rows)
        env = {k: v for k, v in os.environ.items() if not k.startswith("AGENT_PRACTICE_AUDIT")}
        env.update(HOME=str(self.tmp), AGENT_PRACTICE_AUDIT_CLAUDE_GLOBS=str(proj / "*.jsonl"))
        p = subprocess.run([sys.executable, str(HERE / "extract.py"), str(self.tmp / "out.jsonl"), "--hosts", "claude"],
                           capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("human=0", p.stdout)
        self.assertIn("headless=0", p.stdout)
        self.assertIn("unknown=1", p.stdout)

    def test_injected_claude_entries_are_not_prompts(self):
        rows = claude_session()
        rows.insert(1, claude_entry("user", "2026-10-01T10:01:00Z", isMeta=True,
                                    message={"content": [{"type": "text", "text": "Base directory for this skill: x\n不对"}]}))
        rows.insert(1, claude_entry("user", "2026-10-01T10:01:00Z",
                                    message={"content": "<task-notification>done, 不对</task-notification>"}))
        r = EX.claude(write_jsonl(self.tmp / "m.jsonl", rows))
        self.assertEqual((r["prompts"], r["corrections"]), (1, 0))

    def test_workbuddy_scheduled_automation_is_headless(self):
        text = ("<system><automation_system_reminder>The task instructions are provided in <user_query>.\nYou MUST"
                "</automation_system_reminder></system><user_query>summarise the morning news briefly</user_query>")
        rows = [{"type": "message", "role": "user", "timestamp": 1790000001000,
                 "content": [{"type": "input_text", "text": text}]}]
        r = EX.workbuddy(write_jsonl(self.tmp / "wb.jsonl", rows))
        self.assertEqual((r["kind"], r["shape"], r.get("scheduled")),
                         ("headless", EX.prompt_shape("summarise the morning news briefly"), True))

    def test_grok_subagent_session_kind(self):
        d = self.tmp / ".grok" / "sessions" / "p" / "1"
        write_jsonl(d / "chat_history.jsonl", [{"type": "user", "content": "<user_query>x</user_query>"}])
        (d / "summary.json").write_text(json.dumps({"session_kind": "subagent_fork"}))
        self.assertEqual(EX.grok(str(d / "chat_history.jsonl"))["kind"], "subagent")


# ---------------------------------------------------------------- D: config scan

class D_ConfigScan(TmpCase):
    def scan(self, repos=()):
        with mock.patch.object(CS, "HOME", str(self.tmp)):
            return CS.scan([str(r) for r in repos], crontab=False)

    def test_non_object_settings_are_reported_unreadable(self):
        root = self.tmp / ".claude"
        root.mkdir()
        (root / "settings.json").write_text("[]")
        (root / "settings.local.json").write_text(json.dumps({"permissions": [], "hooks": {"PreToolUse": [1, {"hooks": "x"}]},
                                                              "env": ["A"]}))
        out = self.scan()["claude"][0]
        self.assertEqual(out["settings.json"], {"unreadable": True})
        self.assertEqual(out["settings.local.json"]["deny_count"], 0)
        self.assertEqual(out["settings.local.json"]["hook_entries"], 0)
        doc = PJ.prejudge({}, self.scan(), PRACTICES)  # prejudge skips the unreadable file
        self.assertEqual(len(doc["practices"]), len(PRACTICES))

    def test_command_mentions_and_must_rules(self):
        f = self.tmp / "AGENTS.md"
        f.write_text("Write a test for every change. Keep lint warnings low.\n")
        info = CS.instruction_file(str(f))
        self.assertEqual((info["mentions_test"], info["mentions_lint"], info["must_rules"]), (False, False, 0))
        f.write_text("Run `pnpm test` and `ruff check .` before you finish.\nNever push to main.\n## Compact instructions\n")
        info = CS.instruction_file(str(f))
        self.assertEqual((info["mentions_test"], info["mentions_lint"], info["must_rules"]), (True, True, 1))
        self.assertTrue(info["compact_instructions"])

    def test_enforcing_hooks_and_project_settings(self):
        hooks = {"SessionStart": [{"hooks": [{}, {}]}], "Notification": [{"hooks": [{}]}],
                 "PreToolUse": [{"hooks": [{}]}], "Stop": [{"hooks": [{}]}]}
        repo = self.tmp / "repo"
        (repo / ".claude").mkdir(parents=True)
        (repo / ".claude" / "settings.json").write_text(json.dumps({"hooks": hooks}))
        out = self.scan([repo])
        proj = out["claude_projects"][0]["settings.json"]
        self.assertEqual((proj["hook_entries"], proj["enforcing_hook_entries"]), (5, 2))
        self.assertEqual(out["claude_projects"][0]["root"], "~/repo/.claude")

    def test_deny_coverage_needs_path_rules(self):
        cov = CS.deny_coverage(["Bash(echo secret)", "Bash(cat .env)", "Read(**/secrets/**)", "Read(~/.aws/**)"])
        self.assertTrue(cov["key_files"])
        self.assertTrue(cov["aws"])
        self.assertFalse(cov["env_files"])  # a Bash rule mentioning .env does not protect the file
        self.assertFalse(CS.deny_coverage(["Bash(grep -r secret .)"])["key_files"])

    def test_codex_instruction_chain_bytes(self):
        codex = self.tmp / ".codex"
        codex.mkdir()
        (codex / "AGENTS.md").write_text("g" * 1000)
        repo = self.tmp / "work" / "repo"
        sub = repo / "pkg"
        sub.mkdir(parents=True)
        (repo / ".git").mkdir()
        (repo / "AGENTS.md").write_text("r" * 300)
        (repo / "AGENTS.override.md").write_text("o" * 200)  # wins over AGENTS.md in the same directory
        (sub / "AGENTS.md").write_text("s" * 50)
        out = self.scan([sub])
        self.assertEqual(out["codex"][0]["instruction_chain_bytes_max"], 1250)
        self.assertEqual(out["codex"][0]["instruction_chain_repo"], "~/work/repo/pkg")

    def test_schedulers_count_headless_jobs(self):
        agents = self.tmp / "Library" / "LaunchAgents"
        agents.mkdir(parents=True)
        script = self.tmp / "nightly.sh"
        script.write_text("#!/bin/sh\nclaude -p 'triage' --max-turns 5\n")
        with open(agents / "a.plist", "wb") as f:
            plistlib.dump({"Label": "a", "ProgramArguments": ["/bin/sh", str(script)]}, f)
        with open(agents / "b.plist", "wb") as f:
            plistlib.dump({"Label": "b", "ProgramArguments": ["/usr/bin/true"]}, f)
        repo = self.tmp / "repo"
        (repo / ".github" / "workflows").mkdir(parents=True)
        (repo / ".github" / "workflows" / "ai.yml").write_text("steps:\n  - run: codex exec 'review'\n")
        self.assertEqual(self.scan([repo])["schedulers"], {"launchd": 1, "cron": 0, "ci": 1, "with_limits": 1, "own": 0})
        # A scheduled run of this skill itself is not the user's automation.
        with open(agents / "c.plist", "wb") as f:
            plistlib.dump({"Label": "c", "ProgramArguments": ["claude", "-p", "/agent-practice-audit"]}, f)
        (repo / ".github" / "workflows" / "audit.yml").write_text("steps:\n  - run: python3 scripts/run_audit.py\n")
        self.assertEqual(self.scan([repo])["schedulers"], {"launchd": 1, "cron": 0, "ci": 1, "with_limits": 1, "own": 2})


# ---------------------------------------------------------------- E: privacy

SECRET_PROMPT = ("UNIQUEPROMPT 不对 use tok" "en=abcd1234efgh5678 and Bearer abcdefghijklmnop sk-live1234567890 "
                 "postgres://demo:shortpass@localhost/db")


class E_Privacy(TmpCase):
    def test_rows_and_summary_hold_no_prompt_text(self):
        r = EX.claude(write_jsonl(self.tmp / "a.jsonl", claude_session(prompt=SECRET_PROMPT)))
        row = json.dumps(r, default=dict, ensure_ascii=False)
        for text in ("UNIQUEPROMPT", "abcd1234efgh5678", "abcdefghijklmnop", "sk-live", "shortpass", "postgres"):
            self.assertNotIn(text, row)
        self.assertNotIn("first", r)
        self.assertEqual((r["shape"], r["corrections"]), (EX.prompt_shape(SECRET_PROMPT), 1))
        s = json.dumps(AG.aggregate([json.loads(row)]), ensure_ascii=False)
        self.assertNotIn("UNIQUEPROMPT", s)
        self.assertNotIn("corr_examples", s)
        self.assertEqual(AG.aggregate([json.loads(row)])["hosts"]["claude"]["correction_categories"], {"other": 1})

    def test_correction_buckets(self):
        r = EX.new_row("claude", "/x")
        for p in ("你没跑测试", "不是我要的", "重来", "撤回这个改动", "你又错了", "不对"):
            EX.add_prompt(r, p)
        self.assertEqual(dict(r["corr_cats"]), {"not_verified": 1, "misunderstood": 1, "redo": 1, "revert": 1,
                                                "broke_or_forgot": 1, "other": 1})

    def test_config_paths_outside_home(self):
        with mock.patch.object(CS, "HOME", "/home/u"):
            self.assertEqual(CS.tilde("/opt/work/app/AGENTS.md"), "(outside ~)/AGENTS.md")
            self.assertEqual(CS.tilde("/home/u/app/AGENTS.md"), "~/app/AGENTS.md")
            self.assertEqual(CS.tilde("/home/user2/AGENTS.md"), "(outside ~)/AGENTS.md")

    def test_prejudge_notes_never_point_at_prompt_text(self):
        doc = PJ.prejudge({"hosts": {"claude": {"sessions": 50}}}, {}, PRACTICES)
        notes = " ".join(str(p.get("note") or "") + str((p.get("draft") or {}).get("reason")) for p in doc["practices"])
        for word in ("sessions.jsonl", "first prompt", "corr_examples", "excerpt"):
            self.assertNotIn(word, notes)


# ---------------------------------------------------------------- F: applicability inputs

class F_Applicability(TmpCase):
    def row(self, i, cwd="/w/app", start="2026-10-01T10:00:00Z", end="2026-10-01T11:00:00Z", tools=(), prompt=None):
        r = EX.claude(write_jsonl(self.tmp / f"{i}.jsonl", claude_session(
            prompt=prompt or f"task number {i} with enough words", tools=tools, cwd=cwd, start=start, end=end)))
        return json.loads(json.dumps(r, default=dict))

    def test_parallel_sessions_and_worktrees(self):
        rows = [self.row(1), self.row(2, cwd="/w/app/.claude/worktrees/b", start="2026-10-01T10:30:00Z"),
                self.row(3, start="2026-10-02T10:00:00Z", end="2026-10-02T10:10:00Z"),  # later, alone
                self.row(4, cwd="/w/other", start="2026-10-01T10:10:00Z"),  # same time, other repo
                self.row(5, start="2026-09-01T00:00:00Z", end="2026-10-03T00:00:00Z")]  # resumed for days: ignored
        p = AG.aggregate(rows)["parallel"]
        self.assertEqual((p["sessions"], p["with_worktree"], p["repos"]), (2, 1, 1))

    def test_repeated_shapes_exclude_own_verifier(self):
        head = [self.row(i, prompt=f"Nightly triage of issue #{i} in repo") for i in range(3)]
        own = [self.row(10 + i, prompt=CO.render_prompt([{"id": f"c{i}", "title": "T"}], f"page {i}"))
               for i in range(3)]
        for r in head + own:
            r["kind"] = "headless"
        s = AG.aggregate(head + own)["headless"]
        self.assertEqual((s["self_audit"], s["repeated"]), (3, {"shapes": 1, "sessions": 3}))

    def test_wide_and_complex_cohorts(self):
        reads = tuple(("Read", {"file_path": f"/w/app/f{i}.py"}) for i in range(30))
        edits = tuple(("Edit", {"file_path": f"/w/app/e{i}.py"}) for i in range(5))
        co = AG.aggregate([self.row(1, tools=reads), self.row(2, tools=edits + (("Agent", {}),)),
                           self.row(3)])["hosts"]["claude"]["cohorts"]
        self.assertEqual(co["wide"], {"n": 1, "subagent": 0})
        self.assertEqual(co["complex"]["n"], 1)


# ---------------------------------------------------------------- G: thresholds live in practices.json

class G_Rules(unittest.TestCase):
    def test_every_practice_has_rule_text_and_params(self):
        for p in PRACTICES:
            rule = p.get("rule")
            self.assertIsInstance(rule, dict, p["id"])
            self.assertTrue(rule.get("text"), p["id"])
            self.assertIsInstance(rule.get("params"), dict, p["id"])
            for k, v in rule["params"].items():
                self.assertIsInstance(v, (int, float), (p["id"], k))
                self.assertIn(str(v), rule["text"], (p["id"], k))  # the text states every number

    def test_no_thresholds_in_code(self):
        self.assertFalse(hasattr(AG, "RULE_DEFAULTS"))
        self.assertEqual(AG.load_rules(), {p["id"]: p["rule"]["params"] for p in PRACTICES})
        # Without params a cohort is left out instead of being computed from a code default.
        s = AG.aggregate([dict(EX.finish(dict(EX.new_row("claude", "/x"), prompts=1, prompt_chars=1)))], rules={})
        self.assertEqual((s["hosts"]["claude"]["cohorts"], s["parallel"], s["human_repeated"]), ({}, None, None))

    def test_prejudge_reads_params_from_practices(self):
        s = {"kinds": {"claude/human": 100}, "hosts": {"claude": {"sessions": 100, "coding_sessions": 50,
                                                                   "pct_coding_with_check": 60.0}}}
        item = next(p for p in PJ.prejudge(s, {}, PRACTICES)["practices"] if p["id"] == "verify-runnable-checks")
        self.assertEqual(item["draft"]["status"], "ok")
        strict = json.loads(json.dumps(PRACTICES))
        verify = next(p for p in strict if p["id"] == "verify-runnable-checks")
        verify["rule"]["params"]["ok_pct"] = 90
        item = next(p for p in PJ.prejudge(s, {}, strict)["practices"] if p["id"] == "verify-runnable-checks")
        self.assertEqual(item["draft"]["status"], "part")
        del verify["rule"]
        item = next(p for p in PJ.prejudge(s, {}, strict)["practices"] if p["id"] == "verify-runnable-checks")
        self.assertIsNone(item["draft"])
        self.assertIn("missing in practices.json", item["note"])


# ---------------------------------------------------------------- H: judge-input shape

class H_JudgeInput(unittest.TestCase):
    def test_every_item_keeps_detect_and_rule(self):
        s = {"kinds": {"claude/human": 100}, "hosts": {"claude": {"sessions": 100}}}
        doc = PJ.prejudge(s, {}, PRACTICES, 60)
        for p in doc["practices"]:
            self.assertTrue(p.get("detect"), p["id"])
            self.assertTrue(p.get("rule"), p["id"])
        self.assertTrue(any(p["draft"] for p in doc["practices"]))
        self.assertLess(len(PJ.render(doc).encode("utf-8")), 12 * 1024)


# ---------------------------------------------------------------- round 3 re-review items

def summary_with(hosts: dict, **extra) -> dict:
    s = {"kinds": {f"{h}/human": v["sessions"] for h, v in hosts.items()}, "hosts": hosts}
    s.update(extra)
    return s


def status_of(doc: dict, pid: str):
    d = next(p for p in doc["practices"] if p["id"] == pid)["draft"]
    return d and d["status"]


class Round3(TmpCase):
    def test_01_own_runs_are_marked(self):
        prompt = CO.render_prompt([{"id": "x", "title": "T"}], "page text")
        self.assertTrue(EX.SELF_MARKER and prompt.lstrip().startswith(EX.SELF_MARKER))
        r = EX.claude(write_jsonl(self.tmp / "v.jsonl", claude_session(prompt=prompt, entry="sdk-cli")))
        self.assertTrue(r.get("self_audit"))
        r = EX.claude(write_jsonl(self.tmp / "a.jsonl", claude_session(
            prompt="nightly job", entry="sdk-cli", tools=(("Bash", {"command": "python3 scripts/run_audit.py --days 7"}),))))
        self.assertTrue(r.get("self_audit"))

    def test_03_worktree_list_earns_nothing_and_folds_agree(self):
        self.assertNotIn("bash:worktree", tags(("Bash", {"command": "git worktree list"})))
        self.assertEqual(tags(("Bash", {"command": "git worktree add ../x -b x"}))["bash:worktree"], 1)
        home = os.path.expanduser("~")
        for cwd, root in ((f"{home}/.codex/worktrees/ab12/app", f"{home}/.codex/worktrees/*/app"),
                          ("/w/app/worktrees/feat", "/w/app"), ("/w/app/.claude/worktrees/x/pkg", "/w/app")):
            r = EX.claude(write_jsonl(self.tmp / "w.jsonl", claude_session(cwd=cwd)))
            self.assertEqual(r["tools"]["bash:worktree"], 1, cwd)
            self.assertEqual(r["repo"], EX.tilde(root), cwd)
            self.assertNotIn("/w/", json.dumps(r, default=dict))

    def test_04_unknown_codex_originator(self):
        rows = [{"type": "session_meta", "payload": {"originator": "something_new"}},
                {"type": "event_msg", "payload": {"type": "user_message", "message": "go"}}]
        self.assertEqual(EX.codex(write_jsonl(self.tmp / "c.jsonl", rows))["kind"], "unknown")

    def test_05_clear_successor_session(self):
        tools = tuple(("Read", {"file_path": f"/w/f{i}"}) for i in range(201))
        long_ = EX.claude(write_jsonl(self.tmp / "l.jsonl", claude_session(tools=tools, end="2026-10-01T11:00:00Z")))
        succ = claude_session(prompt="next task", start="2026-10-01T11:02:00Z", end="2026-10-01T11:30:00Z")
        succ.insert(0, claude_entry("user", "2026-10-01T11:01:00Z", message={"content": "<command-name>/clear</command-name>"}))
        s = EX.claude(write_jsonl(self.tmp / "s.jsonl", succ))
        self.assertEqual(s["started_by"], "clear")
        co = AG.aggregate([json.loads(json.dumps(r, default=dict)) for r in (long_, s)])["hosts"]["claude"]["cohorts"]
        self.assertEqual((co["long"]["n"], co["long"]["cleared"]), (1, 1))
        alone = AG.aggregate([json.loads(json.dumps(long_, default=dict))])["hosts"]["claude"]["cohorts"]["long"]
        self.assertEqual(alone["cleared"], 0)

    def test_06_subagent_reads_count_toward_wide_cohort(self):
        parent = EX.claude(write_jsonl(self.tmp / "p" / "sess1.jsonl", claude_session(tools=(("Agent", {}),))))
        side = claude_session(tools=tuple(("Read", {"file_path": f"/w/f{i}"}) for i in range(30)))
        child = EX.claude(write_jsonl(self.tmp / "p" / "sess1" / "subagents" / "agent-1.jsonl", side))
        self.assertEqual((child["kind"], child["parent"], parent["sid"]), ("subagent", "sess1", "sess1"))
        co = AG.aggregate([json.loads(json.dumps(r, default=dict)) for r in (parent, child)])["hosts"]["claude"]
        self.assertEqual(co["cohorts"]["wide"], {"n": 1, "subagent": 1})

    def test_08_must_rules_and_compact_focus(self):
        f = self.tmp / "AGENTS.md"
        f.write_text("Don't add comments.\nDo not rename files.\n不要写长句。\nNever commit .env files.\n")
        info = CS.instruction_file(str(f))
        self.assertEqual(info["must_rules"], 1)
        self.assertEqual(set(info["must_topics"]), {"secrets", "git_push"})

        def compact(pct_long):
            h = {"sessions": 100, "long_sessions": 20, "pct_compaction_long": pct_long}
            return status_of(PJ.prejudge(summary_with({"claude": h}), {}, PRACTICES), "ctx-compact-focus")
        self.assertEqual((compact(60.0), compact(30.0), compact(5.0)), ("no", "part", "na"))

    def test_09_sandbox_setting_is_reported_not_applied_to_past_sessions(self):
        h = {"sessions": 20, "modes_sessions": [["bypassPermissions", 20]], "full_access_sessions": 20}
        plain = {"claude": [{"root": "~/.claude", "settings.json": {"hook_entries": 0, "deny_count": 0}}]}
        boxed = {"claude": [{"root": "~/.claude", "settings.json": {"sandbox_enabled": True}}]}
        doc = PJ.prejudge(summary_with({"claude": h}), plain, PRACTICES)
        self.assertEqual(status_of(doc, "safe-low-risk-preset"), "no")
        reason = next(p for p in doc["practices"] if p["id"] == "safe-low-risk-preset")["draft"]["reason"]
        self.assertIn("reasoning effort is not measured", reason)
        doc = PJ.prejudge(summary_with({"claude": h}), boxed, PRACTICES)
        self.assertEqual(status_of(doc, "safe-low-risk-preset"), "no")
        reason = next(p for p in doc["practices"] if p["id"] == "safe-low-risk-preset")["draft"]["reason"]
        self.assertIn("now enabled (not applied to past sessions)", reason)
        r = self.tmp / ".claude"
        r.mkdir()
        (r / "settings.json").write_text(json.dumps({"sandbox": {"enabled": True}}))
        self.assertTrue(CS.claude_settings(str(r))["settings.json"]["sandbox_enabled"])

    def test_10_shared_definitions(self):
        self.assertIs(EX.EDIT_TOOLS, AG.EDIT_TOOLS)
        self.assertIs(AG.tilde, PJ.tilde)

    def test_11_fix_kind(self):
        for p in PRACTICES:
            self.assertIn(p.get("fix_kind"), ("config", "habit"), p["id"])

    def test_12_lead_is_two_sentences(self):
        text = (HERE.parent / "references" / "audit-files.md").read_text(encoding="utf-8")
        self.assertIn('"lead": "Two sentences', text)
        self.assertNotIn("Two or three sentences", text)

    def test_13_num_keeps_fractions(self):
        self.assertEqual((PJ.num("10.9"), PJ.num(3.0), PJ.num("x")), (10.9, 3, 0))

    def test_14_and_16_planning_applicability(self):
        def co(n, plan=0, sub=0, interview=0, logged=True):
            return {"sessions": 100, "cohorts": {"complex": {"n": n, "plan": plan, "plan_or_sub": sub,
                                                             "interview": interview, "plan_logged": logged}}}
        doc = PJ.prejudge(summary_with({"claude": co(30)}), {}, PRACTICES)
        self.assertEqual(status_of(doc, "plan-interview"), "na")  # no interviews: no evidence either way
        self.assertEqual(status_of(doc, "plan-mode-first"), "no")  # Claude logs plan mode
        doc = PJ.prejudge(summary_with({"codex": co(30, logged=False)}), {}, PRACTICES)
        self.assertEqual(status_of(doc, "plan-mode-first"), "na")  # Codex does not log plan mode
        doc = PJ.prejudge(summary_with({"codex": co(30, sub=5, logged=False)}), {}, PRACTICES)
        self.assertEqual(status_of(doc, "plan-mode-first"), "part")

    def test_15_image_generation_is_not_a_screenshot(self):
        self.assertNotIn("bash:screenshot", tags(("image_gen", {"mode": "image", "prompt": "a cat"})))
        self.assertEqual(tags(("mcp__kimi-cu__get_app_state", {"mode": "image"}))["bash:screenshot"], 1)

    def test_17_one_path_reducer(self):
        from audit_common import tilde
        self.assertEqual(tilde("/Use" "rs/adonisX/app", "/Use" "rs/adonis"), "(outside ~)/app")
        self.assertEqual(tilde("/Use" "rs/adonis/app", "/Use" "rs/adonis"), "~/app")
        long_ = EX.finish(dict(EX.new_row("claude", "/opt/logs/s.jsonl"), prompts=1, prompt_chars=1, cwd="/opt/app"))
        long_["tools"]["Read"] = 300
        s = json.dumps(AG.aggregate([long_]))
        self.assertNotIn("/opt/", s)


class Round4(TmpCase):
    def test_01_error_rows_hold_no_log_text(self):
        d = self.tmp / ".grok" / "sessions" / "p" / "1"
        write_jsonl(d / "chat_history.jsonl", [{"type": "user", "content": "<user_query>x</user_query>"}])
        (d / "signals.json").write_text(json.dumps({"compactionCount": "LEAKED-VALUE-123"}))
        r = EX.work(("grok", str(d / "chat_history.jsonl")))
        self.assertEqual(r["error"], "parse-ValueError")
        self.assertNotIn("LEAKED", json.dumps(r))
        self.assertEqual(EX.work(("claude", str(self.tmp / "missing.jsonl")))["error"], "unreadable")

    def test_02_code_cell_calls_are_normalised(self):
        cell = ('await tools.read_file({path: "/w/a.py"}); await tools.exec_command({cmd: "rg foo"});\n'
                'await tools.mcp__browser__take_screenshot({}); await tools.exec_command({cmd: "pnpm test"});')
        r = EX.new_row("codex", "/x")
        EX.codex_code_cell(r, cell)
        self.assertEqual((r["explore"], r["tools"]["bash:screenshot"], r["tools"]["bash:test"]), (2, 1, 1))

    def test_03_same_name_repos_stay_apart(self):
        rows = [EX.claude(write_jsonl(self.tmp / f"{i}.jsonl", claude_session(cwd=c)))
                for i, c in enumerate(("/one/app", "/two/app"))]
        p = AG.aggregate([json.loads(json.dumps(r, default=dict)) for r in rows])["parallel"]
        self.assertEqual(p["sessions"], 0)  # same time, same name, different repositories
        repo = self.tmp / "main"
        (repo / ".git" / "worktrees" / "wt").mkdir(parents=True)
        wt = self.tmp / ".codex" / "worktrees" / "ab12" / "main"
        wt.mkdir(parents=True)
        (wt / ".git").write_text(f"gitdir: {repo}/.git/worktrees/wt\n")
        from audit_common import repo_identity
        self.assertEqual(repo_identity(str(wt)), str(repo))  # linked worktree resolved to its main checkout

    def test_04_clear_successor_must_start_after(self):
        tools = tuple(("Read", {"file_path": f"/w/f{i}"}) for i in range(201))
        long_ = EX.claude(write_jsonl(self.tmp / "l.jsonl", claude_session(tools=tools, end="2026-10-01T11:00:00Z")))
        before = claude_session(prompt="x", start="2026-10-01T10:55:00Z", end="2026-10-01T10:58:00Z")
        before.insert(0, claude_entry("user", "2026-10-01T10:55:00Z", message={"content": "<command-name>/clear</command-name>"}))
        s = EX.claude(write_jsonl(self.tmp / "b.jsonl", before))
        co = AG.aggregate([json.loads(json.dumps(r, default=dict)) for r in (long_, s)])["hosts"]["claude"]["cohorts"]
        self.assertEqual(co["long"]["cleared"], 0)  # started before the long session ended

    def test_07_substitutes_can_reach_ok_on_hosts_without_plan_mode(self):
        h = {"sessions": 100, "cohorts": {"complex": {"n": 40, "plan": 0, "plan_or_sub": 12, "interview": 0,
                                                      "plan_logged": False}}}
        self.assertEqual(status_of(PJ.prejudge(summary_with({"grok": h}), {}, PRACTICES), "plan-mode-first"), "ok")

    def test_10_outer_limit_flag_survives_script_follow(self):
        script = self.tmp / "job.sh"
        script.write_text("claude -p 'triage'\n")
        hit, lim, own = CS.headless_hits(f"{script} --max-turns 5")
        self.assertEqual((hit, lim, own), (True, True, False))

    def test_11_inactive_roots_and_other_skills(self):
        cfg = {"claude": [{"root": "~/.claude", "settings.json": {"deny_count": 0, "deny_coverage": {}}},
                          {"root": "~/.claude-old", "settings.json": {"deny_count": 50, "hook_entries": 50,
                                                                      "enforcing_hook_entries": 50}}],
               "other_skills": {"codex": 4, "agents": 3}}
        h = {"sessions": 100, "accounts": [[".claude", 100]], "concepts_pct": {"skill": 30.0}}
        doc = PJ.prejudge(summary_with({"claude": h}), cfg, PRACTICES)
        item = next(p for p in doc["practices"] if p["id"] == "safe-small-enforced-set")
        self.assertEqual((item["draft"]["status"], item["metrics"]["inactive_roots"]), ("ok", 1))
        skills = next(p for p in doc["practices"] if p["id"] == "doc-skills-on-demand")
        self.assertEqual((skills["draft"]["status"], skills["metrics"]["skills"]["codex"]), ("ok", 4))
        codex = self.tmp / ".codex"
        (codex / "skills" / "s").mkdir(parents=True)
        (codex / "skills" / "s" / "SKILL.md").write_text("x")
        with mock.patch.object(CS, "HOME", str(self.tmp)):
            self.assertEqual(CS.scan([], crontab=False)["other_skills"], {"codex": 1, "agents": 0})

    def test_12_no_stale_text(self):
        self.assertNotIn("RULE_DEFAULTS", PJ.__doc__)
        self.assertNotIn("prompt excerpts", (HERE / "safe_output.py").read_text(encoding="utf-8")[:400])

    def test_13_skill_use_needs_the_rate_bar(self):
        cfg = {"claude": [{"root": "~/.claude", "settings.json": {}, "skills": {"count": 20}}]}
        low = {"sessions": 100, "concepts_pct": {"skill": 2.0}}
        self.assertEqual(status_of(PJ.prejudge(summary_with({"claude": low}), cfg, PRACTICES), "doc-skills-on-demand"), "part")
        wide = {"sessions": 100, "cohorts": {"wide": {"n": 40, "subagent": 1}}}
        self.assertEqual(status_of(PJ.prejudge(summary_with({"claude": wide}), {}, PRACTICES), "ctx-subagent-offload"), "part")

    def test_14_all_low_sample_gives_no_verdict(self):
        h = {"sessions": 5, "full_access_sessions": 5, "modes_sessions": [["bypassPermissions", 5]],
             "coding_sessions": 5, "pct_coding_with_check": 0.0}
        doc = PJ.prejudge(summary_with({"claude": h}, parallel={"sessions": 30, "with_worktree": 0}), {}, PRACTICES)
        for pid in ("safe-low-risk-preset", "auto-worktrees", "verify-runnable-checks"):
            self.assertIn(status_of(doc, pid), (None, "na"), pid)
        few = {"sessions": 50, "coding_sessions": 4, "pct_coding_with_check": 0.0}
        self.assertEqual(status_of(PJ.prejudge(summary_with({"claude": few}), {}, PRACTICES), "verify-runnable-checks"), "na")

    def test_15_deny_secrets_grades_setups_that_ran_bypass(self):
        cov_none = {"deny_count": 0, "deny_coverage": {}}
        cov_full = {"deny_count": 2, "deny_coverage": {"env_files": True, "ssh": True}}
        cfg = {"claude": [{"root": "~/.claude", "settings.json": cov_full},
                          {"root": "~/.claude" "-2", "settings.json": cov_none}]}
        h = {"sessions": 100, "accounts": [[".claude", 60], [".claude-2", 40]], "bypass_by_account": {".claude": 30}}
        self.assertEqual(status_of(PJ.prejudge(summary_with({"claude": h}), cfg, PRACTICES), "safe-deny-secrets"), "ok")
        h["bypass_by_account"] = {".claude-2": 5}
        self.assertEqual(status_of(PJ.prejudge(summary_with({"claude": h}), cfg, PRACTICES), "safe-deny-secrets"), "no")

    def test_16_session_rows_reduce_outside_paths(self):
        r = EX.claude(write_jsonl(self.tmp / "s.jsonl", claude_session(cwd="/opt/secret-project/app")))
        row = json.dumps(r, default=dict)
        self.assertNotIn("/opt/", row)
        self.assertEqual((r["cwd"], r["repo"]), ("(outside ~)/app", "(outside ~)/app"))
        self.assertTrue(r["path"].startswith("(outside ~)/") or r["path"].startswith("~/"))


if __name__ == "__main__":
    unittest.main()
