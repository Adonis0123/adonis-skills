#!/usr/bin/env python3
"""Check that SKILL.md keeps UI checks in scope and requires real kimi-cu tool calls.

Run: python3 skills/kimi-computer-use/evals/check_scope.py
Exits 0 only when every check passes; each failure says what to fix.
"""
import argparse
import json
import re
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
UI_PROMPT = "用 kimi 看一下当前桌面上的设置窗口是不是按稿子做的"
INSTALL_PROMPT = "帮我把 Kimi Computer Use 装到 Cursor CLI 上"


def load():
    text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    match = re.search(r'^description:\s*"(.*)"\s*$', text, re.M)
    if not match:
        sys.exit("FAIL: SKILL.md frontmatter has no quoted description line")
    evals = json.loads((SKILL_DIR / "evals" / "evals.json").read_text(encoding="utf-8"))["evals"]
    triggers = json.loads((SKILL_DIR / "evals" / "trigger-eval.json").read_text(encoding="utf-8"))
    return text, match.group(1), evals, triggers


def eval_for(evals, prompt):
    return next((e for e in evals if e["prompt"] == prompt), None)


def main():
    global SKILL_DIR
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skill-dir", type=Path, default=SKILL_DIR,
                        help="Skill snapshot to check; defaults to this skill")
    SKILL_DIR = parser.parse_args().skill_dir
    text, desc, evals, triggers = load()
    body = text.split("\n---\n", 1)[1]
    should_trigger = {t["query"]: t["should_trigger"] for t in triggers}
    ui_eval = eval_for(evals, UI_PROMPT)
    ui_expect = " ".join(ui_eval["expectations"]) if ui_eval else ""

    checks = [
        (
            "1. UI-check prompt is in scope as a real tool-using check",
            re.search(r"verify a running .*UI through kimi-cu", desc)
            and should_trigger.get(UI_PROMPT) is True
            and "get_app_state" in ui_expect
            and "get_app_state" in body,
            "describe UI verification in the description, add the prompt to evals.json with a "
            "get_app_state expectation, and mark it should_trigger=true in trigger-eval.json",
        ),
        (
            "2. a UI check with zero kimi-cu tool calls is UNVERIFIED",
            re.search(r"zero `?kimi-cu`? tool calls is `?UNVERIFIED`?", body)
            and re.search(r"never emits a call", body),
            "state in 'Operate through MCP' that a UI check with zero kimi-cu tool calls is "
            "UNVERIFIED, and say why (the host can list tools while the model never emits a call)",
        ),
        (
            "3. installing to Cursor CLI stays in scope",
            desc.startswith("Install") and "Cursor CLI" in desc
            and eval_for(evals, INSTALL_PROMPT) is not None,
            "keep 'Install ... Cursor CLI' in the description and the install prompt in evals.json",
        ),
        (
            "4. DOM, Console, Network, Performance belong to Chrome DevTools",
            re.search(r"DOM, Console, Network, and Performance belong to Chrome DevTools MCP, not `kimi-cu`", body),
            "keep the 'Browser internals ... belong to Chrome DevTools MCP, not kimi-cu' rule",
        ),
        (
            "5. description does not refuse UI verification once installed",
            not re.search(r"already works|once kimi-cu|already installed", desc, re.I),
            "remove wording that excludes use after kimi-cu works; exclude general automation instead",
        ),
        (
            "6. argument correction requires a successful read-only retry",
            "retry the read-only `get_app_state` call" in body
            and "Stop only after the corrected call completes successfully" in body
            and "If the corrected call still fails, continue the layered checks below" in body
            and "If the retry cannot run, report runtime verification as `UNVERIFIED`" in body
            and "The service is fine" not in body,
            "require a read-only retry after correcting arguments; continue diagnosis on failure "
            "and mark an unavailable retry UNVERIFIED instead of declaring service health",
        ),
        (
            "7. Hermes fuse attribution requires preceding-call evidence",
            "Attribute it to bad arguments only when the preceding failed calls show those errors" in body
            and "otherwise keep the cause unresolved" in body
            and "Do not infer permission health from the fuse message" in body,
            "condition bad-argument attribution on preceding-call evidence and leave other causes unresolved",
        ),
        (
            "8. offline eval covers corrected timeout and unavailable retry",
            any(e.get("name") == "corrected-call-fails-and-fuse-cause-unknown"
                and "timed out" in e["prompt"]
                and "UNVERIFIED" in " ".join(e.get("expectations", []))
                for e in evals),
            "add an offline eval for a corrected-call timeout, missing fuse evidence, and unavailable retry",
        ),
    ]

    failed = 0
    for name, ok, fix in checks:
        if ok:
            print(f"PASS {name}")
        else:
            failed += 1
            print(f"FAIL {name}\n     fix: {fix}")
    print(f"{len(checks) - failed}/{len(checks)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
