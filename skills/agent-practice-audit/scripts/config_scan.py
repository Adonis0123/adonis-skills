#!/usr/bin/env python3
"""Read-only scan of agent configuration that practices are judged against.

Usage: config_scan.py [--summary SUMMARY.json] [--repo DIR ...] [-o CONFIG.json]

Reports sizes and shapes, never secret values: instruction files (bytes, lines,
longest line, must-rule lines, whether real test/lint commands appear), Claude
settings global and per repository (hook counts incl. hooks that can block,
permission counts, deny-rule coverage categories, env variable names only),
custom subagents and skills, a fixed allowlist of Codex config keys plus the
size of the instruction chain Codex reads, and counts of scheduled jobs that
start a headless agent. Repositories come from --repo or from the most-used
working directories in an aggregate summary. Paths outside home are reduced to
their last component; an unreadable or non-object settings file is reported as
such and the scan continues.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys

try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    tomllib = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from safe_output import UnsafeOutput, safe_file_target  # noqa: E402
import audit_common  # noqa: E402

HOME = os.path.expanduser("~")
# Deny rules can embed credentials in command arguments, so only coverage categories are reported.
# Secret categories need a path-like file rule (Read/Edit/Write/...(path)); a Bash rule that merely
# mentions "secret" does not protect any file.
FILE_RULE = re.compile(r"^\s*(?:Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep)\((.+)\)\s*$")
PATH_COVERAGE = {
    "ssh": re.compile(r"(^|/)\.ssh(/|$|\*)|id_rsa|id_ed25519|id_ecdsa"),
    "aws": re.compile(r"(^|/)\.aws(/|$|\*)"),
    "cloud_credentials": re.compile(r"\.config/gcloud|(^|/)\.azure(/|$|\*)|(^|/)\.kube(/|$|\*)"
                                   r"|(^|/)credentials(\.json)?$|\.docker/config\.json"),
    "env_files": re.compile(r"(^|/)\.env"),
    "key_files": re.compile(r"\.(pem|key|p12|pfx|keystore|jks)\b|(^|/)secrets?(/|\.|$|\*)|(^|/)\.netrc$"),
}
RULE_COVERAGE = {
    "destructive_bash": re.compile(r"rm -rf|rm -fr|git push[^)]*(--force|-f\b)|git reset --hard|sudo|mkfs|dd if=", re.I),
    "network_bash": re.compile(r"Bash\((curl|wget|nc|ssh|scp)\b", re.I),
    "web_fetch": re.compile(r"^WebFetch", re.I),
}
# Hook events that can block or gate an action; SessionStart, SessionEnd, Notification, PreCompact cannot.
ENFORCING_EVENTS = {"PreToolUse", "PermissionRequest", "UserPromptSubmit", "Stop", "SubagentStop", "PostToolUse"}
INSTRUCTION_NAMES = ("AGENTS.md", "CLAUDE.md", "GEMINI.md", "AGENTS.override.md", ".cursorrules")
CODEX_KEYS = ("model", "model_reasoning_effort", "approval_policy", "sandbox_mode", "project_doc_max_bytes")
# Real command invocations, not the bare words "test" or "lint".
RE_TEST = re.compile(r"\b(?:(?:pnpm|npm|yarn|bun)(?: run)? test\b|npm t\b|pytest|python3? -m (?:pytest|unittest)|go test"
                     r"|cargo test|vitest|jest\b|make (?:test|check)\b|deno test|playwright test|rspec|phpunit"
                     r"|gradlew? test|mvn test|dotnet test|swift test|mix test|tox\b|node --test)", re.I)
RE_LINT = re.compile(r"\b(?:(?:pnpm|npm|yarn|bun)(?: run)? (?:lint|typecheck|type-check)\b|eslint|ruff\b|biome (?:check|lint)"
                     r"|golangci-lint|cargo clippy|tsc --noEmit|vue-tsc|mypy|pyright|make lint\b|flake8|pylint"
                     r"|shellcheck|stylelint|rubocop|swiftlint|prettier --check)", re.I)
# Lines that state a must-rule (what hooks or deny rules could enforce).
# "do not / don't / 不要" are left out: they mark advice far more often than a rule a hook could enforce.
RE_MUST = re.compile(r"\b(always|never|must)\b|必须|禁止|一律|不得|务必|严禁|不准", re.I)
# Rule topics a hook or deny rule can enforce. A must-rule counts as enforced only when an enforcing hook
# (by its matcher and command) or a deny rule covers the same topic.
TOPICS = {
    "secrets": re.compile(r"secret|credential|token|password|api[ _-]?key|\.env\b|\.ssh|密钥|凭据|令牌|密码", re.I),
    "destructive": re.compile(r"rm -rf|force[- ]push|--force|reset --hard|destructive|danger|删除|破坏", re.I),
    "git_push": re.compile(r"\bgit push\b|\bpush\b|\bcommit\b|deploy|publish|推送|提交|发布|部署", re.I),
    "language": re.compile(r"\blanguage\b|\blang\b|chinese|english|locale|中文|英文|语言", re.I),
}
RE_COMPACT = re.compile(r"(?im)^#+\s*compact(ion)? instructions")
HEADLESS_INVOKE = re.compile(r"\bclaude\b[^\n]*\s(?:-p|--print)\b|\bcodex\s+(?:exec|e)\b|\bgemini\b[^\n]*\s-p\b"
                             r"|\bgrok\b[^\n]*\s(?:-p|--print)\b|cursor-agent\b[^\n]*\s-p\b|claude-code-action"
                             r"|codex-action")
LIMITS = re.compile(r"--max-turns|--max-budget-usd|max_turns|max-turns")
CLAUDE_LINE_TARGET = 200
CODEX_DOC_DEFAULT = 32 * 1024


def tilde(p: str) -> str:
    """audit_common.tilde against this module's HOME (tests patch HOME)."""
    return audit_common.tilde(p, HOME)


