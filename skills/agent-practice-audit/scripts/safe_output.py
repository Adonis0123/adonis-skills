"""Shared guard for every script that writes output: never write inside a git work tree.

Audit output contains prompt excerpts and local paths, so it must not land in a
repository where it could be committed. The target is resolved with realpath
(symlinks followed, `..` removed) before checking, and every ancestor is tested
for a `.git` directory or a `.git` file (linked worktrees and submodules).
"""

from __future__ import annotations

import os
import re

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class UnsafeOutput(ValueError):
    """The output path is not allowed; the message says how to fix it."""


def git_root(path: str) -> str | None:
    p = os.path.realpath(path)
    while True:
        if os.path.exists(os.path.join(p, ".git")):
            return p
        parent = os.path.dirname(p)
        if parent == p:
            return None
        p = parent


def safe_output_path(path: str) -> str:
    """Return the resolved path, or raise UnsafeOutput when it is inside a git work tree."""
    real = os.path.realpath(os.path.expanduser(path))
    root = git_root(real)
    if root:
        raise UnsafeOutput(f"refusing to write {real}: it is inside the git work tree {root}. "
                           "Write audit output outside repositories, e.g. under ~/.local/share/agent-practice-audit "
                           "(set AGENT_PRACTICE_AUDIT_DIR or pass a different path).")
    return real


def safe_file_target(path: str) -> str:
    """Check one file about to be written: refuse a symlinked target, then check its real path.

    Call this for every final file (not just the directory), right before opening it for writing.
    """
    p = os.path.expanduser(path)
    if os.path.islink(p):
        raise UnsafeOutput(f"refusing to write {p}: it is a symlink. Remove the link or choose another path.")
    return safe_output_path(p)


def check_date(value: str) -> str:
    if not DATE.match(value or ""):
        raise UnsafeOutput(f"--date must look like YYYY-MM-DD (got {value!r})")
    return value
