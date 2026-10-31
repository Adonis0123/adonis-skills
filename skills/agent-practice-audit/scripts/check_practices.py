#!/usr/bin/env python3
"""Validate references/practices.json, and optionally re-check every quote on its live page.

Usage:
  check_practices.py [PRACTICES.json]            # schema + allowlist only (offline)
  check_practices.py [PRACTICES.json] --fetch    # also fetch pages and look for fragment + quote
  check_practices.py --fetch --update-digests    # and write linkStatus / lastVerifiedAt / finalUrl to digests

Offline checks: required fields, known dimension, unique id, quote <= 25 words,
fragment contained in quote, URL on the official-domain allowlist, a digest
references/sources/<slug>.md per source (frontmatter + 5-12 bullet summary +
the cited quote), basis live|digest, and a consensus record. With --fetch
each page is downloaded once (stdlib urllib) and its visible text is searched
for the fragment and the quote (split at ellipses). Statuses per source:
live-verified, quote-missing, fragment-missing, or, when the page is dead (HTTP
4xx/5xx), unreachable (network error after one retry) or unreadable, the digest
fallback: digest-verified (the stored digest holds the quote) or digest-missing.
Unreadable means the page was fetched but its text looks script-rendered.
A page that answers from another URL is reported as redirected (not a failure).
Unreachable or dead links are flagged, never removed. Exit 0 when every source
is live- or digest-verified; exit 1 only for a quote or fragment missing on a
reachable page, or an unreadable page without a digest that holds the quote.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import digests  # noqa: E402
DEFAULT = os.path.join(HERE, "..", "references", "practices.json")
DIMENSIONS = ("ctx", "safe", "doc", "plan", "verify", "auto")
REQUIRED = ("id", "dimension", "title", "sources", "detect", "verifiedAt", "basis", "consensus")
SOURCE_REQUIRED = ("source", "page", "url", "quote", "fragment")
BASES = ("live", "digest")
MAX_QUOTE_WORDS = 25
# Keep in sync with references/sources.md.
ALLOWED_DOMAINS = (
    "code.claude.com", "docs.anthropic.com", "docs.claude.com", "claude.com", "anthropic.com", "www.anthropic.com",
    "learn.chatgpt.com", "developers.openai.com", "openai.com", "platform.openai.com",
    "geminicli.com", "github.com", "developers.googleblog.com", "ai.google.dev",
    "cursor.com", "docs.cursor.com",
    "docs.x.ai",
    "codebuddy.ai", "www.codebuddy.ai", "cloud.tencent.com",
)
GITHUB_ORGS = ("google-gemini",)


def norm(s: str) -> str:
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace(" ", " ").replace("‑", "-").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", s).strip().lower()


def loose(s: str) -> str:
    """Punctuation-insensitive form: tag stripping leaves stray spaces around inline code and links."""
    return re.sub(r"[^\w]+", " ", norm(s)).strip()


def allowed(url: str) -> bool:
    u = urlparse(url)
    if u.scheme != "https":
        return False
    host = u.hostname or ""
    if host == "github.com":
        return u.path.strip("/").split("/")[0] in GITHUB_ORGS
    return host in ALLOWED_DOMAINS


def validate(data: dict, sources_dir: str | None = None) -> list[str]:
    """Return a list of human-readable problems; empty means valid. sources_dir=None skips digest checks."""
    problems, seen, checked = [], set(), {}
    items = data.get("practices")
    if not isinstance(items, list) or not items:
        return ["practices must be a non-empty list"]
    for i, p in enumerate(items):
        pid = p.get("id") or f"#{i}"
        for k in REQUIRED:
            if not p.get(k):
                problems.append(f"{pid}: missing {k}")
        if pid in seen:
            problems.append(f"{pid}: duplicate id")
        seen.add(pid)
        if p.get("dimension") not in DIMENSIONS:
            problems.append(f"{pid}: dimension must be one of {', '.join(DIMENSIONS)}")
        if p.get("basis") and p["basis"] not in BASES:
            problems.append(f"{pid}: basis must be live or digest")
        c = p.get("consensus") or {}
        if c and not (c.get("verifiers") and isinstance(c.get("agree"), int) and isinstance(c.get("total"), int) and c.get("checkedAt")):
            problems.append(f"{pid}: consensus needs verifiers, agree, total, checkedAt")
        for j, s in enumerate(p.get("sources") or []):
            where = f"{pid} source {j + 1}"
            for k in SOURCE_REQUIRED:
                if not s.get(k):
                    problems.append(f"{where}: missing {k}")
            q, frag = s.get("quote", ""), s.get("fragment", "")
            if len(q.split()) > MAX_QUOTE_WORDS:
                problems.append(f"{where}: quote has {len(q.split())} words; shorten to <= {MAX_QUOTE_WORDS}")
            if frag and norm(frag) not in norm(q):
                problems.append(f"{where}: fragment is not part of the quote; copy it from the quote")
            if s.get("url") and not allowed(s["url"]):
                problems.append(f"{where}: {s['url']} is not on the official allowlist (references/sources.md)")
            slug = s.get("source")
            if sources_dir and slug:
                if slug not in checked:
                    d = digests.load_digest(slug, sources_dir)
                    checked[slug] = d
                    problems += digests.problems(slug, d)
                    if d and d.get("url") and d["url"] != s.get("url"):
                        problems.append(f"{where}: url differs from digest {slug} url")
                d = checked[slug]
                if d and q and not any(norm(q) in norm(line) for line in d.get("quotes") or []):
                    problems.append(f"{where}: quote is not listed under 'Cited quotes' in references/sources/{slug}.md")
    for c in data.get("pending") or []:
        if not c.get("id") or not c.get("sources"):
            problems.append(f"pending {c.get('id') or '?'}: needs id and sources")
    return problems


def page_text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript|svg)\b.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return loose(html.unescape(raw))


def fetch(url: str, timeout: int = 20) -> tuple[str | None, str | None, str]:
    """Return (html, error, final_url)."""
    req = urllib.request.Request(url, headers={"User-Agent": "agent-practice-audit/1 (+practice check)"})
    err = None
    for _ in range(2):  # one retry: TLS resets and timeouts are usually transient
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace"), None, r.geturl()
        except urllib.error.HTTPError as e:
            return None, f"dead (HTTP {e.code})", url
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            err = f"unreachable ({getattr(e, 'reason', e)})"
    return None, err, url


def link_status(url: str, err: str | None, final_url: str) -> str:
    if err:
        return "unreachable"
    return "redirected" if final_url.rstrip("/") != url.rstrip("/") else "ok"


def check_live(data: dict, sources_dir: str | None = None) -> list[dict]:
    """Per source: live-verified, digest-verified, or a failure status (see check_gate)."""
    cache: dict[str, tuple[str | None, str | None, str]] = {}
    dcache: dict[str, dict | None] = {}
    out = []
    for p in data["practices"]:
        for s in p["sources"]:
            url = s["url"]
            if url not in cache:
                raw, err, final = fetch(url)
                cache[url] = (page_text(raw) if raw is not None else None, err, final)
            text, err, final = cache[url]
            if err:
                status = err
            elif len(text) < 400:
                status = "unreadable"
            elif loose(s["fragment"]) not in text:
                status = "fragment-missing"
            elif not all(loose(part) in text for part in re.split(r"\s*(?:…|\.\.\.)\s*", s["quote"]) if part.strip()):
                status = "quote-missing"
            else:
                status = "live-verified"
            if err or status == "unreadable":
                # The page cannot be read: fall back to the stored digest, which must hold the quote.
                slug = s.get("source")
                if slug and sources_dir and slug not in dcache:
                    dcache[slug] = digests.load_digest(slug, sources_dir)
                d = dcache.get(slug) if slug else None
                in_digest = bool(d) and any(norm(s["quote"]) in norm(line) for line in d.get("quotes") or [])
                status = "digest-verified" if in_digest else f"digest-missing ({status})"
            out.append({"id": p["id"], "source": s.get("source"), "basis": p.get("basis", "live"), "url": url, "fragment": s["fragment"],
                        "status": status, "linkStatus": link_status(url, err, final), "finalUrl": final})
    return out


PASSING = ("live-verified", "digest-verified")


def check_gate(results: list[dict]) -> int:
    """Print non-live results and a summary; return 0 when every source is live- or digest-verified.

    Fails only for a quote or fragment missing on a reachable page, or an unreachable page
    whose digest is missing or does not hold the quote.
    """
    for r in results:
        if r["status"] != "live-verified":
            print(f"{r['status']:<26} {r['id']:<26} {r['url']}  [{r['fragment']}]")
    rest_on_digest = sorted({r["id"] for r in results if r["status"] == "digest-verified" and r.get("basis") != "digest"})
    for pid in rest_on_digest:
        print(f"note: {pid} now rests on its digest; set \"basis\": \"digest\" until the page works again")
    live = sum(r["status"] == "live-verified" for r in results)
    dig = sum(r["status"] == "digest-verified" for r in results)
    bad = len(results) - live - dig
    print(f"live: {live}/{len(results)} ok, digest-verified: {dig}, failed: {bad}")
    return 1 if bad else 0


def update_digests(results: list[dict], sources_dir: str) -> list[str]:
    """Write link state into each digest. Never deletes anything; returns one line per change."""
    changes, done = [], set()
    today = date.today().isoformat()
    for r in results:
        slug = r.get("source")
        if not slug or slug in done or not os.path.isfile(digests.digest_path(slug, sources_dir)):
            continue
        done.add(slug)
        upd = {"linkStatus": r["linkStatus"], "finalUrl": r["finalUrl"] if r["linkStatus"] == "redirected" else ""}
        if r["linkStatus"] != "unreachable":
            upd["lastVerifiedAt"] = today
        digests.update_frontmatter(digests.digest_path(slug, sources_dir), upd)
        changes.append(f"{slug}: linkStatus={r['linkStatus']}")
    return changes


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("practices", nargs="?", default=DEFAULT)
    ap.add_argument("--fetch", action="store_true", help="fetch every page and check fragment and quote text")
    ap.add_argument("--json", action="store_true", help="print live results as JSON")
    ap.add_argument("--update-digests", action="store_true", help="with --fetch: record link state in references/sources/*.md")
    ap.add_argument("--sources-dir", default=digests.SOURCES_DIR)
    a = ap.parse_args(argv)
    with open(a.practices, encoding="utf-8") as f:
        data = json.load(f)
    problems = validate(data, a.sources_dir)
    for msg in problems:
        print("SCHEMA", msg)
    if problems:
        return 1
    n = sum(len(p["sources"]) for p in data["practices"])
    print(f"schema ok: {len(data['practices'])} practices, {n} sources, {len(data.get('pending') or [])} pending")
    if not a.fetch:
        return 0
    results = check_live(data, a.sources_dir)
    if a.json:
        print(json.dumps(results, ensure_ascii=False, indent=1))
    if a.update_digests:
        for line in update_digests(results, a.sources_dir):
            print("digest", line)
    for r in results:
        if r["linkStatus"] == "redirected":
            print(f"redirected         {r['id']:<26} {r['url']} -> {r['finalUrl']}")
    return check_gate(results)


if __name__ == "__main__":
    sys.exit(main())
