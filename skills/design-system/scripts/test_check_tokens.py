#!/usr/bin/env python3
"""check_tokens.py 自测：python3 scripts/test_check_tokens.py"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("check_tokens.py")
NEUTRAL_LIGHT = ["#FCFCFD", "#F9F9FB", "#F0F0F3", "#E8E8EC", "#E0E1E6", "#D9D9E0",
                 "#CDCED6", "#B9BBC6", "#8B8D98", "#80838D", "#60646C", "#1C2024"]
NEUTRAL_DARK = ["#111113", "#18191B", "#212225", "#272A2D", "#2E3135", "#363A3F",
                "#43484E", "#5A6169", "#696E77", "#777B84", "#B0B4BA", "#EDEEF0"]
LEAF_LIGHT = ["#FBFEF6", "#F2FAE5"] + ["#D6EDB5"] * 7 + ["#64A400", "#3C6608", "#1F2F0C"]
LEAF_DARK = ["#10140B", "#141A0D"] + ["#304B10"] * 7 + ["#64A400", "#A6DA62", "#D6F2B0"]
ROLES = {
    "background": "{neutral-2}", "card": "{neutral-1}", "sidebar": "{neutral-2}",
    "foreground": "{neutral-12}", "muted-foreground": "{neutral-11}", "subtle-foreground": "{neutral-9}",
    "primary": "{accent-solid}", "primary-foreground": "{accent-solid-foreground}",
    "accent": "color-mix(in srgb, {accent-9} 12%, {card})", "accent-foreground": "{accent-11}",
    "selected": "color-mix(in srgb, {accent-9} 12%, {card})",
    "nav-active": "color-mix(in srgb, {accent-9} 15%, transparent)", "nav-active-foreground": "{accent-11}",
    "link": "{accent-11}", "warning-text": "{neutral-12}", "danger-text": "{neutral-12}",
}


def tokens(solid):
    dark_roles = dict(ROLES, background="{neutral-1}", card="{neutral-3}", sidebar="{neutral-1}")
    return {
        "scales": {"neutral": {"light": NEUTRAL_LIGHT, "dark": NEUTRAL_DARK}},
        "functional": {},
        "themes": {"leaf": {"scale": {"light": LEAF_LIGHT, "dark": LEAF_DARK},
                            "solid": solid, "solid-foreground": "#FFFFFF"}},
        "roles": {"light": ROLES, "dark": dark_roles},
    }


def run(data):
    with tempfile.TemporaryDirectory() as d:
        path = Path(d, "tokens.json")
        path.write_text(json.dumps(data))
        return subprocess.run([sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True)


class PrimaryForegroundThreshold(unittest.TestCase):
    def test_white_on_saturated_accent_passes_at_three(self):
        result = run(tokens({"light": "#568C11", "dark": "#64A400"}))  # 4.07 / 3.06
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_white_below_three_fails_with_fix_hint(self):
        result = run(tokens("#7FBF1F"))  # 约 2.2
        self.assertEqual(result.returncode, 1)
        self.assertIn("primary-foreground #FFFFFF 配 primary #7FBF1F", result.stdout)
        self.assertIn("要 ≥ 3.0", result.stdout)


if __name__ == "__main__":
    unittest.main()
