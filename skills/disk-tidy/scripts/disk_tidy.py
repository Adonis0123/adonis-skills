#!/usr/bin/env python3
"""disk_tidy.py: measure where disk space went and remove rebuildable build output safely.

  free       free/used space of the data volume; each call is appended to a history file
             (~/.local/state/disk-tidy/free.jsonl) and compared with the previous one
  known      sizes of well-known cache and leftover locations listed in assets/locations.json
  artifacts  find build output (.next, .turbo, node_modules/.cache, Cargo target, ...) under code
             folders and say, per folder, whether git ignores it and whether a running process
             works in the package that owns it
  clean      delete the cleanable folders of an artifacts report (dry run unless --yes),
             checking each one again right before deletion

Sizes come from `du`, which counts APFS clones and hard links once per path, so a sum can be
larger than the space a deletion frees. Only `free` before and after tells the real gain.

Python 3.9+, standard library only. Exit code 0 on success, 1 when any requested deletion failed.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional

# Folder names that hold only generated build output. `target` counts only next to Cargo.toml,
# because plenty of projects keep real files in a folder called target.
ARTIFACT_NAMES = {".next", ".turbo", ".nuxt", ".svelte-kit", ".parcel-cache", ".vite", ".angular", ".expo"}
CARGO_TARGET = "target"
# Bundler caches (webpack, babel-loader, Remotion) live inside node_modules; only this one
# subfolder of the dependencies is build output.
MODULES_CACHE = os.path.join("node_modules", ".cache")
# Folders never walked: dependencies and git internals hold no build output of the project itself.
SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "Pods", ".gradle", "DerivedData"}
ASSETS = Path(__file__).resolve().parent.parent / "assets"


def history_file() -> Path:
    # Earlier snapshots answer "what grew since the last cleanup"; keep them outside the skill.
    base = os.environ.get("DISK_TIDY_STATE") or os.path.join(
        os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "disk-tidy")
    return Path(base) / "free.jsonl"


def data_volume() -> str:
    # On macOS user data lives on the Data volume; `/` is the sealed system snapshot.
    return "/System/Volumes/Data" if os.path.isdir("/System/Volumes/Data") else "/"


def free_space(path: Optional[str] = None) -> Dict[str, object]:
    path = path or data_volume()
    usage = shutil.disk_usage(path)
    gib = 1024 ** 3
    return {"path": path, "total_gib": round(usage.total / gib, 1), "used_gib": round(usage.used / gib, 1),
            "free_gib": round(usage.free / gib, 1), "used_pct": round(100 * usage.used / usage.total, 1)}


def du_kib(path: str) -> int:
    out = subprocess.run(["du", "-sk", path], capture_output=True, text=True).stdout.split()
    return int(out[0]) if out else 0


def expand(path: str) -> str:
    return os.path.abspath(os.path.expanduser(path))


def process_cwds() -> Dict[str, List[str]]:
    """Map each process working directory to the commands running there (pid: command)."""
    cwds: Dict[str, List[str]] = {}
    if os.path.isdir("/proc/self"):
        for pid in filter(str.isdigit, os.listdir("/proc")):
            try:
                cwd = os.readlink(f"/proc/{pid}/cwd")
                cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
            except OSError:
                continue
            cwds.setdefault(cwd, []).append(f"{pid}: {cmd.strip()[:120]}")
        return cwds
    if not shutil.which("lsof"):
        return cwds
    out = subprocess.run(["lsof", "-d", "cwd", "-Fpcn"], capture_output=True, text=True).stdout
    pid = cmd = ""
    for line in out.splitlines():
        tag, value = line[:1], line[1:]
        if tag == "p":
            pid = value
        elif tag == "c":
            cmd = value
        elif tag == "n":
            cwds.setdefault(value, []).append(f"{pid}: {cmd}")
    return cwds


def inside(path: str, folder: str) -> bool:
    return path == folder or path.startswith(folder.rstrip("/") + "/")


def busy_in(folder: str, cwds: Dict[str, List[str]]) -> List[str]:
    return [cmd for cwd, cmds in cwds.items() if inside(cwd, folder) for cmd in cmds]


def git_ignored(path: str) -> Optional[bool]:
    """True/False when `path` sits in a git work tree, None when it does not."""
    parent = os.path.dirname(path)
    inside_tree = subprocess.run(["git", "-C", parent, "rev-parse", "--is-inside-work-tree"],
                                 capture_output=True, text=True).returncode == 0
    if not inside_tree:
        return None
    return subprocess.run(["git", "-C", parent, "check-ignore", "-q", path]).returncode == 0


def find_artifacts(roots: Iterable[str]) -> List[str]:
    found: List[str] = []
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(expand(root)):
            keep = []
            for name in dirnames:
                full = os.path.join(dirpath, name)
                # A linked folder (worktrees often link node_modules to the main checkout) belongs
                # to wherever it points; it is found there, not through the link.
                if os.path.islink(full):
                    continue
                if name == "node_modules" and os.path.isdir(os.path.join(full, ".cache")):
                    found.append(os.path.join(full, ".cache"))
                if name in SKIP_DIRS:
                    continue
                if name in ARTIFACT_NAMES or (name == CARGO_TARGET and "Cargo.toml" in filenames):
                    found.append(full)
                    continue
                keep.append(name)
            dirnames[:] = keep
    return sorted(found)


def package_of(path: str) -> str:
    """The package folder that owns build output: web/ for web/.next and web/node_modules/.cache."""
    if path.endswith(os.sep + MODULES_CACHE):
        return os.path.dirname(os.path.dirname(path))
    return os.path.dirname(path)


def assess(path: str, cwds: Dict[str, List[str]]) -> Dict[str, object]:
    """Facts about one artifact folder; cleanable when git ignores it and nothing runs in its package."""
    ignored = git_ignored(path)
    # Dev servers run in the package folder that owns the build output.
    busy = busy_in(package_of(path), cwds)
    blockers = []
    if ignored is None:
        blockers.append("not-in-git")
    elif not ignored:
        blockers.append("not-ignored")
    if busy:
        blockers.append("busy")
    return {"path": path, "kib": du_kib(path), "ignored": ignored, "busy": busy[:5],
            "blockers": blockers, "cleanable": not blockers}


def allowed_name(path: str) -> bool:
    name = os.path.basename(path)
    if name in ARTIFACT_NAMES or path.endswith(os.sep + MODULES_CACHE):
        return True
    return name == CARGO_TARGET and os.path.isfile(os.path.join(os.path.dirname(path), "Cargo.toml"))


def cmd_free(args: argparse.Namespace) -> int:
    now = {**free_space(args.path), "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "note": args.note or ""}
    history = history_file()
    previous = None
    if history.exists():
        lines = [line for line in history.read_text().splitlines() if line.strip()]
        same = [json.loads(line) for line in lines if json.loads(line).get("path") == now["path"]]
        previous = same[-1] if same else None
    if not args.no_record:
        history.parent.mkdir(parents=True, exist_ok=True)
        with history.open("a") as handle:
            handle.write(json.dumps(now, ensure_ascii=False) + "\n")
    out = {**now, "previous": previous}
    if previous:
        out["free_change_gib"] = round(float(now["free_gib"]) - float(previous["free_gib"]), 1)
    print(json.dumps(out, ensure_ascii=False))
    return 0


def cmd_known(args: argparse.Namespace) -> int:
    entries = json.loads((ASSETS / "locations.json").read_text())
    rows = []
    for entry in entries:
        for path in sorted({p for pattern in entry["paths"] for p in glob_home(pattern)}):
            kib = du_kib(path)
            if kib >= args.min_mib * 1024:
                rows.append({**{k: v for k, v in entry.items() if k != "paths"}, "path": path, "kib": kib})
    rows.sort(key=lambda r: -r["kib"])
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    else:
        for r in rows:
            print(f'{r["kib"] / 1048576:6.1f}G  {r["tier"]}  {r["path"]}  ({r["what"]})')
    return 0


def glob_home(pattern: str) -> List[str]:
    return [p for p in glob.glob(expand(pattern)) if os.path.exists(p) and not os.path.islink(p)]


def cmd_artifacts(args: argparse.Namespace) -> int:
    cwds = process_cwds()
    report = [assess(p, cwds) for p in find_artifacts(args.roots)]
    report = [r for r in report if r["kib"] >= args.min_mib * 1024]
    report.sort(key=lambda r: -int(r["kib"]))
    total = sum(int(r["kib"]) for r in report if r["cleanable"]) / 1048576
    if args.out:
        Path(args.out).write_text(json.dumps({"roots": [expand(r) for r in args.roots], "items": report},
                                             indent=2, ensure_ascii=False))
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        for r in report:
            mark = "clean" if r["cleanable"] else ",".join(r["blockers"])
            print(f'{int(r["kib"]) / 1048576:6.1f}G  {mark:<12} {r["path"]}')
        print(f"cleanable total ~{total:.1f}G by du (APFS clones can make the real gain smaller)")
    return 0


def cmd_clean(args: argparse.Namespace) -> int:
    report = json.loads(Path(args.report).read_text())
    cwds = process_cwds()
    failed = 0
    before = free_space()
    for item in report["items"]:
        path = item["path"]
        if not item.get("cleanable"):
            continue
        # Facts may have changed since the report: check again right before deleting.
        if not os.path.isdir(path) or os.path.islink(path):
            print(f"gone     {path}")
            continue
        if not allowed_name(path):
            print(f"refused  {path}: not a known build-output folder")
            failed += 1
            continue
        fresh = assess(path, cwds) if args.yes else {"blockers": item["blockers"]}
        if fresh["blockers"]:
            print(f'skipped  {path}: {",".join(fresh["blockers"])}')
            continue
        if not args.yes:
            print(f"would delete  {path}")
            continue
        try:
            shutil.rmtree(path)
            print(f"deleted  {path}")
        except OSError as error:
            print(f"failed   {path}: {error}")
            failed += 1
    if args.yes:
        after = free_space()
        print(json.dumps({"free_before_gib": before["free_gib"], "free_after_gib": after["free_gib"],
                          "gained_gib": round(float(after["free_gib"]) - float(before["free_gib"]), 1)}))
    else:
        print("dry run: add --yes to delete")
    return 1 if failed else 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("free", help="free and used space of the data volume")
    p.add_argument("--path")
    p.add_argument("--note", help="label stored with the snapshot, e.g. before-cleanup")
    p.add_argument("--no-record", action="store_true", help="do not append to the snapshot history")
    p.set_defaults(func=cmd_free)
    p = sub.add_parser("known", help="sizes of well-known cache and leftover locations")
    p.add_argument("--min-mib", type=int, default=500)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_known)
    p = sub.add_parser("artifacts", help="find build output under code folders")
    p.add_argument("roots", nargs="+")
    p.add_argument("--min-mib", type=int, default=0)
    p.add_argument("--out", help="write the report here for `clean`")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_artifacts)
    p = sub.add_parser("clean", help="delete cleanable folders of an artifacts report")
    p.add_argument("report")
    p.add_argument("--yes", action="store_true", help="really delete (default is a dry run)")
    p.set_defaults(func=cmd_clean)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
