#!/usr/bin/env python3
"""Report which coding-agent CLIs this machine can dispatch to.

Discovers accounts from an accounts file, an optional multi-account manager,
or PATH lookup. Prints JSON only: products, usable accounts, distinct quota
pools, per-account launch commands, and the fallback the coordinator should
apply. Never prints emails, tokens, or credentials.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Callable

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

ADAPTERS: list[Callable[[], tuple[list[dict], str] | None]] = []


def register_adapter(fn: Callable[[], tuple[list[dict], str] | None]) -> Callable[[], tuple[list[dict], str] | None]:
    ADAPTERS.append(fn)
    return fn


def get_accounts_file_path() -> str:
    env_path = os.environ.get("AGENT_DISPATCH_ACCOUNTS")
    if env_path:
        return os.path.expanduser(env_path)
    xdg_config = os.environ.get("XDG_CONFIG_HOME")
    if xdg_config:
        return os.path.join(os.path.expanduser(xdg_config), "agent-dispatch", "accounts.json")
    return os.path.expanduser("~/.config/agent-dispatch/accounts.json")


def from_accounts_file(path: str | None = None) -> list[dict] | None:
    if path is None:
        path = get_accounts_file_path()
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None

    if not isinstance(data, dict):
        return None

    raw_accounts = data.get("accounts")
    if not isinstance(raw_accounts, list):
        return None

    accounts = []
    for idx, item in enumerate(raw_accounts):
        if not isinstance(item, dict):
            continue
        product = item.get("product")
        command = item.get("command")
        if not product or not command or not isinstance(product, str) or not isinstance(command, str):
            continue
        product = product.strip().lower()
        command = command.strip()
        pool = item.get("pool")
        if pool is not None and isinstance(pool, str) and pool.strip():
            pool_val = pool.strip()
        else:
            # missing pool means its own pool
            pool_val = f"{product}:own:{idx}"
        accounts.append(
            {
                "product": product,
                "command": command,
                "pool": pool_val,
            }
        )
    return accounts


@register_adapter
def from_sideby() -> tuple[list[dict], str] | None:
    """Read accounts from sideby multi-account manager if available."""
    if not shutil.which("sideby"):
        return None
    try:
        out = subprocess.run(
            ["sideby", "list", "--json"], capture_output=True, text=True, timeout=20
        )
        data = json.loads(out.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    accounts = []
    for acc in data.get("accounts", []):
        if not isinstance(acc, dict):
            continue
        # subscription logins only: API-key accounts bill per call, so the
        # coordinator should not fan out to them without the user asking
        if not acc.get("hostInstalled") or acc.get("login") != "logged-in" or acc.get("kind") == "api":
            continue
        family = acc.get("family")
        ref = acc.get("ref")
        if not family or not ref:
            continue
        # accounts sharing one login share one quota pool
        pool = min([ref, *acc.get("sameLogin", [])])
        accounts.append(
            {
                "product": family,
                "command": f"sideby run {ref}",
                "pool": pool,
            }
        )
    if not accounts:
        return None
    return accounts, "sideby"


def probe() -> dict:
    found: dict[str, list[dict]] = {}
    sources: list[str] = []

    # 1. Accounts file
    file_accounts = from_accounts_file()
    if file_accounts:
        sources.append("accounts_file")
        for acc in file_accounts:
            prod = acc["product"]
            found.setdefault(prod, [])
            if not any(existing["command"] == acc["command"] for existing in found[prod]):
                found[prod].append({"command": acc["command"], "pool": acc["pool"]})

    # 2. Multi-account manager adapter(s)
    for adapter in ADAPTERS:
        res = adapter()
        if res:
            mgr_accounts, mgr_source = res
            if mgr_accounts:
                sources.append(mgr_source)
                for acc in mgr_accounts:
                    prod = acc["product"]
                    found.setdefault(prod, [])
                    if not any(existing["command"] == acc["command"] for existing in found[prod]):
                        found[prod].append({"command": acc["command"], "pool": acc["pool"]})

    # 3. PATH lookup as last resort
    for product, bins in PRODUCTS.items():
        if product in found and found[product]:
            continue
        binary = next((b for b in bins if shutil.which(b)), None)
        if binary:
            found[product] = [{"command": binary, "pool": binary}]

    if "accounts_file" in sources:
        source = "accounts_file"
    elif sources:
        source = sources[0]
    else:
        source = "path"

    products = {
        p: {
            "accounts": found[p],
            "quota_pools": len({a["pool"] for a in found[p]}),
        }
        for p in sorted(found.keys())
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

    return {
        "source": source,
        "products": products,
        "code_products": code,
        "drafting_agents": [p for p in DRAFTING_PRODUCTS if p in products],
        # one pool stays with the coordinator; 0 means it writes alone
        "max_parallel_workers": max(0, min(3, pools - 1)),
        "fallback": fallback,
    }


def main() -> None:
    result = probe()
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
