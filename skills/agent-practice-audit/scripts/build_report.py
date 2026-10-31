#!/usr/bin/env python3
"""Score judged practices and render the local HTML report.

Usage:
  build_report.py --judgments JUDGMENTS.json [--summary SUMMARY.json]
                  [--practices references/practices.json] [--previous auto|none|PATH]
                  [--out-dir DIR] [--date YYYY-MM-DD]

Writes report.html and report-data.json into
$AGENT_PRACTICE_AUDIT_DIR/reports/YYYY-MM-DD/ (default base
~/.local/share/agent-practice-audit). report-data.json is what the next run
compares against. A letter grade needs >= 60% of practices measured (not na) and a
dimension score >= 50%; trends compare only practices measured in both runs. Every
ok/part/no needs evidence, part/no a suggestion, na an evidence or caveat.
Optional $AGENT_PRACTICE_AUDIT_DIR/config.json supplies
theme colours and an illustration; see references/audit-files.md.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
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
# A letter grade needs this share of all practices measured (status other than na); below it the
# score is shown without a grade or ladder, so 1 ok + 19 na cannot read as 100/S.
MIN_COVERAGE = 60
MIN_DIM_COVERAGE = 50  # per dimension: below this share measured, the dimension score shows as "—"
MIN_DIM_MEASURED = 2  # ... and below this many measured practices: one practice is not a dimension score
HEURISTIC_MARK = "(heuristic)"  # rule.text ends with this when its number is the list's own, not the vendor's
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


def coverage(statuses: list[str]) -> dict:
    """How many practices were measured (status other than na) out of all of them."""
    measured = sum(1 for s in statuses if POINTS[s] is not None)
    total = len(statuses)
    return {"measured": measured, "total": total, "pct": round(100 * measured / total) if total else 0}


def enough(cov: dict, floor_pct: int) -> bool:
    """Exact comparison, so 59.5% never rounds up to a 60% floor."""
    return cov["total"] > 0 and 100 * cov["measured"] >= floor_pct * cov["total"]


def needed_for(total: int, floor_pct: int) -> int:
    """Measured practices needed to reach floor_pct of total."""
    return -(-floor_pct * total // 100)


def ladder(items: list[dict], dim_scores: dict[str, int | None] | None = None) -> list[dict]:
    """Fewest fixes to reach each higher grade, cumulatively.

    Every scored practice weighs the same, so taking the biggest gains first
    (no -> ok = 10, part -> ok = 5) is minimal. On equal gains a config fix comes before a habit
    change, a vendor-backed rule before a heuristic one, then the weakest dimension first.
    Each step lists its fixes with fix kind and whether the rule is a heuristic threshold.
    """
    scored = [i for i in items if POINTS[i["status"]] is not None]
    if not scored:
        return []
    dim_scores = dim_scores or {}
    cands = sorted((i for i in scored if i["status"] != "ok"),
                   key=lambda i: (POINTS[i["status"]], 0 if i.get("fixKind") == "config" else 1,
                                  1 if (i.get("rule") or {}).get("heuristic") else 0,
                                  # Dimensions without a shown score (too few measured) are left out of
                                  # the weakest-dimension tie-break: they sort after every scored one.
                                  101 if dim_scores.get(i["dimension"]) is None else dim_scores[i["dimension"]]))
    meta = {i["id"]: {"id": i["id"], "fixKind": i.get("fixKind"),
                      "heuristic": bool((i.get("rule") or {}).get("heuristic"))} for i in scored}
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
        steps.append({"grade": grade(now), "score": now, "add": add, "total": len(fixed),
                      "fixes": [meta[i] for i in add]})
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


def criteria_hash(p: dict) -> str:
    """Fingerprint of what a status means: the practice's rule (text + params) and detect text."""
    rule = p.get("rule") if isinstance(p.get("rule"), dict) else {}
    blob = json.dumps({"text": rule.get("text"), "params": rule.get("params"), "detect": p.get("detect")},
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def like_for_like(cur: dict[str, str], prev: dict[str, str], ids: list[str],
                  exclude: set[str] = frozenset()) -> tuple[int | None, int]:
    """(score change, practices compared) over the ids measured (not na) in both runs, minus exclude."""
    both = [i for i in ids if i in prev and i not in exclude and POINTS[cur[i]] is not None and POINTS[prev[i]] is not None]
    before, after = score([prev[i] for i in both]), score([cur[i] for i in both])
    return ((after - before) if after is not None and before is not None else None), len(both)


def compare(cur: dict[str, str], prev: dict[str, str], changed_rule: set[str] = frozenset()) -> dict:
    """Score change on the practices measured in both runs, with coverage and list changes kept apart.

    Restricting the delta to practices measured both times keeps a shift from na to ok, or a
    practice added to the list, from showing up as a score jump. A practice whose rule or detect
    text changed since the previous run measures something else now, so it is left out too.
    """
    delta, compared = like_for_like(cur, prev, list(cur), changed_rule)
    cov_now, cov_prev = coverage(list(cur.values())), coverage(list(prev.values()))
    return {
        "compared": compared, "delta": delta,
        "coverageBefore": cov_prev, "coverageAfter": cov_now,
        "coverageDelta": (cov_now["pct"] - cov_prev["pct"]) if cov_prev["total"] else None,
        "added": [i for i in cur if i not in prev],
        "removed": [i for i in prev if i not in cur],
        "newlyMeasured": [i for i in cur if i in prev and POINTS[prev[i]] is None and POINTS[cur[i]] is not None],
        "noLongerMeasured": [i for i in cur if i in prev and POINTS[prev[i]] is not None and POINTS[cur[i]] is None],
        "changedRule": [i for i in cur if i in changed_rule],
    }


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


def previous_hashes(data: dict) -> dict[str, str]:
    """criteriaHash per id from a previous report-data.json; empty for older reports and judgments files."""
    items = data.get("items")
    if not isinstance(items, list):
        return {}
    return {i["id"]: i["criteriaHash"] for i in items
            if isinstance(i, dict) and isinstance(i.get("id"), str) and isinstance(i.get("criteriaHash"), str)}


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
    for w in redact_judgments(judgments):
        print(w, file=sys.stderr)
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
    out, cache, gaps = [], {}, []
    for p in practices["practices"]:
        j = judged.get(p["id"]) or {"status": "na", "evidence": "Not judged in this run."}
        st = j.get("status")
        if st not in POINTS:
            raise InputError(f"{p['id']}: status must be one of ok, part, no, na (got {st!r})")
        gaps += judgment_gaps(p["id"], j)
        out.append({
            "id": p["id"], "dimension": p["dimension"],
            "title": p.get("title_zh") if lang == "zh" and p.get("title_zh") else p["title"],
            "sources": resolve_sources(p["sources"], sources_dir, cache), "detect": p["detect"],
            "verifiedAt": p.get("verifiedAt", ""), "basis": effective_basis(p),
            "rule": rule_view(p.get("rule")),
            "criteriaHash": criteria_hash(p),
            "fixKind": p.get("fix_kind") if p.get("fix_kind") in ("config", "habit") else None,
            **consensus_view(p),
            "status": st, "points": POINTS[st],
            "summary": j.get("summary", ""), "evidence": j.get("evidence", ""),
            "suggestion": j.get("suggestion", ""), "caveat": j.get("caveat", ""),
        })
    if gaps:
        raise InputError("judgments.json is incomplete; fix these items in judgments.items and rebuild:\n  - "
                         + "\n  - ".join(gaps))
    return out


def effective_basis(p: dict) -> str:
    """digest when the practice or any of its sources rests on a stored digest (label 基于摘要), else live."""
    if p.get("basis") in ("digest", "mixed") or any(isinstance(s, dict) and s.get("basis") == "digest"
                                                     for s in p.get("sources") or []):
        return "digest"
    return "live"


HOME_PATH = re.compile(r"(?<![\w~])(?:/Users|/home)/[^/\s`'\")\]]+(?=/|\b|$)")


def redact_home(text, home: str | None = None) -> tuple[str, bool]:
    """Replace the user's home directory (or any /Users/<name>, /home/<name>) with ~ in report text."""
    if not isinstance(text, str):
        return text, False
    home = (home if home is not None else os.path.expanduser("~")).rstrip("/")
    out = text.replace(home + "/", "~/") if home and home != "/" else text
    if home and home != "/" and out.endswith(home):
        out = out[: -len(home)] + "~"
    out = HOME_PATH.sub("~", out)
    return out, out != text


def redact_judgments(judgments: dict) -> list[str]:
    """Redact home paths in every text field of judgments in place; one warning per changed field."""
    warnings = []
    for key in ("headline", "lead"):
        judgments[key], changed = redact_home(judgments.get(key, ""))
        if changed:
            warnings.append(f"warning: {key}: replaced a home directory path with ~")
    notes = judgments.get("notes")
    if isinstance(notes, list):
        for n, note in enumerate(notes):
            notes[n], changed = redact_home(note)
            if changed:
                warnings.append(f"warning: notes[{n}]: replaced a home directory path with ~")
    for pid, j in (judgments.get("items") or {}).items():
        if not isinstance(j, dict):
            continue
        for field in ("summary", "evidence", "suggestion", "caveat"):
            j[field], changed = redact_home(j.get(field, ""))
            if changed:
                warnings.append(f"warning: {pid} {field}: replaced a home directory path with ~")
    return warnings


def filled(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def judgment_gaps(pid: str, j: dict) -> list[str]:
    """Actionable messages for a judgment whose verdict is not backed by text (SKILL.md contract 4)."""
    st, gaps = j.get("status"), []
    if st in ("ok", "part", "no") and not filled(j.get("evidence")):
        gaps.append(f"{pid} (status {st}): field `evidence` is empty. Add the number or file fact behind the "
                    "verdict, e.g. `66/339 Claude sessions ran over 200 tool calls`.")
    if st in ("part", "no") and not filled(j.get("suggestion")):
        gaps.append(f"{pid} (status {st}): field `suggestion` is empty. Add one or two imperative sentences "
                    "naming the file, flag or command to change.")
    if st == "na" and not (filled(j.get("evidence")) or filled(j.get("caveat"))):
        gaps.append(f"{pid} (status na): fields `evidence` and `caveat` are both empty. Say in either one why "
                    "the logs or config cannot measure this practice.")
    return gaps


def rule_view(rule) -> dict | None:
    """The practice's scoring rule for display; `heuristic` marks a threshold the list chose, not the vendor."""
    if not isinstance(rule, dict) or not filled(rule.get("text")):
        return None
    text = rule["text"].strip()
    heuristic = text.endswith(HEURISTIC_MARK)
    params = rule.get("params") if isinstance(rule.get("params"), dict) else {}
    return {"text": text[: -len(HEURISTIC_MARK)].rstrip() if heuristic else text, "params": params,
            "heuristic": heuristic}


def consensus_view(p: dict) -> dict:
    """consensus record, needs-consensus flag, and whether at least two models verified the practice."""
    c = p.get("consensus") if isinstance(p.get("consensus"), dict) else None
    needs = bool(p.get("needs-consensus"))
    agree, total = (c or {}).get("agree"), (c or {}).get("total")
    multi = (not needs and isinstance(agree, int) and isinstance(total, int)
             and agree >= 2 and agree > total / 2)
    return {"consensus": c, "needsConsensus": needs, "verifiedBy": "multi" if multi else "single"}


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
    judgments = json.loads(json.dumps(judgments))  # merge redacts home paths; keep the caller's copy intact
    items = merge(practices, judgments, lang, allow_missing, sources_dir)
    prev = previous_statuses(previous) if previous else {}
    prev_hash = previous_hashes(previous) if previous else {}
    changed_rule = {i["id"] for i in items if i["id"] in prev_hash and prev_hash[i["id"]] != i["criteriaHash"]}
    for it in items:
        it["trend"] = ("changed-rule" if it["id"] in changed_rule else trend(prev.get(it["id"]), it["status"])) \
            if previous else None
    cur = {i["id"]: i["status"] for i in items}
    dims_meta = practices.get("dimensions") or {}
    dim_scores = {d: score([i["status"] for i in items if i["dimension"] == d]) for d in dims_meta}
    dimensions = []
    for d, meta in dims_meta.items():
        ids = [i["id"] for i in items if i["dimension"] == d]
        cov = coverage([cur[i] for i in ids])
        shown = enough(cov, MIN_DIM_COVERAGE) and cov["measured"] >= MIN_DIM_MEASURED
        s = dim_scores[d] if shown else None
        dimensions.append({"id": d, "name": meta.get(lang) or meta.get("en") or d,
                           "hint": (meta.get("hint") or {}).get(lang, ""), "score": s, "grade": grade(s),
                           "measuredScore": dim_scores[d], "coverage": cov, "lowCoverage": not shown,
                           "ids": ids, "delta": like_for_like(cur, prev, ids, changed_rule)[0] if previous and shown else None})
    total = score([i["status"] for i in items])
    cov_total = coverage(list(cur.values()))
    withheld = total is not None and not enough(cov_total, MIN_COVERAGE)
    comparison = compare(cur, prev, changed_rule) if previous else None
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
        "grade": None if withheld else grade(total),
        "gradeWithheld": "low-coverage" if withheld else None,
        "coverage": cov_total,
        "minCoverage": MIN_COVERAGE,
        "minDimCoverage": MIN_DIM_COVERAGE,
        "minDimMeasured": MIN_DIM_MEASURED,
        "neededForGrade": needed_for(cov_total["total"], MIN_COVERAGE),
        "scoreDelta": comparison["delta"] if comparison else None,
        "comparison": comparison,
        "counts": counts,
        "consensusCounts": {"multi": sum(i["verifiedBy"] == "multi" for i in items),
                            "single": sum(i["verifiedBy"] != "multi" for i in items)},
        "dimensions": dimensions,
        "ladder": [] if withheld else ladder(items, {d["id"]: d["score"] for d in dimensions}),
        "items": items,
        "notes": list(judgments.get("notes") or []),
        "dataNotes": data_notes(summary, lang),
        "theme": theme or None,
        "illustration": None,
        "illustrationAlt": config.get("illustrationAlt", ""),
        "brand": {"name": str((config.get("brand") or {}).get("name", ""))[:60], "logo": None, "logoDark": None},
        "previous": previous.get("date") if previous else None,
    }


def load_config(path: str) -> dict:
    """Optional config.json; a broken one is an InputError that says where and how to fix it."""
    if not os.path.isfile(path):
        return {}
    try:
        data = load_json(path)
    except (OSError, UnicodeDecodeError) as e:
        raise InputError(f"cannot read {path}: {e}") from None
    except json.JSONDecodeError as e:
        raise InputError(f"{path} is not valid JSON (line {e.lineno}, column {e.colno}: {e.msg}); "
                         "fix it or move it aside to build with defaults") from None
    if not isinstance(data, dict):
        raise InputError(f"{path} must hold a JSON object with optional theme, brand and illustration keys")
    for key in ("theme", "brand"):
        if key in data and not isinstance(data[key], dict):
            raise InputError(f"{path}: {key} must be an object (see references/audit-files.md)")
    return data


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
    try:
        config = load_config(os.path.join(base, "config.json"))
    except InputError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

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
    for line in summary_lines(data):
        print(line)
    return 0


def summary_lines(data: dict) -> list[str]:
    """Plain-text result for stdout: score with coverage, grade or why it is withheld, trend, ladder."""
    cov = data["coverage"]
    cov_text = f"coverage {cov['measured']}/{cov['total']} measured ({cov['pct']}%)"
    if data["score"] is None:
        lines = [f"score: n/a (nothing scorable)  grade: n/a  {cov_text}"]
    elif data["gradeWithheld"]:
        lines = [f"score: {data['score']}  grade: none, coverage too low  {cov_text}; a grade needs "
                 f">= {data['minCoverage']}% ({data['neededForGrade']} practices measured). The score covers only "
                 "what was measured; judge more practices before quoting a grade."]
    else:
        lines = [f"score: {data['score']}  grade: {data['grade']}  {cov_text}"]
    c = data.get("comparison")
    if c:
        delta = f"{c['delta']:+d}" if c["delta"] is not None else "n/a"
        cov_change = (f"{c['coverageBefore']['pct']}% -> {c['coverageAfter']['pct']}% ({c['coverageDelta']:+d})"
                      if c["coverageDelta"] is not None else "n/a")
        parts = [f"previous {data['previous']}: delta {delta} on {c['compared']} practice(s) measured both times",
                 f"coverage {cov_change}"]
        for key, label in (("added", "added"), ("removed", "removed"), ("newlyMeasured", "newly measured"),
                           ("noLongerMeasured", "no longer measured"), ("changedRule", "rule changed, not in delta")):
            if c[key]:
                parts.append(f"{label}: {', '.join(c[key])}")
        lines.append("; ".join(parts))
    dims = []
    for d in data["dimensions"]:
        dc = d["coverage"]
        dims.append(f"{d['id']} {'—' if d['score'] is None else d['score']} ({dc['measured']}/{dc['total']})")
    if dims:
        lines.append(f"dimensions (score, measured/total; — when under {data['minDimMeasured']} measured or under "
                     f"{data['minDimCoverage']}%): " + ", ".join(dims))
    cc = data["consensusCounts"]
    lines.append(f"practices: {cc['multi']} multi-model verified, {cc['single']} single reviewer awaiting consensus")
    for s in data["ladder"]:
        tags = [f"{f['id']} [{', '.join(x for x in (f.get('fixKind'), 'heuristic' if f.get('heuristic') else None) if x)}]"
                if f.get("fixKind") or f.get("heuristic") else f["id"] for f in s.get("fixes") or []]
        lines.append(f"fix {len(s['add'])} -> {s['score']} {s['grade']}: {', '.join(tags or s['add'])}")
    return lines


if __name__ == "__main__":
    sys.exit(main())
