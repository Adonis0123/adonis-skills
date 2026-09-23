#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path


SECRET_PATTERNS = {
    "authorization_value": re.compile(rb'"Authorization"\s*:\s*"[^"\r\n]+"'),
    "bearer_value": re.compile(rb"Bearer\s+[A-Za-z0-9._~-]{12,}"),
}


def included_files(out_dir: Path) -> list[Path]:
    files = []
    for path in out_dir.rglob("*"):
        if not path.is_file() or path.name == "MANIFEST.sha256":
            continue
        if path.is_relative_to(out_dir / "runtime"):
            continue
        files.append(path)
    return sorted(files)


def secret_hits(files: list[Path]) -> list[dict[str, str]]:
    hits = []
    for path in files:
        try:
            content = path.read_bytes()
        except OSError:
            continue
        for name, pattern in SECRET_PATTERNS.items():
            if pattern.search(content):
                hits.append({"path": str(path), "pattern": name})
    return hits


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()

    out_dir = args.out_dir.expanduser().resolve()
    if not out_dir.is_dir():
        parser.error("OUT_DIR does not exist")

    files = included_files(out_dir)
    hits = secret_hits(files)
    if hits:
        print(json.dumps({"ok": False, "secret_hit_count": len(hits), "hits": hits}, indent=2))
        return 2

    runtime = out_dir / "runtime"
    runtime.mkdir(exist_ok=True)
    temporary = runtime / "MANIFEST.sha256.new"
    with temporary.open("w", encoding="utf-8") as handle:
        for path in files:
            handle.write(f"{digest(path)}  {path}\n")
    os.replace(temporary, out_dir / "MANIFEST.sha256")

    print(
        json.dumps(
            {
                "ok": True,
                "artifact_count": len(files),
                "secret_hit_count": 0,
                "artifact_bytes": sum(path.stat().st_size for path in files),
                "manifest": str(out_dir / "MANIFEST.sha256"),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
