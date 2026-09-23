#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


HELPERS = ("init_audit.py", "probe_jsonl_schema.py", "finalize_audit.py")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--window-days", type=int, default=90)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    if args.window_days <= 0:
        parser.error("--window-days must be positive")

    out_dir = args.out_dir.expanduser().resolve()
    forbidden = {Path("/").resolve(), Path.home().resolve()}
    if out_dir in forbidden:
        parser.error("OUT_DIR must not be / or the home directory")

    if out_dir.exists() and any(out_dir.iterdir()) and not args.resume:
        parser.error("OUT_DIR is non-empty; use --resume only for the same audit")

    for name in ("raw", "scripts", "runtime", "proposed", "recovery"):
        (out_dir / name).mkdir(parents=True, exist_ok=True)

    source_dir = Path(__file__).resolve().parent
    for helper in HELPERS:
        shutil.copy2(source_dir / helper, out_dir / "scripts" / helper)

    config_path = out_dir / "audit-config.json"
    if not config_path.exists():
        config = {
            "out_dir": str(out_dir),
            "window_days": args.window_days,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        config_path.write_text(
            json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    print(
        json.dumps(
            {
                "out_dir": str(out_dir),
                "window_days": args.window_days,
                "helper_count": len(HELPERS),
                "resume": args.resume,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
