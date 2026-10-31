"""Offline source digests: references/sources/<slug>.md with a small frontmatter block.

The frontmatter is flat `key: value` lines between `---` fences, so it is parsed
without a YAML dependency. Digests let the report and verifiers fall back to a
stored summary when an official page cannot be opened.
"""

from __future__ import annotations

import os
import re

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_DIR = os.path.join(SKILL, "references", "sources")
REQUIRED = ("slug", "title", "publisher", "url", "fetchedAt", "lastVerifiedAt", "linkStatus")
LINK_STATUSES = ("ok", "redirected", "unreachable")


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


def update_frontmatter(path: str, updates: dict) -> None:
    """Rewrite selected frontmatter keys in place, keeping order and the body; new keys are appended."""
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
