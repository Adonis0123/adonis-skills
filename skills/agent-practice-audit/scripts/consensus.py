#!/usr/bin/env python3
"""Multi-model consensus for candidate practices (refresh mode, stage b).

Usage:
  consensus.py detect [--exclude claude]            # verifier CLIs on PATH
  consensus.py prompt --candidate C.json --page PAGE.txt [--basis live|digest]
  consensus.py decide VERDICT.txt [VERDICT.txt ...] [--names claude,codex,...]

Rule: accept iff agree >= 2 AND agree > total / 2 AND no veto, where total is
every verifier that ran (invalid or unparseable output counts and never agrees)
and agree counts valid "accept" verdicts. A verdict must use real JSON booleans
for quote_found, faithful and checkable; accept requires all three true. Any
parsed result with quote_found strictly false vetoes, even if the rest of it is
invalid. Fewer than 2 verifiers ran -> pending-consensus (not merged).
Verifier names must be unique and match the verdict files 1:1.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROMPT = os.path.join(os.path.dirname(HERE), "references", "verify-prompt.md")
MIN_VERIFIERS = 2
# name -> how to send a prompt headlessly (prompt on stdin). Check `<cli> --help` for the installed version.
VERIFIER_CLIS = {
    "claude": "claude -p",
    "codex": "codex exec -",
    "grok": "grok -p",
    "gemini": "gemini -p",
}


def detect(exclude: tuple[str, ...] = ()) -> list[str]:
    return [n for n in VERIFIER_CLIS if n not in exclude and shutil.which(n)]


BOOL_FIELDS = ("quote_found", "faithful", "checkable")


def first_verdict_object(text: str) -> dict | None:
    """First JSON object in the text that has a `verdict` or any BOOL_FIELDS key (prose and code fences
    around it are ignored). An object without `verdict` still counts, so its quote_found=false can veto."""
    dec = json.JSONDecoder()
    i = text.find("{")
    while i != -1:
        try:
            obj, _ = dec.raw_decode(text, i)
        except ValueError:
            obj = None
        if isinstance(obj, dict) and ("verdict" in obj or any(k in obj for k in BOOL_FIELDS)):
            return obj
        i = text.find("{", i + 1)
    return None


def parse_verdict(text: str) -> dict | None:
    """Strictly validated verdict; None when no verdict object exists.

    A verdict object that breaks the schema comes back with `invalid: True` and never counts
    as agreement: every field in BOOL_FIELDS must be a real JSON boolean, verdict must be
    accept or reject, and accept requires all three checks to be true.
    """
    d = first_verdict_object(text)
    if d is None:
        return None
    reason = str(d.get("reason", ""))[:500]
    problems = []
    if d.get("verdict") not in ("accept", "reject"):
        problems.append("verdict must be accept or reject")
    for k in BOOL_FIELDS:
        if not isinstance(d.get(k), bool):
            problems.append(f"{k} must be true or false")
    if not problems and d["verdict"] == "accept" and not all(d[k] for k in BOOL_FIELDS):
        problems.append("accept requires quote_found, faithful and checkable to be true")
    v = {"verdict": d.get("verdict"), "reason": reason, "invalid": bool(problems), "problems": problems}
    for k in BOOL_FIELDS:
        v[k] = d.get(k) if isinstance(d.get(k), bool) else None
    return v


def decide(verdicts: list[dict | None], names: list[str] | None = None) -> dict:
    """Apply the consensus rule. Raises ValueError when names do not match verdicts one to one."""
    if names is None:
        names = [f"verifier{i + 1}" for i in range(len(verdicts))]
    if len(names) != len(verdicts):
        raise ValueError(f"got {len(names)} verifier names for {len(verdicts)} verdicts; give exactly one name per verdict")
    if len(set(names)) != len(names):
        raise ValueError("verifier names must be unique; one verifier cannot vote twice")
    valid = [(n, v) for n, v in zip(names, verdicts) if v is not None and not v.get("invalid")]
    invalid = [n for n, v in zip(names, verdicts) if v is not None and v.get("invalid")]
    missing = [n for n, v in zip(names, verdicts) if v is None]
    agree = sum(1 for _, v in valid if v["verdict"] == "accept")
    # The veto reads every parsed result, valid or not, whenever quote_found is strictly false.
    vetoed = [n for n, v in zip(names, verdicts) if v is not None and v.get("quote_found") is False]
    total = len(verdicts)  # every verifier that ran counts; invalid or unparseable output never agrees
    if total < MIN_VERIFIERS:
        decision = "pending-consensus"
    elif vetoed:
        decision = "reject"
    elif agree >= MIN_VERIFIERS and agree > total / 2:
        decision = "accept"
    else:
        decision = "reject"
    return {
        "decision": decision,
        "consensus": {"verifiers": list(names), "agree": agree, "total": total,
                      "checkedAt": dt.date.today().isoformat()},
        "vetoed_by": vetoed,
        "invalid": invalid,
        "unusable": missing,
        "reasons": {n: v["reason"] for n, v in zip(names, verdicts) if v is not None},
    }


def render_prompt(candidate: dict, page_text: str, basis: str = "live", template_path: str = PROMPT) -> str:
    with open(template_path, encoding="utf-8") as f:
        tpl = f.read()
    tpl = tpl.split("<!-- template -->", 1)[-1]
    return (tpl.replace("{{BASIS}}", basis)
               .replace("{{CANDIDATE_JSON}}", json.dumps(candidate, ensure_ascii=False, indent=2))
               .replace("{{PAGE_TEXT}}", page_text))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("detect")
    d.add_argument("--exclude", default="", help="comma-separated CLIs to skip, e.g. the proposer's own model")
    p = sub.add_parser("prompt")
    p.add_argument("--candidate", required=True)
    p.add_argument("--page", required=True, help="page text (or the digest file when the page is unreachable)")
    p.add_argument("--basis", choices=("live", "digest"), default="live")
    c = sub.add_parser("decide")
    c.add_argument("verdicts", nargs="+", help="raw verifier outputs, one file each")
    c.add_argument("--names", help="comma-separated verifier names in the same order")
    a = ap.parse_args(argv)
    if a.cmd == "detect":
        found = detect(tuple(x for x in a.exclude.split(",") if x))
        for n in found:
            print(f"{n}\t{VERIFIER_CLIS[n]}")
        if len(found) < MIN_VERIFIERS:
            print(f"only {len(found)} verifier(s) available; new candidates stay pending-consensus", file=sys.stderr)
        return 0
    if a.cmd == "prompt":
        with open(a.candidate, encoding="utf-8") as f:
            cand = json.load(f)
        with open(a.page, encoding="utf-8") as f:
            print(render_prompt(cand, f.read(), a.basis))
        return 0
    texts = []
    for path in a.verdicts:
        with open(path, encoding="utf-8") as f:
            texts.append(f.read())
    names = a.names.split(",") if a.names else [os.path.splitext(os.path.basename(p))[0] for p in a.verdicts]
    try:
        result = decide([parse_verdict(t) for t in texts], names)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
