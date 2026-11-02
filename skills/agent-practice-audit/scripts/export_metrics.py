#!/usr/bin/env python3
"""Write metrics.json: the report's numbers in the shared Check-up metrics format (schemaVersion 1).

build_report.py calls metrics_doc() for every new report. Run this script on an older report directory
(one holding report-data.json and, ideally, work/summary.json) to backfill it:

    python3 export_metrics.py "$AGENT_PRACTICE_AUDIT_DIR/reports/2026-11-01" --backfill

The format is documented in references/audit-files.md (metrics.json). Every metric names the file and field it
came from; a value the report cannot show is null with status "na", never a guess.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys

SCHEMA_VERSION = 1
SOURCE = "agent-practice-audit"
# Method version of the session metrics; bump when their formula changes so trends break instead of lying.
SUMMARY_METHOD = "summary-v1"
HOST_ORDER = ("claude", "codex", "grok", "workbuddy")

DIM_LABEL_EN = {"ctx": "Context management", "safe": "Permissions and safety", "doc": "Instruction files",
                "plan": "Think before doing", "verify": "Verification", "auto": "Parallelism and automation"}
DIM_LABEL_ZH = {"ctx": "上下文管理", "safe": "权限与安全", "doc": "指令文件",
                "plan": "先想后做", "verify": "验证", "auto": "并行与自动化"}


def _hash(parts: list[str]) -> str:
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:16]


def _metric(mid, en, zh, group, value, unit, better, *, scope="all", status=None, criteria=None,
            numerator=None, denominator=None, file="report-data.json", field="", extra=None):
    m = {"id": mid, "label": {"en": en, "zh": zh}, "group": group, "scope": scope,
         "value": value, "unit": unit, "better": better,
         "status": status or ("measured" if value is not None else "na"),
         "criteriaHash": criteria, "numerator": numerator, "denominator": denominator,
         "source": {"file": file, "field": field}}
    if extra:
        m.update(extra)
    return m


def _pct(num, den):
    return round(100.0 * num / den, 1) if isinstance(num, (int, float)) and isinstance(den, (int, float)) and den else None


def score_metrics(data: dict) -> list[dict]:
    items = [i for i in data.get("items") or [] if isinstance(i, dict)]
    measured = sorted(f'{i["id"]}:{i.get("criteriaHash", "")}' for i in items if i.get("status") in ("ok", "part", "no"))
    all_ids = sorted(f'{i["id"]}:{i.get("criteriaHash", "")}' for i in items)
    total_hash = _hash(measured) if all(i.get("criteriaHash") for i in items) else None
    cov = data.get("coverage") or {}
    counts = data.get("counts") or {}
    out = [
        _metric("score", "Total score", "总分", "score", data.get("score"), "score", "higher",
                status="withheld" if data.get("gradeWithheld") else None, criteria=total_hash, field="score",
                extra={"grade": data.get("grade")}),
        _metric("coverage", "Measured coverage", "测量覆盖率", "score", cov.get("pct"), "pct", "higher",
                criteria=_hash(all_ids), numerator=cov.get("measured"), denominator=cov.get("total"), field="coverage.pct"),
    ]
    for key, en, zh, better in (("ok", "Practices met", "达标条目", "higher"), ("part", "Partly met", "部分达标", "neutral"),
                                ("no", "Practices missed", "未达标条目", "lower"), ("na", "Not measurable", "无法检测", "lower")):
        out.append(_metric(f"items.{key}", en, zh, "items", counts.get(key), "count", better,
                           criteria=_hash(all_ids), field=f"counts.{key}"))
    for d in data.get("dimensions") or []:
        did = d.get("id")
        dim_items = [i for i in items if i.get("dimension") == did]
        dim_measured = sorted(f'{i["id"]}:{i.get("criteriaHash", "")}' for i in dim_items if i.get("status") in ("ok", "part", "no"))
        value = None if d.get("lowCoverage") else d.get("score")
        dcov = d.get("coverage") or {}
        out.append(_metric(f"dim.{did}", DIM_LABEL_EN.get(did, d.get("name", did)), DIM_LABEL_ZH.get(did, d.get("name", did)),
                           "dimension", value, "score", "higher",
                           status="withheld" if d.get("lowCoverage") else None,
                           criteria=_hash(dim_measured) if all(i.get("criteriaHash") for i in dim_items) else None,
                           numerator=dcov.get("measured"), denominator=dcov.get("total"), field=f"dimensions[{did}].score"))
    return out


def session_metrics(summary: dict | None) -> list[dict]:
    """Per-host session habits from aggregate.py's summary.json. No summary: no session metrics."""
    if not isinstance(summary, dict):
        return []
    out = []
    hosts = summary.get("hosts") or {}
    f = "work/summary.json"
    for host in [h for h in HOST_ORDER if h in hosts] + sorted(set(hosts) - set(HOST_ORDER)):
        h = hosts[host] if isinstance(hosts[host], dict) else {}
        n = h.get("sessions")
        if not n:
            continue
        out += [
            _metric("sessions.human", "Human sessions", "人工会话数", "sessions", n, "count", "neutral",
                    scope=host, criteria=SUMMARY_METHOD, file=f, field=f"hosts.{host}.sessions"),
            _metric("sessions.long_pct", "Long sessions (>200 tool calls)", "长会话占比（超 200 次工具调用）", "sessions",
                    _pct(h.get("long_sessions"), n), "pct", "lower", scope=host, criteria=SUMMARY_METHOD,
                    numerator=h.get("long_sessions"), denominator=n, file=f, field=f"hosts.{host}.long_sessions"),
            _metric("sessions.corrections_per100", "Corrections per 100 prompts", "每百条提示纠错数", "sessions",
                    h.get("corrections_per100_prompts"), "per100", "lower", scope=host, criteria=SUMMARY_METHOD,
                    file=f, field=f"hosts.{host}.corrections_per100_prompts"),
            _metric("sessions.full_access_pct", "Sessions with full access", "全权限运行的会话占比", "sessions",
                    _pct(h.get("full_access_sessions"), n), "pct", "lower", scope=host, criteria=SUMMARY_METHOD,
                    numerator=h.get("full_access_sessions"), denominator=n, file=f, field=f"hosts.{host}.full_access_sessions"),
        ]
        coding = h.get("coding_sessions")
        if coding:
            out.append(_metric("sessions.coding_with_check_pct", "Coding sessions that ran a check", "编码会话跑过检查的占比",
                               "sessions", h.get("pct_coding_with_check"), "pct", "higher", scope=host, criteria=SUMMARY_METHOD,
                               numerator=round(coding * (h.get("pct_coding_with_check") or 0) / 100), denominator=coding,
                               file=f, field=f"hosts.{host}.pct_coding_with_check"))
    kinds = summary.get("kinds") or {}
    if kinds:
        for kind, en, zh in (("headless", "Headless sessions", "headless 会话数"), ("subagent", "Subagent sessions", "subagent 会话数")):
            total = sum(v for k, v in kinds.items() if k.endswith("/" + kind) and isinstance(v, int))
            out.append(_metric(f"sessions.{kind}", en, zh, "sessions", total, "count", "neutral",
                               criteria=SUMMARY_METHOD, file=f, field="kinds"))
    return out


