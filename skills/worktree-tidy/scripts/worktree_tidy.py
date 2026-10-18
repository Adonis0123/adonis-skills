#!/usr/bin/env python3
"""worktree_tidy.py: find and remove stale git worktrees across many repositories.

Removing a worktree deletes its folder but keeps its branch, so it can be checked out again with
`git worktree add`. A branch is deleted only when its pull/merge request is merged or closed
and its HEAD is saved on another ref.

  scan    prune records of worktrees whose folder is gone, then report every linked worktree
  remove  remove the given worktrees after checking each one again (dry run unless --yes)

A worktree is Stale when nothing happened in it for --days days (default 7), it has no uncommitted
changes or non-regenerable ignored files, it is not locked, it is not pinned in a tool (Orca),
and a detached HEAD is reachable from some ref. Only Stale worktrees are removed by default; explicit --allow-recent also permits a worktree
whose only Blocker is recent. Removal uses `git worktree remove` without --force.

Python 3.9+, standard library only. Exit code 0 on success, 1 when any requested removal failed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

DEFAULT_DAYS = 7
ORCA_APP_CLI = "/Applications/Orca.app/Contents/Resources/bin/orca"
CNB_MAX_PAGES = 20
# Requests updated this long before a branch's newest commit are not looked at.
REQUEST_SLACK_DAYS = 30
DONE_STATES = ("merged", "closed")
REGENERABLE_DIRS = set("node_modules dist build out .next .nuxt .output .svelte-kit .turbo .vite .cache "
                       ".parcel-cache coverage .nyc_output storybook-static .vercel .wrangler target "
                       "__pycache__ .pytest_cache .mypy_cache .ruff_cache .venv venv .tox .gradle "
                       ".dart_tool Pods DerivedData .expo .angular generated test-results playwright-report".split())
# Ignored path prefixes that tools recreate (husky writes its hook shims into .husky/_ on install).
REGENERABLE_PREFIXES = {".husky/_/"}


# Secrets are never regenerable, even inside an ignored build folder: `build/.env` dies with it.
SECRET_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".keystore", ".jks")
# Dependency folders: too big to walk and never hold a project's own secrets.
UNWALKED_DIRS = {"node_modules", ".venv", "venv", "Pods", ".gradle", "DerivedData", ".cache", "target", ".git"}
WALK_LIMIT = 5000


def is_secret(name: str) -> bool:
    return name == ".env" or name.startswith(".env.") or name.startswith("id_rsa") or \
        name.startswith("id_ed25519") or name.endswith(SECRET_SUFFIXES)


def secrets_under(folder: Path, rel: str) -> List[str]:
    """Secret-looking files in a collapsed regenerable folder (bounded walk)."""
    found, seen = [], 0
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in UNWALKED_DIRS]
        seen += len(files) + len(dirs)
        found += [os.path.join(rel, os.path.relpath(os.path.join(root, f), folder)) for f in files if is_secret(f)]
        if seen > WALK_LIMIT or len(found) >= 10:
            break
    return found


def add_regenerable(names: Iterable[str]) -> None:
    """Config "regenerable": entries containing "/" are path prefixes (a folder ending in "/" or one
    file), the rest folder names."""
    if not isinstance(names, list) or not all(isinstance(n, str) and n.strip("/") for n in names):
        raise SystemExit('config "regenerable" must be a list of folder names or path prefixes, e.g. ["generated", "apps/web/.wrangler/"]')
    for n in names:
        if "/" in n:
            REGENERABLE_PREFIXES.add(n.lstrip("/"))  # "dir/" or one generated file
        else:
            REGENERABLE_DIRS.add(n)


def run(cmd: List[str], cwd: Optional[str] = None, timeout: int = 60, both: bool = False) -> Tuple[int, str]:
    """(exit code, stdout); stderr instead on failure, or stdout + stderr when both is set."""
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return 127, str(e)
    if both:
        return p.returncode, p.stdout + p.stderr
    return p.returncode, p.stdout if p.returncode == 0 else (p.stderr or p.stdout)


def git(repo: str, *args: str, timeout: int = 60, both: bool = False) -> Tuple[int, str]:
    return run(["git", "-C", repo, *args], timeout=timeout, both=both)


# ── configuration and repository discovery ────────────────────────────────────

def config_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "worktree-tidy" / "config.json"


def load_config(path: Optional[str]) -> dict:
    p = Path(path).expanduser() if path else config_path()
    if not p.is_file():
        return {}
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise SystemExit(f"config must be a JSON object: {p}")
    return data


def main_repo(folder: str) -> Optional[str]:
    """The main worktree of the repository a folder belongs to (linked worktrees resolve to it)."""
    rc, out = git(folder, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if rc != 0:
        return None
    common = Path(out.strip())
    return str(common.parent) if common.name == ".git" else None


def repos_under(root: str) -> List[str]:
    """First-level folders of a root whose .git is a directory (main worktrees, not linked ones)."""
    base = Path(root).expanduser()
    if not base.is_dir():
        return []
    return sorted(str(d) for d in base.iterdir() if (d / ".git").is_dir())


def discover_repos(roots: Iterable[str], repos: Iterable[str]) -> List[str]:
    found = []
    for r in roots:
        found.extend(repos_under(r))
    for r in repos:
        m = main_repo(str(Path(r).expanduser()))
        if m:
            found.append(m)
    seen, out = set(), []
    for r in found:
        key = os.path.realpath(r)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


# ── git facts ─────────────────────────────────────────────────────────────────

def prune(repo: str, dry_run: bool = False) -> List[str]:
    """Drop records of worktrees whose folder no longer exists; returns their names."""
    rc, out = git(repo, "worktree", "prune", "-v", *(["-n"] if dry_run else []), both=True)  # -v writes to stderr
    if rc != 0:
        return []
    return re.findall(r"^Removing worktrees/([^:]+):", out, re.M)


def list_worktrees(repo: str) -> List[dict]:
    rc, out = git(repo, "worktree", "list", "--porcelain")
    if rc != 0:
        return []
    items, cur = [], {}
    for line in out.splitlines() + [""]:
        if not line:
            if cur:
                items.append(cur)
            cur = {}
            continue
        key, _, value = line.partition(" ")
        if key == "worktree":
            cur["path"] = value
        elif key == "HEAD":
            cur["head"] = value
        elif key == "branch":
            cur["branch"] = value[len("refs/heads/"):] if value.startswith("refs/heads/") else value
        elif key in ("detached", "bare", "locked", "prunable"):
            cur[key] = True
    if items:
        items[0]["main"] = True
    return items


def mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def dirty_paths(wt: str) -> Optional[Tuple[List[str], List[str]]]:
    """Uncommitted and non-regenerable ignored paths from one status call; None when unknown."""
    # --no-optional-locks: do not refresh the index, so scanning never looks like activity.
    rc, out = run(["git", "--no-optional-locks", "-C", wt, "status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=normal"])
    if rc != 0:
        return None
    paths, ignored, entries, i = [], [], out.split("\0"), 0
    while i < len(entries):
        e = entries[i]
        if len(e) > 3:
            path = e[3:]
            if e.startswith("!! "):
                parts = path.rstrip("/").split("/")
                regenerable = any(p in REGENERABLE_DIRS for p in parts) or path.startswith(tuple(REGENERABLE_PREFIXES))
                if not path.endswith("/"):
                    if is_secret(parts[-1]):
                        regenerable = False
                    else:
                        regenerable = regenerable or parts[-1] in (".DS_Store", "next-env.d.ts") or \
                            path.endswith((".log", ".pyc", ".tsbuildinfo"))
                if not regenerable:
                    ignored.append(path)
                elif path.endswith("/") and parts[-1] not in UNWALKED_DIRS:
                    ignored += secrets_under(Path(wt, path), path.rstrip("/"))
            else:
                paths.append(path)
            if "R" in e[:2] or "C" in e[:2]:
                i += 1  # a rename or copy carries its source path as the next entry
        i += 1
    return paths, ignored


def head_saved(wt: str, branch: Optional[str] = None) -> bool:
    """HEAD (or the named branch tip) must be reachable from a ref other than the branch itself."""
    if not branch:
        rc, out = git(wt, "for-each-ref", "--contains", "HEAD", "--count=1", "--format=%(refname)")
        return rc == 0 and bool(out.strip())
    # Commits only this branch has; none means another branch, tag or remote ref keeps them all.
    # Not --all: it counts every worktree's HEAD, so the branch would vouch for itself. One graph
    # walk; `for-each-ref --contains` takes ~10 s to prove a negative in a repo with 5000 refs.
    rc, out = git(wt, "rev-list", "-n1", "refs/heads/" + branch, "--not", "--exclude=" + branch,
                  "--branches", "--tags", "--remotes")
    return rc == 0 and not out.strip()


def unpushed_count(wt: str) -> Optional[int]:
    """HEAD commits on no remote-tracking ref (work that exists only on this machine); None when the
    repository has no remote refs or the count cannot be read. No fetch is performed."""
    rc, out = git(wt, "for-each-ref", "--count=1", "--format=%(refname)", "refs/remotes")
    if rc != 0 or not out.strip():
        return None
    rc, out = git(wt, "rev-list", "--count", "HEAD", "--not", "--remotes")
    return int(out.strip()) if rc == 0 and out.strip().isdigit() else None


def upstream_branch(wt: str) -> Optional[str]:
    rc, out = git(wt, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if rc != 0 or "/" not in out.strip():
        return None
    return out.strip().split("/", 1)[1]


# ── tools: Orca (optional, read only) ─────────────────────────────────────────

def orca_cli() -> Optional[str]:
    env = os.environ.get("WORKTREE_TIDY_ORCA")
    if env is not None:
        return env or None
    return shutil.which("orca") or (ORCA_APP_CLI if os.access(ORCA_APP_CLI, os.X_OK) else None)


def orca_worktrees() -> Dict[str, dict]:
    """Real path -> {pinned, activity} for every worktree Orca lists; {} when Orca is unavailable."""
    cli = orca_cli()
    if not cli:
        return {}
    rc, out = run([cli, "worktree", "list", "--json"], timeout=30)
    try:
        items = json.loads(out)["result"]["worktrees"] if rc == 0 else []
    except (ValueError, KeyError, TypeError):
        return {}
    found = {}
    for w in items:
        if isinstance(w, dict) and w.get("path"):
            at = w.get("lastActivityAt")
            found[os.path.realpath(w["path"])] = {
                "pinned": bool(w.get("isPinned")),
                "activity": at / 1000 if isinstance(at, (int, float)) else 0.0,
            }
    return found


# ── hosts: pull / merge request state ─────────────────────────────────────────

def remote_of(repo: str) -> Tuple[Optional[str], Optional[str]]:
    """(provider, slug) from the origin URL: github, cnb or gitlab; (None, None) otherwise."""
    rc, url = git(repo, "remote", "get-url", "origin")
    if rc != 0:
        return None, None
    m = re.match(r"^(?:[a-z+]+://)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?/?$", url.strip())
    if not m:
        return None, None
    host, slug = m.group(1).lower(), m.group(2)
    for provider, needle in (("github", "github"), ("cnb", "cnb.cool"), ("gitlab", "gitlab")):
        if needle in host:
            return provider, slug
    return None, None


def github_states(slug: str, branches: Iterable[str], since: float = 0) -> Dict[str, dict]:
    out = {}
    for b in branches:
        rc, text = run(["gh", "pr", "list", "-R", slug, "--head", b, "--state", "all",
                        "--json", "state,url,number", "--limit", "5"])
        try:
            prs = json.loads(text) if rc == 0 else None
        except ValueError:
            prs = None
        if prs is None:
            continue
        out[b] = pick_state([(p.get("state", "").lower(), p.get("url")) for p in prs])
    return out


def gitlab_states(slug: str, branches: Iterable[str], since: float = 0) -> Dict[str, dict]:
    out = {}
    for b in branches:
        rc, text = run(["glab", "mr", "list", "-R", slug, "--source-branch", b, "--all", "--output", "json"])
        try:
            mrs = json.loads(text) if rc == 0 else None
        except ValueError:
            mrs = None
        if mrs is None:
            continue
        out[b] = pick_state([(m.get("state", "").lower(), m.get("web_url")) for m in mrs])
    return out


_cnb_user: List[Optional[str]] = []
_cnb_user_lock = threading.Lock()


def cnb_user() -> Optional[str]:
    """The signed-in cnb.cool username, looked up once per run (scan asks from several threads)."""
    with _cnb_user_lock:
        return _cnb_user_locked()


def _cnb_user_locked() -> Optional[str]:
    if not _cnb_user:
        rc, text = run(["cnb", "users", "get-user-info", "--verbose"])
        try:
            name = json.loads(text)["data"]["username"] if rc == 0 else None
        except (ValueError, KeyError, TypeError):
            name = None
        _cnb_user.append(name if isinstance(name, str) and name else None)
    return _cnb_user[0]


def cnb_states(slug: str, branches: Iterable[str], since: float = 0) -> Dict[str, dict]:
    """cnb.cool has no head-branch filter, so page through the signed-in user's pull requests updated
    since `since` (newest first). Other people's branches and older requests are reported as none."""
    wanted, found = set(branches), {}
    window = ["--updated-time-begin", time.strftime("%Y-%m-%d", time.gmtime(since))] if since > 0 else []
    user = cnb_user()
    if user:
        window += ["--authors", user]
    for page in range(1, CNB_MAX_PAGES + 1):
        if not wanted - set(found):
            break
        rc, text = run(["cnb", "pulls", "list-pulls", "--repo", slug, "--state", "all", *window,
                        "--page", str(page), "--page-size", "100", "--verbose"])
        try:
            data = json.loads(text)["data"] if rc == 0 else None
        except (ValueError, KeyError, TypeError):
            data = None
        if not isinstance(data, list):  # the CLI or API failed: what was not found yet stays unknown
            return found
        if not data:
            break
        for p in data:
            if not isinstance(p, dict):
                continue
            ref = ((p.get("head") or {}).get("ref") or "").replace("refs/heads/", "", 1)
            if ref in wanted and ref not in found:  # newest pull request for that branch wins
                state = "merged" if p.get("is_merged") else (p.get("state") or "").lower()
                url = f"https://cnb.cool/{slug}/-/pulls/{p.get('number')}"
                found[ref] = {"state": state, "url": url}
    for b in wanted - set(found):
        found[b] = {"state": "none", "url": None}
    return found


