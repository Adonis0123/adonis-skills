#!/usr/bin/env python3
"""Tests for prejudge.py and run_audit.py. All inputs are synthetic and written to temp dirs."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


PJ = load("prejudge")
AG = load("aggregate")
EX = load("extract")
PRACTICES = json.loads((HERE.parent / "references" / "practices.json").read_text(encoding="utf-8"))["practices"]


def host(n=100, **kw) -> dict:
    h = {"sessions": n, "long_sessions": 0, "pct_with_correction": 10.0,
         "pct_correction_long": 0.0, "pct_compaction_long": 0.0, "pct_with_clear": 0.0,
         "concepts_pct": {"plan_mode": 0.0, "ask_user": 0.0, "subagent": 0.0, "todo": 0.0, "skill": 0.0, "web": 0.0},
         "pct_session_bash_tags": {}, "top_skills": [], "agent_types_calls": [], "slash_cmds_sessions": [],
         "efforts": [], "modes_sessions": [], "corr_examples": ["SECRET PROMPT EXCERPT"],
         "cohorts": {"complex": {"n": 0, "plan": 0, "plan_or_sub": 0, "interview": 0},
                     "wide": {"n": 0, "subagent": 0}, "long": {"n": 0, "clear": 0, "compact": 0, "corr": 0}}}
    for k, v in kw.items():
        if k in h["concepts_pct"]:
            h["concepts_pct"][k] = v
        else:
            h[k] = v
    return h


def summary(hosts: dict, headless=0, repeated=0, human_repeated=0, parallel=(0, 0)) -> dict:
    kinds = {f"{h}/human": v["sessions"] for h, v in hosts.items()}
    return {"kinds": kinds, "hosts": hosts, "subagent": {"sessions": 0},
            "headless": {"sessions": headless, "by_host": {}, "self_audit": 0, "scheduled": 0,
                         "repeated": {"shapes": 1, "sessions": repeated}},
            "human_repeated": {"shapes": 1, "sessions": human_repeated},
            "parallel": {"sessions": parallel[0], "with_worktree": parallel[1], "repos": 1, "by_host": {}}}


def wide(n, k) -> dict:
    return {"wide": {"n": n, "subagent": k}}


def settings(hooks=0, deny=0, cov=()) -> dict:
    keys = ("ssh", "aws", "cloud_credentials", "env_files", "key_files")
    return {"hook_entries": hooks, "enforcing_hook_entries": hooks, "deny_count": deny,
            "deny_coverage": {k: k in cov for k in keys}, "default_mode": None}


def config(claude=None, files=(), repos=(), codex=()) -> dict:
    return {"claude": claude or [], "codex": list(codex), "global_instructions": list(files),
            "repo_instructions": list(repos)}


def ifile(path, lines=10, size=100, test=False, lint=False) -> dict:
    return {"path": path, "realpath": path, "bytes": size, "lines": lines, "mentions_test": test, "mentions_lint": lint}


def item(doc: dict, pid: str) -> dict:
    return next(p for p in doc["practices"] if p["id"] == pid)


def status(doc: dict, pid: str):
    d = item(doc, pid)["draft"]
    return d and d["status"]


def run(summary_=None, config_=None, practices=None) -> dict:
    return PJ.prejudge(summary_ or summary({"claude": host()}), config_ or config(), practices or PRACTICES, 60)


class Thresholds(unittest.TestCase):
    def test_enforced_set_boundaries(self):
        for hooks, deny, want in ((10, 9, "ok"), (10, 10, "part"), (30, 9, "part"), (30, 10, "no")):
            c = config(claude=[{"root": "~/.claude", "settings.json": settings(hooks, deny)}])
            self.assertEqual(status(run(config_=c), "safe-small-enforced-set"), want, (hooks, deny))

    def test_enforced_set_sums_settings_files_and_dedupes_roots(self):
        root = {"root": "~/.claude", "settings.json": settings(15), "settings.local.json": settings(0, 6)}
        doc = run(config_=config(claude=[root, dict(root, root="~/.claude" "-2")]))
        self.assertEqual(status(doc, "safe-small-enforced-set"), "part")
        self.assertEqual(item(doc, "safe-small-enforced-set")["metrics"]["setups"],
                         [{"roots": 2, "enforcing": 15, "deny": 6, "secret_deny": 0, "enforced": 21}])

    def test_only_blocking_hooks_count_toward_the_set(self):
        s = dict(settings(30, 5), enforcing_hook_entries=10)  # 20 SessionStart/Notification-type hooks
        doc = run(config_=config(claude=[{"root": "~/.claude", "settings.json": s}]))
        self.assertEqual(status(doc, "safe-small-enforced-set"), "ok")  # 10 + 5 = 15

    def test_secret_denies_do_not_count_against_the_set(self):
        s = dict(settings(15, 10), secret_deny_count=6)
        doc = run(config_=config(claude=[{"root": "~/.claude", "settings.json": s}]))
        self.assertEqual(status(doc, "safe-small-enforced-set"), "ok")  # 15 hooks + 4 non-secret denies = 19

    def test_doc_short_instructions(self):
        small = ifile("~/repo/AGENTS.md")
        long_claude = ifile("~/repo/CLAUDE.md", lines=201, size=1000)
        big_agents = ifile("~/big/AGENTS.md", lines=150, size=32 * 1024 + 1)
        big_claude_global = ifile("~/.claude/CLAUDE.md", lines=150, size=40000)
        self.assertEqual(status(run(config_=config(repos=[small])), "doc-short-instructions"), "ok")
        self.assertEqual(status(run(config_=config(repos=[small, long_claude])), "doc-short-instructions"), "part")
        self.assertEqual(status(run(config_=config(repos=[big_agents])), "doc-short-instructions"), "no")
        # Codex does not read ~/.claude/CLAUDE.md, so its size alone is not a "no".
        self.assertEqual(status(run(config_=config(files=[big_claude_global])), "doc-short-instructions"), "ok")
        raised = config(repos=[big_agents], codex=[{"present": True, "project_doc_max_bytes": 65536}])
        self.assertEqual(status(run(config_=raised), "doc-short-instructions"), "ok")

    def test_deny_secrets_coverage(self):
        for cov, want in (((), "no"), (("ssh", "aws"), "part"), (("env_files",), "part"),
                          (("env_files", "cloud_credentials"), "ok")):
            c = config(claude=[{"root": "~/.claude", "settings.json": settings(deny=3, cov=cov)}])
            self.assertEqual(status(run(config_=c), "safe-deny-secrets"), want, cov)

    def test_subagent_offload_among_wide_exploration(self):
        s = summary({"claude": host(80, cohorts=wide(30, 8)), "grok": host(20, cohorts=wide(10, 0))})
        self.assertEqual(status(run(s), "ctx-subagent-offload"), "ok")  # 8/40 = 20%
        s = summary({"claude": host(80, cohorts=wide(30, 2)), "grok": host(20, cohorts=wide(10, 0))})
        self.assertEqual(status(run(s), "ctx-subagent-offload"), "part")
        self.assertEqual(status(run(summary({"claude": host(cohorts=wide(40, 0))})), "ctx-subagent-offload"), "no")
        # No wide exploration: offloading does not apply, whatever the overall subagent share.
        self.assertEqual(status(run(summary({"claude": host(cohorts=wide(3, 0))})), "ctx-subagent-offload"), "na")

    def test_low_risk_preset(self):
        full = host(20, modes_sessions=[["approval=never", 20], ["sandbox=danger-full-access", 20]],
                    full_access_sessions=20)
        safe = host(20, modes_sessions=[["approval=on-request", 20], ["sandbox=workspace-write", 20]],
                    full_access_sessions=0)
        some = host(20, modes_sessions=[["default", 20], ["bypassPermissions", 5]], full_access_sessions=5)
        self.assertEqual(status(run(summary({"codex": full})), "safe-low-risk-preset"), "no")
        self.assertEqual(status(run(summary({"codex": safe})), "safe-low-risk-preset"), "ok")
        self.assertEqual(status(run(summary({"claude": some})), "safe-low-risk-preset"), "part")
        self.assertIsNone(item(run(summary({"workbuddy": host(20)})), "safe-low-risk-preset")["draft"])

    def test_headless_judges_repeatable_work_not_volume(self):
        st = lambda **kw: status(run(summary({"claude": host()}, **kw)), "auto-headless")  # noqa: E731
        self.assertEqual(st(headless=12, repeated=12), "ok")
        self.assertEqual(st(headless=40, repeated=12, human_repeated=30), "part")  # more repeats typed by hand
        self.assertEqual(st(headless=3, repeated=3), "part")
        self.assertEqual(st(human_repeated=15), "no")
        self.assertEqual(st(), "na")  # nothing repeatable: not applicable, not "no"
        self.assertEqual(st(headless=200), "na")  # volume without repetition earns nothing
        sched = config()
        sched["schedulers"] = {"launchd": 1, "cron": 0, "ci": 0, "with_limits": 1}
        self.assertEqual(status(run(summary({"claude": host()}), sched), "auto-headless"), "ok")
        self.assertEqual(status(run(summary({"claude": host()}), sched), "auto-headless-limits"), "ok")
        self.assertEqual(status(run(summary({"claude": host()})), "auto-headless-limits"), "na")
        self.assertIsNone(item(run(summary({"claude": host()}, headless=3)), "auto-headless-limits")["draft"])

    def test_semantic_practices_have_no_draft_but_a_note(self):
        doc = run()
        for pid in ("doc-update-on-repeat", "plan-done-when"):
            self.assertIsNone(item(doc, pid)["draft"])
            self.assertTrue(item(doc, pid)["note"])

    def test_every_practice_is_mapped(self):
        self.assertEqual({p["id"] for p in PRACTICES} - set(PJ.PRACTICES), set())


class Robustness(unittest.TestCase):
    def test_unknown_practice_id(self):
        extra = PRACTICES + [{"id": "new-from-refresh", "dimension": "ctx", "title": "T", "detect": "D"}]
        p = item(run(practices=extra), "new-from-refresh")
        self.assertEqual((p["metrics"], p["draft"]), ({}, None))
        self.assertIn("no pre-judge mapping", p["note"])

    def test_malformed_inputs_do_not_crash(self):
        doc = PJ.prejudge({"hosts": {"claude": {"sessions": "x"}}}, {"claude": "bad"}, PRACTICES)
        self.assertEqual(len(doc["practices"]), len(PRACTICES))
        doc = PJ.prejudge({}, {}, PRACTICES)
        self.assertEqual(doc["counts"], {})

    def test_low_sample_host_is_flagged_and_excluded(self):
        s = summary({"claude": host(100, cohorts=wide(20, 6)), "codex": host(5, cohorts=wide(5, 0))})
        doc = run(s)
        self.assertTrue(doc["counts"]["codex"]["low_sample"])
        self.assertNotIn("low_sample", doc["counts"]["claude"])
        d = item(doc, "ctx-subagent-offload")["draft"]
        self.assertEqual((d["status"], d["low_sample"]), ("ok", ["codex"]))
        self.assertEqual(item(doc, "ctx-subagent-offload")["metrics"]["all"], {"n": 20, "subagent": 6})

    def test_only_low_sample_hosts_give_no_verdict(self):
        doc = run(summary({"codex": host(5, cohorts=wide(50, 40))}))
        self.assertIsNone(item(doc, "ctx-subagent-offload")["draft"])
        self.assertIsNone(item(doc, "plan-mode-first")["draft"])

    def test_no_excerpts_or_absolute_paths(self):
        c = config(repos=[ifile("/opt/work/app/AGENTS.md", lines=300)],
                   claude=[{"root": "/abs/.claude", "settings.json": settings(1)}])
        text = PJ.render(run(config_=c))
        self.assertNotIn("SECRET PROMPT", text)
        self.assertNotIn("/opt/work", text)
        self.assertNotIn("/abs/", text)
        self.assertIn("(outside ~)/AGENTS.md", text)
        json.loads(text)


def row(host_name="codex", modes=(), tools=()) -> dict:
    r = EX.new_row(host_name, "/x/s.jsonl")
    r.update(prompts=1, prompt_chars=10)
    for m in modes:
        r["modes"][m] += 1
    for t in tools:
        r["tools"][t] += 1
    return EX.finish(r)


def complex_row(tools=()) -> dict:
    r = row("claude", tools=("Edit",) + tuple(tools))
    r["edited_files"] = 6
    return r


class ReviewRegressions(unittest.TestCase):
    def test_full_access_needs_both_in_one_turn(self):
        # Two flags from different turns of one session are not full access; extract.py marks the joint turn.
        rows = [row(modes=("approval=never", "sandbox=danger-full-access")) for _ in range(50)]
        doc = run(AG.aggregate(rows))
        self.assertEqual(item(doc, "safe-low-risk-preset")["metrics"]["codex"]["full_access"], 0)
        self.assertEqual(status(doc, "safe-low-risk-preset"), "ok")
        both = [row(modes=("approval=never", "sandbox=danger-full-access", "full-access")) for _ in range(20)]
        self.assertEqual(status(run(AG.aggregate(both)), "safe-low-risk-preset"), "no")

    def test_full_access_without_joint_count_gives_no_false_no(self):
        old = host(100, modes_sessions=[["approval=never", 50], ["sandbox=danger-full-access", 50]])
        self.assertIsNone(item(run(summary({"codex": old})), "safe-low-risk-preset")["draft"])

    def test_agent_type_paths_are_not_leaked(self):
        s = summary({"claude": host(agent_types_calls=[["/Use" "rs/example/agents/review.md", 3], ["Explore", 2]],
                                    efforts=[["C:\\Users\\x\\high", 1]])})
        text = PJ.render(run(s))
        self.assertNotIn("/Users/", text)
        self.assertNotIn("Users\\", text)
        self.assertEqual(item(run(s), "ctx-custom-subagents")["metrics"]["claude"]["agent_types"],
                         {"review.md": 3, "Explore": 2})

    def test_verify_uses_any_check_coverage(self):
        rows = []
        for tag in ("bash:test", "bash:lint", "bash:typecheck"):
            rows += [row("claude", tools=("Edit", tag)) for _ in range(30)]
        rows += [row("claude", tools=("Edit",)) for _ in range(10)]
        rows += [row("claude", tools=("Read",)) for _ in range(50)]  # not coding sessions
        doc = run(AG.aggregate(rows))
        self.assertEqual(item(doc, "verify-runnable-checks")["metrics"]["coding_with_check_pct"], 90.0)
        self.assertEqual(status(doc, "verify-runnable-checks"), "ok")

    def test_verify_lower_bound_never_drafts_part_or_no(self):
        old = host(100, pct_session_bash_tags={"test": 30.0, "lint": 30.0, "typecheck": 30.0})
        self.assertIsNone(item(run(summary({"claude": old})), "verify-runnable-checks")["draft"])

    def test_plan_mode_counts_planning_skills_as_substitutes(self):
        for skill, want in (("writing-plans", "part"), ("sp:planning", "part"), ("grilling", "part"),
                            ("commit", "no")):
            rows = [complex_row(("Skill:" + skill,)) for _ in range(3)] + [complex_row() for _ in range(17)]
            self.assertEqual(status(run(AG.aggregate(rows)), "plan-mode-first"), want, skill)

    def test_plan_mode_measured_among_complex_sessions_only(self):
        rows = [complex_row(("ExitPlanMode",)) for _ in range(5)] + [complex_row() for _ in range(15)]
        rows += [row("claude", tools=("Read",)) for _ in range(200)]  # small sessions do not dilute the share
        doc = run(AG.aggregate(rows))
        self.assertEqual(status(doc, "plan-mode-first"), "ok")  # 5/20 = 25%
        self.assertEqual(item(doc, "plan-mode-first")["metrics"]["all"]["n"], 20)
        few = [complex_row(("ExitPlanMode",))] + [row("claude", tools=("Read",)) for _ in range(50)]
        self.assertEqual(status(run(AG.aggregate(few)), "plan-mode-first"), "na")

    def test_plan_interview_is_a_rate(self):
        rows = [complex_row(("Skill:grill-me",))] + [complex_row() for _ in range(29)]
        self.assertEqual(status(run(AG.aggregate(rows)), "plan-interview"), "na")  # below the bar: no evidence
        rows = [complex_row(("AskUserQuestion",)) for _ in range(3)] + [complex_row() for _ in range(27)]
        self.assertEqual(status(run(AG.aggregate(rows)), "plan-interview"), "ok")

    def test_worktrees_need_parallel_work(self):
        self.assertEqual(status(run(summary({"claude": host()})), "auto-worktrees"), "na")
        self.assertEqual(status(run(summary({"claude": host()}, parallel=(20, 12))), "auto-worktrees"), "ok")
        self.assertEqual(status(run(summary({"claude": host()}, parallel=(20, 2))), "auto-worktrees"), "part")
        self.assertEqual(status(run(summary({"claude": host()}, parallel=(20, 0))), "auto-worktrees"), "no")

    def test_ctx_clear_counts_cleared_long_sessions_and_corrections_per_prompt(self):
        def h(cleared, corr100_long, corr100=10.5):
            return host(100, long_sessions=40, corrections_per100_prompts=corr100,
                        cohorts={"long": {"n": 40, "cleared": cleared, "compact": 0, "corr_per100": corr100_long}})
        self.assertEqual(status(run(summary({"claude": h(10, 50.0)})), "ctx-clear-between-tasks"), "ok")  # 25%
        self.assertEqual(status(run(summary({"claude": h(1, 50.0)})), "ctx-clear-between-tasks"), "no")
        # 10.9 vs 10.5 corrections per 100 prompts: floats, not truncated to equal ints (item 13).
        self.assertEqual(status(run(summary({"claude": h(1, 10.9)})), "ctx-clear-between-tasks"), "no")
        self.assertEqual(status(run(summary({"claude": h(1, 10.5)})), "ctx-clear-between-tasks"), "part")
        self.assertEqual(status(run(summary({"claude": host(100, long_sessions=5)})), "ctx-clear-between-tasks"), "ok")

    def test_hooks_for_musts_maps_enforcement_to_must_rule_topics(self):
        musts = [dict(ifile("~/repo/AGENTS.md"), must_rules=4, must_topics={"secrets": 2, "language": 1})]

        def st(files, s):
            return status(run(config_=config(claude=[{"root": "~/.claude", "settings.json": s}], repos=files)),
                          "safe-hooks-for-musts")
        notify_only = dict(settings(hooks=3), enforcing_hook_entries=0)
        self.assertEqual(st([ifile("~/repo/AGENTS.md")], dict(settings(hooks=3), enforcing_hook_entries=3)), "na")
        self.assertEqual(st(musts, notify_only), "part")
        # An enforcing hook on an unrelated topic is not free credit.
        self.assertEqual(st(musts, dict(settings(hooks=3), enforcing_hook_entries=1,
                                        enforcing_hook_topics=["git_push"])), "part")
        # Only some must-rule topics enforced: part; every topic enforced: ok.
        self.assertEqual(st(musts, dict(settings(hooks=3), enforcing_hook_entries=1,
                                        enforcing_hook_topics=["language"])), "part")
        self.assertEqual(st(musts, dict(settings(deny=1), deny_topics=["secrets"])), "part")
        self.assertEqual(st(musts, dict(settings(hooks=1, deny=1), enforcing_hook_topics=["language"],
                                        deny_topics=["secrets"])), "ok")
        self.assertEqual(st(musts, settings()), "no")

    def test_doc_short_uses_codex_chain_bytes(self):
        small = [ifile("~/repo/AGENTS.md")]
        over = config(repos=small, codex=[{"present": True, "instruction_chain_bytes_max": 40000,
                                          "instruction_chain_repo": "~/repo"}])
        self.assertEqual(status(run(config_=over), "doc-short-instructions"), "no")
        raised = config(repos=small, codex=[{"present": True, "instruction_chain_bytes_max": 40000,
                                            "project_doc_max_bytes": 65536}])
        self.assertEqual(status(run(config_=raised), "doc-short-instructions"), "ok")


def claude_session(cwd: str) -> str:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    rows = [{"type": "user", "timestamp": now, "entrypoint": "cli", "cwd": cwd,
             "message": {"role": "user", "content": "fix the failing test"}},
            {"type": "assistant", "timestamp": now,
             "message": {"model": "m", "content": [{"type": "tool_use", "name": "Bash", "input": {"command": "pytest -q"}}]}}]
    return "\n".join(json.dumps(r) for r in rows) + "\n"


class RunAudit(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(os.path.realpath(self._tmp.name))
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("AGENT_PRACTICE_AUDIT")}
        self.env.update(HOME=str(self.home), AGENT_PRACTICE_AUDIT_DIR=str(self.home / "audit"))

    def tearDown(self):
        self._tmp.cleanup()

    def audit(self, *args):
        return subprocess.run([sys.executable, str(HERE / "run_audit.py"), "--run", str(self.home / "run"), *args],
                              capture_output=True, text=True, env=self.env, timeout=120)

    def test_no_human_sessions_exits_with_roots(self):
        p = self.audit("--days", "7")
        self.assertEqual(p.returncode, 3, p.stderr)
        self.assertIn("no human sessions", p.stderr)
        self.assertIn("~/.claude*/projects/**/*.jsonl", p.stderr)
        self.assertIn("--days 14", p.stderr)
        self.assertFalse((self.home / "run" / "work" / "judge-input.json").exists())

    def test_end_to_end_writes_judge_input(self):
        proj = self.home / ".claude" / "projects" / "app"
        proj.mkdir(parents=True)
        (proj / "s1.jsonl").write_text(claude_session(str(self.home / "app")), encoding="utf-8")
        p = self.audit()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("human=1", p.stdout)
        out = self.home / "run" / "work" / "judge-input.json"
        self.assertIn(f"judge-input: {out}", p.stdout)
        doc = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(len(doc["practices"]), len(PRACTICES))
        self.assertTrue(doc["counts"]["claude"]["low_sample"])
        self.assertEqual(doc["window_days"], 60)

    def test_refuses_run_inside_git_work_tree(self):
        repo = self.home / "repo"
        (repo / ".git").mkdir(parents=True)
        p = subprocess.run([sys.executable, str(HERE / "run_audit.py"), "--run", str(repo / "r")],
                           capture_output=True, text=True, env=self.env, timeout=60)
        self.assertEqual(p.returncode, 2)
        self.assertFalse((repo / "r").exists())


if __name__ == "__main__":
    unittest.main()
