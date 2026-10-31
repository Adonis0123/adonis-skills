#!/usr/bin/env python3
"""Multi-model consensus for candidate practices (refresh mode, stage b).

Usage:
  consensus.py detect [--exclude claude]            # verifier CLIs on PATH
  consensus.py prompt --candidate C.json --page PAGE.txt [--basis live|digest]
  consensus.py decide VERDICT.txt [VERDICT.txt ...] [--names claude,codex,...]
  consensus.py run --candidates FILE_OR_DIR [...] --pages DIR --out DIR [--exclude claude]
                   [--verifiers claude,codex] [--verifier-cmd NAME=CMD] [--jobs 4] [--timeout 600]
                   [--max-calls N]

`decide` honours the v-<name>.status.json that `run` writes beside each
output, so a failed call stays malformed when the rule is re-applied.
`run` groups candidates by source page and sends one prompt per (page,
verifier): the page text once plus every candidate citing that page. Each
verifier CLI gets the prompt on stdin (several calls at once, each with a
timeout, in an empty temp directory outside any repository) and answers with a
JSON array of per-candidate verdicts. The raw answer is kept in
OUT/_batches/<batch>/v-<name>.txt; each candidate's verdict (combined over its
pages) goes to OUT/<id>/v-<name>.txt with a status sidecar, the rule below is
applied per candidate, and OUT/decisions.json is written. A timeout, a non-zero
exit or a malformed batch answer (no array, an unknown, duplicate or missing
id) makes every candidate in that batch malformed for that verifier.
--max-calls caps the total verifier calls; candidates whose pages do not fit
stay pending-consensus. Page text comes from PAGES/<source>.txt, used only
when PAGES/manifest.json (written by check_practices.py --save-pages) marks it
fresh and its hash matches; any other source (or a candidate with basis
"digest") uses its digest. Verifier CLIs get isolation flags (no user
settings, hooks, MCP servers or skills) when their --help lists them.

Rule: accept iff agree >= 2 AND agree > total / 2 AND no veto, where total is
every verifier that ran (invalid or unparseable output counts and never agrees)
and agree counts valid "accept" verdicts. A verdict must use real JSON booleans
for quote_found, faithful and checkable; accept requires all three true, and
when the candidate has a `rule`, also rule_faithful true. Any parsed result
with quote_found strictly false vetoes, even if the rest of it is invalid.
Fewer than 2 verifiers ran -> pending-consensus (not merged).
Verifier names must be unique and match the verdict files 1:1.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import digests  # noqa: E402
from safe_output import UnsafeOutput, git_root, safe_file_target, safe_output_path  # noqa: E402
PROMPT = os.path.join(os.path.dirname(HERE), "references", "verify-prompt.md")
MIN_VERIFIERS = 2
# name -> base headless command, shown by `detect`; `run` builds the full command from VERIFIER_SPECS.
VERIFIER_CLIS = {
    "claude": "claude -p",
    "codex": "codex exec -",
    "grok": "grok --prompt-file",
    "gemini": "gemini -p",
}


# How `run` calls each CLI. The prompt goes on stdin unless `tail` passes {prompt_file}. A flag in
# `flags` is added only when the installed version's `help` output lists it (never guessed): a turn
# cap, no tools, no git-repo check, a read-only sandbox, no saved session. `requires` must be listed
# or the CLI is skipped. {turns} and {prompt_file} are filled per call.
# Isolation flags keep a verifier from loading the user's hooks, MCP servers, skills and settings:
# claude loads only `local` settings (none exist in the empty temp cwd), no MCP servers and no
# skills or slash commands; codex skips ~/.codex/config.toml (MCP servers, hooks) and .rules files;
# gemini loads no extensions. Each is added only when the installed help lists it.
VERIFIER_SPECS = {
    "claude": {"cmd": "claude -p", "help": "claude --help",
               "flags": (("--max-turns", "--max-turns {turns}"), ("--tools", "--tools ''"),
                         ("--setting-sources", "--setting-sources local"), ("--strict-mcp-config", "--strict-mcp-config"),
                         ("--disable-slash-commands", "--disable-slash-commands"),
                         ("--no-session-persistence", "--no-session-persistence"))},
    "codex": {"cmd": "codex exec", "help": "codex exec --help", "tail": "-",
              "flags": (("--skip-git-repo-check", "--skip-git-repo-check"), ("--ephemeral", "--ephemeral"),
                        ("--sandbox", "--sandbox read-only"), ("--color", "--color never"),
                        ("--ignore-user-config", "--ignore-user-config"), ("--ignore-rules", "--ignore-rules"))},
    # grok -p takes the prompt as an argument, not stdin; --prompt-file reads it from the file.
    "grok": {"cmd": "grok", "help": "grok --help", "tail": "--prompt-file {prompt_file}", "requires": "--prompt-file",
             "flags": (("--max-turns", "--max-turns {turns}"), ("--no-subagents", "--no-subagents"),
                       ("--disable-web-search", "--disable-web-search"))},
    "gemini": {"cmd": "gemini -p", "help": "gemini --help",
               "flags": (("--max-turns", "--max-turns {turns}"), ("--extensions", "--extensions none"))},
}
KILL_GRACE = 5  # seconds to collect output after killing a timed-out verifier
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")  # ids, slugs and verifier names used in paths
_help_cache: dict[str, str] = {}


def detect(exclude: tuple[str, ...] = ()) -> list[str]:
    return [n for n in VERIFIER_CLIS if n not in exclude and shutil.which(n)]


def cli_help(name: str) -> str:
    if name not in _help_cache:
        try:
            r = subprocess.run(shlex.split(VERIFIER_SPECS[name]["help"]), capture_output=True, text=True,
                               check=False, timeout=30, stdin=subprocess.DEVNULL)
            _help_cache[name] = (r.stdout or "") + (r.stderr or "")
        except (OSError, subprocess.TimeoutExpired):
            _help_cache[name] = ""
    return _help_cache[name]


def has_flag(help_text: str, flag: str) -> bool:
    return re.search(rf"(?<![\w-]){re.escape(flag)}(?![\w-])", help_text) is not None


# Flags that keep a verifier away from the user's settings, hooks and MCP servers. A verifier is
# "isolated" only when its help lists all of them; grok lists none today, so it is never isolated.
ISOLATION_FLAGS = {"claude": ("--setting-sources", "--strict-mcp-config"), "codex": ("--ignore-user-config",),
                   "grok": (), "gemini": ("--extensions",)}


def isolated(name: str, help_text: str) -> bool:
    flags = ISOLATION_FLAGS.get(name) or ()
    return bool(flags) and all(has_flag(help_text, f) for f in flags)


def build_command(name: str, help_text: str | None = None) -> str | None:
    """Command template for a known CLI with the flags its help lists; None when a required flag is missing."""
    spec = VERIFIER_SPECS[name]
    text = cli_help(name) if help_text is None else help_text
    if spec.get("requires") and not has_flag(text, spec["requires"]):
        return None
    parts = [spec["cmd"]] + [args for flag, args in spec.get("flags", ()) if has_flag(text, flag)]
    return " ".join(parts + ([spec["tail"]] if spec.get("tail") else []))


BOOL_FIELDS = ("quote_found", "faithful", "checkable")
RULE_FIELD = "rule_faithful"  # required, as a real boolean, when the candidate has a rule
BATCH_DIR = "_batches"  # under OUT; candidate ids start with a letter or digit, so this never collides


def first_verdict_object(text: str) -> dict | None:
    """First JSON object in the text that has a `verdict` or any BOOL_FIELDS key (prose and code fences
    around it are ignored). An object without `verdict` still counts, so its quote_found=false can veto."""
    dec = json.JSONDecoder()
    i = text.find("{")
    while i != -1:
        try:
            obj, _ = dec.raw_decode(text, i)
        except ValueError:
            obj = None
        if isinstance(obj, dict) and ("verdict" in obj or any(k in obj for k in BOOL_FIELDS)):
            return obj
        i = text.find("{", i + 1)
    return None


def parse_verdict(text: str, rule_required: bool = False) -> dict | None:
    """Strictly validated verdict; None when no verdict object exists.

    A verdict object that breaks the schema comes back with `invalid: True` and never counts
    as agreement: every field in BOOL_FIELDS must be a real JSON boolean, verdict must be
    accept or reject, and accept requires all three checks to be true. With rule_required
    (the candidate has a rule), rule_faithful must be a real boolean and accept needs it true.
    """
    d = first_verdict_object(text)
    if d is None:
        return None
    reason = str(d.get("reason", ""))[:500]
    problems = []
    if d.get("verdict") not in ("accept", "reject"):
        problems.append("verdict must be accept or reject")
    for k in BOOL_FIELDS + ((RULE_FIELD,) if rule_required else ()):
        if not isinstance(d.get(k), bool):
            problems.append(f"{k} must be true or false")
    if not problems and d["verdict"] == "accept":
        if not all(d[k] for k in BOOL_FIELDS):
            problems.append("accept requires quote_found, faithful and checkable to be true")
        elif rule_required and not d[RULE_FIELD]:
            problems.append("accept requires rule_faithful to be true when the candidate has a rule")
    v = {"verdict": d.get("verdict"), "reason": reason, "invalid": bool(problems), "problems": problems}
    for k in BOOL_FIELDS + (RULE_FIELD,):
        v[k] = d.get(k) if isinstance(d.get(k), bool) else None
    return v


def decide(verdicts: list[dict | None], names: list[str] | None = None) -> dict:
    """Apply the consensus rule. Raises ValueError when names do not match verdicts one to one."""
    if names is None:
        names = [f"verifier{i + 1}" for i in range(len(verdicts))]
    if len(names) != len(verdicts):
        raise ValueError(f"got {len(names)} verifier names for {len(verdicts)} verdicts; give exactly one name per verdict")
    if len(set(names)) != len(names):
        raise ValueError("verifier names must be unique; one verifier cannot vote twice")
    valid = [(n, v) for n, v in zip(names, verdicts) if v is not None and not v.get("invalid")]
    invalid = [n for n, v in zip(names, verdicts) if v is not None and v.get("invalid")]
    missing = [n for n, v in zip(names, verdicts) if v is None]
    agree = sum(1 for _, v in valid if v["verdict"] == "accept")
    # The veto reads every parsed result, valid or not, whenever quote_found is strictly false.
    vetoed = [n for n, v in zip(names, verdicts) if v is not None and v.get("quote_found") is False]
    total = len(verdicts)  # every verifier that ran counts; invalid or unparseable output never agrees
    if total < MIN_VERIFIERS:
        decision = "pending-consensus"
    elif vetoed:
        decision = "reject"
    elif agree >= MIN_VERIFIERS and agree > total / 2:
        decision = "accept"
    else:
        decision = "reject"
    return {
        "decision": decision,
        "consensus": {"verifiers": list(names), "agree": agree, "total": total,
                      "checkedAt": dt.date.today().isoformat()},
        "vetoed_by": vetoed,
        "invalid": invalid,
        "unusable": missing,
        "reasons": {n: v["reason"] for n, v in zip(names, verdicts) if v is not None},
    }


PROMPT_KEYS = ("id", "dimension", "title", "detect", "rule")


def has_rule(cand: dict) -> bool:
    rule = cand.get("rule")
    return isinstance(rule, dict) and isinstance(rule.get("text"), str) and bool(rule["text"].strip())


def prompt_entry(cand: dict, slug: str | None = None) -> dict:
    """What a verifier sees of one candidate: the sources on this page to check, and quotes elsewhere as context."""
    e = {k: cand[k] for k in PROMPT_KEYS if k in cand}
    srcs = [s for s in cand.get("sources") or [] if isinstance(s, dict)]
    e["check_sources"] = [s for s in srcs if slug is None or s.get("source") == slug]
    others = [{"source": s.get("source"), "quote": s.get("quote")} for s in srcs if slug is not None and s.get("source") != slug]
    if others:
        e["quotes_on_other_pages"] = others
    return e


def render_prompt(candidates, page_text: str, basis: str = "live", template_path: str = PROMPT,
                  slug: str | None = None) -> str:
    """Fill the verify prompt for one candidate or a list of candidates that cite the same page."""
    with open(template_path, encoding="utf-8") as f:
        tpl = f.read()
    tpl = tpl.split("<!-- template -->", 1)[-1]
    cands = candidates if isinstance(candidates, list) else [candidates]
    blob = json.dumps([prompt_entry(c, slug) for c in cands], ensure_ascii=False, indent=2)
    return (tpl.replace("{{BASIS}}", basis)
               .replace("{{CANDIDATES_JSON}}", blob).replace("{{CANDIDATE_JSON}}", blob)
               .replace("{{PAGE_TEXT}}", page_text))


def first_verdict_array(text: str) -> list | None:
    """First JSON array of objects in the text; prose and code fences around it are ignored."""
    dec = json.JSONDecoder()
    i = text.find("[")
    while i != -1:
        try:
            obj, _ = dec.raw_decode(text, i)
        except ValueError:
            obj = None
        if isinstance(obj, list) and obj and all(isinstance(x, dict) for x in obj):
            return obj
        i = text.find("[", i + 1)
    return None


def split_batch(text: str, ids: list[str]) -> tuple[dict[str, dict], str | None]:
    """Per-candidate verdict objects from one batch answer, plus the batch problem (None when well-formed).

    Well-formed means a JSON array with exactly one object per candidate id. Anything else makes the
    whole batch malformed for this verifier; objects that still match an id are returned so their
    quote_found=false can veto. A batch of one may also answer with a bare object or an id-less array.
    """
    arr = first_verdict_array(text)
    if arr is None or (len(ids) == 1 and len(arr) == 1 and "id" not in arr[0]):
        obj = arr[0] if arr else first_verdict_object(text)
        if len(ids) == 1 and obj is not None:
            if obj.get("id", ids[0]) != ids[0]:
                return {}, f"answer is for id {obj.get('id')!r}, expected {ids[0]}"
            return {ids[0]: obj}, None
        return {}, "no JSON array of per-candidate verdicts found"
    found, problems = {}, []
    for obj in arr:
        cid = obj.get("id")
        if cid not in ids:
            problems.append(f"unknown id {cid!r}")
        elif cid in found:
            problems.append(f"duplicate id {cid}")
            if obj.get("quote_found") is False:  # keep a veto rather than the first answer
                found[cid] = obj
        else:
            found[cid] = obj
    missing = [i for i in ids if i not in found]
    if missing:
        problems.append(f"no verdict for {', '.join(missing)}")
    return found, "; ".join(problems) or None


def combine_pages(cid: str, parts: list[tuple[str, dict | None]], rule_required: bool) -> tuple[str, list[str]]:
    """One verdict text for a candidate from its per-page answers, plus problems that make it malformed.

    One page: the answer as given. Several pages: accept only if every page's answer is a valid accept;
    a check is false if any page says false (so quote_found=false still vetoes), true only if all say true.
    """
    present = [(b, o) for b, o in parts if o is not None]
    problems = [f"{b}: no verdict" for b, o in parts if o is None]
    if not present:
        return "", problems
    if len(parts) == 1:
        return json.dumps(present[0][1], ensure_ascii=False), problems
    parsed = [(b, parse_verdict(json.dumps(o), rule_required)) for b, o in present]
    # An object with no verdict fields (e.g. {"id": "x"}) parses to None: malformed for this page.
    problems += [f"{b}: answer has no verdict fields" for b, v in parsed if v is None]
    parsed = [(b, v) for b, v in parsed if v is not None]
    if not parsed:
        return "", problems
    problems += [f"{b}: {'; '.join(v['problems'])}" for b, v in parsed if v["invalid"]]
    out = {"id": cid}
    for k in BOOL_FIELDS + ((RULE_FIELD,) if rule_required else ()):
        vals = [v[k] for _, v in parsed]
        out[k] = False if False in vals else (True if len(vals) == len(parts) and all(x is True for x in vals) else None)
    ok = not problems and all(v["verdict"] == "accept" for _, v in parsed)
    out["verdict"] = "accept" if ok else "reject"
    out["reason"] = " | ".join(f"{b}: {v['reason']}" for b, v in parsed)[:500]
    out["pages"] = [b for b, _ in parts]
    return json.dumps(out, ensure_ascii=False), problems


# ---------------------------------------------------------------- run: verify candidates in parallel

def load_candidates(path: str) -> list[dict]:
    """Candidates from a JSON file or every *.json in a directory (sorted). A file may hold one candidate,
    a list, or a practices file (its `needs-consensus` practices plus `pending`). Raises ValueError."""
    files = sorted(os.path.join(path, f) for f in os.listdir(path) if f.endswith(".json")) if os.path.isdir(path) else [path]
    out, seen = [], set()
    for f in files:
        with open(f, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and "practices" in data:
            items = [p for p in data["practices"] if p.get("needs-consensus")] + list(data.get("pending") or [])
        else:
            items = data if isinstance(data, list) else [data]
        for c in items:
            cid = c.get("id") if isinstance(c, dict) else None
            if not isinstance(cid, str) or not SAFE_NAME.match(cid):
                raise ValueError(f"{f}: candidate id {cid!r} must be kebab-case letters, digits, . _ -")
            if cid in seen:
                raise ValueError(f"{f}: duplicate candidate id {cid}")
            if not c.get("sources"):
                raise ValueError(f"{f}: candidate {cid} has no sources")
            seen.add(cid)
            out.append(c)
    return out


def candidate_pages(cand: dict, pages_dir: str, sources_dir: str = digests.SOURCES_DIR,
                    fresh: dict[str, str] | None = None) -> tuple[list[dict], list[str]]:
    """Each distinct source page as {slug, basis, path, url}, plus slugs with no page text or digest.

    A page is PAGES/<slug>.txt (live) only when PAGES/manifest.json from this run's
    check_practices.py --save-pages marks it fresh and its hash matches; otherwise, or when the
    candidate has basis "digest", the stored digest is used.
    """
    if fresh is None:
        fresh = digests.fresh_pages(pages_dir)[0]
    pages, missing = [], []
    for src in {s.get("source"): s for s in cand["sources"]}.values():
        slug = src.get("source")
        if not isinstance(slug, str) or not SAFE_NAME.match(slug):
            missing.append(str(slug))
            continue
        live = fresh.get(slug)
        # The saved page must be the page this source cites, not another URL saved under the same slug.
        if cand.get("basis") != "digest" and live and live.get("url") == src.get("url"):
            pages.append({"slug": slug, "basis": "live", "path": live["path"], "url": src.get("url", "")})
        elif os.path.isfile(digests.digest_path(slug, sources_dir)):
            pages.append({"slug": slug, "basis": "digest", "path": digests.digest_path(slug, sources_dir),
                          "url": src.get("url", "")})
        else:
            missing.append(slug)
    return pages, missing


def resolve_verifiers(names: list[str] | None, exclude: tuple[str, ...], overrides: dict[str, str],
                      require_isolation: bool = False) -> tuple[dict[str, str], list[str], dict[str, bool]]:
    """name -> command template, notes for skipped or unisolated verifiers, and name -> isolated.

    A CLI whose --help prints nothing is skipped (flags cannot be checked, so it would run bare).
    One whose help lists no isolation flags runs with isolated=false and a warning, or is skipped
    with require_isolation. A --verifier-cmd override is never known to be isolated.
    """
    if names is None:
        names = detect(exclude) + list(overrides)
    chosen, notes, iso = {}, [], {}
    for n in dict.fromkeys(names):
        if n in exclude:
            notes.append(f"{n}: excluded (proposer)")
            continue
        if not SAFE_NAME.match(n):
            notes.append(f"{n}: invalid verifier name")
            continue
        if n in overrides:
            tpl, ok = overrides[n], False
        elif n not in VERIFIER_SPECS or not shutil.which(n):
            notes.append(f"{n}: not found on PATH")
            continue
        else:
            text = cli_help(n)
            if not text.strip():
                notes.append(f"{n}: `{VERIFIER_SPECS[n]['help']}` printed nothing; detect failed, skipped")
                continue
            tpl = build_command(n, text)
            if tpl is None:
                notes.append(f"{n}: installed version lacks {VERIFIER_SPECS[n]['requires']}; skipped")
                continue
            ok = isolated(n, text)
        if not ok and require_isolation:
            notes.append(f"{n}: no isolation flags (user settings, hooks, MCP); skipped by --require-isolation")
            continue
        if not ok:
            notes.append(f"warning: {n} runs without isolation flags and may load the user's settings, hooks and MCP servers")
        chosen[n], iso[n] = tpl, ok
    return chosen, notes, iso


def run_verifier(template: str, prompt_file: str, out_file: str, timeout: float, turns: int) -> dict:
    """Run one verifier with the prompt on stdin in a fresh temp dir; write stdout to out_file."""
    argv = [a.replace("{prompt_file}", prompt_file).replace("{turns}", str(turns)) for a in shlex.split(template)]
    start, out, err, rc, timed_out = time.monotonic(), b"", b"", None, False
    # A CLI that reads {prompt_file} gets an empty stdin, so the prompt is not sent twice.
    stdin_path = os.devnull if "{prompt_file}" in template else prompt_file
    with tempfile.TemporaryDirectory(prefix="apa-verify-") as cwd, open(stdin_path, "rb") as stdin:
        if git_root(cwd):
            err = f"temp dir {cwd} is inside a git work tree; set TMPDIR elsewhere".encode()
        else:
            try:
                proc = subprocess.Popen(argv, cwd=cwd, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        start_new_session=True)
            except OSError as e:
                err = str(e).encode()
            else:
                try:
                    out, err = proc.communicate(timeout=timeout)
                except subprocess.TimeoutExpired:
                    timed_out = True
                    with contextlib.suppress(OSError):  # the whole process group, so child processes stop too
                        if hasattr(os, "killpg"):
                            os.killpg(proc.pid, signal.SIGKILL)
                        else:
                            proc.kill()
                    with contextlib.suppress(OSError):
                        proc.kill()
                    try:  # bounded: a grandchild in its own session can keep the pipes open forever
                        out, err = proc.communicate(timeout=KILL_GRACE)
                    except subprocess.TimeoutExpired as e:
                        out, err = e.output or b"", e.stderr or b""
                        for pipe in (proc.stdout, proc.stderr):
                            with contextlib.suppress(OSError):
                                pipe.close()
                        with contextlib.suppress(subprocess.TimeoutExpired):
                            proc.wait(timeout=KILL_GRACE)
                rc = proc.returncode
    with open(safe_file_target(out_file), "w", encoding="utf-8") as f:
        f.write(out.decode("utf-8", "replace"))
    stderr = err.decode("utf-8", "replace").strip()
    if stderr:
        with open(safe_file_target(out_file[:-4] + ".stderr.txt"), "w", encoding="utf-8") as f:
            f.write(stderr + "\n")
    run = {"exit": rc, "timedOut": timed_out, "seconds": round(time.monotonic() - start, 1)}
    # `decide` reads this sidecar so saved outputs reproduce run's verdict (a failed call never agrees).
    with open(safe_file_target(status_path(out_file)), "w", encoding="utf-8") as f:
        json.dump(run, f)
    return dict(run, stderrTail=stderr[-300:] if (timed_out or rc != 0) else "")


def status_path(verdict_file: str) -> str:
    return os.path.splitext(verdict_file)[0] + ".status.json"


def verdict_from_run(text: str, run: dict) -> dict | None:
    """parse_verdict, but a timeout, a non-zero exit or a malformed batch answer makes any verdict
    malformed (it can still veto). The run sidecar also says whether the candidate has a rule."""
    v = parse_verdict(text, bool(run.get("ruleRequired")))
    failure = "timed out" if run.get("timedOut") else (None if run.get("exit") == 0 else f"exit {run.get('exit')}")
    extra = ([f"verifier {failure}"] if failure else []) + (
        [f"batch answer malformed: {run['batchProblem']}"] if run.get("batchProblem") else [])
    if v is not None and extra:
        v = dict(v, invalid=True, problems=v["problems"] + extra)
    return v


def run_all(candidates: list[dict], verifiers: dict[str, str], pages_dir: str, out_dir: str,
            jobs: int = 4, timeout: float = 600, turns: int = 3, sources_dir: str = digests.SOURCES_DIR,
            max_calls: int | None = None) -> tuple[list[dict], list[dict]]:
    """Verify every candidate with every verifier, one call per (source page, verifier).

    Returns (one decision record per candidate in input order, one record per batch).
    """
    names = list(verifiers)
    records, batches = [], {}
    fresh, note = digests.fresh_pages(pages_dir)
    if note:
        print(f"note: {note}", file=sys.stderr)
    for c in candidates:
        pages, missing = candidate_pages(c, pages_dir, sources_dir, fresh)
        bases = sorted({p["basis"] for p in pages})
        rec = {"id": c["id"], "basis": bases[0] if len(bases) == 1 else "mixed",
               "sourceBasis": {p["slug"]: p["basis"] for p in pages},
               "dir": safe_output_path(os.path.join(out_dir, c["id"])), "batches": [],
               "ruleRequired": has_rule(c)}
        records.append(rec)
        if missing:
            rec["error"] = f"no page text or digest for source(s): {', '.join(missing)}"
            continue
        if len(names) < MIN_VERIFIERS:
            continue
        for p in pages:
            bt = batches.setdefault((p["slug"], p["path"]), dict(p, cands=[], recs=[]))
            bt["cands"].append(c)
            bt["recs"].append(rec)
            rec["batches"].append(bt)
    order = list(batches.values())
    budget = max_calls
    for n, bt in enumerate(order, 1):
        bt["id"] = f"batch-{n:02d}"
        bt["skipped"] = budget is not None and budget < len(names)
        if not bt["skipped"] and budget is not None:
            budget -= len(names)
    tasks = []
    for bt in order:
        if bt["skipped"]:
            continue
        bdir = safe_output_path(os.path.join(out_dir, BATCH_DIR, bt["id"]))
        os.makedirs(bdir, exist_ok=True)
        with open(bt["path"], encoding="utf-8") as f:
            text = f"=== source {bt['slug']} ({bt['basis']}) {bt['url']} ===\n{f.read().strip()}"
        bt["prompt"] = safe_file_target(os.path.join(bdir, "prompt.txt"))
        with open(bt["prompt"], "w", encoding="utf-8") as f:
            f.write(render_prompt(bt["cands"], text, bt["basis"], slug=bt["slug"]))
        tasks += [(bt, n, os.path.join(bdir, f"v-{n}.txt")) for n in names]
    lock = threading.Lock()

    def one(task):
        bt, n, out_file = task
        run = run_verifier(verifiers[n], bt["prompt"], out_file, timeout, turns)
        with lock:
            status = "timeout" if run["timedOut"] else f"exit {run['exit']}"
            ids = ", ".join(c["id"] for c in bt["cands"])
            print(f"  {bt['id']} {bt['slug']} ({len(bt['cands'])}: {ids}) / {n}: {status}, {run['seconds']}s", file=sys.stderr)
        return run

    if tasks:
        with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
            runs = list(pool.map(one, tasks))
        for (bt, n, out_file), run in zip(tasks, runs):
            with open(out_file, encoding="utf-8") as f:
                found, problem = split_batch(f.read(), [c["id"] for c in bt["cands"]])
            bt.setdefault("runs", {})[n] = run
            bt.setdefault("answers", {})[n] = (found, problem)
    for rec in records:
        skipped = [bt["slug"] for bt in rec["batches"] if bt["skipped"]]
        if skipped:
            rec["error"] = f"not verified: --max-calls {max_calls} spent before source page(s) {', '.join(skipped)}"
        if rec.get("error") or not rec["batches"]:
            rec.update(decide([], []))
            rec["decision"] = "pending-consensus"
            rec["batches"] = [bt.get("id") for bt in rec["batches"]]
            continue
        os.makedirs(rec["dir"], exist_ok=True)
        verdicts = []
        for n in names:
            parts, problems, page_runs = [], [], []
            for bt in rec["batches"]:
                found, problem = bt["answers"][n]
                parts.append((bt["id"], found.get(rec["id"])))
                if problem:
                    problems.append(f"{bt['id']}: {problem}")
                page_runs.append(bt["runs"][n])
            text, more = combine_pages(rec["id"], parts, rec["ruleRequired"])
            problems += more
            run = {"exit": next((r["exit"] for r in page_runs if r["exit"] != 0), 0),
                   "timedOut": any(r["timedOut"] for r in page_runs),
                   "seconds": round(sum(r["seconds"] for r in page_runs), 1),
                   "batches": [bt["id"] for bt in rec["batches"]], "ruleRequired": rec["ruleRequired"]}
            if problems:
                run["batchProblem"] = "; ".join(problems)
            out_file = os.path.join(rec["dir"], f"v-{n}.txt")
            with open(safe_file_target(out_file), "w", encoding="utf-8") as f:
                f.write(text)
            with open(safe_file_target(status_path(out_file)), "w", encoding="utf-8") as f:
                json.dump(run, f)
            rec.setdefault("runs", {})[n] = dict(run, stderrTail=next((r["stderrTail"] for r in page_runs if r["stderrTail"]), ""))
            verdicts.append(verdict_from_run(text, run))
        rec.update(decide(verdicts, names))
        rec["batches"] = [bt["id"] for bt in rec["batches"]]
    batch_records = [{"id": bt["id"], "source": bt["slug"], "basis": bt["basis"], "skipped": bt["skipped"],
                      "candidates": [c["id"] for c in bt["cands"]], "prompt": bt.get("prompt"),
                      "malformed": sorted(n for n, (_, p) in (bt.get("answers") or {}).items() if p)}
                     for bt in order]
    return records, batch_records


def run_main(a) -> int:
    overrides = {}
    for item in a.verifier_cmd or []:
        name, sep, cmd = item.partition("=")
        if not sep or not name or not cmd.strip():
            print(f"error: --verifier-cmd needs NAME=COMMAND (got {item!r})", file=sys.stderr)
            return 2
        overrides[name] = cmd
    exclude = tuple(x for x in a.exclude.split(",") if x)
    names = [x for x in a.verifiers.split(",") if x] if a.verifiers else None
    try:
        out_dir = safe_output_path(a.out)
        candidates = [c for path in a.candidates for c in load_candidates(path)]
        dupes = sorted({c["id"] for c in candidates if sum(x["id"] == c["id"] for x in candidates) > 1})
        if dupes:
            raise ValueError(f"candidate id(s) appear in more than one --candidates file: {', '.join(dupes)}")
    except (UnsafeOutput, ValueError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    verifiers, notes, iso = resolve_verifiers(names, exclude, overrides, a.require_isolation)
    for note in notes:
        print(note if note.startswith("warning:") else f"note: {note}", file=sys.stderr)
    if len(verifiers) < MIN_VERIFIERS:
        print(f"only {len(verifiers)} verifier(s) available; every candidate stays pending-consensus", file=sys.stderr)
    if a.max_calls is not None and a.max_calls < 0:
        print("error: --max-calls must be 0 or more", file=sys.stderr)
        return 2
    print(f"verifying {len(candidates)} candidate(s) with {', '.join(verifiers) or 'no verifiers'} "
          f"(one call per source page and verifier; jobs {a.jobs}, timeout {a.timeout:g}s"
          + (f", max {a.max_calls} calls" if a.max_calls is not None else "") + ")", file=sys.stderr)
    os.makedirs(out_dir, exist_ok=True)
    try:
        records, batches = run_all(candidates, verifiers, a.pages, out_dir, a.jobs, a.timeout, a.turns,
                                   a.sources_dir, a.max_calls)
    except UnsafeOutput as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    calls = sum(len(verifiers) for b in batches if not b["skipped"])
    skipped = [b["source"] for b in batches if b["skipped"]]
    print(f"{len(batches)} page batch(es), {calls} verifier call(s)"
          + (f"; skipped by --max-calls: {', '.join(skipped)}" if skipped else ""), file=sys.stderr)
    with open(safe_file_target(os.path.join(out_dir, "decisions.json")), "w", encoding="utf-8") as f:
        json.dump({"checkedAt": dt.date.today().isoformat(), "verifiers": verifiers,
                   "isolation": {n: {"isolated": iso.get(n, False)} for n in verifiers}, "notes": notes,
                   "batches": batches, "candidates": records}, f, ensure_ascii=False, indent=1)
    for r in records:
        c = r["consensus"]
        extra = r.get("error") or (f"vetoed by {', '.join(r['vetoed_by'])}" if r["vetoed_by"] else "")
        bad = r["invalid"] + r["unusable"]
        extra = "; ".join(x for x in (extra, f"malformed: {', '.join(bad)}" if bad else "") if x)
        print(f"{r['decision']:<18} {r['id']:<34} {c['agree']}/{c['total']}" + (f"  ({extra})" if extra else ""))
    counts = {d: sum(r["decision"] == d for r in records) for d in ("accept", "reject", "pending-consensus")}
    print(", ".join(f"{k}: {v}" for k, v in counts.items()) + f"; details in {os.path.join(out_dir, 'decisions.json')}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("detect")
    d.add_argument("--exclude", default="", help="comma-separated CLIs to skip, e.g. the proposer's own model")
    p = sub.add_parser("prompt")
    p.add_argument("--candidate", required=True)
    p.add_argument("--page", required=True, help="page text (or the digest file when the page is unreachable)")
    p.add_argument("--basis", choices=("live", "digest"), default="live")
    c = sub.add_parser("decide")
    c.add_argument("verdicts", nargs="+", help="raw verifier outputs, one file each")
    c.add_argument("--names", help="comma-separated verifier names in the same order")
    r = sub.add_parser("run", help="verify every candidate with every verifier CLI in parallel and decide")
    r.add_argument("--candidates", required=True, nargs="+", help="candidate JSON files or directories; a practices "
                   "file contributes its needs-consensus practices and pending list")
    r.add_argument("--pages", required=True, help="directory of page text files named <source-slug>.txt; "
                   "a missing file falls back to the digest")
    r.add_argument("--out", required=True, help="output directory outside any repository")
    r.add_argument("--exclude", default="", help="comma-separated verifiers to skip, e.g. the proposer's own model")
    r.add_argument("--verifiers", help="comma-separated verifier names (default: every detected CLI)")
    r.add_argument("--verifier-cmd", action="append", metavar="NAME=CMD",
                   help="use CMD for verifier NAME as given (prompt on stdin; {prompt_file} and {turns} are filled)")
    r.add_argument("--jobs", type=int, default=4, help="verifier calls at once (default 4)")
    r.add_argument("--timeout", type=float, default=600, help="seconds per verifier call (default 600)")
    r.add_argument("--turns", type=int, default=3, help="turn cap for CLIs whose help lists --max-turns (default 3)")
    r.add_argument("--require-isolation", action="store_true",
                   help="skip verifiers whose CLI lists no isolation flags (and every --verifier-cmd override)")
    r.add_argument("--max-calls", type=int, help="total verifier-call budget (page batches x verifiers); "
                   "candidates on pages beyond it stay pending-consensus")
    r.add_argument("--sources-dir", default=digests.SOURCES_DIR)
    a = ap.parse_args(argv)
    if a.cmd == "run":
        return run_main(a)
    if a.cmd == "detect":
        found = detect(tuple(x for x in a.exclude.split(",") if x))
        for n in found:
            text = cli_help(n)
            if not text.strip():
                print(f"{n}\t(detect failed: `{VERIFIER_SPECS[n]['help']}` printed nothing; run skips it)")
                continue
            cmd = build_command(n, text) or VERIFIER_CLIS[n] + "  (unsupported by this version)"
            print(f"{n}\t{cmd}\tisolated={'yes' if isolated(n, text) else 'no'}")
        if len(found) < MIN_VERIFIERS:
            print(f"only {len(found)} verifier(s) available; new candidates stay pending-consensus", file=sys.stderr)
        return 0
    if a.cmd == "prompt":
        with open(a.candidate, encoding="utf-8") as f:
            cand = json.load(f)
        with open(a.page, encoding="utf-8") as f:
            print(render_prompt(cand, f.read(), a.basis))
        return 0
    verdicts = []
    for path in a.verdicts:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if os.path.isfile(status_path(path)):  # written by `run`: a timeout or non-zero exit stays malformed
            with open(status_path(path), encoding="utf-8") as f:
                verdicts.append(verdict_from_run(text, json.load(f)))
        else:
            verdicts.append(parse_verdict(text))
    names = a.names.split(",") if a.names else [os.path.splitext(os.path.basename(p))[0] for p in a.verdicts]
    try:
        result = decide(verdicts, names)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