def read_text(path: str, limit: int = 1 << 20) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read(limit)
    except OSError:
        return None


def instruction_file(path: str) -> dict:
    text = read_text(path, 1 << 22) or ""
    lines = text.splitlines()
    return {
        "path": tilde(path),
        "realpath": tilde(os.path.realpath(path)),
        "bytes": len(text.encode("utf-8")),
        "lines": len(lines),
        "longest_line": max((len(x) for x in lines), default=0),
        "mentions_test": bool(RE_TEST.search(text)),
        "mentions_lint": bool(RE_LINT.search(text)),
        "must_rules": sum(1 for x in lines if RE_MUST.search(x)),
        "must_topics": {k: n for k, rx in TOPICS.items()
                        if (n := sum(1 for x in lines if RE_MUST.search(x) and rx.search(x)))},
        "compact_instructions": bool(RE_COMPACT.search(text)),
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


def hook_counts(hooks) -> tuple[int, int, int, list[str]]:
    """(events, hook entries, entries under events that can block or gate, topics those enforcing hooks
    cover judging by their matcher and command; the command text itself is never reported)."""
    if not isinstance(hooks, dict):
        return 0, 0, 0, []
    entries = enforcing = 0
    topics = set()
    for event, groups in hooks.items():
        for g in groups if isinstance(groups, list) else []:
            hs = g.get("hooks") if isinstance(g, dict) else None
            k = len(hs) if isinstance(hs, list) else 0
            entries += k
            if event in ENFORCING_EVENTS and k:
                enforcing += k
                text = " ".join([str(g.get("matcher") or "")] + [str(h.get("command") or "") for h in hs
                                                                  if isinstance(h, dict)])
                topics.update(t for t, rx in TOPICS.items() if rx.search(text))
    return len(hooks), entries, enforcing, sorted(topics)


def secret_rule(r) -> bool:
    m = FILE_RULE.match(str(r))
    return bool(m) and any(rx.search(m.group(1).strip()) for rx in PATH_COVERAGE.values())


def deny_topics(rules: list) -> list[str]:
    topics = set()
    for r in rules:
        if secret_rule(r):
            topics.add("secrets")
        if RULE_COVERAGE["destructive_bash"].search(str(r)):
            topics.add("destructive")
        if re.search(r"git (push|commit)", str(r)):
            topics.add("git_push")
    return sorted(topics)


def deny_coverage(rules: list) -> dict:
    paths = [m.group(1).strip() for m in (FILE_RULE.match(str(r)) for r in rules) if m]
    cov = {k: any(rx.search(p) for p in paths) for k, rx in PATH_COVERAGE.items()}
    cov.update({k: any(rx.search(str(r)) for r in rules) for k, rx in RULE_COVERAGE.items()})
    return cov


def as_dict(v) -> dict:
    return v if isinstance(v, dict) else {}


def as_list(v) -> list:
    return v if isinstance(v, list) else []


def claude_settings(root: str) -> dict:
    out = {"root": tilde(root)}
    for name in ("settings.json", "settings.local.json"):
        p = os.path.join(root, name)
        if not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                s = json.load(f)
        except (OSError, ValueError):
            s = None
        if not isinstance(s, dict):  # unreadable, invalid JSON or a non-object root: report and move on
            out[name] = {"unreadable": True}
            continue
        perms = as_dict(s.get("permissions"))
        deny = as_list(perms.get("deny"))
        events, entries, enforcing, hook_topics = hook_counts(s.get("hooks"))
        sandbox = as_dict(s.get("sandbox"))
        out[name] = {
            "hook_events": events,
            "hook_entries": entries,
            "enforcing_hook_entries": enforcing,
            "enforcing_hook_topics": hook_topics,
            "deny_count": len(deny),
            "secret_deny_count": sum(1 for r in deny if secret_rule(r)),
            "deny_topics": deny_topics(deny),
            "sandbox_enabled": sandbox.get("enabled") is True,
            "deny_coverage": deny_coverage(deny),
            "allow_count": len(as_list(perms.get("allow"))),
            "ask_count": len(as_list(perms.get("ask"))),
            "default_mode": perms.get("defaultMode") if isinstance(perms.get("defaultMode"), str) else None,
            "env_names": sorted(str(k) for k in as_dict(s.get("env"))),
        }
    agents = glob.glob(os.path.join(root, "agents", "*.md"))
    skills = glob.glob(os.path.join(root, "skills", "*", "SKILL.md"))
    long_skills, manual_only = 0, 0
    for p in skills:
        text = read_text(p)
        if text is None:
            continue
        long_skills += text.count("\n") > 500
        manual_only += "disable-model-invocation: true" in text
    out["custom_subagents"] = len(agents)
    out["skills"] = {"count": len(skills), "over_500_lines": long_skills, "manual_only": manual_only}
    return out


def git_root(d: str) -> str:
    """Nearest ancestor with .git (stopping at home or /), else d itself."""
    cur = os.path.abspath(d)
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur or cur == HOME:
            return os.path.abspath(d)
        cur = parent


def first_file(d: str, names) -> int:
    """Bytes of the first non-empty file among names in d (Codex reads one per directory)."""
    for n in names:
        p = os.path.join(d, n)
        if os.path.isfile(p):
            try:
                size = os.path.getsize(p)
            except OSError:
                continue
            if size:
                return size
    return 0


def codex_chain_bytes(root: str, repos: list[str], fallback: list[str]) -> tuple[int, str | None]:
    """Largest combined instruction chain Codex reads: global AGENTS(.override).md plus, per repository,
    one AGENTS.override.md / AGENTS.md / fallback file per directory from the git root down to the repo."""
    names = ["AGENTS.override.md", "AGENTS.md"] + fallback
    base = first_file(root, ["AGENTS.override.md", "AGENTS.md"])
    best, where = base, None
    for repo in repos:
        top = git_root(repo)
        rel = os.path.relpath(os.path.abspath(repo), top)
        dirs = [top] + ([os.path.join(top, *rel.split(os.sep)[:i + 1]) for i in range(len(rel.split(os.sep)))]
                        if rel != "." else [])
        total = base + sum(first_file(d, names) for d in dirs)
        if total > best:
            best, where = total, tilde(repo)
    return best, where


def codex_config(root: str, repos: list[str] = ()) -> dict:
    p = os.path.join(root, "config.toml")
    out = {"root": tilde(root), "present": os.path.isfile(p)}
    if not out["present"]:
        out["instruction_chain_bytes_max"], out["instruction_chain_repo"] = codex_chain_bytes(root, list(repos), [])
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
    out["profiles"] = sorted(str(k) for k in as_dict(data.get("profiles")))
    out["mcp_servers"] = len(as_dict(data.get("mcp_servers")))
    fallback = [x for x in as_list(data.get("project_doc_fallback_filenames")) if isinstance(x, str) and "/" not in x]
    out["instruction_chain_bytes_max"], out["instruction_chain_repo"] = codex_chain_bytes(root, list(repos), fallback)
    return out


def repos_from_summary(path: str, limit: int = 8) -> list[str]:
    try:
        with open(path, encoding="utf-8") as f:
            s = json.load(f)
    except (OSError, ValueError):
        return []
    seen = []
    for host in as_dict(as_dict(s).get("hosts")).values():
        for pair in as_list(as_dict(host).get("cwd_top")):
            if not (isinstance(pair, list) and pair and isinstance(pair[0], str)):
                continue
            d = os.path.expanduser(pair[0])
            if d and d not in seen and os.path.isdir(d):
                seen.append(d)
    return seen[:limit]


def headless_hits(text: str, depth: int = 1) -> tuple[bool, bool, bool]:
    """(starts a headless agent, passes a turn/budget limit, runs this skill itself), following script
    paths named in text once."""
    hit, lim, own = bool(HEADLESS_INVOKE.search(text)), bool(LIMITS.search(text)), bool(audit_common.OWN_RUN.search(text))
    if depth and not hit:
        for tok in re.findall(r"(?:~|/)[^\s'\"<>;|&]+", text)[:20]:
            p = os.path.expanduser(tok)
            if os.path.isfile(p) and os.path.getsize(p) < 256 * 1024:
                h, l_, o = headless_hits(read_text(p) or "", depth - 1)
                if h or o:
                    return h, l_ or lim, own or o
    return hit, lim, own


def schedulers(repos: list[str], crontab: bool = True) -> dict:
    """Counts of launchd jobs, crontab lines and CI workflows that start a headless agent (no paths, no text).
    Jobs that run this skill itself (agent-practice-audit, run_audit.py, ...) are counted apart as `own`."""
    out = {"launchd": 0, "cron": 0, "ci": 0, "with_limits": 0, "own": 0}

    def add(kind: str, text: str) -> None:
        hit, lim, own = headless_hits(text)
        if own:
            out["own"] += 1
        elif hit:
            out[kind] += 1
            out["with_limits"] += lim
    for p in glob.glob(os.path.join(HOME, "Library", "LaunchAgents", "*.plist")):
        try:
            with open(p, "rb") as f:
                d = plistlib.load(f)
        except Exception:  # noqa: BLE001 - any unreadable plist is skipped
            continue
        if isinstance(d, dict):
            args = [str(x) for x in as_list(d.get("ProgramArguments"))] + [str(d.get("Program") or "")]
            add("launchd", " ".join(args))
    if crontab and shutil.which("crontab"):
        try:
            p = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=5)
            for line in p.stdout.splitlines() if p.returncode == 0 else []:
                if line.strip() and not line.lstrip().startswith("#"):
                    add("cron", line)
        except (OSError, subprocess.SubprocessError):
            pass
    for repo in repos:
        for pat in (".github/workflows/*.yml", ".github/workflows/*.yaml", ".gitlab-ci.yml", ".cnb.yml"):
            for p in glob.glob(os.path.join(repo, pat)):
                add("ci", read_text(p) or "")
    return out


