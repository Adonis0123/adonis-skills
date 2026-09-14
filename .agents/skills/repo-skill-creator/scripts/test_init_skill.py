"""Exercise author serialization through the real initializer CLI."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml


class InitializerAuthorTests(unittest.TestCase):
    def initialize(self, author):
        with tempfile.TemporaryDirectory(prefix="skill-author-test-") as directory:
            skill_dir = Path(directory) / "author-example"
            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("init_skill.py")),
                    "author-example",
                    "--path", directory,
                    "--author", author,
                ],
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            content = (skill_dir / "SKILL.md").read_text()
            frontmatter = yaml.safe_load(content.split("---", 2)[1])
            self.assertEqual(frontmatter["metadata"]["author"], author)
            self.assertEqual(set(frontmatter), {"name", "description", "metadata"})
            self.assertEqual(set(frontmatter["metadata"]), {"author"})
            self.assertTrue((skill_dir / "agents" / "openai.yaml").is_file())

    def test_plain_author_round_trip(self):
        self.initialize("Platform Team")

    def test_unicode_control_author_round_trip(self):
        for author in ("Team\u0085Name", "Team\u007fName", "Team\u009fName"):
            with self.subTest(author=author):
                self.initialize(author)

    def test_unicode_scalar_author_round_trip(self):
        for author in (
            "Team 🦉",
            "Team 𠮷",
            "Line\u2028Separator",
            "Paragraph\u2029Separator",
            "Team\uffffName",
            ("Long author " * 30) + "End",
        ):
            with self.subTest(author=author):
                self.initialize(author)

    def test_yaml_sensitive_author_round_trip(self):
        for author in (
            "Platform #1",
            "Platform: Tools",
            '"Quoted Team"',
            "O'Connor",
            "Line one\nLine two",
            "Team\nextra: injected",
            "true",
            r"Team\Tools",
            "研发 #1",
        ):
            with self.subTest(author=author):
                self.initialize(author)


if __name__ == "__main__":
    unittest.main()