def pick_state(prs: List[Tuple[str, Optional[str]]]) -> dict:
    """An open request wins (work continues), then merged, then closed; none when there is no request."""
    for wanted in ("open", "merged", "closed"):
        for state, url in prs:
            if state == wanted:
                return {"state": state, "url": url}
    return {"state": "none", "url": None}


PROVIDERS = {"github": ("gh", github_states), "cnb": ("cnb", cnb_states), "gitlab": ("glab", gitlab_states)}


def request_states(repo: str, branches: Iterable[str], since: float = 0) -> Dict[str, dict]:
    """Branch -> {state: open|merged|closed|none|unknown, url}. unknown when the host cannot be asked.
    since (epoch seconds) lets hosts without a branch filter skip older requests."""
    branches = sorted(set(branches))
    provider, slug = remote_of(repo)
    tool, fetch = PROVIDERS.get(provider, (None, None))
    found = fetch(slug, branches, since) if tool and shutil.which(tool) else {}
    return {b: found.get(b, {"state": "unknown", "url": None}) for b in branches}


# ── assessment ────────────────────────────────────────────────────────────────

def assess(wt: dict, orca: Dict[str, dict], now: float, days: int) -> dict:
    """Facts and verdict for one worktree from `git worktree list`."""
    path = wt["path"]
    info = {"path": path, "branch": wt.get("branch"), "head": wt.get("head"),
            "detached": bool(wt.get("detached")), "blockers": [],
            "shortHead": "", "subject": "", "dirtyFiles": [], "ignored": 0, "ignoredFiles": [],
            "branchSaved": False, "unpushed": None}
    if wt.get("main"):
        info["blockers"].append("main")
    if wt.get("locked"):
        info["blockers"].append("locked")
    if not os.path.isdir(path):
        info["blockers"].append("missing")
        info.update(dirty=0, lastActivity=0, ageDays=None, pinned=False, stale=False, removable=False)
        return info
    rc, gitdir = git(path, "rev-parse", "--absolute-git-dir")
    gd = Path(gitdir.strip()) if rc == 0 else None
    # The index file is not used: git status, editors and Orca refresh it without anyone working.
    times = [mtime(gd / "logs" / "HEAD")] if gd else []
    rc, ct = git(path, "log", "-1", "--format=%ct%n%s")
    stamp, _, subject = ct.partition("\n") if rc == 0 else ("", "", "")
    commit = float(stamp) if stamp.isdigit() else 0.0
    info.update(shortHead=(wt.get("head") or "")[:7], subject=subject.rstrip("\n"),
                branchSaved=head_saved(path, info["branch"]), unpushed=unpushed_count(path))
    times.append(commit)
    status = dirty_paths(path)
    if status is None:
        info["blockers"].append("unreadable")
    dirty, ignored = status if status is not None else ([], [])
    times.extend(mtime(Path(path) / p) for p in dirty[:200])
    tool = orca.get(os.path.realpath(path), {})
    times.append(tool.get("activity", 0.0))
    last = max(times or [0.0])
    age = (now - last) / 86400 if last else None
    if dirty:
        info["blockers"].append("dirty")
    if ignored:
        info["blockers"].append("ignored")
    if tool.get("pinned"):
        info["blockers"].append("pinned")
    if info["detached"] and not info["branchSaved"]:
        info["blockers"].append("unsaved-head")
    if age is None or age < days:
        info["blockers"].append("recent")
    info.update(dirty=len(dirty), dirtyFiles=dirty[:10], ignored=len(ignored), ignoredFiles=ignored[:10],
                lastActivity=int(last), commitTime=int(commit), ageDays=None if age is None else round(age, 1),
                pinned=bool(tool.get("pinned")), upstream=upstream_branch(path) if info["branch"] else None)
    info["stale"] = not info["blockers"]
    info["removable"] = info["stale"]
    return info


