#!/usr/bin/env python3
"""Report which coding-agent CLIs this machine can dispatch to.

Prefers `sideby list --json` (multi-account inventory); falls back to PATH
lookup. Prints JSON only: products, usable accounts, distinct quota pools,
and the fallback the coordinator should apply. Never prints emails or keys.
"""

from __future__ import annotations

import json
import shutil
import subprocess

# product id -> CLI binaries that provide it
PRODUCTS = {
    "claude": ["claude"],
    "codex": ["codex"],
    "grok": ["grok"],
    "cursor": ["cursor-agent"],
    "antigravity": ["agy"],
    "gemini": ["gemini"],
    "opencode": ["opencode"],
}
CODE_PRODUCTS = ("claude", "codex", "grok", "cursor", "opencode", "gemini")
# preferred for long-form drafting; any code product can draft as a fallback
DRAFTING_PRODUCTS = ("antigravity",)


def from_sideby() -> dict[str, dict] | None:
    if not shutil.which("sideby"):
        return None
    try:
        out = subprocess.run(
            ["sideby", "list", "--json"], capture_output=True, text=True, timeout=20
        )
        data = json.loads(out.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    found: dict[str, dict] = {}
    for acc in data.get("accounts", []):
        # subscription logins only: API-key accounts bill per call, so the
        # coordinator should not fan out to them without the user asking
        if not acc.get("hostInstalled") or acc.get("login") != "logged-in":
            continue
        entry = found.setdefault(acc["family"], {"accounts": [], "pools": set()})
        entry["accounts"].append(acc["ref"])
        # accounts sharing one login share one quota pool
        entry["pools"].add(min([acc["ref"], *acc.get("sameLogin", [])]))
    return found


def main() -> None:
    found = from_sideby() or {}
    source = "sideby" if found else "path"
    for product, bins in PRODUCTS.items():
        if product in found:
            continue
        binary = next((b for b in bins if shutil.which(b)), None)
        if binary:
            found[product] = {"accounts": [binary], "pools": {binary}}

    products = {
        p: {"accounts": v["accounts"], "quota_pools": len(v["pools"])}
        for p, v in sorted(found.items())
    }
    code = [p for p in CODE_PRODUCTS if p in products]
    pools = sum(products[p]["quota_pools"] for p in code)

    fallback = []
    if len(code) < 2:
        fallback.append(
            "single-product: reviewer is a fresh session of the same product "
            "that sees only the diff and spec, never the writer's conversation"
        )
    if pools < 2:
        fallback.append("one quota pool: L2 runs workers one after another, not in parallel")
    if "antigravity" not in products:
        fallback.append("no drafting agent: coordinator writes articles itself with the writing skills")

    print(
        json.dumps(
            {
                "source": source,
                "products": products,
                "code_products": code,
                "drafting_agents": [p for p in DRAFTING_PRODUCTS if p in products],
                # one pool stays with the coordinator; 0 means it writes alone
                "max_parallel_workers": max(0, min(3, pools - 1)),
                "fallback": fallback,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