def scan(repos: list[str], crontab: bool = True) -> dict:
    claude_roots = sorted(p for p in glob.glob(os.path.join(HOME, ".claude*")) if os.path.isdir(p))
    codex_roots = sorted(p for p in glob.glob(os.path.join(HOME, ".codex*")) if os.path.isdir(p))
    grok_roots = sorted(p for p in glob.glob(os.path.join(HOME, ".grok*")) if os.path.isdir(p))
    gemini = os.path.join(HOME, ".gemini")
    global_dirs = claude_roots + codex_roots + grok_roots + ([gemini] if os.path.isdir(gemini) else [])
    projects = [os.path.join(r, ".claude") for r in repos
                if any(os.path.isfile(os.path.join(r, ".claude", n)) for n in ("settings.json", "settings.local.json"))]
    return {
        "global_instructions": instruction_files(global_dirs),
        "repo_instructions": instruction_files(repos),
        "claude": [claude_settings(r) for r in claude_roots],
        "other_skills": {"codex": sum(len(glob.glob(os.path.join(r, "skills", "*", "SKILL.md"))) for r in codex_roots),
                         "agents": len(glob.glob(os.path.join(HOME, ".agents", "skills", "*", "SKILL.md")))},
        "claude_projects": [claude_settings(p) for p in projects],
        "codex": [codex_config(r, repos) for r in codex_roots],
        "schedulers": schedulers(repos, crontab),
        "notes": ["Values are sizes, counts and allowlisted keys only; secrets are never read into the output.",
                  "Paths outside home are reduced to (outside ~)/<name>."],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--summary", help="aggregate summary; its top working directories become --repo values")
    ap.add_argument("--repo", action="append", default=[], help="repository directory to scan (repeatable)")
    ap.add_argument("-o", "--out")
    a = ap.parse_args(argv)
    repos = [os.path.abspath(os.path.expanduser(r)) for r in a.repo] + (repos_from_summary(a.summary) if a.summary else [])
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
