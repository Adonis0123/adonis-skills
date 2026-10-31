#!/usr/bin/env python3
"""Score judged practices and render the local HTML report.

Usage:
  build_report.py --judgments JUDGMENTS.json [--summary SUMMARY.json]
                  [--practices references/practices.json] [--previous auto|none|PATH]
                  [--out-dir DIR] [--date YYYY-MM-DD]

Writes report.html and report-data.json into
$AGENT_PRACTICE_AUDIT_DIR/reports/YYYY-MM-DD/ (default base
~/.local/share/agent-practice-audit). report-data.json is what the next run
compares against. Optional $AGENT_PRACTICE_AUDIT_DIR/config.json supplies
theme colours and an illustration; see references/audit-files.md.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import digests  # noqa: E402
from safe_output import UnsafeOutput, check_date, safe_file_target, safe_output_path  # noqa: E402
DEFAULT_PRACTICES = os.path.join(SKILL, "references", "practices.json")
TEMPLATE = os.path.join(SKILL, "assets", "report-template.html")
PLACEHOLDER = "__REPORT_DATA__"

POINTS = {"ok": 10, "part": 5, "no": 0, "na": None}
GRADES = ((90, "S"), (80, "A"), (70, "B"), (60, "C"), (0, "D"))
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class InputError(ValueError):
    """Bad or incomplete input; the message says how to fix it."""


def base_dir() -> str:
    return os.path.expanduser(os.environ.get("AGENT_PRACTICE_AUDIT_DIR") or "~/.local/share/agent-practice-audit")


# ---------------------------------------------------------------- scoring

def score(statuses: list[str]) -> int | None:
    """earned / max * 100, rounded; None when nothing is scorable."""
    pts = [POINTS[s] for s in statuses if POINTS[s] is not None]
    return round(100 * sum(pts) / (10 * len(pts))) if pts else None


def grade(value: int | None) -> str | None:
    if value is None:
        return None
    return next(letter for floor, letter in GRADES if value >= floor)


def ladder(items: list[dict], dim_scores: dict[str, int | None] | None = None) -> list[dict]:
    """Fewest fixes to reach each higher grade, cumulatively.

    Every scored practice weighs the same, so taking the biggest gains first
    (no -> ok = 10, part -> ok = 5) is minimal. Ties go to the weakest dimension.
    """
    scored = [i for i in items if POINTS[i["status"]] is not None]
    if not scored:
        return []
    dim_scores = dim_scores or {}
    cands = sorted((i for i in scored if i["status"] != "ok"),
                   key=lambda i: (POINTS[i["status"]], dim_scores.get(i["dimension"]) or 0))
    statuses = {i["id"]: i["status"] for i in scored}
    steps, fixed = [], []
    for floor, _letter in sorted(GRADES[:-1]):
        if score(list(statuses.values())) >= floor:
            continue
        add = []
        while score(list(statuses.values())) < floor and cands:
            c = cands.pop(0)
            statuses[c["id"]] = "ok"
            add.append(c["id"])
        fixed += add
        now = score(list(statuses.values()))
        steps.append({"grade": grade(now), "score": now, "add": add, "total": len(fixed)})
    return steps


def trend(prev: str | None, cur: str) -> str:
    if prev is None:
        return "new"
    if prev == cur:
        return "same"
    a, b = POINTS.get(prev), POINTS[cur]
    if a is None or b is None:
        return "changed"
    return "up" if b > a else "down"


# ---------------------------------------------------------------- inputs

def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def previous_statuses(data: dict) -> dict[str, str]:
    """Accept a previous report-data.json (items list) or judgments.json (items mapping)."""
    items = data.get("items")
    if isinstance(items, list):
        return {i["id"]: i["status"] for i in items
                if isinstance(i, dict) and "id" in i and isinstance(i.get("status"), str) and i["status"] in POINTS}
    if isinstance(items, dict):
        return {k: v.get("status") for k, v in items.items() if isinstance(v, dict) and v.get("status") in POINTS}
    return {}


def find_previous(reports_root: str, out_dir: str) -> str | None:
    """Latest reports/<date>/report-data.json older than the current output directory."""
    if not os.path.isdir(reports_root):
        return None
    current = os.path.basename(os.path.normpath(out_dir))
    dates = sorted(d for d in os.listdir(reports_root)
                   if d < current and os.path.isfile(os.path.join(reports_root, d, "report-data.json")))
    return os.path.join(reports_root, dates[-1], "report-data.json") if dates else None


def resolve_sources(sources: list[dict], sources_dir: str | None, cache: dict) -> list[dict]:
    """Attach link state from the offline digest. Unreachable sources carry the digest summary instead."""
    out = []
    for s in sources:
        slug = s.get("source")
        if slug and sources_dir and slug not in cache:
            cache[slug] = digests.load_digest(slug, sources_dir)
        d = cache.get(slug) if slug else None
        status = (d or {}).get("linkStatus") or "ok"
        r = {**s, "linkStatus": status, "href": s["url"]}
        if status == "redirected" and (d or {}).get("finalUrl"):
            r["href"] = d["finalUrl"]
        if d:
            r["digestPath"] = d["path"]
            r["lastVerifiedAt"] = d.get("lastVerifiedAt", "")
            if status == "unreachable":
                r["digestSummary"] = d.get("summary") or []
        out.append(r)
    return out


def merge(practices: dict, judgments: dict, lang: str, allow_missing: bool = False,
          sources_dir: str | None = digests.SOURCES_DIR) -> list[dict]:
    judged = judgments.get("items") or {}
    ids = [p["id"] for p in practices["practices"]]
    if len(set(ids)) != len(ids):
        raise InputError("duplicate practice ids; give each practice a unique id before scoring")
    missing = [i for i in ids if i not in judged]
    if missing and not allow_missing:
        raise InputError(f"no judgment for: {', '.join(missing)}. Add them to judgments.items "
                         "(status na with a reason if they cannot be measured) or pass --allow-missing.")
    unknown = sorted(set(judged) - set(ids))
    if unknown:
        print(f"warning: judgments for unknown practice ids ignored: {', '.join(unknown)}", file=sys.stderr)
    out, cache = [], {}
    for p in practices["practices"]:
        j = judged.get(p["id"]) or {"status": "na", "evidence": "Not judged in this run."}
        st = j.get("status")
        if st not in POINTS:
            raise InputError(f"{p['id']}: status must be one of ok, part, no, na (got {st!r})")
        out.append({
            "id": p["id"], "dimension": p["dimension"],
            "title": p.get("title_zh") if lang == "zh" and p.get("title_zh") else p["title"],
            "sources": resolve_sources(p["sources"], sources_dir, cache), "detect": p["detect"],
            "verifiedAt": p.get("verifiedAt", ""), "basis": p.get("basis", "live"),
            "status": st, "points": POINTS[st],
            "summary": j.get("summary", ""), "evidence": j.get("evidence", ""),
            "suggestion": j.get("suggestion", ""), "caveat": j.get("caveat", ""),
        })
    return out


def data_notes(summary: dict | None, lang: str) -> list[str]:
    if not summary:
        return []
    kinds = summary.get("kinds") or {}
    hosts = sorted({k.split("/")[0] for k in kinds})
    parts = []
    for h in hosts:
        c = {k.split("/")[1]: v for k, v in kinds.items() if k.startswith(h + "/")}
        if lang == "zh":
            parts.append(f"{h}：人开 {c.get('human', 0)}、无头 {c.get('headless', 0)}、subagent {c.get('subagent', 0)}")
        else:
            parts.append(f"{h}: {c.get('human', 0)} human, {c.get('headless', 0)} headless, {c.get('subagent', 0)} subagent")
    files, errors = summary.get("files", 0), summary.get("errors", 0)
    if lang == "zh":
        return [f"共扫描 {files} 个会话文件（解析失败 {errors} 个）。" + "；".join(parts) + "。"]
    return [f"Scanned {files} session files ({errors} failed to parse). " + "; ".join(parts) + "."]


def build_data(practices: dict, judgments: dict, summary: dict | None = None, previous: dict | None = None,
               config: dict | None = None, date: str | None = None, allow_missing: bool = False,
               sources_dir: str | None = digests.SOURCES_DIR) -> dict:
    lang = "zh" if str(judgments.get("lang", "en")).lower().startswith("zh") else "en"
    items = merge(practices, judgments, lang, allow_missing, sources_dir)
    prev = previous_statuses(previous) if previous else {}
    for it in items:
        it["trend"] = trend(prev.get(it["id"]), it["status"]) if previous else None
    dims_meta = practices.get("dimensions") or {}
    dim_scores = {d: score([i["status"] for i in items if i["dimension"] == d]) for d in dims_meta}
    dimensions = []
    for d, meta in dims_meta.items():
        ids = [i["id"] for i in items if i["dimension"] == d]
        s = dim_scores[d]
        pd = None
        if previous:
            pst = [prev[i] for i in ids if i in prev]
            pd = score(pst) if pst else None
        dimensions.append({"id": d, "name": meta.get(lang) or meta.get("en") or d,
                           "hint": (meta.get("hint") or {}).get(lang, ""), "score": s, "grade": grade(s),
                           "ids": ids, "delta": (s - pd) if s is not None and pd is not None else None})
    total = score([i["status"] for i in items])
    prev_total = score(list(prev.values())) if prev else None
    counts = {k: sum(1 for i in items if i["status"] == k) for k in POINTS}
    config = config or {}
    theme = {k: v for k, v in (config.get("theme") or {}).items() if k in ("accent", "accentDark") and HEX.match(str(v))}
    return {
        "lang": lang,
        "date": date or dt.date.today().isoformat(),
        "windowDays": judgments.get("window_days") or (summary or {}).get("window_days") or 60,
        "headline": judgments.get("headline", ""),
        "lead": judgments.get("lead", ""),
        "score": total,
        "grade": grade(total),
        "scoreDelta": (total - prev_total) if total is not None and prev_total is not None else None,
        "counts": counts,
        "dimensions": dimensions,
        "ladder": ladder(items, dim_scores),
        "items": items,
        "notes": list(judgments.get("notes") or []),
        "dataNotes": data_notes(summary, lang),
        "theme": theme or None,
        "illustration": None,
        "illustrationAlt": config.get("illustrationAlt", ""),
        "brand": {"name": str((config.get("brand") or {}).get("name", ""))[:60], "logo": None, "logoDark": None},
        "previous": previous.get("date") if previous else None,
    }


def render(data: dict, template_path: str = TEMPLATE) -> str:
    with open(template_path, encoding="utf-8") as f:
        tpl = f.read()
    if PLACEHOLDER not in tpl:
        raise InputError(f"{template_path} has no {PLACEHOLDER} placeholder")
    blob = json.dumps(data, ensure_ascii=False)
    # Escape characters that can end or confuse an HTML <script> block; JSON \u escapes keep it valid JSON.
    for ch, code in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"), ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        blob = blob.replace(ch, code)
    return tpl.replace(PLACEHOLDER, blob)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--judgments", required=True)
    ap.add_argument("--summary", help="aggregate.py output, for the data notes")
    ap.add_argument("--practices", default=DEFAULT_PRACTICES)
    ap.add_argument("--previous", default="auto", help="auto (latest earlier report), none, or a report-data.json / judgments.json path")
    ap.add_argument("--out-dir")
    ap.add_argument("--date", help="report date, default today (YYYY-MM-DD)")
    ap.add_argument("--sources-dir", default=digests.SOURCES_DIR, help="offline digests directory (default: the skill's references/sources)")
    ap.add_argument("--allow-missing", action="store_true", help="treat unjudged practices as na instead of failing")
    a = ap.parse_args(argv)

    try:
        date = check_date(a.date) if a.date else dt.date.today().isoformat()
        base = base_dir()
        out_dir = safe_output_path(a.out_dir if a.out_dir else os.path.join(base, "reports", date))
    except UnsafeOutput as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    config_path = os.path.join(base, "config.json")
    config = load_json(config_path) if os.path.isfile(config_path) else {}

    prev_path = None
    if a.previous == "auto":
        prev_path = find_previous(os.path.join(base, "reports"), out_dir)
    elif a.previous != "none":
        prev_path = os.path.expanduser(a.previous)
    try:
        data = build_data(load_json(a.practices), load_json(a.judgments),
                          load_json(a.summary) if a.summary else None,
                          load_json(prev_path) if prev_path else None, config, date, a.allow_missing,
                          a.sources_dir)
    except InputError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    os.makedirs(out_dir, exist_ok=True)
    try:
        data_path = safe_file_target(os.path.join(out_dir, "report-data.json"))
        html_path = safe_file_target(os.path.join(out_dir, "report.html"))
        brand = config.get("brand") or {}
        # (config value, setter) pairs; each existing file is copied into the run's img/ directory.
        images = [(config.get("illustration"), lambda rel: data.__setitem__("illustration", rel)),
                  (brand.get("logo"), lambda rel: data["brand"].__setitem__("logo", rel)),
                  (brand.get("logoDark"), lambda rel: data["brand"].__setitem__("logoDark", rel))]
        copies = []
        for value, setter in images:
            if value and os.path.isfile(os.path.expanduser(str(value))):
                src = os.path.expanduser(str(value))
                os.makedirs(safe_output_path(os.path.join(out_dir, "img")), exist_ok=True)
                copies.append((src, safe_file_target(os.path.join(out_dir, "img", os.path.basename(src))), setter))
    except UnsafeOutput as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    for src, dst, setter in copies:
        shutil.copyfile(src, dst)
        setter("img/" + os.path.basename(src))
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(render(data))
    print(f"report: {html_path}")
    print(f"score: {data['score'] if data['score'] is not None else 'n/a (nothing scorable)'} grade: {data['grade'] or 'n/a'}"
          + (f" (previous {data['previous']}, delta {data['scoreDelta']:+d})" if data["scoreDelta"] is not None else ""))
    for s in data["ladder"]:
        print(f"fix {len(s['add'])} -> {s['score']} {s['grade']}: {', '.join(s['add'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
