#!/usr/bin/env python3
"""Read-only scan of agent configuration that practices are judged against.

Usage: config_scan.py [--summary SUMMARY.json] [--repo DIR ...] [-o CONFIG.json]

Reports sizes and shapes, never secret values: instruction files (bytes, lines,
longest line, whether build/test/lint commands appear), Claude settings (hook
and permission counts, deny-rule coverage categories, env variable names only), custom subagents
and skills, and a fixed allowlist of Codex config keys. Repositories come from
--repo or from the most-used working directories in an aggregate summary.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    tomllib = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from safe_output import UnsafeOutput, safe_file_target  # noqa: E402

HOME = os.path.expanduser("~")
# Deny rules can embed credentials in command arguments, so only coverage categories are reported.
DENY_COVERAGE = {
    "ssh": re.compile(r"\.ssh\b|id_rsa|id_ed25519", re.I),
    "aws": re.compile(r"\.aws\b", re.I),
    "cloud_credentials": re.compile(r"\.config/gcloud|\.azure|\.kube|credentials", re.I),
    "env_files": re.compile(r"\.env", re.I),
    "key_files": re.compile(r"\.pem\b|\.key\b|secret", re.I),
    "destructive_bash": re.compile(r"rm -rf|rm -fr|git push[^)]*(--force|-f\b)|git reset --hard|sudo|mkfs|dd if=", re.I),
    "network_bash": re.compile(r"Bash\((curl|wget|nc|ssh|scp)\b", re.I),
    "web_fetch": re.compile(r"^WebFetch", re.I),
}
INSTRUCTION_NAMES = ("AGENTS.md", "CLAUDE.md", "GEMINI.md", "AGENTS.override.md", ".cursorrules")
CODEX_KEYS = ("model", "model_reasoning_effort", "approval_policy", "sandbox_mode", "project_doc_max_bytes")
RE_TEST = re.compile(r"\b(test|vitest|jest|pytest|go test|cargo test)\b", re.I)
RE_LINT = re.compile(r"\b(lint|eslint|biome|ruff|typecheck|tsc)\b", re.I)
CLAUDE_LINE_TARGET = 200
CODEX_DOC_DEFAULT = 32 * 1024


def tilde(p: str) -> str:
    return "~" + p[len(HOME):] if p.startswith(HOME) else p


def instruction_file(path: str) -> dict:
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    lines = text.splitlines()
    return {
        "path": tilde(path),
        "realpath": tilde(os.path.realpath(path)),
        "bytes": len(text.encode("utf-8")),
        "lines": len(lines),
        "longest_line": max((len(x) for x in lines), default=0),
        "mentions_test": bool(RE_TEST.search(text)),
        "mentions_lint": bool(RE_LINT.search(text)),
        "over_200_lines": len(lines) > CLAUDE_LINE_TARGET,
        "over_32KiB": len(text.encode("utf-8")) > CODEX_DOC_DEFAULT,
    }


def instruction_files(dirs: list[str]) -> list[dict]:
    out, seen = [], set()
    for d in dirs:
        for name in INSTRUCTION_NAMES:
            p = os.path.join(d, name)
            if os.path.isfile(p) and p not in seen:
                seen.add(p)
                out.append(instruction_file(p))
    return out


def hook_counts(hooks) -> tuple[int, int]:
    if not isinstance(hooks, dict):
        return 0, 0
    entries = 0
    for groups in hooks.values():
        for g in groups if isinstance(groups, list) else []:
            entries += len(g.get("hooks") or []) if isinstance(g, dict) else 0
    return len(hooks), entries


def deny_coverage(rules: list) -> dict:
    return {k: any(rx.search(str(r)) for r in rules) for k, rx in DENY_COVERAGE.items()}


def claude_settings(root: str) -> dict:
    out = {"root": tilde(root)}
    for name in ("settings.json", "settings.local.json"):
        p = os.path.join(root, name)
        try:
            with open(p, encoding="utf-8") as f:
                s = json.load(f)
        except (OSError, ValueError):
            continue
        perms = s.get("permissions") or {}
        events, entries = hook_counts(s.get("hooks"))
        out[name] = {
            "hook_events": events,
            "hook_entries": entries,
            "deny_count": len(perms.get("deny") or []),
            "deny_coverage": deny_coverage(perms.get("deny") or []),
            "allow_count": len(perms.get("allow") or []),
            "ask_count": len(perms.get("ask") or []),
            "default_mode": perms.get("defaultMode"),
            "env_names": sorted((s.get("env") or {}).keys()),
        }
    agents = glob.glob(os.path.join(root, "agents", "*.md"))
    skills = glob.glob(os.path.join(root, "skills", "*", "SKILL.md"))
    long_skills, manual_only = 0, 0
    for p in skills:
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            continue
        long_skills += text.count("\n") > 500
        manual_only += "disable-model-invocation: true" in text
    out["custom_subagents"] = len(agents)
    out["skills"] = {"count": len(skills), "over_500_lines": long_skills, "manual_only": manual_only}
    return out


def codex_config(root: str) -> dict:
    p = os.path.join(root, "config.toml")
    out = {"root": tilde(root), "present": os.path.isfile(p)}
    if not out["present"]:
        return out
    with open(p, "rb") as f:
        raw = f.read()
    if tomllib:
        try:
            data = tomllib.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            data = {}
    else:
        data = {}
        # Only root-level scalar settings are eligible; tables may contain env secrets.
        root_text = re.split(r"(?m)^\s*\[", raw.decode("utf-8", "replace"), maxsplit=1)[0]
        for k in CODEX_KEYS:
            m = re.search(rf"""^{k}\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([0-9]+))\s*(?:#.*)?$""", root_text, re.M)
            if m:
                data[k] = int(m.group(3)) if m.group(3) is not None else next(v for v in m.groups()[:2] if v is not None)
    out.update({k: data.get(k) if type(data.get(k)) is (int if k == "project_doc_max_bytes" else str) else None
                for k in CODEX_KEYS})
    out["profiles"] = sorted((data.get("profiles") or {}).keys())
    out["mcp_servers"] = len(data.get("mcp_servers") or {})
    return out


def repos_from_summary(path: str, limit: int = 8) -> list[str]:
    with open(path, encoding="utf-8") as f:
        s = json.load(f)
    seen = []
    for host in (s.get("hosts") or {}).values():
        for cwd, _ in host.get("cwd_top") or []:
            d = os.path.expanduser(cwd)
            if d and d not in seen and os.path.isdir(d):
                seen.append(d)
    return seen[:limit]


def scan(repos: list[str]) -> dict:
    claude_roots = sorted(p for p in glob.glob(os.path.join(HOME, ".claude*")) if os.path.isdir(p))
    codex_roots = sorted(p for p in glob.glob(os.path.join(HOME, ".codex*")) if os.path.isdir(p))
    grok_roots = sorted(p for p in glob.glob(os.path.join(HOME, ".grok*")) if os.path.isdir(p))
    gemini = os.path.join(HOME, ".gemini")
    global_dirs = claude_roots + codex_roots + grok_roots + ([gemini] if os.path.isdir(gemini) else [])
    return {
        "global_instructions": instruction_files(global_dirs),
        "repo_instructions": instruction_files(repos),
        "claude": [claude_settings(r) for r in claude_roots],
        "codex": [codex_config(r) for r in codex_roots],
        "notes": ["Values are sizes, counts and allowlisted keys only; secrets are never read into the output."],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--summary", help="aggregate summary; its top working directories become --repo values")
    ap.add_argument("--repo", action="append", default=[], help="repository directory to scan (repeatable)")
    ap.add_argument("-o", "--out")
    a = ap.parse_args(argv)
    repos = [os.path.expanduser(r) for r in a.repo] + (repos_from_summary(a.summary) if a.summary else [])
    text = json.dumps(scan(list(dict.fromkeys(repos))), ensure_ascii=False, indent=1)
    if a.out:
        try:
            a.out = safe_file_target(a.out)
        except UnsafeOutput as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