def list_repo(repo: str, dry_run: bool) -> Tuple[List[str], List[dict]]:
    """Prune, then the repository's linked worktrees in `git worktree list` order. The main worktree is
    never reported, so it is not assessed: its `git status` is usually the slowest of the repository."""
    pruned = prune(repo, dry_run=dry_run)
    return pruned, [w for w in list_worktrees(repo) if not w.get("bare") and not w.get("main")]


def finish_repo(repo: str, pruned: List[str], worktrees: List[dict], remote: bool) -> dict:
    """Attach request states to the assessed worktrees of one repository."""
    linked = [w for w in worktrees if "main" not in w["blockers"]]
    states = {}
    if remote:
        lookup = {w["path"]: (w.get("upstream") or w["branch"]) for w in linked if w["branch"]}
        oldest = min((w.get("commitTime") or 0 for w in linked if w["branch"]), default=0)
        since = oldest - REQUEST_SLACK_DAYS * 86400 if oldest else 0
        found = request_states(repo, lookup.values(), since) if lookup else {}
        states = {p: found.get(b) for p, b in lookup.items()}
    for w in linked:
        req = states.get(w["path"]) or {"state": "unknown" if w["branch"] else "n/a", "url": None}
        w["request"] = req
        w["branchDeletable"] = bool(w["branch"]) and w["removable"] and w["branchSaved"] and req["state"] in DONE_STATES
    provider, slug = remote_of(repo)
    return {"path": repo, "provider": provider, "slug": slug, "pruned": pruned, "worktrees": linked}


