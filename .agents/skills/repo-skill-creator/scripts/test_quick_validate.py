"""Exercise frontmatter acceptance using real temporary skill files."""

import tempfile
import unittest
from pathlib import Path

import yaml

from quick_validate import validate_skill


class RequiredFieldsTest(unittest.TestCase):
    def check_fields(self, **overrides):
        fields = {
            "name": "example-skill",
            "description": "Validate an existing skill without changing Git state.",
            "metadata": {"author": "test"},
        }
        fields.update(overrides)
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "SKILL.md").write_text(
                "---\n" + yaml.safe_dump(fields) + "---\n\nValidate the skill.\n"
            )
            return validate_skill(directory)

    def test_nonempty_fields_are_accepted(self):
        self.assertTrue(self.check_fields()[0])

    def test_empty_or_wrong_type_fields_are_rejected(self):
        for field in ("name", "description"):
            for value in ("", "  \n\t", None, 123, []):
                with self.subTest(field=field, value=value):
                    self.assertFalse(self.check_fields(**{field: value})[0])

    def test_valid_optional_metadata_is_preserved(self):
        self.assertTrue(self.check_fields(metadata={"author": "test", "version": "1.0"})[0])


if __name__ == "__main__":
    unittest.main()
