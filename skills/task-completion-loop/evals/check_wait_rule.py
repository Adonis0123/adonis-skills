#!/usr/bin/env python3
"""Check that SKILL.md keeps a terminating wait for background external calls.

Usage: python3 -I evals/check_wait_rule.py [path/to/SKILL.md]

Static checks read the section that launches background calls. Runtime checks
execute the documented `kill -0` wait against a short-lived process, and show
that a `pgrep -f` wait whose own command line contains the pattern never ends,
while the `[r]eview-loop` bracket form does.
"""
import json
import os
import re
import signal
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
failures = []


def fail(msg):
    failures.append(msg)
    print(f"FAIL: {msg}")


def section_with(text, needle):
    """Return the heading-delimited section that contains needle."""
    parts = re.split(r"(?m)^#{2,4} ", text)
    for part in parts:
        if needle in part:
            return part
    return None


def run_wait(script, timeout):
    """Run a bash wait loop; return True if it exits before timeout."""
    proc = subprocess.Popen(["bash", "-c", script], start_new_session=True,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        proc.wait(timeout=timeout)
        return True
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
        return False


def static_checks(text):
    section = section_with(text, "后台进程")
    if section is None:
        fail("no section launches external calls as a background process (后台进程)")
        return None
    has_pid_wait = "kill -0" in section or "完成通知" in section
    if not has_pid_wait:
        fail("launch section has no PID wait: add `while kill -0 \"$(cat pid)\"` "
             "or the host's background completion notice next to the launch sentence")
    if "后台进程 + 轮询" in section and not has_pid_wait:
        fail("launch sentence says 后台进程 + 轮询 without a PID wait in the same section")
    if "pgrep -f" not in section:
        fail("launch section does not warn against `pgrep -f` / `ps | grep` polling")
    if not re.search(r"匹配到等待脚本自己|matches? (the )?wait(er| script) itself", section):
        fail("launch section does not say why: the pattern matches the waiting script itself")
    m = re.search(r"`(while kill -0 [^`]+)`", section)
    if m is None and "kill -0" in section:
        fail("kill -0 wait is not written as one runnable `while kill -0 ...; done` command")
    return m.group(1) if m else None


def runtime_checks(wait_cmd):
    if wait_cmd:
        fast = re.sub(r"sleep \d+", "sleep 0.2", wait_cmd)
        script = f"sleep 1 & echo $! > \"$T/pid\"; {fast}"
        script = f"T=$(mktemp -d); trap 'rm -rf \"$T\"' EXIT; cd \"$T\"; {script}"
        if run_wait(script, timeout=10):
            print("ok: documented kill -0 wait exits after the target process ends")
        else:
            fail("documented kill -0 wait did not exit within 10s after its target ended")
    # No process carries the tag, so any match is the waiter matching itself.
    # macOS pgrep skips its own ancestors; ps | grep and Linux pgrep -f do not.
    tag = "review-loop consult tcl-wait-probe"
    bracket = tag.replace("review", "[r]eview", 1)
    probes = {
        "pgrep -f": 'while pgrep -f "{}" >/dev/null; do sleep 0.2; done',
        "ps | grep": 'while ps ax -o args= | grep -q "{}"; do sleep 0.2; done',
    }
    for name, loop in probes.items():
        if run_wait(loop.format(tag), timeout=3):
            print(f"note: {name} wait did not self-match on this platform")
        else:
            print(f"ok: {name} wait self-matches and never ends (hazard reproduced)")
        if run_wait(loop.format(bracket), timeout=3):
            print(f"ok: {name} with [r]eview-loop bracket form does not match itself")
        else:
            fail(f"{name} with [r]eview-loop bracket form still matched its own waiter")


def json_checks():
    for name in ("evals.json", "trigger-eval.json"):
        path = SKILL_DIR / "evals" / name
        try:
            json.loads(path.read_text())
            print(f"ok: {name} parses as JSON")
        except (OSError, ValueError) as exc:
            fail(f"{name} does not parse as JSON: {exc}")


def main():
    skill = Path(sys.argv[1]) if len(sys.argv) > 1 else SKILL_DIR / "SKILL.md"
    wait_cmd = static_checks(skill.read_text())
    runtime_checks(wait_cmd)
    json_checks()
    print("RESULT:", "FAIL" if failures else "PASS")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