def metrics_doc(data: dict, summary: dict | None, run_id: str, run_at: str | None, *, backfilled: bool = False) -> dict:
    date = data.get("date")
    days = data.get("windowDays")
    start = None
    if isinstance(date, str) and isinstance(days, int):
        try:
            start = (dt.date.fromisoformat(date) - dt.timedelta(days=days)).isoformat()
        except ValueError:
            start = None
    items = [{"id": i.get("id"), "dimension": i.get("dimension"), "status": i.get("status"),
              "points": i.get("points"), "criteriaHash": i.get("criteriaHash")}
             for i in data.get("items") or [] if isinstance(i, dict)]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": SOURCE,
        "runId": run_id,
        "runAt": run_at,
        "timePrecision": "second" if run_at else "day",
        "reportDate": date,
        "backfilled": backfilled,
        "mode": "full",
        "lang": data.get("lang"),
        "window": {"days": days, "start": start, "end": date},
        "headline": data.get("headline", ""),
        "report": {"html": "report.html", "data": "report-data.json"},
        "metrics": score_metrics(data) + session_metrics(summary),
        "items": items,
        "changes": [],
    }


def write_doc(doc: dict, out_dir: str) -> str:
    path = os.path.join(out_dir, "metrics.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("report_dir", help="a report directory holding report-data.json")
    ap.add_argument("--backfill", action="store_true", help="mark the run as backfilled; runAt stays null (day precision)")
    a = ap.parse_args(argv)
    from safe_output import UnsafeOutput, safe_file_target  # same write guard as build_report.py

    report_dir = os.path.abspath(os.path.expanduser(a.report_dir))
    data_path = os.path.join(report_dir, "report-data.json")
    try:
        with open(data_path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: cannot read {data_path}: {e.__class__.__name__}; run build_report.py for this directory first", file=sys.stderr)
        return 2
    summary = None
    summary_path = os.path.join(report_dir, "work", "summary.json")
    if os.path.isfile(summary_path):
        with open(summary_path, encoding="utf-8") as f:
            summary = json.load(f)
    run_at = None if a.backfill else dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    doc = metrics_doc(data, summary, os.path.basename(report_dir), run_at, backfilled=a.backfill)
    try:
        safe_file_target(os.path.join(report_dir, "metrics.json"))
    except UnsafeOutput as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    path = write_doc(doc, report_dir)
    print(f"metrics: {path} ({len(doc['metrics'])} metrics{', session metrics skipped: no work/summary.json' if summary is None else ''})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
