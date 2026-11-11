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
# A hook on such an event blocks only when its script can say so: permissionDecision "deny", a
# PermissionRequest behavior "deny", decision "block", or exit code 2. Status reporters and notifiers
# (Orca, Feishu reminders) print none of these.
BLOCK_SIGNALS = (
    (re.compile(r"permissionDecision"), re.compile(r"""['"]deny['"]|\bdeny\b""")),
    (re.compile(r"""\bbehavior['"]?\s*:"""), re.compile(r"""['"]deny['"]""")),
    (re.compile(r"""\bdecision\\?['"]?\s*:\s*\\?['"]block\\?['"]"""), None),
    (re.compile(r"""['"]decision['"]"""), re.compile(r"""['"]block['"]""")),
    (re.compile(r"(?m)(?:^|[;&|{(]|\bthen|\belse|\bdo)\s*exit\s+2\b|\b(?:sys|os)\._?exit\(\s*2\s*\)"
                r"|\bprocess\.exit(?:Code\s*=\s*|\()\s*2\b|\bexit\(\s*2\s*\)"), None),
)
# Script paths a hook command names: absolute, ~, $HOME / ${HOME} / ${HOME-}, $CLAUDE_PROJECT_DIR.
HOOK_PATH = re.compile(r"""(?:\$\{?(?:HOME|CLAUDE_PROJECT_DIR)[-:]*\}?|~|(?<![\w$}])/)[^\s'"<>;|&()`]*""")
SCRIPT_EXT = (".sh", ".bash", ".zsh", ".py", ".js", ".mjs", ".cjs", ".ts", ".rb", ".pl")
# Upper-case environment variable names (ORCA_AGENT_HOOK_TOKEN, GITHUB_TOKEN) are not a topic.
ENV_NAME = re.compile(r"\$?\{?\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b-?\}?")
INSTRUCTION_NAMES = ("AGENTS.md", "CLAUDE.md", "GEMINI.md", "AGENTS.override.md", ".cursorrules")
# Subdirectory instruction files (monorepo packages): names, walk depth, a cap on directories visited, and
# directories never walked (dependencies, builds, caches; hidden directories are skipped too).
SUB_NAMES = ("AGENTS.md", "CLAUDE.md", "AGENTS.override.md")
SUB_DEPTH, SUB_DIRS = 3, 3000
SKIP_DIRS = {"node_modules", "dist", "build", "out", "target", "vendor", "coverage", "venv", "__pycache__",
             "bower_components", "Pods", "DerivedData", "tmp", "temp", "logs"}
GLOBAL_PREFIXES = (".claude", ".codex", ".grok", ".gemini")
CODEX_KEYS = ("model", "model_reasoning_effort", "approval_policy", "sandbox_mode", "project_doc_max_bytes")
# Real command invocations, not the bare words "test" or "lint".
RE_TEST = re.compile(r"\b(?:(?:pnpm|npm|yarn|bun)(?: run)? test\b|npm t\b|pytest|python3? -m (?:pytest|unittest)|go test"
                     r"|cargo test|vitest|jest\b|make (?:test|check)\b|deno test|playwright test|rspec|phpunit"
                     r"|gradlew? test|mvn test|dotnet test|swift test|mix test|tox\b|node --test)", re.I)
RE_LINT = re.compile(r"\b(?:(?:pnpm|npm|yarn|bun)(?: run)? (?:lint|typecheck|type-check|check)\b|eslint|ruff\b|biome (?:check|lint|ci)"
                     r"|golangci-lint|cargo clippy|tsc --noEmit|vue-tsc|mypy|pyright|make lint\b|flake8|pylint"
                     r"|shellcheck|stylelint|rubocop|swiftlint|prettier --check)", re.I)
RE_BUILD = re.compile(r"\b(?:(?:pnpm|npm|yarn|bun)(?: run)? build\b|cargo build|go build|make build\b|mvn (?:package|install)"
                      r"|gradlew? (?:build|assemble)|tsc -b\b|tsc --build|swift build|dotnet build|xcodebuild\b"
                      r"|vite build|next build|python3? -m build)", re.I)
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
# Lines that say what to keep or re-read around context compaction, without the heading: 压缩后先读账本,
# 压缩时保留..., "after compaction, re-read the ledger". Image/video/file compression is not compaction.
RE_COMPACT_NOTE = re.compile(
    r"(?<!图片)(?<!图像)(?<!视频)(?<!文件)(?<!素材)(?<!资源)(?<!体积)压缩(?:后|时|前|之后|以后)[^。\n]{0,30}"
    r"(?:账本|保留|恢复|先读|重读|继续|状态)"
    r"|(?:自动|上下文|会话|对话)压缩[^。\n]{0,40}(?:账本|保留|恢复|先读|重读)"
    r"|\b(?:after|before|during|across|when)\s+(?:an?\s+|the\s+)?(?:compaction|compacting|/compact|auto-?compact)\b"
    r"|(?:\bcompaction|/compact)\b[^.\n]{0,60}\b(?:preserve|retain|survive|re-?read)", re.I)
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
        "mentions_build": bool(RE_BUILD.search(text)),
        "must_rules": sum(1 for x in lines if RE_MUST.search(x)),
        "must_topics": {k: n for k, rx in TOPICS.items()
                        if (n := sum(1 for x in lines if RE_MUST.search(x) and rx.search(x)))},
        "compact_instructions": bool(RE_COMPACT.search(text)),
        "compact_notes": bool(RE_COMPACT_NOTE.search(text)),
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


