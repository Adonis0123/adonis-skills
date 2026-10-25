"""The eval sideby stub answers in the shapes the skill's own parser accepts; the trigger suite grades loading only."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_DIR / "scripts"))
sys.path.insert(0, str(SKILL_DIR / "evals"))

from sideby_cli import valid_response  # noqa: E402
from build_plugin_eval import evaluation_note  # noqa: E402


class SidebyStubTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        shutil.copytree(SKILL_DIR / "fixtures" / "sideby-stub", Path(self.tmp) / "stub")
        self.env = {**os.environ, "PATH": f"{self.tmp}/stub:{os.environ['PATH']}"}

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_stub(self, *args):
        return subprocess.run(["sideby", *args], capture_output=True, text=True, env=self.env)

    def test_sessions_list_and_aliases_pass_the_skill_parser(self):
        for command in (["sessions"], ["list"], ["config", "get", "aliases"]):
            result = self.run_stub(*command, "--json")
            self.assertEqual(result.returncode, 0, command)
            self.assertTrue(valid_response(command, json.loads(result.stdout)), command)

    def test_send_returns_a_receipt_and_logs_the_text(self):
        result = self.run_stub("send", "6e9c249d", "A1 按推荐", "--json")
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["schemaVersion"], 1)
        self.assertEqual(data["message"]["status"], "delivered")
        self.assertEqual(data["message"]["toSessionId"], "6e9c249d-9a58-427f-bd46-95697fc8897a")
        sent = (Path(self.tmp) / "stub" / "sent.log").read_text(encoding="utf-8")
        self.assertIn("A1 按推荐", sent)

    def test_send_to_codex_needs_paste_and_unknown_target_fails(self):
        codex = json.loads(self.run_stub("send", "3f9a2c71", "hi", "--json").stdout)
        self.assertEqual(codex["message"]["status"], "paste-needed")
        self.assertEqual(self.run_stub("send", "nope", "hi", "--json").returncode, 1)
        self.assertEqual(self.run_stub("ui", "--background").returncode, 1)

    def test_note_puts_the_stub_on_path(self):
        note = evaluation_note(["fixtures/sideby-stub/sideby"])
        self.assertIn('PATH="$PWD/fixtures/sideby-stub:$PATH"', note)
        self.assertNotIn("sideby", evaluation_note(["fixtures/probe-full.json"]).split("probe-full.json", 1)[1])


class TriggerSuiteTest(unittest.TestCase):
    def test_one_case_per_query_graded_on_loading(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "suite"
            subprocess.run([sys.executable, str(SKILL_DIR / "evals" / "build_plugin_eval.py"), "--trigger", "--out", str(out)],
                           check=True, capture_output=True)
            items = json.loads((SKILL_DIR / "evals" / "trigger-eval-set.json").read_text(encoding="utf-8"))
            cases = sorted(p.name for p in out.iterdir())
            self.assertEqual(len(cases), len(items))
            for name, item in zip(cases, items):
                grader = (out / name / "graders" / "skill-fired.md").read_text(encoding="utf-8")
                self.assertEqual(name.endswith("fires"), item["should_trigger"])
                self.assertEqual("max: 0" in grader, not item["should_trigger"])
                self.assertIn(item["query"], (out / name / "prompt.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