def scan_repo(repo: str, orca: Dict[str, dict], now: float, days: int, remote: bool, dry_run: bool) -> dict:
    """One repository, serially. scan() does the same steps with worktree-level parallelism."""
    pruned, raw = list_repo(repo, dry_run)
    return finish_repo(repo, pruned, [assess(w, orca, now, days) for w in raw], remote)


# Each assess() is a handful of short git processes, so threads mostly wait on subprocesses.
SCAN_WORKERS = min(16, max(4, os.cpu_count() or 4))


def scan(repos: List[str], days: int, remote: bool, use_orca: bool, dry_run: bool = False) -> dict:
    orca = orca_worktrees() if use_orca else {}
    now = time.time()
    # Three phases on one pool: list every repository, assess every worktree (one big repository no
    # longer runs on a single thread), then ask each host about its requests. Order follows `repos`
    # and `git worktree list`, the same as scan_repo() run one by one.
    with ThreadPoolExecutor(max_workers=SCAN_WORKERS) as pool:
        listings = list(pool.map(lambda r: list_repo(r, dry_run), repos))
        futures = [[pool.submit(assess, w, orca, now, days) for w in raw] for _, raw in listings]
        assessed = [[f.result() for f in fs] for fs in futures]
        results = list(pool.map(lambda i: finish_repo(repos[i], listings[i][0], assessed[i], remote),
                                range(len(repos))))
    every = [w for r in results for w in r["worktrees"]]
    return {
        "generatedAt": int(now), "days": days, "orca": bool(orca), "repos": results,
        "summary": {"repos": len(results), "worktrees": len(every),
                    "removable": sum(w["removable"] for w in every),
                    "branchDeletable": sum(w["branchDeletable"] for w in every),
                    "pruned": sum(len(r["pruned"]) for r in results)},
    }


