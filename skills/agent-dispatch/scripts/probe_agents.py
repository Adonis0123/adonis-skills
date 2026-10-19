#!/usr/bin/env python3
"""Report which coding-agent CLIs this machine can dispatch to.

Discovers accounts from an accounts file, an optional multi-account manager,
or PATH lookup, then applies the user's account allow-list. Prints JSON only:
products, usable accounts, distinct quota pools, per-account launch commands,
how many sessions each pool may run, and the fallback the coordinator should
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


def read_accounts_file(path: str | None = None) -> dict | None:
    if path is None:
        path = get_accounts_file_path()
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def from_accounts_file(path: str | None = None, data: dict | None = None) -> list[dict] | None:
    if data is None:
        data = read_accounts_file(path)
    if data is None:
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
        account_id = item.get("id")
        if not isinstance(account_id, str) or not account_id.strip():
            account_id = command
        accounts.append(
            {
                "id": account_id.strip(),
                "product": product,
                "command": command,
                "pool": pool_val,
            }
        )
    return accounts


def parse_allow(raw: object) -> list[str]:
    """Accept a list or a comma/space separated string of account ids."""
    if isinstance(raw, str):
        items = raw.replace(",", " ").split()
    elif isinstance(raw, list):
        items = [x for x in raw if isinstance(x, str)]
    else:
        return []
    return [x.strip() for x in items if x.strip()]


def get_allow(file_data: dict | None) -> list[str]:
    # env is the user's per-run instruction, so it wins over the file
    env_allow = parse_allow(os.environ.get("AGENT_DISPATCH_ALLOW", ""))
    if env_allow:
        return env_allow
    return parse_allow((file_data or {}).get("allow"))


def get_sessions_per_pool(file_data: dict | None) -> int:
    for raw in (os.environ.get("AGENT_DISPATCH_SESSIONS_PER_POOL"), (file_data or {}).get("sessions_per_pool")):
        if raw is None or raw == "":
            continue
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value >= 1:
            return value
    return 1


def parse_aliases(raw: object) -> dict[str, str]:
    """Map short command -> account id; values are an id or {"account": id, ...}."""
    if not isinstance(raw, dict):
        return {}
    aliases = {}
    for short, target in raw.items():
        if isinstance(target, dict):
            target = target.get("account")
        if isinstance(short, str) and isinstance(target, str) and target.strip():
            aliases[short.strip()] = target.strip()
    return aliases


def from_sideby_aliases() -> dict[str, str]:
    """Short commands such as cc001 -> claude:001, from sideby's config."""
    if not shutil.which("sideby"):
        return {}
    try:
        out = subprocess.run(
            ["sideby", "config", "get", "aliases", "--json"], capture_output=True, text=True, timeout=20
        )
        data = json.loads(out.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}
    return parse_aliases(data.get("value") if isinstance(data, dict) else None)


def get_aliases(file_data: dict | None) -> dict[str, str]:
    # the accounts file wins over the manager for the same short name
    return {**from_sideby_aliases(), **parse_aliases((file_data or {}).get("aliases"))}


def is_allowed(product: str, account: dict, allow: list[str]) -> bool:
    keys = {product, account["id"], account["command"]}
    return any(entry in keys for entry in allow)


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
                "id": ref,
                "product": family,
                # trailing "--" passes host args through, e.g. `<command> -p ...`
                "command": f"sideby run {ref} --",
                "pool": pool,
            }
        )
    if not accounts:
        return None
    return accounts, "sideby"


def probe() -> dict:
    found: dict[str, list[dict]] = {}
    sources: list[str] = []
    file_data = read_accounts_file()

    # 1. Accounts file
    file_accounts = from_accounts_file(data=file_data)
    if file_accounts:
        sources.append("accounts_file")
        for acc in file_accounts:
            prod = acc["product"]
            found.setdefault(prod, [])
            if not any(existing["command"] == acc["command"] for existing in found[prod]):
                found[prod].append({"id": acc["id"], "command": acc["command"], "pool": acc["pool"]})

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
                        found[prod].append({"id": acc["id"], "command": acc["command"], "pool": acc["pool"]})

    # 3. PATH lookup as last resort
    for product, bins in PRODUCTS.items():
        if product in found and found[product]:
            continue
        binary = next((b for b in bins if shutil.which(b)), None)
        if binary:
            found[product] = [{"id": binary, "command": binary, "pool": binary}]

    # 4. The user's allow-list overrides discovery
    allow = get_allow(file_data)
    allow_unmatched: list[str] = []
    if allow:
        aliases = get_aliases(file_data)
        # short commands such as cc001 resolve to their account id
        resolved = {entry: aliases.get(entry, entry) for entry in allow}
        matched: set[str] = set()
        for product in list(found):
            kept = []
            for acc in found[product]:
                keys = {product, acc["id"], acc["command"]}
                if is_allowed(product, acc, list(resolved.values())):
                    kept.append(acc)
                    matched.update(e for e, target in resolved.items() if target in keys)
            if kept:
                found[product] = kept
            else:
                del found[product]
        allow_unmatched = [e for e in allow if e not in matched]
    sessions_per_pool = get_sessions_per_pool(file_data)

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
    if pools < 2 and sessions_per_pool < 2:
        fallback.append("one quota pool: L2 runs workers one after another, not in parallel")
    elif pools < 2:
        fallback.append("one quota pool: parallel sessions all share one rate limit")
    if "antigravity" not in products:
        fallback.append("no drafting agent: coordinator writes articles itself with the writing skills")

    return {
        "source": source,
        "products": products,
        "code_products": code,
        "drafting_agents": [p for p in DRAFTING_PRODUCTS if p in products],
        "allow": allow,
        "allow_unmatched": allow_unmatched,
        "sessions_per_pool": sessions_per_pool,
        # pools bound quota, sessions_per_pool bounds concurrency; the
        # coordinator holds one session slot, its own pool may host workers.
        # Above 1 session per pool the user raised the limit, so no cap of 3.
        "max_parallel_workers": max(
            0,
            pools * sessions_per_pool - 1 if sessions_per_pool > 1 else min(3, pools - 1),
        ),
        "fallback": fallback,
    }


def main() -> None:
    result = probe()
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
