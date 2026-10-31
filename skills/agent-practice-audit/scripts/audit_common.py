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


_CHECKOUT_CACHE: dict[str, str] = {}


def checkout_root(cwd) -> str:
    """The working tree a directory sits in: nearest ancestor with a `.git` entry (a clone's directory or a
    linked worktree's file), stopping below home and /. Unlike repo_identity, worktrees are NOT folded, so
    two checkouts of one repository stay apart. Falls back to the directory itself."""
    p = os.path.expanduser(str(cwd or "")).rstrip("/")
    if p in _CHECKOUT_CACHE:
        return _CHECKOUT_CACHE[p]
    h, cur, found = home().rstrip(os.sep), p, p
    while cur and cur != h and cur != os.path.dirname(cur):
        if os.path.exists(os.path.join(cur, ".git")):
            found = cur
            break
        cur = os.path.dirname(cur)
    _CHECKOUT_CACHE[p] = found
    return found


def file_checkout(path) -> str | None:
    """The checkout an edited file sits in, or None when no `.git` is found below home. A path inside a
    known worktree layout (`.claude/worktrees/<n>`, `.worktrees/<n>`, `~/.codex/worktrees/<id>/<repo>`,
    `worktrees/<n>`) maps to that worktree even after it was removed from disk."""
    p = os.path.expanduser(str(path or "")).rstrip("/")
    for rx in WORKTREE_RX:
        m = rx.match(p)
        if m:
            return m.group(0)
    h, cur = home().rstrip(os.sep), os.path.dirname(p)
    while cur and cur != h and cur != os.path.dirname(cur):
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        cur = os.path.dirname(cur)
    return None


def main_checkout(checkout) -> str:
    """For a linked worktree (its `.git` is a file pointing at `<main>/.git/worktrees/<n>`), the main
    checkout; else the path itself. Read-only."""
    p = os.path.expanduser(str(checkout or "")).rstrip("/")
    try:
        with open(os.path.join(p, ".git"), encoding="utf-8") as f:
            m = re.match(r"gitdir:\s*(.+?)/\.git/worktrees/[^/]+/?$", f.read(4096).strip())
        if m:
            return m.group(1)
    except OSError:
        pass
    return repo_identity(p)


def project_identity(checkout) -> str:
    """The project a checkout belongs to: its main checkout's remote, else the main checkout path."""
    main = main_checkout(checkout)
    return remote_identity(main) or main


_REMOTE_CACHE: dict[str, str | None] = {}
_REMOTE_URL = re.compile(r"^\s*url\s*=\s*(\S+)\s*$", re.M)


def normalise_remote(url: str) -> str:
    """`git@host:o/r.git`, `https://user:pw@host/o/r` and `ssh://git@host/o/r/` all become `host/o/r`."""
    u = url.strip()
    u = re.sub(r"^[a-z+]+://", "", u, flags=re.I)
    u = re.sub(r"^[^@/]*@", "", u)  # credentials or the ssh user
    u = re.sub(r"^([^/:]+):(?!\d+/)", r"\1/", u)  # scp-like host:path
    u = re.sub(r"^([^/:]+):\d+/", r"\1/", u)  # explicit port
    u = re.sub(r"(\.git)?/*$", "", u)
    host, _, rest = u.partition("/")
    return f"{host.lower()}/{rest}"


def remote_identity(repo) -> str | None:
    """Normalised URL of the `origin` remote (else the first remote) of a repository path, read from its
    `.git/config` (read-only, cached); None when there is none. Clones of one remote in different
    directories share it. The URL itself never leaves this process: callers hash it."""
    p = os.path.expanduser(str(repo or "")).rstrip("/")
    if p in _REMOTE_CACHE:
        return _REMOTE_CACHE[p]
    out = None
    try:
        with open(os.path.join(p, ".git", "config"), encoding="utf-8", errors="replace") as f:
            text = f.read(1 << 16)
        sections = re.split(r"(?m)^\s*\[", text)
        remotes = [s for s in sections if s.startswith("remote ")]
        remotes.sort(key=lambda s: not s.startswith('remote "origin"'))
        for s in remotes:
            m = _REMOTE_URL.search(s)
            if m:
                out = normalise_remote(m.group(1))
                break
    except OSError:
        pass
    _REMOTE_CACHE[p] = out
    return out


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
