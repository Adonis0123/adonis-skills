#!/usr/bin/env python3
"""Static checker for the acceptance criteria in TASK.md (skill-opt-2026-10-20).

Reads the edited skills/figma-mcp/SKILL.md and marks each of the four
required assertions from textual evidence in the file. No tool calls, no
agent run -- this only verifies the shipped text makes the right claims.

Exit code 0 only if every assertion passes.
"""
from __future__ import annotations

import pathlib
import re
import sys

SKILL_PATH = pathlib.Path(__file__).resolve().parents[1] / "SKILL.md"


def load_skill_md() -> tuple[str, str, str]:
    text = SKILL_PATH.read_text(encoding="utf-8")
    fm_match = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not fm_match:
        raise SystemExit(f"Could not parse frontmatter in {SKILL_PATH}")
    frontmatter, body = fm_match.group(1), fm_match.group(2)
    desc_match = re.search(r'description:\s*"(.*)"\s*$', frontmatter, re.MULTILINE | re.DOTALL)
    if not desc_match:
        raise SystemExit("Could not find description field in frontmatter")
    description = desc_match.group(1)
    return text, description, body


def check_1_implement_task_covered(description: str) -> tuple[bool, str]:
    """Case 1: /figma-mcp + URL/node-id + implement task must be covered as
    an implement job, not filed only under auth."""
    has_implement_or_match = bool(re.search(r"\b(implement|match)", description, re.I))
    has_invocation = bool(re.search(r"/figma-mcp", description))
    has_url_or_key = bool(re.search(r"design URL|file key|fileKey", description, re.I))
    ok = has_implement_or_match and has_invocation and has_url_or_key
    evidence = (
        f"implement/match term={has_implement_or_match}, "
        f"/figma-mcp mentioned={has_invocation}, "
        f"URL/file-key mentioned={has_url_or_key}"
    )
    return ok, evidence


def check_2_names_design_to_code_and_requires_following(body: str) -> tuple[bool, str]:
    """Case 2: the implement path must name figma-design-to-code and require
    following it through, not just loading it once."""
    names_skill = bool(re.search(r"figma-design-to-code", body))
    requires_following = bool(
        re.search(r"follow(?:ed|ing)? (?:its|the) workflow through", body, re.I)
        or re.search(r"follow it through to a finished", body, re.I)
    )
    reaches_done_state = bool(re.search(r"finished[,]? matched screen|finished screen", body, re.I))
    ok = names_skill and requires_following and reaches_done_state
    evidence = (
        f"names figma-design-to-code={names_skill}, "
        f"requires following workflow through={requires_following}, "
        f"names a finished/matched end state={reaches_done_state}"
    )
    return ok, evidence


def check_3_install_or_switch_still_in_scope(description: str) -> tuple[bool, str]:
    """Case 3: a prompt that only asks to install or switch account must
    still be in scope."""
    has_install = bool(re.search(r"\binstall\b", description, re.I))
    has_auth = bool(re.search(r"authenticat", description, re.I))
    has_switch = bool(re.search(r"switch accounts?", description, re.I))
    hosts = re.findall(r"Codex|Claude Code|Cursor|Grok Build", description)
    has_two_hosts = len(set(hosts)) >= 2
    ok = has_install and has_auth and has_switch and has_two_hosts
    evidence = (
        f"install={has_install}, authenticate={has_auth}, switch accounts={has_switch}, "
        f"distinct hosts named={sorted(set(hosts))}"
    )
    return ok, evidence


def check_4_no_single_read_is_implementation(body: str) -> tuple[bool, str]:
    """Case 4: the skill must not claim a metadata read or screenshot alone
    is implementation."""
    has_evidence_not_implementation = bool(
        re.search(
            r"get_metadata.{0,200}get_design_context.{0,200}screenshot.{0,200}"
            r"evidence for that workflow.{0,80}never as the finished implementation",
            body,
            re.I | re.DOTALL,
        )
    )
    # Guard against a regression that re-introduces the old escape hatch
    # ("this skill only supplies the proof and read rules" with nothing
    # requiring the workflow to finish).
    has_old_stop_after_read_loophole = bool(
        re.search(
            r"it owns the workflow; this skill only supplies the proof and read rules\.",
            body,
        )
    )
    ok = has_evidence_not_implementation and not has_old_stop_after_read_loophole
    evidence = (
        f"explicit 'evidence, not implementation' sentence found={has_evidence_not_implementation}, "
        f"old stop-after-single-read loophole still present={has_old_stop_after_read_loophole}"
    )
    return ok, evidence


def main() -> int:
    _text, description, body = load_skill_md()

    checks = [
        ("1. implement task covered by description (not auth-only)", check_1_implement_task_covered(description)),
        ("2. implement path names figma-design-to-code and requires following it", check_2_names_design_to_code_and_requires_following(body)),
        ("3. install/switch-account-only prompt still in scope", check_3_install_or_switch_still_in_scope(description)),
        ("4. no claim that a single read/screenshot alone is implementation", check_4_no_single_read_is_implementation(body)),
    ]

    all_pass = True
    for name, (ok, evidence) in checks:
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name}")
        print(f"        evidence: {evidence}")
        if not ok:
            all_pass = False

    print()
    print("RESULT:", "ALL ASSERTIONS PASS" if all_pass else "AT LEAST ONE ASSERTION FAILED")
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
