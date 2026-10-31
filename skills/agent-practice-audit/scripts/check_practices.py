#!/usr/bin/env python3
"""Validate references/practices.json, and optionally re-check every quote on its live page.

Usage:
  check_practices.py [PRACTICES.json]            # schema + allowlist only (offline)
  check_practices.py [PRACTICES.json] --fetch    # also fetch pages and look for fragment + quote
  check_practices.py --fetch --update-digests    # and write linkStatus / lastVerifiedAt / finalUrl to digests
  check_practices.py --save-pages DIR [--candidates cands.json]
                                                 # save each source page's rendered text as DIR/<slug>.txt

Offline checks: required fields, known dimension, unique id, quote <= 25 words,
fragment contained in quote, URL on the official-domain allowlist, a digest
references/sources/<slug>.md per source (frontmatter + 5-12 bullet summary +
the cited quote), basis live|digest|mixed (each source may carry its own
basis live|digest), an optional rule {text, params}, and a
consensus record. An active practice (no "needs-consensus") must carry a
consensus that meets the accept rule: unique verifiers, agree >= 2,
agree > total / 2, no veto. needs-consensus seeds pass and are counted as
"awaiting consensus". With --fetch
each distinct page is downloaded once (stdlib urllib, a few in parallel) and
its visible text is searched for the fragment and the quote (split at
ellipses). Statuses per source:
live-verified, quote-missing, fragment-missing, or, when the page is dead (HTTP
4xx/5xx), unreachable (network error after one retry) or unreadable, the digest
fallback: digest-verified (the stored digest holds the quote) or digest-missing.
Unreadable means the page was fetched but its text looks script-rendered.
A page that answers from another URL is reported as redirected (not a failure).
Unreachable or dead links are flagged, never removed. Exit 0 when every source
is live- or digest-verified; exit 1 only for a quote or fragment missing on a
reachable page, or an unreadable page without a digest that holds the quote.
--fetch alone only reads: it writes nothing (digests change only with
--update-digests, which refuses unless the digests sit in a git clone on a
non-default branch with no symlink on the way; --allow-default-branch lifts
the branch check). --save-pages writes the verbatim rendered text of every
readable source page (practices, the pending list and --candidates) to
DIR/<slug>.txt plus DIR/manifest.json (slug -> status, fetchedAt, sha256) for
`consensus.py run --pages DIR`, which uses only pages marked fresh there;
unreachable and script-rendered pages fall back to the digest.
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
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import digests  # noqa: E402
from safe_output import UnsafeOutput, safe_file_target, safe_output_path  # noqa: E402
DEFAULT = os.path.join(HERE, "..", "references", "practices.json")
DIMENSIONS = ("ctx", "safe", "doc", "plan", "verify", "auto")
REQUIRED = ("id", "dimension", "title", "sources", "detect", "verifiedAt", "basis", "consensus")
SOURCE_REQUIRED = ("source", "page", "url", "quote", "fragment")
BASES = ("live", "digest", "mixed")  # practice level; mixed = some sources rest on their digest
SOURCE_BASES = ("live", "digest")
MAX_QUOTE_WORDS = 25
FETCH_JOBS = 6  # distinct pages fetched in parallel; small to stay polite to the doc sites
MIN_READABLE = 400  # loose-text characters below which a fetched page counts as script-rendered (unreadable)
MIN_AGREE = 2  # keep in sync with consensus.MIN_VERIFIERS
SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")  # source slugs used as file names
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
            problems.append(f"{pid}: basis must be live, digest or mixed")
        src_bases = [s.get("basis") for s in p.get("sources") or [] if isinstance(s, dict) and "basis" in s]
        if any(b not in SOURCE_BASES for b in src_bases):
            problems.append(f"{pid}: a source basis must be live or digest")
        elif p.get("basis") == "mixed" and "digest" not in src_bases:
            problems.append(f"{pid}: basis mixed needs at least one source with \"basis\": \"digest\"")
        c = p.get("consensus") or {}
        if c and not (c.get("verifiers") and isinstance(c.get("agree"), int) and isinstance(c.get("total"), int) and c.get("checkedAt")):
            problems.append(f"{pid}: consensus needs verifiers, agree, total, checkedAt")
        elif c and not p.get("needs-consensus"):
            problems += [f"{pid}: {m}" for m in consensus_problems(c)]
        if "needs-consensus" in p and not isinstance(p["needs-consensus"], bool):
            problems.append(f"{pid}: needs-consensus must be true or false")
        if "rule" in p:
            problems += [f"{pid}: {m}" for m in rule_problems(p["rule"])]
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


def consensus_problems(c: dict) -> list[str]:
    """Why an active practice's consensus record does not meet the accept rule (empty when it does)."""
    out = []
    names = c.get("verifiers")
    agree, total = c.get("agree"), c.get("total")
    if not isinstance(names, list) or not all(isinstance(n, str) and n.strip() for n in names):
        return ["consensus.verifiers must be a list of verifier names"]
    if len(set(names)) != len(names):
        out.append("consensus.verifiers repeats a name; one verifier cannot vote twice")
    if total != len(names):
        out.append(f"consensus.total is {total} but {len(names)} verifiers are listed; total counts every verifier that ran")
    if not 0 <= agree <= total:
        out.append("consensus.agree must be between 0 and total")
    if agree < MIN_AGREE or not agree > total / 2:
        out.append(f"consensus {agree}/{total} does not meet the accept rule (agree >= {MIN_AGREE} and agree > total / 2); "
                   "re-verify with consensus.py run, or mark it \"needs-consensus\": true")
    if c.get("vetoed_by") or c.get("veto"):
        out.append("consensus records a veto (quote not found); a vetoed practice cannot be active")
    return out


