#!/usr/bin/env python3
"""Extract per-session behaviour stats from local coding-agent transcripts.

One adapter per host turns a session file into the same row shape, so the
aggregator never needs to know which host wrote it. Read-only: transcripts are
opened for reading and nothing else on disk is touched except the output file.

Usage: extract.py OUT.jsonl [--days 60] [--hosts claude,codex,grok,workbuddy]
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from safe_output import UnsafeOutput, safe_file_target  # noqa: E402

HOME = os.path.expanduser("~")

# Default glob roots per host. Override with AGENT_PRACTICE_AUDIT_<HOST>_GLOBS
# (os.pathsep-separated) or add more under "extraRoots" in config.json.
DEFAULT_GLOBS = {
    "claude": ["~/.claude*/projects/**/*.jsonl"],
    "codex": ["~/.codex*/sessions/**/*.jsonl"],
    # Grok keeps one directory per session; chat_history.jsonl is the unit and
    # events.jsonl / summary.json / signals.json / prompt_context.json are read as sidecars.
    "grok": ["~/.grok*/sessions/**/chat_history.jsonl"],
    "workbuddy": ["~/.workbuddy/projects/*/*.jsonl"],
}
HOSTS = tuple(DEFAULT_GLOBS)

CORRECT = re.compile(
    r"不对|不是这样|错了|搞错|不要这样|别这样|为什么(没|不)|你(又|没)|重新做|重来|撤回|回滚|不是我要|理解错"
    r"|\b(that'?s (wrong|not right)|not what i (asked|wanted|meant)|you (didn'?t|forgot|broke)|try again|start over"
    r"|revert (that|this|it)|undo (that|this))\b",
    re.I,
)
BASH_TAGS = {
    "test": re.compile(r"\b(vitest|jest|pytest|unittest|playwright test|go test|cargo test|(pnpm|npm|yarn|bun)( run)? -?s? ?test)\b"),
    "lint": re.compile(r"\b(eslint|biome|ruff|golangci-lint|clippy|(pnpm|npm|yarn|bun)( run)? -?s? ?lint)\b"),
    "typecheck": re.compile(r"\b(tsc|typecheck|vue-tsc|mypy|pyright)\b"),
    "worktree": re.compile(r"git worktree"),
    "git_diff": re.compile(r"git (diff|show)\b"),
    "commit": re.compile(r"git commit"),
    "headless": re.compile(r"\bclaude\b[^|;&\n]* -p\b|\bclaude -p\b|codex exec|gemini -p\b|grok\b[^|;&\n]* -p\b"),
    "screenshot": re.compile(r"screenshot|screencapture"),
}
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")
CMD = re.compile(r"<command-name>/?([\w:.-]+)</command-name>")
USER_QUERY = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.S)
COMPACT_MARKERS = ("This session is being continued", "<cb_summary>", "<conversation_history_summary>")
# Text Codex injects as role=user messages; everything else in the Desktop fallback is a real prompt,
# including prompts that start with Markdown headings or XML-like tags.
CODEX_INJECTED = ("# AGENTS.md instructions", "<environment_context>", "<user_instructions>", "<INSTRUCTIONS>",
                  "<external_codex_apps_open_page")


def new_row(host: str, path: str) -> dict:
    return dict(host=host, path=path, account=account_of(path, host), kind="human", entry=None, cwd=None,
                start=None, end=None, prompts=0, prompt_chars=0, corrections=0, compactions=0, interrupts=0,
                denials=0, tools=collections.Counter(), cmds=collections.Counter(), efforts=collections.Counter(),
                models=collections.Counter(), modes=collections.Counter(), first=None, corr_examples=[])


def account_of(path: str, host: str) -> str:
    """The per-account root directory name (e.g. `.claude`, `.codex-2`), or `custom` for overridden roots."""
    prefix = "." + host
    for part in path.split(os.sep):
        if part.startswith(prefix):
            return part
    return "custom"


def iso(ts) -> str | None:
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        secs = ts / 1000 if ts > 1e11 else ts
        return datetime.fromtimestamp(secs, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    return str(ts)


def stamp(r: dict, ts) -> None:
    ts = iso(ts)
    if ts:
        r["start"] = r["start"] or ts
        r["end"] = ts


def epoch(ts) -> float | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def in_window(r: dict, cutoff: float) -> bool:
    """A session belongs to the window when its last event is on or after the cutoff.

    File mtime only pre-filters: a resume, sync or copy touches the file without new events.
    A session that started before the cutoff and ran into it is kept and marked spansCutoff,
    so its totals include some turns from before the window. Without timestamps the mtime
    pre-filter stands.
    """
    end = epoch(r.get("end"))
    if end is None:
        return True
    if end < cutoff:
        return False
    start = epoch(r.get("start"))
    if start is not None and start < cutoff:
        r["spansCutoff"] = True
    return True


def tag_cmd(r: dict, cmd: str) -> None:
    for k, rx in BASH_TAGS.items():
        if rx.search(cmd):
            r["tools"]["bash:" + k] += 1


def add_prompt(r: dict, s: str) -> None:
    r["prompts"] += 1
    r["prompt_chars"] += len(s)
    r["first"] = r["first"] or s[:160]
    if CORRECT.search(s[:400]):
        r["corrections"] += 1
        if len(r["corr_examples"]) < 3:
            r["corr_examples"].append(s[:160])


def tool_call(r: dict, name: str, args) -> None:
    """Count one tool call; tag shell commands and image reads."""
    r["tools"][name] += 1
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = {"command": args}
    args = args if isinstance(args, dict) else {}
    if name in ("Skill",):
        r["tools"]["Skill:" + str(args.get("skill", ""))[:40]] += 1
    if name in ("Agent", "Task"):
        r["tools"]["Agent:" + str(args.get("subagent_type", "general"))[:30]] += 1
    cmd = args.get("command") or args.get("cmd") or args.get("input")
    if isinstance(cmd, list):
        cmd = " ".join(map(str, cmd))
    if isinstance(cmd, str) and cmd:
        tag_cmd(r, cmd[:2000])
    target = str(args.get("file_path") or args.get("path") or args.get("target_file") or "").lower()
    if "screenshot" in name.lower() or target.endswith(IMAGE_EXT):
        r["tools"]["bash:screenshot"] += 1


# ---------------------------------------------------------------- Claude Code

CLAUDE_HUMAN = ("cli", "claude-vscode", "claude-desktop")


def claude_human_text(content) -> str | None:
    """Text the human typed in a Claude user entry, or None for tool results / injected context."""
    if isinstance(content, str):
        s = content
    elif isinstance(content, list):
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        if not parts or any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return None
        s = "\n".join(parts)
    else:
        return None
    s = s.strip()
    if not s or s.startswith(("<system-reminder>", "<local-command-stdout>", "Caveat:")):
        return None
    return s


def claude(path: str) -> dict:
    r = new_row("claude", path)
    sidechain = "/subagents/" in path
    with open(path, "rb") as f:
        for raw in f:
            if raw.startswith(b'{"type":"') and not raw.startswith((b'{"type":"user"', b'{"type":"assistant"', b'{"type":"system"')):
                if raw.startswith((b'{"type":"mode"', b'{"type":"permission-mode"')):
                    try:
                        d = json.loads(raw)
                    except ValueError:  # truncated line: skip it, keep the session
                        continue
                    r["modes"][d.get("mode") or d.get("permissionMode")] += 1
                continue
            try:
                d = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            t = d.get("type")
            if t in ("mode", "permission-mode"):
                r["modes"][d.get("mode") or d.get("permissionMode")] += 1
                continue
            if t not in ("user", "assistant", "system"):
                continue
            stamp(r, d.get("timestamp"))
            sidechain = sidechain or bool(d.get("isSidechain"))
            r["entry"] = r["entry"] or d.get("entrypoint")
            r["cwd"] = r["cwd"] or d.get("cwd")
            if d.get("permissionMode") and d["permissionMode"] not in r["modes"]:
                r["modes"][d["permissionMode"]] += 1
            if t == "system":
                if d.get("subtype") in ("compact_boundary", "microcompact_boundary"):
                    r["compactions"] += 1
                continue
            msg = d.get("message") or {}
            if t == "assistant":
                if d.get("effort"):
                    r["efforts"][d["effort"]] += 1
                if msg.get("model") and msg["model"] != "<synthetic>":
                    r["models"][msg["model"]] += 1
                for b in msg.get("content") or []:
                    if isinstance(b, dict) and b.get("type") == "tool_use":
                        tool_call(r, b.get("name", ""), b.get("input") or {})
                continue
            if d.get("isCompactSummary"):
                continue
            c = msg.get("content")
            if isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        txt = json.dumps(b.get("content"), ensure_ascii=False)[:300]
                        if "user doesn't want to proceed" in txt or ("permission" in txt and "denied" in txt):
                            r["denials"] += 1
            s = claude_human_text(c)
            if s is None:
                continue
            if "[Request interrupted by user" in s:
                r["interrupts"] += 1
                continue
            m = CMD.search(s)
            if m:
                r["cmds"][m.group(1)] += 1
                continue
            add_prompt(r, s)
    r["kind"] = "subagent" if sidechain else ("human" if r["entry"] in CLAUDE_HUMAN else "headless")
    return r


# ---------------------------------------------------------------- Codex

CODEX_HUMAN = ("codex-tui", "codex_cli_rs", "codex_vscode", "Codex Desktop", "codex_work_desktop")


def codex(path: str) -> dict:
    r = new_row("codex", path)
    subagent = False
    fallback = []
    with open(path, "rb") as f:
        for raw in f:
            head = raw[:200]
            if not any(k in head for k in (b"session_meta", b"turn_context", b"event_msg", b"response_item", b"compacted")):
                continue
            try:
                d = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            t = d.get("type")
            p = d.get("payload") if isinstance(d.get("payload"), dict) else {}
            stamp(r, d.get("timestamp"))
            if t == "session_meta":
                r["entry"] = p.get("originator")
                r["cwd"] = p.get("cwd")
                subagent = p.get("thread_source") not in (None, "user")
            elif t == "turn_context":
                if p.get("effort"):
                    r["efforts"][p["effort"]] += 1
                if p.get("model"):
                    r["models"][p["model"]] += 1
                sp = p.get("sandbox_policy")
                sandbox = sp.get("type") if isinstance(sp, dict) else sp
                r["modes"][f"approval={p.get('approval_policy')}"] += 1
                r["modes"][f"sandbox={sandbox}"] += 1
            elif t == "compacted":
                r["compactions"] += 1
            elif t == "event_msg":
                pt = p.get("type")
                if pt == "user_message":
                    s = str(p.get("message") or "").strip()
                    if s:
                        add_prompt(r, s)
                elif pt == "turn_aborted":
                    r["interrupts"] += 1
                elif pt == "context_compacted":
                    r["compactions"] += 1
            elif t == "response_item" and p.get("type") in ("function_call", "custom_tool_call", "local_shell_call"):
                tool_call(r, p.get("name") or p.get("type", ""), p.get("arguments") or p.get("input") or p.get("action") or "")
            elif t == "response_item" and p.get("type") == "message" and p.get("role") == "user":
                txt = "\n".join(b.get("text", "") for b in p.get("content") or [] if isinstance(b, dict)).strip()
                if txt and not txt.startswith(CODEX_INJECTED):
                    fallback.append(txt)
    if r["prompts"] == 0:
        # Newer Codex Desktop builds log user input only as response_item messages with role user.
        for s in fallback:
            add_prompt(r, s)
    r["kind"] = "subagent" if subagent else ("human" if r["entry"] in CODEX_HUMAN else "headless")
    return r


# ---------------------------------------------------------------- Grok

def read_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def user_query_text(text: str) -> str | None:
    """Human text wrapped in <user_query> (Grok, WorkBuddy); None when the entry is only injected context."""
    parts = [m.strip() for m in USER_QUERY.findall(text)]
    s = "\n".join(p for p in parts if p)
    return s or None


def grok(path: str) -> dict:
    r = new_row("grok", path)
    d = os.path.dirname(path)
    summary = read_json(os.path.join(d, "summary.json"))
    ctx = read_json(os.path.join(d, "prompt_context.json"))
    signals = read_json(os.path.join(d, "signals.json"))
    r["cwd"] = (summary.get("info") or {}).get("cwd") or ctx.get("working_directory")
    stamp(r, summary.get("created_at"))
    compactions = 0
    with open(path, "rb") as f:
        for raw in f:
            try:
                x = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(x, dict):
                continue
            t = x.get("type")
            if t == "assistant":
                if x.get("model_id"):
                    r["models"][x["model_id"]] += 1
                if x.get("reasoning_effort"):
                    r["efforts"][x["reasoning_effort"]] += 1
                for tc in x.get("tool_calls") or []:
                    if isinstance(tc, dict):
                        tool_call(r, tc.get("name", ""), tc.get("arguments") or "")
            elif t == "user":
                c = x.get("content")
                text = "".join(b.get("text", "") for b in c if isinstance(b, dict)) if isinstance(c, list) else str(c or "")
                if text.lstrip().startswith(COMPACT_MARKERS):
                    compactions += 1
                    continue
                s = user_query_text(text)
                if s:
                    add_prompt(r, s)
    relationship = None
    events = os.path.join(d, "events.jsonl")
    if os.path.exists(events):
        with open(events, "rb") as f:
            for raw in f:
                if b'"phase_changed"' in raw[:80]:
                    continue
                try:
                    e = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(e, dict):
                    continue
                et = e.get("type")
                if et in ("turn_started", "turn_ended", "tool_started"):
                    stamp(r, e.get("ts"))
                if et == "turn_started":
                    relationship = relationship or e.get("session_relationship")
                    r["modes"]["yolo" if e.get("yolo_mode") else "ask"] += 1
                elif et == "permission_resolved" and e.get("decision") == "deny":
                    r["denials"] += 1
                elif et == "turn_ended" and e.get("outcome") in ("cancelled", "canceled", "interrupted"):
                    r["interrupts"] += 1
    stamp(r, summary.get("last_active_at"))
    if summary.get("sandbox_profile"):
        r["modes"]["sandbox=" + str(summary["sandbox_profile"])] += 1
    if summary.get("reasoning_effort") and not r["efforts"]:
        r["efforts"][summary["reasoning_effort"]] += 1
    r["compactions"] = max(compactions, int(signals.get("compactionCount") or 0))
    r["interrupts"] = max(r["interrupts"], int(signals.get("cancellationCount") or 0))
    r["entry"] = summary.get("session_kind") or ("non-interactive" if ctx.get("is_non_interactive") else "interactive")
    headless = summary.get("session_kind") == "headless" or bool(ctx.get("is_non_interactive"))
    if relationship not in (None, "primary"):
        r["kind"] = "subagent"
    else:
        r["kind"] = "headless" if headless else "human"
    return r


# ---------------------------------------------------------------- WorkBuddy

AUTOMATION_TOOLS = ("send_automation_result", "automation_update")


def workbuddy(path: str) -> dict:
    r = new_row("workbuddy", path)
    with open(path, "rb") as f:
        for raw in f:
            try:
                x = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(x, dict):
                continue
            t = x.get("type")
            stamp(r, x.get("timestamp"))
            r["cwd"] = r["cwd"] or x.get("cwd")
            if t == "session-meta":
                meta = x.get("meta") or {}
                r["entry"] = r["entry"] or meta.get("codebuddy.ai/hostKind")
            elif t == "function_call":
                model = (x.get("providerData") or {}).get("model")
                if model:
                    r["models"][model] += 1
                tool_call(r, x.get("name", ""), x.get("arguments") or "")
            elif t == "function_call_result" and x.get("status") in ("cancelled", "canceled", "rejected", "denied"):
                r["denials" if x.get("status") in ("rejected", "denied") else "interrupts"] += 1
            elif t == "message" and x.get("role") == "user":
                c = x.get("content")
                blocks = c if isinstance(c, list) else [{"type": "input_text", "text": str(c or "")}]
                text = "\n".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "input_text")
                if any(m in text for m in COMPACT_MARKERS):
                    r["compactions"] += 1
                    continue
                s = user_query_text(text)
                if s:
                    add_prompt(r, s)
    r["kind"] = "headless" if any(r["tools"].get(n) for n in AUTOMATION_TOOLS) else "human"
    return r


ADAPTERS = {"claude": claude, "codex": codex, "grok": grok, "workbuddy": workbuddy}


def work(item: tuple[str, str]) -> dict:
    host, path = item
    try:
        return ADAPTERS[host](path)
    except Exception as e:  # one unreadable file must not stop the run
        return {"host": host, "path": path, "error": f"{type(e).__name__}: {e}"}


# ---------------------------------------------------------------- discovery

def load_config() -> dict:
    base = os.environ.get("AGENT_PRACTICE_AUDIT_DIR") or os.path.join(HOME, ".local", "share", "agent-practice-audit")
    return read_json(os.path.join(os.path.expanduser(base), "config.json"))


def globs_for(host: str, config: dict | None = None) -> list[str]:
    env = os.environ.get(f"AGENT_PRACTICE_AUDIT_{host.upper()}_GLOBS")
    pats = env.split(os.pathsep) if env else list(DEFAULT_GLOBS[host])
    extra = ((config or {}).get("extraRoots") or {}).get(host) or []
    return [os.path.expanduser(p) for p in pats + list(extra) if p]


def discover(hosts, cutoff: float, config: dict | None = None) -> tuple[list[tuple[str, str]], dict]:
    """Return ([(host, path)], {host: {"globs", "found", "files"}}). A host with no matching root is 'not found'."""
    items, report = [], {}
    for host in hosts:
        pats = globs_for(host, config)
        found, n = False, 0
        seen = set()
        for pat in pats:
            for p in glob.glob(pat, recursive=True):
                found = True
                try:
                    real = os.path.realpath(p)
                    if real not in seen and os.path.isfile(p) and os.path.getmtime(p) >= cutoff:
                        seen.add(real)
                        items.append((host, p))
                        n += 1
                except OSError:
                    pass
        report[host] = {"globs": [p.replace(HOME, "~", 1) for p in pats], "found": found, "files": n}
    return items, report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out", help="output JSONL path (keep it outside any repository)")
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--hosts", default=",".join(HOSTS), help="comma-separated subset of: " + ",".join(HOSTS))
    ap.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 4) - 2))
    a = ap.parse_args(argv)
    hosts = [h for h in a.hosts.split(",") if h]
    unknown = [h for h in hosts if h not in ADAPTERS]
    if unknown:
        ap.error(f"unknown host(s): {', '.join(unknown)}; choose from {', '.join(HOSTS)}")
    try:
        a.out = safe_file_target(a.out)
    except UnsafeOutput as e:
        ap.error(str(e))
    cutoff = time.time() - a.days * 86400
    items, report = discover(hosts, cutoff, load_config())
    counts = {h: collections.Counter() for h in hosts}
    with Pool(a.workers) as pool, open(a.out, "w", encoding="utf-8") as o:
        for r in pool.imap_unordered(work, items, chunksize=8):
            if "error" not in r and not in_window(r, cutoff):
                counts[r["host"]]["outside"] += 1
                continue
            counts[r["host"]]["spans"] += bool(r.get("spansCutoff"))
            o.write(json.dumps(r, ensure_ascii=False, default=dict) + "\n")
            counts[r["host"]]["error" if "error" in r else r["kind"]] += 1
    print(f"window: last {a.days} days -> {a.out}")
    for h in hosts:
        info = report[h]
        if not info["found"]:
            print(f"{h:<10} not found ({', '.join(info['globs'])})")
            continue
        c = counts[h]
        print(f"{h:<10} files={info['files']:<6} human={c['human']:<5} headless={c['headless']:<5} "
              f"subagent={c['subagent']:<5} errors={c['error']} "
              f"dropped-outside-window={c['outside']} spans-window-start={c['spans']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
