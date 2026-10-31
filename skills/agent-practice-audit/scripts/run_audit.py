#!/usr/bin/env python3
"""Run the audit data steps in one call: extract -> aggregate -> config_scan -> prejudge.

Usage: run_audit.py [--days N] [--repo DIR ...] [--run DIR]

RUN defaults to $AGENT_PRACTICE_AUDIT_DIR/reports/YYYY-MM-DD (base default
~/.local/share/agent-practice-audit). Work files go to RUN/work. Prints the
extract host lines and the judge-input.json path. Exits 3 when the window holds
no human sessions, naming the roots that were searched.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from safe_output import UnsafeOutput, safe_output_path  # noqa: E402

NO_SESSIONS = 3


def default_run() -> str:
    base = os.environ.get("AGENT_PRACTICE_AUDIT_DIR") or os.path.join("~", ".local", "share", "agent-practice-audit")
    return os.path.join(os.path.expanduser(base), "reports", datetime.date.today().isoformat())


def step(name: str, args: list[str], echo: bool = False) -> None:
    """Run one sibling script; stop the whole run with its stderr when it fails."""
    p = subprocess.run([sys.executable, os.path.join(HERE, name), *args], capture_output=True, text=True)
    if echo and p.stdout:
        sys.stdout.write(p.stdout)
    if p.returncode:
        sys.stderr.write(p.stderr or p.stdout)
        raise SystemExit(f"error: {name} exited {p.returncode}")


def searched_roots() -> list[str]:
    """Glob roots extract.py used, in `~/` form, for the no-sessions message."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("extract", os.path.join(HERE, "extract.py"))
    ex = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ex)
    home = os.path.expanduser("~")
    cfg = ex.load_config()
    return [f"{h}: " + ", ".join(p.replace(home, "~", 1) for p in ex.globs_for(h, cfg)) for h in ex.HOSTS]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--repo", action="append", default=[], help="extra repository to scan (repeatable)")
    ap.add_argument("--run", help="run directory (default $AGENT_PRACTICE_AUDIT_DIR/reports/YYYY-MM-DD)")
    a = ap.parse_args(argv)
    try:
        run = safe_output_path(a.run or default_run())
    except UnsafeOutput as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    work = os.path.join(run, "work")
    os.makedirs(work, exist_ok=True)
    sessions, summary = os.path.join(work, "sessions.jsonl"), os.path.join(work, "summary.json")
    config, judge = os.path.join(work, "config-scan.json"), os.path.join(work, "judge-input.json")
    t0 = time.time()

    step("extract.py", [sessions, "--days", str(a.days)], echo=True)
    step("aggregate.py", [sessions, "-o", summary])
    with open(summary, encoding="utf-8") as f:
        hosts = json.load(f).get("hosts") or {}
    if not hosts:
        print(f"error: no human sessions with prompts in the last {a.days} days. Searched:", file=sys.stderr)
        for line in searched_roots():
            print(f"  {line}", file=sys.stderr)
        print(f"Try a longer window (--days {a.days * 2}) or add roots via AGENT_PRACTICE_AUDIT_<HOST>_GLOBS "
              "or extraRoots in config.json. No report was built.", file=sys.stderr)
        return NO_SESSIONS

    scan_args = ["--summary", summary, "-o", config]
    for r in a.repo:
        scan_args += ["--repo", r]
    step("config_scan.py", scan_args)
    step("prejudge.py", ["--summary", summary, "--config", config, "--days", str(a.days), "-o", judge])
    print(f"run: {run}")
    print(f"judge-input: {judge} ({os.path.getsize(judge)} bytes, {time.time() - t0:.1f}s total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
