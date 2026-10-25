#!/usr/bin/env python3
"""Compare the arms of a run_bench.py results.jsonl: per task first, then in total (references/measure.md).

The verdict follows the rule in measure.md: the dispatch arm earns its tier only if it completes at least as
many tasks as solo, no task got worse, and its median wall time is lower. A task whose arms differ by a single
run is marked "check transcript": one run can be chance.

  python3 compare.py <out>/results.jsonl [--md report.md] [--base solo --other dispatch]
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys


def load(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def median(values: list[float]) -> float | None:
    values = [v for v in values if isinstance(v, (int, float))]
    return round(statistics.median(values), 2) if values else None


def summarize(rows: list[dict], base: str, other: str) -> dict:
    tasks = sorted({r["task"] for r in rows})
    per_task = []
    for task in tasks:
        entry = {"task": task}
        for arm in (base, other):
            mine = [r for r in rows if r["task"] == task and r["arm"] == arm]
            entry[arm] = {"passed": sum(1 for r in mine if r.get("pass")), "runs": len(mine),
                          "wall_s": median([r.get("wall_s") for r in mine]),
                          "cost_usd": median([r.get("total_known_cost_usd") for r in mine]),
                          "tiers": sorted({r.get("tier") for r in mine if r.get("tier")})}
        b, o = entry[base], entry[other]
        rate = lambda a: a["passed"] / a["runs"] if a["runs"] else None
        if rate(b) is None or rate(o) is None:
            entry["flip"] = "missing runs"
        elif rate(o) < rate(b):
            entry["flip"] = "worse"
        elif rate(o) > rate(b):
            entry["flip"] = "better"
        else:
            entry["flip"] = ""
        if entry["flip"] in ("worse", "better") and abs(b["passed"] - o["passed"]) == 1:
            entry["flip"] += " (one run: check transcript)"
        per_task.append(entry)
    totals = {}
    for arm in (base, other):
        mine = [r for r in rows if r["arm"] == arm]
        totals[arm] = {"passed": sum(1 for r in mine if r.get("pass")), "runs": len(mine),
                       "tasks_completed": sum(1 for e in per_task if e[arm]["runs"] and e[arm]["passed"] == e[arm]["runs"]),
                       "wall_s": median([r.get("wall_s") for r in mine]),
                       "cost_usd": median([r.get("total_known_cost_usd") for r in mine]),
                       "unknown_cost_runs": sum(1 for r in mine if r.get("lanes_without_cost"))}
    b, o = totals[base], totals[other]
    worse = [e["task"] for e in per_task if e["flip"].startswith("worse")]
    faster = b["wall_s"] is not None and o["wall_s"] is not None and o["wall_s"] < b["wall_s"]
    holds = o["tasks_completed"] >= b["tasks_completed"] and not worse and faster
    reasons = []
    if o["tasks_completed"] < b["tasks_completed"]:
        reasons.append(f"{other} completed fewer tasks ({o['tasks_completed']} vs {b['tasks_completed']})")
    if worse:
        reasons.append(f"worse on {', '.join(worse)}")
    if not faster:
        reasons.append(f"not faster (median {o['wall_s']}s vs {b['wall_s']}s)")
    return {"per_task": per_task, "totals": totals, "holds": holds, "reasons": reasons, "base": base, "other": other}


def render(s: dict) -> str:
    base, other = s["base"], s["other"]
    out = [f"| Task | {base} pass | {other} pass | {other} tier | {base} median s | {other} median s | {base} median $ | {other} median $ | Flip |",
           "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for e in s["per_task"]:
        b, o = e[base], e[other]
        out.append(f"| {e['task']} | {b['passed']}/{b['runs']} | {o['passed']}/{o['runs']} | {', '.join(o['tiers']) or '-'} | "
                   f"{b['wall_s']} | {o['wall_s']} | {b['cost_usd']} | {o['cost_usd']} | {e['flip'] or '-'} |")
    out.append("")
    for arm in (base, other):
        t = s["totals"][arm]
        note = f"; {t['unknown_cost_runs']} run(s) had lanes without a reported cost" if t["unknown_cost_runs"] else ""
        out.append(f"- {arm}: {t['passed']}/{t['runs']} runs passed, {t['tasks_completed']} task(s) passed every run, "
                   f"median {t['wall_s']}s, median known cost ${t['cost_usd']}{note}")
    verdict = "holds" if s["holds"] else "does not hold: " + "; ".join(s["reasons"])
    out.append(f"- Verdict ({other} vs {base}): {verdict}")
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("results")
    p.add_argument("--base", default="solo")
    p.add_argument("--other", default="dispatch")
    p.add_argument("--md", help="also write the table to this Markdown file")
    args = p.parse_args(argv)
    rows = load(args.results)
    if not rows:
        print(f"{args.results} has no results; run run_bench.py first", file=sys.stderr)
        return 2
    text = render(summarize(rows, args.base, args.other))
    sys.stdout.write(text)
    if args.md:
        with open(args.md, "w", encoding="utf-8") as f:
            f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
