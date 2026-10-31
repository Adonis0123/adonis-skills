#!/usr/bin/env python3
"""Aggregate extract.py rows into one summary JSON for judging practices.

Usage: aggregate.py SESSIONS.jsonl [-o SUMMARY.json]

Per host it summarises human sessions (the ones a person drove); headless and
subagent sessions are counted separately. Cross-host "concepts" map different
tool names that mean the same thing (plan mode, asking the user, subagents,
todo lists) so practices can be judged once for every host.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import statistics
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from safe_output import UnsafeOutput, safe_file_target  # noqa: E402

HOME = os.path.expanduser("~")
LONG_SESSION_TOOLS = 200

# Tool names (any host) that count as evidence for a concept.
CONCEPTS = {
    "plan_mode": {"ExitPlanMode", "EnterPlanMode", "exit_plan_mode"},
    "ask_user": {"AskUserQuestion", "ask_user_question", "request_user_input"},
    "subagent": {"Agent", "Task", "spawn_agent", "get_command_or_subagent_output"},
    "todo": {"TodoWrite", "update_plan", "todo_write", "TaskCreate", "TaskUpdate"},
    "skill": {"Skill"},
    "web": {"WebFetch", "WebSearch", "web_fetch", "web_search"},
}


def load_rows(path: str) -> tuple[list[dict], int]:
    rows, errors = [], 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if "error" in r:
                errors += 1
            else:
                rows.append(r)
    return rows, errors


def minutes(r: dict) -> float | None:
    try:
        a = datetime.fromisoformat(r["start"].replace("Z", "+00:00"))
        b = datetime.fromisoformat(r["end"].replace("Z", "+00:00"))
        return (b - a).total_seconds() / 60
    except (KeyError, TypeError, AttributeError, ValueError):
        return None


def pct(n: int, d: int) -> float:
    return round(100 * n / d, 1) if d else 0.0


def tool_total(r: dict) -> int:
    return sum(v for k, v in r["tools"].items() if ":" not in k)


def has_concept(r: dict, concept: str) -> bool:
    if concept == "plan_mode" and "plan" in (r.get("modes") or {}):
        return True
    return any(r["tools"].get(n) for n in CONCEPTS[concept])


def top(counter: collections.Counter, n: int) -> list:
    return [[k, v] for k, v in counter.most_common(n)]


def tilde(p: str | None) -> str:
    p = p or ""
    return "~" + p[len(HOME):] if HOME and p.startswith(HOME) else p


def host_summary(hs: list[dict]) -> dict:
    n = len(hs)
    has = lambda f: sum(1 for r in hs if f(r))  # noqa: E731
    tools, skills, agents, cmds, efforts, models, modes = (collections.Counter() for _ in range(7))
    for r in hs:
        for k, v in r["tools"].items():
            if k.startswith("Skill:"):
                skills[k[6:]] += 1
            elif k.startswith("Agent:"):
                agents[k[6:]] += v
            else:
                tools[k] += 1
        cmds.update(set(r["cmds"]))
        if r["efforts"]:
            efforts[max(r["efforts"], key=r["efforts"].get)] += 1
        if r["models"]:
            models[max(r["models"], key=r["models"].get)] += 1
        modes.update(set(r.get("modes") or {}))
    tt = [tool_total(r) for r in hs]
    ds = [d for d in (minutes(r) for r in hs) if d is not None]
    long_ = [r for r in hs if tool_total(r) > LONG_SESSION_TOOLS]
    return {
        "sessions": n,
        "median_prompts": statistics.median(r["prompts"] for r in hs),
        "p90_prompts": sorted(r["prompts"] for r in hs)[min(n - 1, int(n * 0.9))],
        "median_prompt_chars": round(statistics.median(r["prompt_chars"] / r["prompts"] for r in hs)),
        "median_tool_calls": statistics.median(tt),
        f"sessions_over_{LONG_SESSION_TOOLS}_tools": len(long_),
        f"pct_compaction_over_{LONG_SESSION_TOOLS}_tools": pct(sum(1 for r in long_ if r["compactions"]), len(long_)),
        f"pct_correction_over_{LONG_SESSION_TOOLS}_tools": pct(sum(1 for r in long_ if r["corrections"]), len(long_)),
        "median_minutes": round(statistics.median(ds), 1) if ds else None,
        "pct_with_compaction": pct(has(lambda r: r["compactions"] > 0), n),
        "pct_with_correction": pct(has(lambda r: r["corrections"] > 0), n),
        "corrections_total": sum(r["corrections"] for r in hs),
        "pct_with_interrupt": pct(has(lambda r: r["interrupts"] > 0), n),
        "pct_with_denial": pct(has(lambda r: r["denials"] > 0), n),
        "concepts_pct": {c: pct(has(lambda r, c=c: has_concept(r, c)), n) for c in CONCEPTS},
        "pct_session_tool_use": {k: pct(v, n) for k, v in tools.most_common(40) if not k.startswith("bash:")},
        "pct_session_bash_tags": {k[5:]: pct(v, n) for k, v in tools.most_common() if k.startswith("bash:")},
        "top_skills": top(skills, 25),
        "agent_types_calls": top(agents, 12),
        "slash_cmds_sessions": top(cmds, 25),
        "efforts": top(efforts, 10),
        "models": top(models, 8),
        "modes_sessions": top(modes, 12),
        "accounts": top(collections.Counter(r.get("account") for r in hs), 10),
        "cwd_top": top(collections.Counter(tilde(r.get("cwd")).split("/.worktrees")[0] for r in hs), 12),
        "longest_sessions": [[tilde(r["path"]), tool_total(r), r["compactions"]] for r in
                             sorted(long_, key=tool_total, reverse=True)[:5]],
        "corr_examples": [e for r in hs for e in r["corr_examples"]][:40],
    }


def aggregate(rows: list[dict], errors: int = 0) -> dict:
    out = {
        "files": len(rows) + errors,
        "errors": errors,
        "kinds": dict(collections.Counter(f"{r['host']}/{r['kind']}" for r in rows)),
        "entries": dict(collections.Counter(f"{r['host']}/{r.get('entry')}" for r in rows)),
        "hosts": {},
    }
    for host in sorted({r["host"] for r in rows}):
        hs = [r for r in rows if r["host"] == host and r["kind"] == "human" and r["prompts"] > 0]
        if hs:
            out["hosts"][host] = host_summary(hs)
    head = [r for r in rows if r["kind"] == "headless"]
    out["headless"] = {
        "sessions": len(head),
        "by_host": dict(collections.Counter(r["host"] for r in head)),
        "efforts_by_host": {h: top(collections.Counter(max(r["efforts"], key=r["efforts"].get)
                                                       for r in head if r["host"] == h and r["efforts"]), 6)
                            for h in sorted({r["host"] for r in head})},
    }
    out["subagent"] = {"sessions": sum(1 for r in rows if r["kind"] == "subagent")}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("sessions", help="JSONL written by extract.py")
    ap.add_argument("-o", "--out", help="write the summary here instead of stdout")
    a = ap.parse_args(argv)
    if a.out:
        try:
            a.out = safe_file_target(a.out)
        except UnsafeOutput as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
    rows, errors = load_rows(a.sessions)
    text = json.dumps(aggregate(rows, errors), ensure_ascii=False, indent=1)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
