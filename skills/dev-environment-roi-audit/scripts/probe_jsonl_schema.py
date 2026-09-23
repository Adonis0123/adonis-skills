#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def discover(inputs: list[Path]) -> list[Path]:
    found: set[Path] = set()
    for candidate in inputs:
        resolved = candidate.expanduser().resolve()
        if resolved.is_file() and resolved.suffix == ".jsonl":
            found.add(resolved)
        elif resolved.is_dir():
            found.update(path.resolve() for path in resolved.rglob("*.jsonl"))
    return sorted(found, key=lambda path: path.stat().st_mtime, reverse=True)


def probe(path: Path) -> dict[str, object]:
    stat = path.stat()
    try:
        with path.open("r", encoding="utf-8") as handle:
            first_line = handle.readline()
        value = json.loads(first_line)
        schema = sorted(value.keys()) if isinstance(value, dict) else [f"<{type(value).__name__}>"]
        error = None
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        schema = []
        error = f"{type(exc).__name__}: first line is not parseable JSON"
    return {
        "path": str(path),
        "size_bytes": stat.st_size,
        "mtime": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "first_line_keys": schema,
        "error": error,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--since-days", type=int)
    args = parser.parse_args()

    files = discover(args.paths)
    if args.since_days is not None:
        if args.since_days <= 0:
            parser.error("--since-days must be positive")
        cutoff = datetime.now(timezone.utc).timestamp() - args.since_days * 86400
        files = [path for path in files if path.stat().st_mtime >= cutoff]

    results = [probe(path) for path in files]
    patterns = Counter(json.dumps(item["first_line_keys"]) for item in results)
    payload = {
        "method": "first physical line of every JSONL file",
        "file_count": len(results),
        "parse_error_count": sum(item["error"] is not None for item in results),
        "schema_patterns": [
            {"keys": json.loads(keys), "file_count": count}
            for keys, count in sorted(patterns.items(), key=lambda item: (-item[1], item[0]))
        ],
        "files": results,
    }
    json.dump(payload, os.sys.stdout, ensure_ascii=False, indent=2)
    os.sys.stdout.write("\n")
    return 0 if payload["parse_error_count"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
