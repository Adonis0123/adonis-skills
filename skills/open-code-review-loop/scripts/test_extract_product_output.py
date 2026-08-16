#!/usr/bin/env python3

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("extract_product_output.py")
REFERENCES = Path(__file__).parents[1] / "references"


class ExtractProductOutputTest(unittest.TestCase):
    def run_extract(
        self, product: str, payload: object, session_id: str | None = None
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_path = root / "input.json"
            output_path = root / "output.json"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            command = [
                    sys.executable,
                    str(SCRIPT),
                    "--product",
                    product,
                    "--input",
                    str(input_path),
                    "--output",
                    str(output_path),
                ]
            if session_id:
                command.extend(["--session-id", session_id])
            result = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
            )
            if output_path.exists():
                result.extracted = json.loads(output_path.read_text(encoding="utf-8"))
            return result

    def test_extracts_codex_direct_result(self) -> None:
        payload = {
            "schema_version": "1",
            "reviewer": {"product": "codex", "session_id": None},
            "verdict": "NO_FINDINGS",
        }
        result = self.run_extract("codex", payload, session_id="codex-session")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.extracted["reviewer"]["product"], "codex")
        self.assertEqual(result.extracted["reviewer"]["session_id"], "codex-session")

    def test_extracts_claude_structured_output(self) -> None:
        payload = {
            "result": "human-readable text must not be parsed",
            "session_id": "claude-session",
            "structured_output": {
                "schema_version": "1",
                "reviewer": {"product": "wrong-product"},
                "verdict": "FINDINGS",
            },
        }
        result = self.run_extract("claude-code", payload)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.extracted["reviewer"]["product"], "claude-code")
        self.assertEqual(result.extracted["reviewer"]["session_id"], "claude-session")

    def test_extracts_grok_structured_output_and_ignores_text(self) -> None:
        payload = {
            "text": '{"first": true}{"second": true}',
            "sessionId": "grok-session",
            "structuredOutput": {
                "schema_version": "1",
                "reviewer": {},
                "verdict": "NO_FINDINGS",
            },
        }
        result = self.run_extract("grok-build", payload)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.extracted["reviewer"]["product"], "grok-build")
        self.assertEqual(result.extracted["reviewer"]["session_id"], "grok-session")

    def test_explicit_session_id_overrides_envelope(self) -> None:
        payload = {
            "session_id": "envelope-session",
            "structured_output": {
                "schema_version": "1",
                "reviewer": {},
                "verdict": "NO_FINDINGS",
            },
        }
        result = self.run_extract(
            "claude-code", payload, session_id="recorded-session"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.extracted["reviewer"]["session_id"], "recorded-session")

    def test_extracts_cursor_exact_json_result(self) -> None:
        expected = {
            "schema_version": "1",
            "reviewer": {"product": "wrong-product", "session_id": "wrong-session"},
            "verdict": "NO_FINDINGS",
        }
        result = self.run_extract(
            "cursor-cli",
            {"session_id": "cursor-session", "result": json.dumps(expected)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.extracted["reviewer"]["product"], "cursor-cli")
        self.assertEqual(result.extracted["reviewer"]["session_id"], "cursor-session")

    def test_rejects_cursor_prose_prefixed_json(self) -> None:
        result = self.run_extract(
            "cursor-cli",
            {"result": 'Review complete.\n{"schema_version":"1"}'},
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("exactly one JSON object", result.stderr)

    def test_rejects_missing_product_field(self) -> None:
        result = self.run_extract("grok-build", {"text": "{}"})
        self.assertEqual(result.returncode, 2)
        self.assertIn("structuredOutput", result.stderr)


class PortableSchemaTest(unittest.TestCase):
    def assert_strict_object_shapes(self, node: object, path: str = "$") -> None:
        if isinstance(node, dict):
            if node.get("type") == "object":
                properties = node.get("properties")
                self.assertIsInstance(properties, dict, path)
                self.assertEqual(
                    set(node.get("required", [])),
                    set(properties),
                    f"{path} must require every declared property",
                )
                self.assertFalse(node.get("additionalProperties", True), path)
            for key, value in node.items():
                self.assert_strict_object_shapes(value, f"{path}.{key}")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                self.assert_strict_object_shapes(value, f"{path}[{index}]")

    def test_review_and_fix_schemas_are_portable_strict_objects(self) -> None:
        for name in ("review-schema.json", "fix-schema.json"):
            with self.subTest(name=name):
                schema = json.loads((REFERENCES / name).read_text(encoding="utf-8"))
                self.assert_strict_object_shapes(schema)


if __name__ == "__main__":
    unittest.main()