def git_listed(root: str) -> list[str] | None:
    """Instruction-file paths git sees under root (read-only `git ls-files`), or None outside a work tree
    or when git is unavailable."""
    if not shutil.which("git") or not os.path.exists(os.path.join(root, ".git")):
        return None
    pats = [f"*{n}" for n in SUB_NAMES]
    try:
        p = subprocess.run(["git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--"]
                           + pats, capture_output=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    return [x for x in p.stdout.decode("utf-8", "replace").split("\0") if x]


def sub_instruction_dirs(repo: str) -> list[str]:
    """Subdirectories of a repository (up to SUB_DEPTH levels, at most SUB_DIRS visited) that hold an
    AGENTS.md / CLAUDE.md / AGENTS.override.md. Dependency, build and hidden directories are skipped, and
    global config directories (~/.claude...) and home itself are not walked."""
    root = os.path.abspath(repo)
    if root == os.path.abspath(HOME) or os.path.basename(root).startswith(GLOBAL_PREFIXES):
        return []
    listed = git_listed(root)
    if listed is not None:  # a git work tree: tracked and untracked files, .gitignore respected
        dirs = set()
        for rel in listed:
            parts = rel.split("/")
            if (parts[-1] in SUB_NAMES and 1 < len(parts) <= SUB_DEPTH + 1
                    and not any(x in SKIP_DIRS or x.startswith(".") for x in parts[:-1])):
                dirs.add(os.path.join(root, *parts[:-1]))
        return sorted(dirs)
    found = []
    for visited, (cur, dirs, files) in enumerate(os.walk(root), 1):
        depth = 0 if cur == root else os.path.relpath(cur, root).count(os.sep) + 1
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")) if depth < SUB_DEPTH else []
        if cur != root and any(n in files for n in SUB_NAMES):
            found.append(cur)
        if visited >= SUB_DIRS:
            break
    return found


def repo_instruction_files(repos: list[str]) -> list[dict]:
    """Instruction files at each repository root and in its subdirectories, each tagged with `repo` (the
    `~/...` label of the repository it belongs to) so per-repository checks can combine them. Subdirectory
    files carry `subdir: true`; only doc-test-commands reads them."""
    out = []
    for repo in repos:
        for f in instruction_files([repo]):
            out.append(dict(f, repo=tilde(repo)))
        for f in instruction_files(sub_instruction_dirs(repo)):
            out.append(dict(f, repo=tilde(repo), subdir=True))
    return out


def can_block(text: str) -> bool:
    """Whether a hook script or inline command can return a blocking answer (see BLOCK_SIGNALS)."""
    return any(a.search(text) and (b is None or b.search(text)) for a, b in BLOCK_SIGNALS)


def hook_scripts(command: str, project_dir: str | None) -> tuple[list[str], int]:
    """(texts of the script files a hook command names, script-like paths that could not be read).
    `$HOME`, `~` and `$CLAUDE_PROJECT_DIR` are expanded; for repository settings a relative script path is
    resolved against the repository. Files over 1 MiB or with NUL bytes are skipped as binaries."""
    texts, missing, seen = [], 0, set()
    tokens = HOOK_PATH.findall(command)
    if project_dir:
        tokens += [t for t in re.findall(r"""(?<![\w/$~.-])[\w.-]+(?:/[\w.-]+)+""", command) if t.endswith(SCRIPT_EXT)]
    for tok in tokens:
        p = re.sub(r"^\$\{?HOME[-:]*\}?", HOME, tok)
        p = re.sub(r"^\$\{?CLAUDE_PROJECT_DIR[-:]*\}?", project_dir or "\0", p)
        p = HOME + p[1:] if p == "~" or p.startswith("~/") else p
        if not p.startswith("/") and project_dir:
            p = os.path.join(project_dir, p)
        if "\0" in p or p in seen:
            continue
        seen.add(p)
        scriptish = p.endswith(SCRIPT_EXT) or "/scripts/" in p or "/hooks/" in p
        try:
            if not os.path.isfile(p) or os.path.getsize(p) > 1 << 20:
                missing += scriptish and not os.path.exists(p)
                continue
            with open(p, "rb") as f:
                raw = f.read()
        except OSError:
            missing += scriptish
            continue
        if b"\0" not in raw:
            texts.append(raw.decode("utf-8", "replace"))
    return texts, missing


def hook_counts(hooks, project_dir: str | None = None) -> tuple[int, int, int, list[str], int, list[str]]:
    """(events, hook entries, blocking entries, topics those blocking hooks cover judging by their matcher
    and command, commands whose scripts could not be read, topics of every hook on any event). A blocking entry
    is a hook on an event that can
    block or gate whose inline command or named script can return deny / block / exit 2. A command that
    names script files none of which can be read counts as non-blocking and as unreadable. The command and
    script text itself is never reported."""
    if not isinstance(hooks, dict):
        return 0, 0, 0, [], 0, []
    entries = enforcing = unreadable = 0
    topics, all_topics = set(), set()
    for event, groups in hooks.items():
        for g in groups if isinstance(groups, list) else []:
            hs = g.get("hooks") if isinstance(g, dict) else None
            k = len(hs) if isinstance(hs, list) else 0
            entries += k
            for h in hs if isinstance(hs, list) else []:
                if isinstance(h, dict):  # any hook enforces something every time, blocking or not
                    text = ENV_NAME.sub(" ", f"{g.get('matcher') or ''} {h.get('command') or ''}")
                    all_topics.update(tp for tp, rx in TOPICS.items() if rx.search(text))
            if event not in ENFORCING_EVENTS or not k:
                continue
            for h in hs:
                if not isinstance(h, dict):
                    continue
                cmd = str(h.get("command") or "")
                if h.get("type") in ("prompt", "agent"):
                    blocks = True  # a model-judged hook answers allow/deny by design
                elif not cmd:
                    blocks = False
                else:
                    scripts, missing = hook_scripts(cmd, project_dir)
                    if missing and not scripts:
                        unreadable += 1
                    blocks = can_block(cmd) or any(can_block(s) for s in scripts)
                if blocks:
                    enforcing += 1
                    text = ENV_NAME.sub(" ", f"{g.get('matcher') or ''} {cmd}")
                    topics.update(t for t, rx in TOPICS.items() if rx.search(text))
    return len(hooks), entries, enforcing, sorted(topics), unreadable, sorted(all_topics)


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


def claude_settings(root: str, project_dir: str | None = None) -> dict:
    """One settings root; project_dir is the repository for `<repo>/.claude` (relative hook paths)."""
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
        events, entries, enforcing, hook_topics, unreadable, all_topics = hook_counts(s.get("hooks"), project_dir)
        sandbox = as_dict(s.get("sandbox"))
        out[name] = {
            "hook_events": events,
            "hook_entries": entries,
            "enforcing_hook_entries": enforcing,
            "enforcing_hook_topics": hook_topics,
            "hook_topics": all_topics,
            "unreadable_hook_commands": unreadable,
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
    """Largest repository instruction chain Codex reads: one AGENTS.override.md / AGENTS.md / fallback file
    per directory from the git root down to the repo. The global AGENTS(.override).md under the Codex home is
    reported separately (codex_global_bytes) and does not count toward project_doc_max_bytes."""
    names = ["AGENTS.override.md", "AGENTS.md"] + fallback
    best, where = 0, None
    for repo in repos:
        top = git_root(repo)
        rel = os.path.relpath(os.path.abspath(repo), top)
        dirs = [top] + ([os.path.join(top, *rel.split(os.sep)[:i + 1]) for i in range(len(rel.split(os.sep)))]
                        if rel != "." else [])
        total = sum(first_file(d, names) for d in dirs)
        if total > best:
            best, where = total, tilde(repo)
    return best, where


def codex_config(root: str, repos: list[str] = ()) -> dict:
    p = os.path.join(root, "config.toml")
    out = {"root": tilde(root), "present": os.path.isfile(p),
           "global_instructions_bytes": first_file(root, ["AGENTS.override.md", "AGENTS.md"])}
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
    claude = [claude_settings(r) for r in claude_roots]
    claude_projects = [claude_settings(p, os.path.dirname(p)) for p in projects]
    unreadable = sum(int(as_dict(s.get(n)).get("unreadable_hook_commands") or 0)
                     for s in claude + claude_projects for n in ("settings.json", "settings.local.json"))
    notes = ["Values are sizes, counts and allowlisted keys only; secrets are never read into the output.",
             "Paths outside home are reduced to (outside ~)/<name>.",
             ("Blocking hooks: a hook on a blocking event counts only when its inline command or script can return "
              "permissionDecision deny, decision block or exit 2.")]
    if unreadable:
        notes.append(f"{unreadable} hook command(s) name scripts that could not be read; counted as non-blocking.")
    return {
        "global_instructions": instruction_files(global_dirs),
        "repo_instructions": repo_instruction_files(repos),
        "claude": claude,
        "other_skills": {"codex": sum(len(glob.glob(os.path.join(r, "skills", "*", "SKILL.md"))) for r in codex_roots),
                         "agents": len(glob.glob(os.path.join(HOME, ".agents", "skills", "*", "SKILL.md")))},
        "claude_projects": claude_projects,
        "codex": [codex_config(r, repos) for r in codex_roots],
        "schedulers": schedulers(repos, crontab),
        "notes": notes,
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