# ── removal ───────────────────────────────────────────────────────────────────

def remove(paths: List[str], days: int, delete_branch: bool, use_orca: bool, yes: bool,
           allow_recent: bool = False) -> dict:
    """Re-check each worktree, then remove it (and its branch when asked and the request is done)."""
    orca = orca_worktrees() if use_orca else {}
    now, results = time.time(), []
    for raw in paths:
        path = str(Path(raw).expanduser())
        res = {"path": path, "removed": False, "branchDeleted": False}
        results.append(res)
        repo = main_repo(path) if os.path.isdir(path) else None
        match = next((w for w in list_worktrees(repo) if os.path.realpath(w["path"]) == os.path.realpath(path)),
                     None) if repo else None
        if not match or match.get("main"):
            res["error"] = "not a linked worktree"
            continue
        info = assess(match, orca, now, days)
        res["branch"] = info["branch"]
        if not info["removable"] and not (allow_recent and info["blockers"] == ["recent"]):
            res["error"] = "not removable: " + ", ".join(info["blockers"])
            continue
        state = None
        if delete_branch and info["branch"]:
            name = info.get("upstream") or info["branch"]
            since = info["commitTime"] - REQUEST_SLACK_DAYS * 86400 if info.get("commitTime") else 0
            state = request_states(repo, [name], since)[name]["state"]
            res["request"] = state
        if not yes:
            res["wouldRemove"] = True
            res["wouldDeleteBranch"] = state in DONE_STATES and info["branchSaved"]
            continue
        # The request lookup above can take a while: check again right before deleting, because
        # `git worktree remove` deletes ignored files without asking.
        status = dirty_paths(path)
        if status is None or status[0] or status[1]:
            res["error"] = "not removable: changed since it was checked"
            continue
        rc, out = git(repo, "worktree", "remove", path)
        if rc != 0:
            res["error"] = out.strip() or "git worktree remove failed"
            continue
        res["removed"] = True
        if state in DONE_STATES:
            if not head_saved(repo, info["branch"]):
                res["branchError"] = "branch has commits that exist on no other ref; kept"
            else:
                # Squash merges leave the branch "not fully merged", so -d would refuse; the host says it is done.
                rc, out = git(repo, "branch", "-D", info["branch"])
                res["branchDeleted"] = rc == 0
                if rc != 0:
                    res["branchError"] = out.strip()
        prune(repo)
    return {"dryRun": not yes, "results": results,
            "failed": sum(1 for r in results if r.get("error"))}


