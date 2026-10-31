"""Definitions shared by extract.py, aggregate.py, config_scan.py and prejudge.py.

One place for tool-name sets, the path reducer, worktree folding and the practice
rule loader, so the modules cannot drift apart. Thresholds are not defined here:
they live only in references/practices.json (`rule.params`).
"""

from __future__ import annotations

import json
import os
import re

PRACTICES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "references", "practices.json")
LOW_SAMPLE = 10  # hosts with fewer human sessions get a caveat, not a verdict

# File-edit tools (any host); a session that edits files or commits counts as a coding session.
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch", "write_file", "edit_file",
              "search_replace", "write", "create_file", "str_replace_based_edit_tool", "append_to_file"}
CHECK_TAGS = ("bash:test", "bash:lint", "bash:typecheck", "bash:screenshot")
# Runs of this skill itself (scheduled audits, refresh verifiers): never counted as the user's automation.
OWN_RUN = re.compile(r"agent-practice-audit|\b(?:run_audit|build_report|consensus|prejudge|config_scan)\.py\b")

# Worktree checkouts, folded into the repository they belong to. Codex keeps its worktrees under
# ~/.codex/worktrees/<id>/<repo>, so those fold to a `*` placeholder that keeps the repo name.
WORKTREE_RX = (
    re.compile(r"^(?P<root>.+?)/\.claude/worktrees/[^/]+"),
    re.compile(r"^(?P<root>.+?)/\.worktrees/[^/]+"),
    re.compile(r"^(?P<base>.*/\.codex[^/]*/worktrees)/[^/]+/(?P<repo>[^/]+)"),
    re.compile(r"^(?P<root>.+?)/worktrees/[^/]+"),
)


def home() -> str:
    return os.path.expanduser("~")


def tilde(p, home_dir: str | None = None) -> str:
    """The one path reducer: `~/...` under home, `(outside ~)/<name>` for anything else."""
    p = str(p or "")
    if not p or p == "~" or p.startswith("~/") or p.startswith("(outside ~)/"):
        return p
    h = (home_dir if home_dir is not None else home()).rstrip(os.sep)
    if h and (p == h or p.startswith(h + os.sep)):
        return "~" + p[len(h):]
    return "(outside ~)/" + os.path.basename(p.rstrip("/"))


def home_relative(p, home_dir: str | None = None):
    """Home prefix replaced by `~`; other paths unchanged (local-only files that still need full paths)."""
    if not isinstance(p, str):
        return p
    h = (home_dir if home_dir is not None else home()).rstrip(os.sep)
    if h and (p == h or p.startswith(h + os.sep)):
        return "~" + p[len(h):]
    return p


def worktree_root(path) -> tuple[str, bool]:
    """(repository the path belongs to, whether the path is inside a worktree checkout)."""
    p = str(path or "").rstrip("/")
    for rx in WORKTREE_RX:
        m = rx.match(p)
        if m:
            if "repo" in m.groupdict():
                return f"{m.group('base')}/*/{m.group('repo')}", True
            return m.group("root"), True
    return p, False


_REPO_CACHE: dict[str, str] = {}


def repo_identity(cwd) -> str:
    """Full path of the repository a working directory belongs to: worktree checkouts folded, and for a
    linked worktree whose `.git` file still exists, the main checkout it points to (read-only, cached).
    Two repositories that merely share a directory name stay distinct."""
    p = os.path.expanduser(str(cwd or "")).rstrip("/")
    if p in _REPO_CACHE:
        return _REPO_CACHE[p]
    root, is_wt = worktree_root(p)
    if is_wt:
        try:
            with open(os.path.join(os.path.expanduser(p), ".git"), encoding="utf-8") as f:
                line = f.read(4096).strip()
            m = re.match(r"gitdir:\s*(.+?)/\.git/worktrees/[^/]+/?$", line)
            if m:
                root = m.group(1)
        except OSError:
            pass
    _REPO_CACHE[p] = root
    return root


def rules_from(practices) -> dict:
    """{practice id: rule.params} for practices that define params; nothing is filled in by code."""
    out = {}
    for p in practices if isinstance(practices, list) else []:
        rule = p.get("rule") if isinstance(p, dict) else None
        if isinstance(rule, dict) and isinstance(rule.get("params"), dict):
            out[p.get("id")] = {k: v for k, v in rule["params"].items() if isinstance(v, (int, float))}
    return out


def load_practices(path: str = PRACTICES_PATH) -> list:
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return []
    doc = doc.get("practices") if isinstance(doc, dict) else doc
    return doc if isinstance(doc, list) else []


def load_rules(path: str = PRACTICES_PATH) -> dict:
    return rules_from(load_practices(path))