def rule_problems(rule) -> list[str]:
    """rule = {"text": criteria (ends with "(heuristic)" when the number is not the vendor's), "params": {name: number}}."""
    if not isinstance(rule, dict):
        return ["rule must be an object with text and params"]
    out = []
    if not isinstance(rule.get("text"), str) or not rule["text"].strip():
        out.append("rule.text must be a non-empty string")
    params = rule.get("params", {})
    if not isinstance(params, dict):
        out.append("rule.params must be an object of name: number")
    else:
        bad = [k for k, v in params.items() if isinstance(v, bool) or not isinstance(v, (int, float))]
        if bad:
            out.append(f"rule.params values must be numbers (not for: {', '.join(map(str, bad))})")
    return out


def awaiting_consensus(data: dict) -> int:
    return sum(1 for p in data.get("practices") or [] if p.get("needs-consensus"))


INLINE_TAGS = "a|abbr|b|cite|code|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var"
BLOCK_TAGS = ("p|div|li|ul|ol|h[1-6]|tr|td|th|table|pre|section|article|header|footer|blockquote|dt|dd|dl|"
              "main|nav|aside|details|summary|figcaption|figure")


def rendered_text(raw: str) -> str:
    """Visible page text as a reader sees it, for verifiers: case and punctuation kept, inline tags
    dropped without adding spaces, one line per block element, entities decoded."""
    raw = re.sub(r"(?is)<(script|style|noscript|svg)\b.*?</\1>", " ", raw)
    raw = re.sub(rf"(?is)<br\s*/?>|</?(?:{BLOCK_TAGS})\b[^>]*>", "\n", raw)
    raw = re.sub(rf"(?is)</?(?:{INLINE_TAGS})\b[^>]*>", "", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    lines = (re.sub(r"[^\S\n]+", " ", ln).strip() for ln in html.unescape(raw).split("\n"))
    return "\n".join(ln for ln in lines if ln)


def page_text(raw: str) -> str:
    """Loose search form used by the gate (tags become spaces; see loose)."""
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


def fetch_all(urls: list[str], jobs: int = FETCH_JOBS, raw: bool = False) -> dict[str, tuple[str | None, str | None, str]]:
    """Fetch each distinct URL once, a few at a time; returns url -> (page text, error, final url).

    The text is the loose search form (page_text), or the raw HTML with raw=True.
    """
    unique = list(dict.fromkeys(urls))

    def one(url: str):
        html_, err, final = fetch(url)
        if html_ is None or raw:
            return html_, err, final
        return page_text(html_), err, final

    if not unique:
        return {}
    with ThreadPoolExecutor(max_workers=max(1, min(jobs, len(unique)))) as pool:
        return dict(zip(unique, pool.map(one, unique)))


def check_live(data: dict, sources_dir: str | None = None, cache: dict | None = None) -> list[dict]:
    """Per source: live-verified, digest-verified, or a failure status (see check_gate).

    cache (url -> (loose text, error, final url)) reuses pages already fetched, e.g. by --save-pages.
    """
    urls = [s["url"] for p in data["practices"] for s in p["sources"]]
    cache = dict(cache or {})
    cache.update(fetch_all([u for u in urls if u not in cache]))
    dcache: dict[str, dict | None] = {}
    out = []
    for p in data["practices"]:
        for s in p["sources"]:
            url = s["url"]
            text, err, final = cache[url]
            if err:
                status = err
            elif len(text) < MIN_READABLE:
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
            out.append({"id": p["id"], "source": s.get("source"), "basis": p.get("basis", "live"),
                        "sourceBasis": s.get("basis"), "url": url, "fragment": s["fragment"],
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
    rest_on_digest = sorted({(r["id"], r.get("source")) for r in results if r["status"] == "digest-verified"
                             and r.get("basis") != "digest" and r.get("sourceBasis") != "digest"})
    for pid, slug in rest_on_digest:
        print(f"note: {pid} source {slug} now rests on its digest; set \"basis\": \"digest\" on that source "
              "(and \"basis\": \"mixed\" on the practice if other sources stay live) until the page works again")
    live = sum(r["status"] == "live-verified" for r in results)
    dig = sum(r["status"] == "digest-verified" for r in results)
    bad = len(results) - live - dig
    print(f"live: {live}/{len(results)} ok, digest-verified: {dig}, failed: {bad}")
    return 1 if bad else 0


def update_digests(results: list[dict], sources_dir: str, allow_default_branch: bool = False) -> list[str]:
    """Write link state into each digest. Never deletes anything; returns one line per change.

    Every target is checked first (digests.refresh_write_problem: a review branch of a git clone,
    no symlinks), so a refused run writes nothing. Raises digests.RefreshWriteRefused.
    """
    todo, live, today = {}, {}, date.today().isoformat()
    for r in results:
        slug = r.get("source")
        if slug and os.path.isfile(digests.digest_path(slug, sources_dir)):
            todo.setdefault(slug, r)
            # A page is re-verified only when every quote cited from it was found live.
            live[slug] = live.get(slug, True) and r.get("status") == "live-verified"
    for slug in todo:
        problem = digests.refresh_write_problem(digests.digest_path(slug, sources_dir), allow_default_branch)
        if problem:
            raise digests.RefreshWriteRefused(problem)
    changes = []
    for slug, r in todo.items():
        upd = {"linkStatus": r["linkStatus"], "finalUrl": r["finalUrl"] if r["linkStatus"] == "redirected" else ""}
        if live[slug]:
            upd["lastVerifiedAt"] = today
        digests.update_frontmatter(digests.digest_path(slug, sources_dir), upd, allow_default_branch)
        changes.append(f"{slug}: linkStatus={r['linkStatus']}")
    return changes


def page_sources(data: dict, extra: list[dict] = ()) -> tuple[dict[str, str], list[str]]:
    """slug -> url for every source in practices, the pending list and extra candidates; plus notes."""
    pages, notes = {}, []
    for p in list(data.get("practices") or []) + list(data.get("pending") or []) + list(extra):
        for s in p.get("sources") or []:
            slug, url = s.get("source"), s.get("url")
            if not isinstance(slug, str) or not SLUG.match(slug) or not isinstance(url, str):
                notes.append(f"{p.get('id', '?')}: source {slug!r} needs a kebab-case slug and a url; skipped")
            elif not allowed(url):
                notes.append(f"{slug}: {url} is not on the official allowlist; not fetched")
            elif slug in pages and pages[slug] != url:
                notes.append(f"{slug}: cited with two urls; kept {pages[slug]}, ignored {url}")
            else:
                pages.setdefault(slug, url)
    return pages, notes


def save_pages(pages: dict[str, str], fetched: dict, out_dir: str) -> list[str]:
    """Write each readable page's rendered text to out_dir/<slug>.txt; returns one line per slug.

    fetched maps url -> (raw html, error, final url), as fetch_all(..., raw=True) returns.

    Unreachable and script-rendered pages get no file, so consensus.py falls back to the digest
    instead of showing verifiers an empty page. DIR/manifest.json is rewritten for this run
    (slug -> status, fetchedAt, url, sha256); consensus.py uses a page file only when this
    manifest marks it fresh and its hash matches, so a file left from an earlier run never counts.
    """
    out_dir = safe_output_path(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    lines, manifest = [], {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run_id = digests.new_run_id()
    for slug, url in sorted(pages.items()):
        raw, err, _final = fetched[url]
        text = rendered_text(raw) if raw is not None else ""
        entry = {"url": url, "fetchedAt": now, "runId": run_id}
        if err:
            manifest[slug] = dict(entry, status="unreachable", error=err)
            lines.append(f"page {slug}: not saved, {err}; verifiers will use its digest")
        elif len(page_text(raw)) < MIN_READABLE:
            manifest[slug] = dict(entry, status="unreadable")
            lines.append(f"page {slug}: not saved, looks script-rendered ({len(text)} chars); verifiers will use its digest")
        else:
            target = safe_file_target(os.path.join(out_dir, f"{slug}.txt"))
            with open(target, "w", encoding="utf-8") as f:
                f.write(f"{url}\n\n{text}\n")
            manifest[slug] = dict(entry, status="fresh", sha256=digests.sha256_file(target))
            lines.append(f"page {slug}: saved {len(text)} chars")
    safe_file_target(os.path.join(out_dir, digests.MANIFEST))
    digests.write_manifest(out_dir, manifest, run_id)
    return lines


def load_extra_candidates(path: str) -> list[dict]:
    """Candidates for --save-pages: a JSON object, a list, or every *.json in a directory."""
    files = sorted(os.path.join(path, f) for f in os.listdir(path) if f.endswith(".json")) if os.path.isdir(path) else [path]
    out = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and "practices" in data:
            out += list(data["practices"]) + list(data.get("pending") or [])
        else:
            out += [c for c in (data if isinstance(data, list) else [data]) if isinstance(c, dict)]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("practices", nargs="?", default=DEFAULT)
    ap.add_argument("--fetch", action="store_true", help="fetch every page and check fragment and quote text")
    ap.add_argument("--json", action="store_true", help="print live results as JSON")
    ap.add_argument("--update-digests", action="store_true", help="with --fetch: record link state in references/sources/*.md "
                    "(only in a git clone on a non-default branch)")
    ap.add_argument("--allow-default-branch", action="store_true", help="with --update-digests: allow writing on the default branch")
    ap.add_argument("--sources-dir", default=digests.SOURCES_DIR)
    ap.add_argument("--save-pages", metavar="DIR", help="save every readable source page's rendered text as DIR/<slug>.txt "
                    "(outside any repository) for consensus.py run --pages DIR")
    ap.add_argument("--candidates", help="with --save-pages: also save pages cited by these candidates (JSON file or directory)")
    a = ap.parse_args(argv)
    with open(a.practices, encoding="utf-8") as f:
        data = json.load(f)
    problems = validate(data, a.sources_dir)
    for msg in problems:
        print("SCHEMA", msg)
    if problems:
        return 1
    n = sum(len(p["sources"]) for p in data["practices"])
    print(f"schema ok: {len(data['practices'])} practices, {n} sources, {len(data.get('pending') or [])} pending, "
          f"awaiting consensus: {awaiting_consensus(data)}")
    if a.update_digests:  # check the write boundary before spending time on fetches
        problem = next(filter(None, (digests.refresh_write_problem(os.path.join(a.sources_dir, f), a.allow_default_branch)
                                     for f in sorted(os.listdir(a.sources_dir)) if f.endswith(".md"))), None) \
            if os.path.isdir(a.sources_dir) else None
        if problem:
            print(f"error: {problem}", file=sys.stderr)
            return 2
    cache = None
    if a.save_pages:
        try:
            extra = load_extra_candidates(a.candidates) if a.candidates else []
        except (OSError, ValueError) as e:
            print(f"error: --candidates: {e}", file=sys.stderr)
            return 2
        pages, notes = page_sources(data, extra)
        for note in notes:
            print(f"note: {note}")
        fetched = fetch_all(list(pages.values()), raw=True)
        try:
            for line in save_pages(pages, fetched, a.save_pages):
                print(line)
        except (UnsafeOutput, digests.RefreshWriteRefused) as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
        cache = {u: (page_text(t) if t is not None else None, e, f) for u, (t, e, f) in fetched.items()}
    if not a.fetch:
        return 0
    results = check_live(data, a.sources_dir, cache)
    if a.json:
        print(json.dumps(results, ensure_ascii=False, indent=1))
    if a.update_digests:
        try:
            for line in update_digests(results, a.sources_dir, a.allow_default_branch):
                print("digest", line)
        except digests.RefreshWriteRefused as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
    for r in results:
        if r["linkStatus"] == "redirected":
            print(f"redirected         {r['id']:<26} {r['url']} -> {r['finalUrl']}")
    return check_gate(results)


if __name__ == "__main__":
    sys.exit(main())
