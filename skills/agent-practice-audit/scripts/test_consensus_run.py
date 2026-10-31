#!/usr/bin/env python3
"""Tests for `consensus.py run` and parallel page fetching. Verifiers are small fake scripts; no model is called."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import shlex
import signal
import sys
import tempfile
import time
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


CO = load("consensus")
CP = load("check_practices")
SO = load("safe_output")
DG = load("digests")

# A fake verifier: reads the prompt on stdin, logs cwd and timing, then answers by mode with one
# verdict per candidate id found between the CANDIDATES markers (a JSON array, like a real verifier).
FAKE = r'''
import json, os, sys, time
mode, log = sys.argv[1], sys.argv[2]
prompt = sys.stdin.read()
start = time.time()
block = prompt.split("<<<CANDIDATES", 1)[1].split("CANDIDATES>>>", 1)[0]
ids = [c["id"] for c in json.loads(block)]
if mode == "veto-other":  # vetoes only on the page whose text says OTHER BODY
    mode = "veto" if "OTHER BODY" in prompt else "accept"
if mode == "hang":
    time.sleep(60)
if mode == "orphan":  # a grandchild in its own session keeps stdout open after this process exits
    import subprocess
    kid = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
    with open(log + ".orphan", "w") as f:
        f.write(str(kid.pid))
time.sleep(float(os.environ.get("FAKE_SLEEP", "0")))
ok = {"verdict": "accept", "quote_found": True, "faithful": True, "checkable": True, "reason": "ok"}
verdicts = {
    "accept": ok, "orphan": ok, "crash": ok, "object": ok, "partial": ok, "dupe": ok,
    "accept-rule": dict(ok, rule_faithful=True),
    "rule-unfaithful": dict(ok, verdict="reject", rule_faithful=False, reason="threshold not on page"),
    "reject": {"verdict": "reject", "quote_found": True, "faithful": False, "checkable": True, "reason": "adds a condition"},
    "veto": {"verdict": "reject", "quote_found": False, "faithful": False, "checkable": True, "reason": "quote not on page"},
}
if mode == "garbage":
    answer = "I could not decide."
elif mode == "idonly":  # objects with an id but no verdict fields
    answer = json.dumps([{"id": i} for i in ids])
elif mode == "object":  # a bare object, as a single-candidate answer
    answer = json.dumps(verdicts[mode])
else:
    answer = [dict(verdicts[mode], id=i) for i in ids]
    if mode == "partial":
        answer = answer[:-1]
    if mode == "dupe":
        answer = answer + answer[:1]
    answer = json.dumps(answer)
print("Here is my answer:\n" + answer, flush=True)
with open(log, "a") as f:
    f.write(json.dumps({"cwd": os.getcwd(), "start": start, "end": time.time(), "has_page": "PAGE BODY" in prompt,
                        "page_count": prompt.count("PAGE BODY"), "ids": ids, "prompt": prompt}) + "\n")
sys.exit(3 if mode == "crash" else 0)
'''


def candidate(cid: str = "cand-one", slug: str = "demo", *more: str, rule: str | None = None) -> dict:
    c = {"id": cid, "dimension": "ctx", "title": "Keep it short", "detect": "count lines",
         "sources": [{"source": sl, "page": sl.title(), "url": f"https://code.claude.com/docs/en/{sl}",
                      "quote": "Keep it short.", "fragment": "Keep it short"} for sl in (slug, *more)]}
    if rule:
        c["rule"] = {"text": rule, "params": {"max_lines": 200}}
    return c


class RunCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.fake = self.tmp / "fake_verifier.py"
        self.fake.write_text(FAKE, encoding="utf-8")
        self.log = self.tmp / "calls.jsonl"
        self.pages = self.tmp / "pages"
        self.pages.mkdir()
        self.write_page("demo", "PAGE BODY Keep it short.")
        self.sources = self.tmp / "sources"
        self.sources.mkdir()
        self.out = self.tmp / "out"

    def tearDown(self):
        self._tmp.cleanup()

    def write_page(self, slug: str, text: str, status: str = "fresh", url: str | None = None,
                   run_id: str = "run-1", fetched_at: str | None = None):
        """Write a page file and record it in the run manifest, as check_practices.py --save-pages does."""
        path = self.pages / f"{slug}.txt"
        path.write_text(text, encoding="utf-8")
        mpath = self.pages / DG.MANIFEST
        entries = json.loads(mpath.read_text())["pages"] if mpath.exists() else {}
        now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="seconds")
        entries[slug] = {"status": status, "fetchedAt": fetched_at or now, "runId": run_id,
                         "url": url or f"https://code.claude.com/docs/en/{slug}", "sha256": DG.sha256_file(str(path))}
        DG.write_manifest(str(self.pages), entries, "run-1")

    def cmd(self, mode: str) -> str:
        return " ".join(shlex.quote(x) for x in (sys.executable, str(self.fake), mode, str(self.log)))

    def run_cli(self, modes: dict[str, str], cands=None, extra=()) -> tuple[str, dict]:
        cfile = self.tmp / "cands.json"
        cfile.write_text(json.dumps(cands or [candidate()]), encoding="utf-8")
        argv = ["run", "--candidates", str(cfile), "--pages", str(self.pages), "--out", str(self.out),
                "--sources-dir", str(self.sources), "--verifiers", ",".join(modes), *extra]
        for name, mode in modes.items():
            argv += ["--verifier-cmd", f"{name}={self.cmd(mode)}"]
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = CO.main(argv)
        self.assertEqual(rc, 0, out.getvalue())
        return out.getvalue(), json.loads((self.out / "decisions.json").read_text(encoding="utf-8"))

    def calls(self) -> list[dict]:
        if not self.log.exists():
            return []
        return [json.loads(x) for x in self.log.read_text().splitlines()]

    def test_parallel_run_accepts_and_writes_outputs(self):
        with mock.patch.dict("os.environ", {"FAKE_SLEEP": "1"}):
            out, dec = self.run_cli({"a": "accept", "b": "accept", "c": "reject"},
                                        cands=[candidate("cand-one"), candidate("cand-two")], extra=["--jobs", "6"])
        self.assertEqual([r["decision"] for r in dec["candidates"]], ["accept", "accept"])
        self.assertEqual((dec["candidates"][0]["consensus"]["agree"], dec["candidates"][0]["consensus"]["total"]), (2, 3))
        self.assertEqual(out.splitlines()[0].split()[:3], ["accept", "cand-one", "2/3"])
        for cid in ("cand-one", "cand-two"):
            for n in "abc":
                self.assertIn('"verdict"', (self.out / cid / f"v-{n}.txt").read_text())
        calls = self.calls()
        # Both candidates cite one page: one batched call per verifier, page text sent once.
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(c["has_page"] and c["page_count"] == 1 for c in calls))
        self.assertTrue(all(c["ids"] == ["cand-one", "cand-two"] for c in calls))
        self.assertEqual(len(dec["batches"]), 1)
        # All three calls overlapped: none finished before the last one started.
        self.assertLess(max(c["start"] for c in calls), min(c["end"] for c in calls))
        # Each call ran in a temp dir outside any repository, never in the caller's cwd.
        for c in calls:
            self.assertIsNone(SO.git_root(c["cwd"]))
            self.assertNotEqual(Path(c["cwd"]).resolve(), Path.cwd().resolve())

    def test_timeout_counts_as_non_agree(self):
        t0 = time.monotonic()
        _, dec = self.run_cli({"a": "accept", "b": "hang"}, extra=["--timeout", "1"])
        self.assertLess(time.monotonic() - t0, 20)  # the hanging verifier was killed
        r = dec["candidates"][0]
        self.assertEqual(r["decision"], "reject")
        self.assertEqual((r["consensus"]["agree"], r["consensus"]["total"]), (1, 2))
        self.assertTrue(r["runs"]["b"]["timedOut"])
        self.assertEqual(r["unusable"], ["b"])

    def test_grandchild_holding_stdout_cannot_hang_the_run(self):
        t0 = time.monotonic()
        with mock.patch.object(CO, "KILL_GRACE", 1):
            _, dec = self.run_cli({"a": "accept", "b": "orphan"}, extra=["--timeout", "1"])
        elapsed = time.monotonic() - t0
        with contextlib.suppress(OSError, ValueError):
            os.kill(int(Path(str(self.log) + ".orphan").read_text()), signal.SIGKILL)
        self.assertLess(elapsed, 10)  # bounded: timeout 1s + grace 1s, not the grandchild's 30s
        r = dec["candidates"][0]
        self.assertTrue(r["runs"]["b"]["timedOut"])
        self.assertIn('"verdict"', (self.out / "cand-one" / "v-b.txt").read_text())  # partial output kept
        self.assertEqual((r["decision"], r["consensus"]["agree"], r["invalid"]), ("reject", 1, ["b"]))

    def test_decide_on_saved_outputs_matches_run(self):
        _, dec = self.run_cli({"a": "accept", "b": "crash"})
        self.assertEqual(dec["candidates"][0]["decision"], "reject")
        files = [str(self.out / "cand-one" / f"v-{n}.txt") for n in "ab"]

        def decide_saved():
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(CO.main(["decide", *files, "--names", "a,b"]), 0)
            return json.loads(out.getvalue())

        r = decide_saved()
        self.assertEqual((r["decision"], r["consensus"]["agree"], r["invalid"]), ("reject", 1, ["b"]))
        # Without the status sidecar the crashed accept would count; that is what the sidecar prevents.
        (self.out / "cand-one" / "v-b.status.json").unlink()
        self.assertEqual(decide_saved()["decision"], "accept")

    def test_nonzero_exit_is_malformed_even_with_accept_json(self):
        out, dec = self.run_cli({"a": "accept", "b": "crash"})
        r = dec["candidates"][0]
        self.assertEqual((r["decision"], r["consensus"]["agree"]), ("reject", 1))
        self.assertEqual(r["invalid"], ["b"])
        self.assertIn("malformed: b", out)

    def test_veto(self):
        out, dec = self.run_cli({"a": "accept", "b": "accept", "c": "veto"})
        r = dec["candidates"][0]
        self.assertEqual(r["decision"], "reject")
        self.assertEqual(r["vetoed_by"], ["c"])
        self.assertIn("vetoed by c", out)

    def test_pending_when_fewer_than_two_verifiers(self):
        _, dec = self.run_cli({"a": "accept"})
        self.assertEqual(dec["candidates"][0]["decision"], "pending-consensus")
        self.assertEqual(self.calls(), [])  # a lone verifier is not called: the result could not count
        # A named verifier that is neither overridden nor installed is skipped with a note.
        with mock.patch.object(CO.shutil, "which", return_value=None):
            chosen, notes, iso = CO.resolve_verifiers(["a", "nosuchcli"], (), {"a": "x"})
        self.assertEqual(list(chosen), ["a"])
        self.assertEqual(iso, {"a": False})  # a --verifier-cmd override is never known to be isolated
        self.assertIn("nosuchcli: not found on PATH", notes)

    def test_digest_fallback_and_missing_page(self):
        (self.sources / "other.md").write_text("---\nslug: other\n---\n## Cited quotes\n- Keep it short.\n", encoding="utf-8")
        _, dec = self.run_cli({"a": "accept", "b": "accept"},
                                  cands=[candidate("from-digest", "other"), candidate("no-text", "ghost")])
        first, second = dec["candidates"]
        self.assertEqual((first["basis"], first["decision"]), ("digest", "accept"))
        batch = next(b for b in dec["batches"] if "from-digest" in b["candidates"])
        self.assertIn("(digest)", Path(batch["prompt"]).read_text())
        self.assertEqual(second["decision"], "pending-consensus")
        self.assertIn("ghost", second["error"])

    def test_refuses_out_dir_in_repo_and_bad_ids(self):
        repo = self.tmp / "repo"
        (repo / ".git").mkdir(parents=True)
        cfile = self.tmp / "c.json"
        cfile.write_text(json.dumps([candidate()]))
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(CO.main(["run", "--candidates", str(cfile), "--pages", str(self.pages),
                                      "--out", str(repo / "out"), "--verifiers", "a"]), 2)
        cfile.write_text(json.dumps([candidate("../escape")]))
        with self.assertRaises(ValueError):
            CO.load_candidates(str(cfile))

    def test_practices_file_yields_needs_consensus_and_pending(self):
        data = {"practices": [dict(candidate("seed-a"), **{"needs-consensus": True}), candidate("done-b")],
                "pending": [candidate("new-c")]}
        p = self.tmp / "practices.json"
        p.write_text(json.dumps(data))
        self.assertEqual([c["id"] for c in CO.load_candidates(str(p))], ["seed-a", "new-c"])

    def test_several_candidate_files_in_one_run(self):
        seeds = self.tmp / "practices.json"
        seeds.write_text(json.dumps({"practices": [dict(candidate("seed-a"), **{"needs-consensus": True})]}))
        new = self.tmp / "new.json"
        new.write_text(json.dumps([candidate("new-b")]))
        argv = ["run", "--candidates", str(seeds), str(new), "--pages", str(self.pages), "--out", str(self.out),
                "--sources-dir", str(self.sources), "--verifiers", "a,b",
                "--verifier-cmd", f"a={self.cmd('accept')}", "--verifier-cmd", f"b={self.cmd('accept')}"]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(CO.main(argv), 0)
        dec = json.loads((self.out / "decisions.json").read_text())
        self.assertEqual([r["id"] for r in dec["candidates"]], ["seed-a", "new-b"])
        self.assertEqual(len(self.calls()), 2)  # same page: one batch for both files
        new.write_text(json.dumps([candidate("seed-a")]))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(CO.main(argv), 2)  # an id in both files is refused


    # ---- batching by source page (one call per page and verifier)

    def two_pages(self):
        self.write_page("other", "OTHER BODY Keep it short.")
        return [candidate("cand-a"), candidate("cand-b"), candidate("cand-c", "other"), candidate("cand-d", "demo", "other")]

    def test_one_call_per_page_and_verifier(self):
        out, dec = self.run_cli({"a": "accept", "b": "accept"}, cands=self.two_pages())
        calls = self.calls()
        self.assertEqual(len(calls), 4)  # 2 pages x 2 verifiers, not 4 candidates x 2
        by_page = {("OTHER BODY" in c["prompt"]): c for c in calls}
        self.assertEqual(by_page[False]["ids"], ["cand-a", "cand-b", "cand-d"])
        self.assertEqual(by_page[True]["ids"], ["cand-c", "cand-d"])
        for c in calls:  # each page's text appears once, never the other page's
            self.assertEqual(c["prompt"].count("Keep it short.\nSOURCE>>>"), 1)
            self.assertFalse("PAGE BODY" in c["prompt"] and "OTHER BODY" in c["prompt"])
        self.assertEqual([r["decision"] for r in dec["candidates"]], ["accept"] * 4)
        d = next(r for r in dec["candidates"] if r["id"] == "cand-d")
        self.assertEqual(len(d["batches"]), 2)
        self.assertIn('"pages"', (self.out / "cand-d" / "v-a.txt").read_text())  # combined over both pages
        self.assertTrue((self.out / "_batches" / d["batches"][0] / "v-a.txt").is_file())  # raw answer kept

    def test_veto_on_one_page_rejects_multi_page_candidate(self):
        _, dec = self.run_cli({"a": "accept", "b": "accept", "c": "veto-other"}, cands=self.two_pages())
        got = {r["id"]: (r["decision"], r["vetoed_by"]) for r in dec["candidates"]}
        self.assertEqual(got["cand-a"], ("accept", []))
        self.assertEqual(got["cand-c"], ("reject", ["c"]))
        self.assertEqual(got["cand-d"], ("reject", ["c"]))  # demo page fine, other page vetoed

    def test_malformed_batch_makes_every_candidate_in_it_malformed(self):
        two = [candidate("cand-one"), candidate("cand-two")]
        for mode in ("partial", "garbage", "dupe"):
            with self.subTest(mode=mode):
                self.log.unlink(missing_ok=True)
                out, dec = self.run_cli({"a": "accept", "b": mode}, cands=two)
                for r in dec["candidates"]:  # cand-one had a well-formed object in "partial", still malformed
                    self.assertEqual((r["decision"], r["consensus"]["agree"], r["consensus"]["total"]), ("reject", 1, 2))
                    self.assertIn("b", r["invalid"] + r["unusable"])
                self.assertEqual(dec["batches"][0]["malformed"], ["b"])
        # `decide` on the saved per-candidate files reproduces the run (the sidecar carries the batch problem).
        files = [str(self.out / "cand-one" / f"v-{n}.txt") for n in "ab"]
        res = io.StringIO()
        with contextlib.redirect_stdout(res):
            self.assertEqual(CO.main(["decide", *files, "--names", "a,b"]), 0)
        self.assertEqual(json.loads(res.getvalue())["decision"], "reject")

    def test_single_candidate_accepts_bare_object(self):
        _, dec = self.run_cli({"a": "object", "b": "accept"})
        r = dec["candidates"][0]
        self.assertEqual((r["decision"], r["consensus"]["agree"]), ("accept", 2))

    def test_rule_needs_rule_faithful(self):
        rule = "ok when no session exceeds 200 tool calls (heuristic)"
        _, dec = self.run_cli({"a": "accept", "b": "accept"}, cands=[candidate(rule=rule)])
        r = dec["candidates"][0]
        self.assertEqual((r["decision"], r["consensus"]["agree"], r["invalid"]), ("reject", 0, ["a", "b"]))
        self.assertIn(rule, self.calls()[0]["prompt"])
        self.log.unlink()
        _, dec = self.run_cli({"a": "accept-rule", "b": "accept-rule"}, cands=[candidate(rule=rule)])
        self.assertEqual(dec["candidates"][0]["decision"], "accept")
        _, dec = self.run_cli({"a": "accept-rule", "b": "rule-unfaithful"}, cands=[candidate(rule=rule)])
        self.assertEqual((dec["candidates"][0]["decision"], dec["candidates"][0]["consensus"]["agree"]), ("reject", 1))
        # A candidate without a rule needs no rule_faithful.
        _, dec = self.run_cli({"a": "accept", "b": "accept"})
        self.assertEqual(dec["candidates"][0]["decision"], "accept")

    def test_max_calls_budget_leaves_rest_pending(self):
        cands = [candidate("cand-a"), candidate("cand-c", "other"), candidate("cand-d", "demo", "other")]
        self.write_page("other", "OTHER BODY Keep it short.")
        _, dec = self.run_cli({"a": "accept", "b": "accept"}, cands=cands, extra=["--max-calls", "3"])
        self.assertEqual(len(self.calls()), 2)  # one page x 2 verifiers fits in 3; the second page would need 4
        got = {r["id"]: r for r in dec["candidates"]}
        self.assertEqual(got["cand-a"]["decision"], "accept")
        for cid in ("cand-c", "cand-d"):
            self.assertEqual(got[cid]["decision"], "pending-consensus")
            self.assertIn("--max-calls", got[cid]["error"])
        self.assertEqual([b["skipped"] for b in dec["batches"]], [False, True])


    # ---- round 3 regressions

    def test_id_only_answers_on_a_multi_page_candidate_do_not_crash(self):
        _, dec = self.run_cli({"a": "accept", "b": "accept", "c": "idonly"}, cands=self.two_pages())
        got = {r["id"]: r for r in dec["candidates"]}
        self.assertEqual(got["cand-d"]["decision"], "accept")  # 2/3: c is malformed, the others still count
        self.assertIn("c", got["cand-d"]["invalid"] + got["cand-d"]["unusable"])
        self.assertEqual((got["cand-d"]["consensus"]["agree"], got["cand-d"]["consensus"]["total"]), (2, 3))
        text, problems = CO.combine_pages("x", [("b1", {"id": "x"}), ("b2", {"id": "x"})], False)
        self.assertEqual(text, "")
        self.assertEqual(len(problems), 2)
        ok = {"id": "x", "verdict": "accept", "quote_found": True, "faithful": True, "checkable": True, "reason": "r"}
        text, problems = CO.combine_pages("x", [("b1", {"id": "x"}), ("b2", ok)], False)
        self.assertTrue(problems)
        self.assertTrue(CO.verdict_from_run(text, {"exit": 0, "batchProblem": "; ".join(problems)})["invalid"])

    def test_only_fresh_manifest_pages_count_as_live(self):
        (self.sources / "demo.md").write_text("---\nslug: demo\n---\n## Cited quotes\n- Keep it short.\n", encoding="utf-8")
        fresh, _ = DG.fresh_pages(str(self.pages))
        self.assertEqual(list(fresh), ["demo"])
        # A later run could not fetch the page: the old file stays on disk but is not fresh.
        self.write_page("demo", "PAGE BODY Keep it short.", status="unreachable")
        _, dec = self.run_cli({"a": "accept", "b": "accept"})
        self.assertEqual(dec["candidates"][0]["basis"], "digest")
        # Fresh in the manifest but edited afterwards: hash mismatch, digest again.
        self.write_page("demo", "PAGE BODY Keep it short.")
        (self.pages / "demo.txt").write_text("PAGE BODY tampered", encoding="utf-8")
        self.assertEqual(DG.fresh_pages(str(self.pages))[0], {})
        # No manifest at all: every source uses its digest, with a note.
        (self.pages / DG.MANIFEST).unlink()
        fresh, note = DG.fresh_pages(str(self.pages))
        self.assertEqual(fresh, {})
        self.assertIn("--save-pages", note)


    # ---- round 4 regressions

    def test_manifest_page_must_match_url_run_and_age(self):
        (self.sources / "demo.md").write_text("---\nslug: demo\n---\n## Cited quotes\n- Keep it short.\n", encoding="utf-8")
        cases = {"other url": dict(url="https://code.claude.com/docs/en/elsewhere"),
                 "older run": dict(run_id="run-0"),
                 "too old": dict(fetched_at="2026-01-01T00:00:00+00:00")}
        for label, kw in cases.items():
            with self.subTest(label):
                self.write_page("demo", "PAGE BODY Keep it short.", **kw)
                _, dec = self.run_cli({"a": "accept", "b": "accept"})
                self.assertEqual(dec["candidates"][0]["basis"], "digest")
                self.assertEqual(dec["candidates"][0]["sourceBasis"], {"demo": "digest"})
        self.write_page("demo", "PAGE BODY Keep it short.")
        _, dec = self.run_cli({"a": "accept", "b": "accept"})
        self.assertEqual(dec["candidates"][0]["sourceBasis"], {"demo": "live"})

    def test_mixed_basis_records_each_source(self):
        (self.sources / "other.md").write_text("---\nslug: other\n---\n## Cited quotes\n- Keep it short.\n", encoding="utf-8")
        _, dec = self.run_cli({"a": "accept", "b": "accept"}, cands=[candidate("cand-m", "demo", "other")])
        r = dec["candidates"][0]
        self.assertEqual((r["basis"], r["sourceBasis"]), ("mixed", {"demo": "live", "other": "digest"}))

    def test_isolation_recorded_and_required(self):
        _, dec = self.run_cli({"a": "accept", "b": "accept"})
        self.assertEqual(dec["isolation"], {"a": {"isolated": False}, "b": {"isolated": False}})
        cfile = self.tmp / "c.json"
        cfile.write_text(json.dumps([candidate()]))
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            CO.main(["run", "--candidates", str(cfile), "--pages", str(self.pages), "--out", str(self.out),
                     "--sources-dir", str(self.sources), "--verifiers", "a,b", "--require-isolation",
                     "--verifier-cmd", f"a={self.cmd('accept')}", "--verifier-cmd", f"b={self.cmd('accept')}"])
        dec = json.loads((self.out / "decisions.json").read_text())
        self.assertEqual((dec["verifiers"], dec["candidates"][0]["decision"]), ({}, "pending-consensus"))
        self.assertIn("skipped by --require-isolation", err.getvalue())


class CommandDetection(unittest.TestCase):
    def test_empty_help_skips_and_missing_isolation_warns(self):
        helps = {"claude": "", "codex": "--skip-git-repo-check\n--ignore-user-config\n",
                 "grok": "--prompt-file <p>\n--no-subagents\n"}
        with mock.patch.object(CO, "cli_help", side_effect=lambda n: helps[n]), \
                mock.patch.object(CO.shutil, "which", return_value="/bin/x"):
            chosen, notes, iso = CO.resolve_verifiers(["claude", "codex", "grok"], (), {})
            self.assertEqual(list(chosen), ["codex", "grok"])  # never a bare `claude -p`
            self.assertEqual(iso, {"codex": True, "grok": False})
            self.assertTrue(any("claude" in n and "detect failed" in n for n in notes))
            self.assertTrue(any(n.startswith("warning: grok runs without isolation") for n in notes))
            chosen, notes, _ = CO.resolve_verifiers(["codex", "grok"], (), {}, require_isolation=True)
            self.assertEqual(list(chosen), ["codex"])

    def test_isolation_flags_only_when_help_lists_them(self):
        help_text = "--tools <t>\n--setting-sources <s>\n--strict-mcp-config\n--disable-slash-commands\n--no-session-persistence\n"
        self.assertEqual(CO.build_command("claude", help_text),
                         "claude -p --tools '' --setting-sources local --strict-mcp-config --disable-slash-commands "
                         "--no-session-persistence")
        self.assertEqual(CO.build_command("claude", "--tools <t>\n"), "claude -p --tools ''")
        codex = CO.build_command("codex", "--skip-git-repo-check\n--ignore-user-config\n--ignore-rules\n")
        self.assertEqual(codex, "codex exec --skip-git-repo-check --ignore-user-config --ignore-rules -")
        self.assertIn("--extensions none", CO.build_command("gemini", "-e, --extensions <list>\n"))

    def test_flags_come_only_from_help_text(self):
        self.assertEqual(CO.build_command("claude", "  -p, --print\n  --tools <tools...>\n"), "claude -p --tools ''")
        self.assertIn("--max-turns {turns}", CO.build_command("claude", "--max-turns <n>\n--tools <tools...>"))
        self.assertNotIn("--max-turns", CO.build_command("claude", "--max-turns-ish\n"))
        codex = CO.build_command("codex", "--skip-git-repo-check\n-s, --sandbox <MODE>\n")
        self.assertEqual(codex, "codex exec --skip-git-repo-check --sandbox read-only -")
        self.assertIsNone(CO.build_command("grok", "-p, --single <PROMPT>\n"))  # no stdin-safe way to send the prompt
        self.assertTrue(CO.build_command("grok", "--prompt-file <PATH>\n").endswith("--prompt-file {prompt_file}"))


class ParallelFetch(unittest.TestCase):
    def test_each_url_fetched_once_and_order_kept(self):
        seen = []

        def fake_fetch(url, timeout=20):
            seen.append(url)
            time.sleep(0.05 if url.endswith("a") else 0)  # finish out of order
            return f"<p>{url}</p>", None, url

        with mock.patch.object(CP, "fetch", side_effect=fake_fetch):
            got = CP.fetch_all(["https://x/a", "https://x/b", "https://x/a", "https://x/c"])
        self.assertEqual(sorted(seen), ["https://x/a", "https://x/b", "https://x/c"])
        self.assertEqual(list(got), ["https://x/a", "https://x/b", "https://x/c"])
        self.assertIn("x b", got["https://x/b"][0])


if __name__ == "__main__":
    unittest.main()
