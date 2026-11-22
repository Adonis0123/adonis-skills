#!/usr/bin/env python3
"""Count comment lines per file with cloc and enforce a baseline that may only shrink.

Subcommands:
  report    totals, per-language counts and the files with the most comments
  snapshot  write the baseline file from the current tree
  check     fail when any file has more counted comment lines than its baseline

Counted = cloc full-line comment lines minus lines carrying an allowed marker
(WHY:, HACK(, ADR-, tool directives, license headers). Trailing comments on a
code line are code to cloc and are not counted.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_BASELINE = ".comment-baseline.json"
COMMENT_LEAD = r"(?://|#|/\*|\*|--|;|<!--)"
DEFAULT_MARKERS = [
    r"WHY:",
    r"HACK\(",
    r"ADR-\d+",
    r"eslint-",
    r"biome-ignore",
    r"prettier-ignore",
    r"@ts-",
    r"noqa",
    r"type:\s*ignore",
    r"pragma: no cover",
    r"SPDX-",
    r"[Cc]opyright",
    r"istanbul ignore",
    r"c8 ignore",
    r"nolint",
    r"#region|#endregion",
]


def fail(msg: str) -> None:
    print(f"comment-ratchet: {msg}", file=sys.stderr)
    sys.exit(2)


def tracked_files(root: Path, paths: list[str]) -> list[str]:
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z", "--", *(paths or ["."])],
            cwd=root,
            check=True,
            capture_output=True,
        ).stdout
        return [p for p in out.decode().split("\0") if p]
    except (subprocess.CalledProcessError, FileNotFoundError):
        fail(f"{root} is not a git repository; run inside a git checkout")
    return []


def cloc_comments(root: Path, files: list[str], excludes: list[str]) -> dict[str, dict]:
    if shutil.which("cloc") is None:
        fail("cloc not found; install it (brew install cloc / apt install cloc) and rerun")
    pattern = re.compile("|".join(excludes)) if excludes else None
    files = [f for f in files if not (pattern and pattern.search(f))]
    if not files:
        return {}
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
        fh.write("\n".join(files))
        list_file = fh.name
    try:
        out = subprocess.run(
            ["cloc", "--by-file", "--json", "--quiet", f"--list-file={list_file}"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    finally:
        Path(list_file).unlink(missing_ok=True)
    data = json.loads(out) if out.strip() else {}
    return {
        k.removeprefix("./"): v
        for k, v in data.items()
        if k not in ("header", "SUM") and isinstance(v, dict)
    }


def comment_blocks(text: str) -> list[list[str]]:
    """Group contiguous full-line comment lines, including /* ... */ continuation lines."""
    lead = re.compile(rf"^\s*{COMMENT_LEAD}")
    blocks: list[list[str]] = []
    current: list[str] = []
    in_block = False
    for line in text.splitlines():
        if in_block or lead.match(line):
            opens = not in_block and line.lstrip().startswith("/*")
            if opens and current:
                blocks.append(current)
                current = []
            current.append(line)
            if opens and "*/" not in line.split("/*", 1)[1]:
                in_block = True
            elif (in_block and "*/" in line) or (opens and "*/" in line):
                in_block = False
                blocks.append(current)
                current = []
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    return blocks


def marker_lines(path: Path, marker_re: re.Pattern[str]) -> int:
    """Lines in comment blocks where any line carries an allowed marker."""
    try:
        text = path.read_text(errors="ignore")
    except OSError:
        return 0
    return sum(len(b) for b in comment_blocks(text) if any(marker_re.search(line) for line in b))


def measure(root: Path, paths: list[str], excludes: list[str], markers: list[str]) -> dict[str, dict]:
    marker_re = re.compile("|".join(markers))
    result: dict[str, dict] = {}
    for file, stats in cloc_comments(root, tracked_files(root, paths), excludes).items():
        raw = int(stats.get("comment", 0))
        if raw == 0:
            continue
        allowed = min(raw, marker_lines(root / file, marker_re))
        result[file] = {
            "language": stats.get("language", "?"),
            "comment": raw,
            "allowed": allowed,
            "counted": raw - allowed,
            "code": int(stats.get("code", 0)),
        }
    return result


def load_config(root: Path, args: argparse.Namespace) -> tuple[list[str], list[str], list[str]]:
    baseline_path = root / args.baseline
    cfg: dict = {}
    if baseline_path.exists():
        cfg = json.loads(baseline_path.read_text()).get("config", {})
    paths = args.paths or cfg.get("paths", [])
    excludes = (args.exclude or []) + cfg.get("exclude", [])
    markers = DEFAULT_MARKERS + cfg.get("extraMarkers", [])
    return paths, excludes, markers


def cmd_report(root: Path, args: argparse.Namespace) -> int:
    paths, excludes, markers = load_config(root, args)
    data = measure(root, paths, excludes, markers)
    total = sum(v["comment"] for v in data.values())
    counted = sum(v["counted"] for v in data.values())
    by_lang: dict[str, int] = {}
    for v in data.values():
        by_lang[v["language"]] = by_lang.get(v["language"], 0) + v["counted"]
    top = sorted(data.items(), key=lambda kv: kv[1]["counted"], reverse=True)[: args.top]
    report = {
        "filesWithComments": len(data),
        "commentLines": total,
        "allowedLines": total - counted,
        "countedLines": counted,
        "byLanguage": dict(sorted(by_lang.items(), key=lambda kv: -kv[1])),
        "topFiles": [{"file": f, **v} for f, v in top],
    }
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0
    print(f"files with comments: {report['filesWithComments']}")
    print(f"comment lines: {total} (allowed markers: {total - counted}, counted: {counted})")
    print("counted by language:")
    for lang, n in report["byLanguage"].items():
        print(f"  {lang}: {n}")
    print(f"top {len(top)} files by counted comment lines:")
    for f, v in top:
        print(f"  {v['counted']:5d}  {f}")
    return 0


def cmd_snapshot(root: Path, args: argparse.Namespace) -> int:
    paths, excludes, markers = load_config(root, args)
    data = measure(root, paths, excludes, markers)
    baseline_path = root / args.baseline
    old_cfg = {}
    if baseline_path.exists():
        old_cfg = json.loads(baseline_path.read_text()).get("config", {})
    config = {
        "paths": paths,
        "exclude": sorted(set(excludes)),
        "extraMarkers": old_cfg.get("extraMarkers", []),
    }
    files = {f: v["counted"] for f, v in sorted(data.items()) if v["counted"] > 0}
    baseline_path.write_text(
        json.dumps({"config": config, "files": files}, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"wrote {args.baseline}: {len(files)} files, {sum(files.values())} counted comment lines")
    return 0


def cmd_check(root: Path, args: argparse.Namespace) -> int:
    baseline_path = root / args.baseline
    if not baseline_path.exists():
        fail(f"{args.baseline} missing; create it with: comment_ratchet.py snapshot")
    baseline = json.loads(baseline_path.read_text()).get("files", {})
    paths, excludes, markers = load_config(root, args)
    data = measure(root, paths, excludes, markers)
    before = sum(int(n) for n in baseline.values())
    now = sum(v["counted"] for v in data.values())
    if now > before:
        grew = [
            (f, int(baseline.get(f, 0)), v["counted"])
            for f, v in sorted(data.items())
            if v["counted"] > int(baseline.get(f, 0))
        ]
        print(f"comment-ratchet: counted comment lines grew from {before} to {now}. Files above their baseline:")
        for f, allowed, n in grew:
            print(f"  {f}: {allowed} -> {n}")
        print(
            "Fix: delete comments that restate the code or describe history; keep a needed one by "
            "adding WHY:, HACK(<issue>) or ADR-<n> to its comment block. Do not raise the baseline by hand."
        )
        return 1
    shrunk = before - now
    if shrunk and args.tighten:
        cmd_snapshot(root, args)
        print(f"baseline tightened by {shrunk} lines")
    elif shrunk:
        print(f"ok; {shrunk} lines below baseline, run 'snapshot' or 'check --tighten' to lock it in")
    else:
        print("ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=".", help="repository root (default: cwd)")
    parser.add_argument("--baseline", default=DEFAULT_BASELINE, help="baseline path relative to root")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("report", "snapshot", "check"):
        p = sub.add_parser(name)
        if name == "check":
            p.set_defaults(paths=[], exclude=[])
        else:
            p.add_argument("paths", nargs="*", help="limit to these paths (stored in the baseline on snapshot)")
            p.add_argument("--exclude", action="append", help="regex of paths to skip; repeatable")
        if name == "report":
            p.add_argument("--top", type=int, default=20)
            p.add_argument("--json", action="store_true")
        if name == "check":
            p.add_argument("--tighten", action="store_true", help="rewrite the baseline when counts dropped")
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    return {"report": cmd_report, "snapshot": cmd_snapshot, "check": cmd_check}[args.cmd](root, args)


if __name__ == "__main__":
    sys.exit(main())
