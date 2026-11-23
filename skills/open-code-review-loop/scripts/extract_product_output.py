#!/usr/bin/env python3
"""Extract one reviewer/fixer JSON object from a supported CLI envelope."""

from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys
from typing import Any


PRODUCTS = ("codex", "claude-code", "grok-build", "cursor-cli")


def load_object(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain one JSON object")
    return value


def require_object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must contain one JSON object")
    return value


def extract(product: str, envelope: dict[str, Any]) -> dict[str, Any]:
    if product == "codex":
        return envelope
    if product == "claude-code":
        return require_object(envelope.get("structured_output"), "structured_output")
    if product == "grok-build":
        return require_object(envelope.get("structuredOutput"), "structuredOutput")
    if product == "cursor-cli":
        raw = envelope.get("result")
        if not isinstance(raw, str):
            raise ValueError("result must be a JSON string containing exactly one JSON object")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ValueError(
                "result must be a JSON string containing exactly one JSON object"
            ) from error
        return require_object(parsed, "result")
    raise ValueError(f"unsupported product: {product}")


def normalize_reviewer_identity(
    product: str,
    envelope: dict[str, Any],
    result: dict[str, Any],
    explicit_session_id: str | None,
) -> dict[str, Any]:
    if "reviewer" not in result:
        return result
    reviewer = result.get("reviewer")
    if not isinstance(reviewer, dict):
        raise ValueError("reviewer must contain one JSON object")

    envelope_field = {
        "claude-code": "session_id",
        "grok-build": "sessionId",
        "cursor-cli": "session_id",
    }.get(product)
    envelope_session_id = envelope.get(envelope_field) if envelope_field else None
    trusted_session_id = explicit_session_id or (
        envelope_session_id
        if isinstance(envelope_session_id, str) and envelope_session_id.strip()
        else None
    )

    normalized = deepcopy(result)
    normalized["reviewer"]["product"] = product
    normalized["reviewer"]["session_id"] = trusted_session_id
    return normalized


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product", required=True, choices=PRODUCTS)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--session-id")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        envelope = load_object(args.input)
        result = normalize_reviewer_identity(
            args.product,
            envelope,
            extract(args.product, envelope),
            args.session_id,
        )
        rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 2
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
