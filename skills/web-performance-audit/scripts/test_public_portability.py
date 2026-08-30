#!/usr/bin/env python3
"""Public-package portability and capability-bootstrap regression tests."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {".md", ".json", ".yaml", ".yml", ".py"}


def public_text() -> str:
    chunks: list[str] = []
    current_test = Path(__file__).resolve()
    for path in sorted(SKILL_DIR.rglob("*")):
        if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
            continue
        if path.resolve() == current_test or "__pycache__" in path.parts:
            continue
        chunks.append(f"\nFILE:{path.relative_to(SKILL_DIR)}\n")
        chunks.append(path.read_text(encoding="utf-8"))
    return "".join(chunks)


class PublicPortabilityTests(unittest.TestCase):
    def test_public_package_has_no_machine_or_product_fingerprints(self) -> None:
        text = public_text()
        forbidden = {
            "macOS user directory": r"/Users/[A-Za-z0-9._-]+/",
            "Linux user directory": r"/home/[A-Za-z0-9._-]+/",
            "Windows user directory": r"[A-Za-z]:\\Users\\[^\\]+\\",
            "fixed remote-debugging port": r"(?:127\.0\.0\.1|localhost):9222",
            "private project marker": r"(?i)(?:ai-video-collection|pollo\.ai|/director/|cmta[0-9a-z]+)",
            "source-audit duration": r"9:40\.68",
            "legacy branded skill name": "co" + r"co-web-performance-audit",
            "legacy branded installer": r"@co" + r"co/skills",
        }
        for label, pattern in forbidden.items():
            with self.subTest(label=label):
                self.assertIsNone(re.search(pattern, text), label)

    def test_bootstrap_covers_install_fallback_authorization_and_acceptance(self) -> None:
        bootstrap = (SKILL_DIR / "references" / "capability-bootstrap.md").read_text(
            encoding="utf-8"
        )
        required = [
            "Chrome DevTools MCP",
            "Playwright MCP",
            "Computer Use",
            "Chrome Recorder",
            "React Scan",
            "Fallback available now",
            "Authorization required: yes",
            "discovery, handshake, and one harmless real call",
            "https://github.com/ChromeDevTools/chrome-devtools-mcp",
            "https://cursor.com/docs/cli/mcp",
            "https://playwright.dev/mcp/",
            "https://developer.chrome.com/docs/devtools/recorder/",
            "https://github.com/aidenybai/react-scan",
        ]
        for phrase in required:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, bootstrap)

    def test_cursor_cli_contract_uses_verified_read_only_route(self) -> None:
        compatibility = (
            SKILL_DIR / "references" / "cross-agent-compatibility.md"
        ).read_text(encoding="utf-8")
        acceptance = (
            SKILL_DIR / "evals" / "host-acceptance-2026-08-30.md"
        ).read_text(encoding="utf-8")
        required_compatibility = [
            "Cursor CLI",
            ".agents/skills/",
            "/web-performance-audit",
            "--mode ask",
            "exit code alone is not acceptance proof",
            "https://cursor.com/docs/skills",
        ]
        for phrase in required_compatibility:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, compatibility)
        self.assertIn("cursor-agent 2026.08.25-3e8eec8", acceptance)
        self.assertIn("16/16 blocked coverage", acceptance)
        self.assertIn("not accepted", acceptance.lower())

    def test_core_skill_routes_missing_capabilities_without_silent_install(self) -> None:
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("capability-bootstrap.md", skill)
        self.assertIn("Guide installation; never install silently", skill)
        self.assertIn("discovery, handshake, and one real harmless call", skill)
        self.assertNotIn("/tmp/web-performance-audit", skill)


if __name__ == "__main__":
    unittest.main()
