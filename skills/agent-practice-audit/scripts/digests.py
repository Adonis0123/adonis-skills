"""Offline source digests: references/sources/<slug>.md with a small frontmatter block.

The frontmatter is flat `key: value` lines between `---` fences, so it is parsed
without a YAML dependency. Digests let the report and verifiers fall back to a
stored summary when an official page cannot be opened.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import uuid

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_DIR = os.path.join(SKILL, "references", "sources")
REQUIRED = ("slug", "title", "publisher", "url", "fetchedAt", "lastVerifiedAt", "linkStatus")
LINK_STATUSES = ("ok", "redirected", "unreachable")
MANIFEST = "manifest.json"  # written by check_practices.py --save-pages beside the page files
MAX_PAGE_AGE_HOURS = 24  # a saved page older than this is not live text for verifiers
DEFAULT_BRANCHES = ("main", "master")  # used when the clone has no origin/HEAD


class RefreshWriteRefused(ValueError):
    """A refresh write (digest update) is outside the allowed boundary; the message says what to do."""


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return (fields, body). Text without a leading `---` block has no fields."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    fields = {}
    for line in text[3:end].strip("\n").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip().strip('"').strip("'")
    body = text[end + 4:].lstrip("\n")
    return fields, body


def section_bullets(body: str, heading: str) -> list[str]:
    """Bullet lines under `## heading`, without the leading dash."""
    m = re.search(rf"^##\s+{re.escape(heading)}\s*$(.*?)(?=^##\s|\Z)", body, re.M | re.S)
    if not m:
        return []
    return [ln.strip()[2:].strip() for ln in m.group(1).splitlines() if ln.strip().startswith("- ")]


def digest_path(slug: str, sources_dir: str = SOURCES_DIR) -> str:
    return os.path.join(sources_dir, f"{slug}.md")


def load_digest(slug: str, sources_dir: str = SOURCES_DIR) -> dict | None:
    path = digest_path(slug, sources_dir)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        fields, body = parse_frontmatter(f.read())
    return {**fields, "summary": section_bullets(body, "Summary"), "quotes": section_bullets(body, "Cited quotes"),
            "path": f"references/sources/{slug}.md"}


def problems(slug: str, digest: dict | None) -> list[str]:
    if digest is None:
        return [f"digest references/sources/{slug}.md is missing; write one (see SKILL.md, refresh step 3)"]
    out = [f"{slug}: frontmatter needs {k}" for k in REQUIRED if not digest.get(k)]
    if digest.get("slug") and digest["slug"] != slug:
        out.append(f"{slug}: frontmatter slug is {digest['slug']!r}; make it match the file name")
    if digest.get("linkStatus") and digest["linkStatus"] not in LINK_STATUSES:
        out.append(f"{slug}: linkStatus must be one of {', '.join(LINK_STATUSES)}")
    if digest.get("linkStatus") == "redirected" and not digest.get("finalUrl"):
        out.append(f"{slug}: linkStatus redirected needs finalUrl")
    if not 5 <= len(digest.get("summary") or []) <= 12:
        out.append(f"{slug}: Summary should have 5-12 bullets (has {len(digest.get('summary') or [])})")
    return out


def _git(root: str, *args: str) -> str | None:
    try:
        r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, timeout=10, check=False,
                           stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def refresh_write_problem(path: str, allow_default_branch: bool = False) -> str | None:
    """Why refresh mode may not write this file (None when it may).

    Refresh writes belong in a clone of the skill repository on a review branch, so the change
    reaches users through a pull request: refuse symlinked targets, an installed copy outside
    git, a detached HEAD, and the default branch unless allow_default_branch is set.
    """
    p = os.path.abspath(os.path.expanduser(path))
    if os.path.islink(p):
        return f"refusing to write {p}: it is a symlink. Write the real file in a clone of the skill repository."
    root = _git(os.path.dirname(p), "rev-parse", "--show-toplevel")
    if not root:
        return (f"refusing to write {p}: it is not inside a git work tree, so this looks like an installed copy. "
                "Run refresh in a clone of the skill repository; installed copies update through skill updates.")
    # Walk the path as given up to the directory holding .git: a symlink on the way means the write
    # would go through a linked install into some repository. Links above the repository root
    # (such as /var -> /private/var on macOS) are not part of the install and are ignored.
    q = p
    while True:
        if os.path.islink(q):
            return (f"refusing to write {p}: {q} is a symlink. Run refresh in a real clone of the skill "
                    "repository, not through a linked install.")
        if os.path.exists(os.path.join(q, ".git")):
            break
        if os.path.dirname(q) == q:
            return f"refusing to write {p}: the path reaches {root} only through a symlink; use the clone's real path."
        q = os.path.dirname(q)
    branch = _git(root, "symbolic-ref", "--quiet", "--short", "HEAD")
    if not branch:
        return f"refusing to write {p}: {root} has a detached HEAD. Create a branch, e.g. git switch -c practices-refresh/<date>."
    origin_head = _git(root, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    default = {origin_head.split("/", 1)[-1]} if origin_head else set(DEFAULT_BRANCHES)
    if branch in default and not allow_default_branch:
        return (f"refusing to write {p}: {root} is on the default branch {branch}. Create a review branch "
                "(git switch -c practices-refresh/<date>) or pass --allow-default-branch.")
    return None


def update_frontmatter(path: str, updates: dict, allow_default_branch: bool = False) -> None:
    """Rewrite selected frontmatter keys in place, keeping order and the body; new keys are appended.

    Raises RefreshWriteRefused outside a review branch of a git clone (see refresh_write_problem).
    """
    problem = refresh_write_problem(path, allow_default_branch)
    if problem:
        raise RefreshWriteRefused(problem)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    end = text.find("\n---", 3)
    head, rest = text[3:end].strip("\n").splitlines(), text[end:]
    seen = set()
    for i, line in enumerate(head):
        key = line.split(":", 1)[0].strip()
        if key in updates:
            head[i] = f"{key}: {updates[key]}".rstrip()
            seen.add(key)
    head += [f"{k}: {v}".rstrip() for k, v in updates.items() if k not in seen]
    with open(path, "w", encoding="utf-8") as f:
        f.write("---\n" + "\n".join(head) + rest)


# ---------------------------------------------------------------- saved page text (refresh step 4)

def sha256_file(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def new_run_id() -> str:
    return uuid.uuid4().hex


def write_manifest(pages_dir: str, entries: dict[str, dict], run_id: str | None = None) -> str:
    """Replace PAGES/manifest.json with this run's pages: slug -> {status, fetchedAt, url, runId, sha256?}.

    Only entries with status "fresh" and this manifest's runId may be used as live text; a file left
    over from an earlier run is not in the new manifest (or not fresh), so verifiers use the digest.
    """
    path = os.path.join(pages_dir, MANIFEST)
    if os.path.islink(path):
        raise RefreshWriteRefused(f"refusing to write {path}: it is a symlink")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"runId": run_id or new_run_id(),
                   "writtenAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "pages": entries},
                  f, ensure_ascii=False, indent=1)
    return path


def _recent(stamp, now: dt.datetime) -> bool:
    try:
        t = dt.datetime.fromisoformat(str(stamp))
    except ValueError:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return dt.timedelta(0) <= now - t <= dt.timedelta(hours=MAX_PAGE_AGE_HOURS) or abs(now - t) < dt.timedelta(minutes=5)


def fresh_pages(pages_dir: str, now: dt.datetime | None = None) -> tuple[dict[str, dict], str | None]:
    """slug -> {path, url} for pages this run's manifest marks fresh.

    A page counts only when its entry has status "fresh", carries the manifest's runId, was
    fetched within MAX_PAGE_AGE_HOURS, and its file still matches the recorded sha256. The caller
    must also check that the entry's url is the source url it cites. Returns ({}, note) when the
    directory has no readable manifest, so every source uses its digest.
    """
    path = os.path.join(pages_dir, MANIFEST)
    try:
        with open(path, encoding="utf-8") as f:
            manifest = json.load(f)
        pages, run_id = manifest.get("pages") or {}, manifest.get("runId")
    except (OSError, ValueError, AttributeError):
        return {}, (f"no readable {MANIFEST} in {pages_dir}; every source uses its digest. "
                    "Save pages with check_practices.py --save-pages DIR.")
    now = now or dt.datetime.now(dt.timezone.utc)
    out, stale = {}, []
    for slug, e in pages.items():
        f = os.path.join(pages_dir, f"{slug}.txt")
        if not (isinstance(e, dict) and e.get("status") == "fresh"):
            continue
        if (run_id and e.get("runId") == run_id and _recent(e.get("fetchedAt"), now) and os.path.isfile(f)
                and not os.path.islink(f) and e.get("sha256") == sha256_file(f)):
            out[slug] = {"path": f, "url": e.get("url")}
        else:
            stale.append(slug)
    note = (f"saved page(s) not from this run, older than {MAX_PAGE_AGE_HOURS} h or changed since saving: "
            f"{', '.join(stale)}; their digests are used") if stale else None
    return out, note