# ── command line ──────────────────────────────────────────────────────────────

def describe(report: dict) -> str:
    lines = []
    for r in report["repos"]:
        if not r["worktrees"] and not r["pruned"]:
            continue
        rm = sum(w["removable"] for w in r["worktrees"])
        lines.append(f"{r['path']}  ({len(r['worktrees'])} worktrees, {rm} removable)")
        for name in r["pruned"]:
            lines.append(f"  pruned record  {name}")
        for w in r["worktrees"]:
            mark = "REMOVE" if w["removable"] else "keep  "
            why = "" if w["removable"] else "  [" + ", ".join(w["blockers"]) + "]"
            req = w.get("request", {}).get("state")
            br = w["branch"] or "(detached)"
            extra = f"  request={req}" if req and req != "n/a" else ""
            if w["branchDeletable"]:
                extra += "  branch-deletable"
            age = "?" if w.get("ageDays") is None else f"{w['ageDays']}d"
            lines.append(f"  {mark} {age:>7}  {br}  {w['path']}{why}{extra}")
    s = report["summary"]
    lines.append(f"{s['worktrees']} worktrees in {s['repos']} repos: {s['removable']} removable, "
                 f"{s['branchDeletable']} branches deletable, {s['pruned']} stale records pruned "
                 f"(threshold {report['days']} days)")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--config", help="config file (default: $XDG_CONFIG_HOME/worktree-tidy/config.json)")
    ap.add_argument("--days", type=int, help=f"idle days before a worktree is Stale (default {DEFAULT_DAYS})")
    ap.add_argument("--no-orca", action="store_true", help="do not read pin and activity data from Orca")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    sub = ap.add_subparsers(dest="command", required=True)
    s = sub.add_parser("scan", help="prune missing worktrees and report the rest")
    s.add_argument("--root", action="append", default=[], help="scan first-level repos under this folder")
    s.add_argument("--repo", action="append", default=[], help="scan this repository")
    s.add_argument("--no-remote", action="store_true", help="skip pull/merge request lookups")
    s.add_argument("--no-prune", action="store_true", help="report missing worktrees without pruning them")
    r = sub.add_parser("remove", help="remove Stale worktrees (dry run unless --yes)")
    r.add_argument("paths", nargs="+", help="worktree folders")
    r.add_argument("--delete-branch", action="store_true", help="also delete branches whose request is merged or closed")
    r.add_argument("--allow-recent", action="store_true", help="explicitly allow hand-removal when recent is the only blocker")
    r.add_argument("--yes", action="store_true", help="actually remove")
    return ap


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    add_regenerable(cfg.get("regenerable", []))
    days = args.days if args.days is not None else int(cfg.get("days", DEFAULT_DAYS))
    use_orca = not args.no_orca and cfg.get("orca", True) is not False
    if args.command == "scan":
        if args.root or args.repo:
            repos = discover_repos(args.root, args.repo)
        elif cfg.get("roots") or cfg.get("repos"):
            repos = discover_repos(cfg.get("roots", []), cfg.get("repos", []))
        else:
            repos = discover_repos([], [os.getcwd()])
        if not repos:
            print("no git repositories found (pass --repo/--root or write a config)", file=sys.stderr)
            return 1
        report = scan(repos, days, remote=not args.no_remote, use_orca=use_orca, dry_run=args.no_prune)
        print(json.dumps(report, ensure_ascii=False, indent=2) if args.json else describe(report))
        return 0
    result = remove(args.paths, days, args.delete_branch, use_orca, args.yes, args.allow_recent)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for r in result["results"]:
            if r.get("error"):
                print(f"FAILED  {r['path']}: {r['error']}")
            elif result["dryRun"]:
                tail = " (and its branch)" if r.get("wouldDeleteBranch") else ""
                print(f"would remove  {r['path']}{tail}")
            else:
                tail = f"; branch {r['branch']} deleted" if r["branchDeleted"] else ""
                print(f"removed  {r['path']}{tail}")
        if result["dryRun"]:
            print("dry run: add --yes to remove")
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
