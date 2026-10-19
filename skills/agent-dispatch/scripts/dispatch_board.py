#!/usr/bin/env python3
"""Run ledger and Board for agent-dispatch.

Only the Coordinator writes the ledger (through this script). Live activity is
derived from each Worker's event stream (Claude stream-json, Codex exec --json,
Grok streaming-json) and, in Orca mode, from `orca orchestration worker-list`.

Usage (see references/run-board.md):
  dispatch_board.py init --objective TEXT [--orca-run RUN_ID]
  dispatch_board.py lane add --id B9 --title "B9 卡片" --role write --account claude:003 --pool claude:003 --output PATH [--after ID,ID]
  dispatch_board.py lane set --id B9 --state done
  dispatch_board.py wait add --id deploy --title "部署 test" --log PATH --stage "web 构建中"
  dispatch_board.py ask add --id A1 --question Q --recommend R --evidence E --blocks B
  dispatch_board.py ask answer --id A1 --answer TEXT
  dispatch_board.py grant add --scope S --words W [--outward]
  dispatch_board.py show [--line] [--html] [--watch SECONDS] [--all]
  dispatch_board.py open        # opens the Board for the user (Orca tab or system browser)
  dispatch_board.py close

Layout under <base> (<repo>/.agent-dispatch or ~/.local/state/agent-dispatch):
  runs/<id>/run.json   active ledgers      archive/<id>/   closed Runs
  boards/<id>.html     the HTML Board; its path survives close
A STOP file in the Run directory pauses dispatch: new Lanes are refused and the Board says so,
while the watcher keeps showing what is still running until the Coordinator stops it.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import html
import re
import json
import os
import shutil
import subprocess
import sys
import time

try:
    import fcntl
except ImportError:  # Windows
    fcntl = None
    import msvcrt

STALE_SECONDS = 300
LANE_STATES = ("queued", "working", "needs-you", "done", "failed", "stopped")
WAIT_STATES = ("running", "done", "failed", "stopped")
ACTIVE_LANE_STATES = ("queued", "working", "needs-you")
LEDGER = "run.json"
STOP = "STOP"
TAIL_BYTES = 4_000_000
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
DIR_NAME = ".agent-dispatch"
STATE_LABELS = {
    "queued": "排队",
    "working": "进行中",
    "needs-you": "等你",
    "done": "完成",
    "failed": "失败",
    "stopped": "已停止",
    "running": "进行中",
}


class BoardError(Exception):
    """A usage error whose message says how to fix it."""


# ---------- locations ----------


def state_dir() -> str:
    return os.environ.get("AGENT_DISPATCH_STATE_DIR") or os.path.expanduser("~/.local/state/agent-dispatch")


def git(cwd: str, *args: str) -> str | None:
    try:
        out = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def ensure_exclude(toplevel: str) -> None:
    """Add /.agent-dispatch/ to $GIT_COMMON_DIR/info/exclude (never .gitignore)."""
    common = git(toplevel, "rev-parse", "--git-common-dir")
    if not common:
        return
    if not os.path.isabs(common):
        common = os.path.join(toplevel, common)
    path = os.path.join(common, "info", "exclude")
    line = f"/{DIR_NAME}/"
    existing = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            existing = f.read()
    if line in existing.splitlines():
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        if existing and not existing.endswith("\n"):
            f.write("\n")
        f.write(line + "\n")


def base_dir(cwd: str) -> str:
    toplevel = git(cwd, "rev-parse", "--show-toplevel")
    if toplevel:
        ensure_exclude(toplevel)
        return os.path.join(toplevel, DIR_NAME)
    return state_dir()


def atomic_write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def now_iso(now: float | None = None) -> str:
    return dt.datetime.fromtimestamp(now if now is not None else time.time(), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc).timestamp()
    except ValueError:
        return None


# ---------- registry ----------


def registry_path() -> str:
    return os.path.join(state_dir(), "runs.json")


def load_registry() -> list[dict]:
    try:
        with open(registry_path(), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def save_registry(rows: list[dict]) -> None:
    atomic_write(registry_path(), json.dumps(rows, ensure_ascii=False, indent=2) + "\n")


@contextlib.contextmanager
def registry_lock():
    """Several Coordinators share one registry; serialize its read-modify-write."""
    os.makedirs(state_dir(), exist_ok=True)
    with open(registry_path() + ".lock", "a+b") as lock:
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX)
        else:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        try:
            yield
        finally:
            if fcntl:
                fcntl.flock(lock, fcntl.LOCK_UN)
            else:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def register(run: dict, run_dir: str, old_dir: str | None = None) -> None:
    drop = {os.path.realpath(d) for d in (run_dir, old_dir) if d}
    with registry_lock():
        rows = [r for r in load_registry() if os.path.realpath(r.get("dir") or "") not in drop]
        rows.append({"id": run["id"], "dir": run_dir, "objective": run["objective"], "state": run["state"]})
        save_registry(rows)


# ---------- ledger ----------


def load_run(run_dir: str) -> dict:
    path = os.path.join(run_dir, LEDGER)
    try:
        with open(path, encoding="utf-8") as f:
            run = json.load(f)
            run["_dir"] = os.path.abspath(run_dir)  # relative event paths resolve against the ledger, not the cwd
            return run
    except OSError as exc:
        raise BoardError(f"no ledger at {path}; run `dispatch_board.py init --objective ...` first or pass --run <dir>") from exc
    except ValueError as exc:
        raise BoardError(f"ledger {path} is not valid JSON ({exc}); restore it from the last good copy or start a new Run") from exc


def base_of(run_dir: str) -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(run_dir)))


def board_path(run_dir: str) -> str:
    return os.path.join(base_of(run_dir), "boards", os.path.basename(os.path.abspath(run_dir)) + ".html")


def archive_of(run_dir: str) -> str:
    return os.path.join(base_of(run_dir), "archive", os.path.basename(os.path.abspath(run_dir)))


def stopped(run_dir: str) -> bool:
    return os.path.exists(os.path.join(run_dir, STOP))


def save_run(run_dir: str, run: dict, now: float | None = None) -> None:
    run["updated_at"] = now_iso(now)
    stored = {k: v for k, v in run.items() if k != "_dir"}
    atomic_write(os.path.join(run_dir, LEDGER), json.dumps(stored, ensure_ascii=False, indent=2) + "\n")


def resolve_run_dir(explicit: str | None, cwd: str) -> str:
    if explicit:
        return explicit
    env = os.environ.get("AGENT_DISPATCH_RUN")
    if env:
        return env
    runs = os.path.join(base_dir(cwd), "runs")
    active = []
    if os.path.isdir(runs):
        for name in os.listdir(runs):
            path = os.path.join(runs, name)
            if os.path.exists(os.path.join(path, LEDGER)):
                active.append(path)
    if len(active) == 1:
        return active[0]
    if not active:
        raise BoardError(f"no active Run under {runs}; run `dispatch_board.py init --objective ...` first")
    raise BoardError(f"{len(active)} active Runs under {runs}; pass --run <dir> or set AGENT_DISPATCH_RUN")


def init_run(objective: str, cwd: str, run_id: str | None = None, orca_run: str | None = None, account: str | None = None, now: float | None = None) -> str:
    stamp = dt.datetime.fromtimestamp(now if now is not None else time.time()).strftime("%Y%m%d-%H%M%S")
    rid = run_id or f"{stamp}-{os.urandom(2).hex()}"
    if not RUN_ID_RE.match(rid):
        raise BoardError(f"Run id {rid!r} must be 1-64 letters, digits, '.', '_' or '-', starting with a letter or digit")
    base = base_dir(cwd)
    run_dir = os.path.join(base, "runs", rid)
    for taken in (run_dir, os.path.join(base, "archive", rid)):
        if os.path.exists(taken):
            raise BoardError(f"Run id {rid} is already used at {taken}; pick another --run-id")
    run = {
        "version": 1,
        "id": rid,
        "objective": objective,
        "state": "active",
        "created_at": now_iso(now),
        "orca_run": orca_run,
        "coordinator": account,
        "lanes": [],
        "waits": [],
        "asks": [],
        "grants": [],
    }
    save_run(run_dir, run, now)
    register(run, run_dir)
    return run_dir


def find(rows: list[dict], key: str, kind: str) -> dict:
    for row in rows:
        if row.get("id") == key:
            return row
    raise BoardError(f"no {kind} with id {key}; list them with `dispatch_board.py show`")


PATH_FIELDS = ("output", "log", "worktree")


def apply_fields(row: dict, fields: dict) -> None:
    for key, value in fields.items():
        if value is None:
            continue
        if key in PATH_FIELDS and value:
            value = os.path.abspath(os.path.expanduser(value))  # the viewer may run from another directory
        if key == "after" and isinstance(value, str):
            value = [v.strip() for v in value.split(",") if v.strip()]
        row[key] = value


def add_lane(run: dict, fields: dict, now: float | None = None, run_dir: str | None = None) -> dict:
    if run_dir and stopped(run_dir):
        raise BoardError(f"{os.path.join(run_dir, STOP)} exists: the Run is stopping, so no new Lane may start; delete the file to resume")
    if not fields.get("id"):
        raise BoardError("a Lane needs a non-empty --id")
    if any(w["id"] == fields["id"] for w in run["waits"]):
        raise BoardError(f"{fields['id']} is already a Wait; Lane and Wait ids share one namespace so --after stays unambiguous")
    if any(lane["id"] == fields["id"] for lane in run["lanes"]):
        raise BoardError(f"Lane {fields['id']} exists; use `lane set --id {fields['id']}` to change it")
    state = fields.get("state") or "queued"
    if state not in LANE_STATES:
        raise BoardError(f"unknown Lane state {state}; use one of {', '.join(LANE_STATES)}")
    if fields.get("kind") == "subagent" and not fields.get("parent"):
        raise BoardError("a Subagent needs --parent <lane id or 'coordinator'>")
    lane = {"kind": "lane", "round": 1, "started_at": now_iso(now)}
    apply_fields(lane, fields)
    lane["state"] = state
    lane["updated_at"] = now_iso(now)
    run["lanes"].append(lane)
    return lane


def set_lane(run: dict, key: str, fields: dict, now: float | None = None) -> dict:
    lane = find(run["lanes"], key, "Lane")
    if fields.get("state") and fields["state"] not in LANE_STATES:
        raise BoardError(f"unknown Lane state {fields['state']}; use one of {', '.join(LANE_STATES)}")
    apply_fields(lane, fields)
    lane["updated_at"] = now_iso(now)
    return lane


def add_wait(run: dict, fields: dict, now: float | None = None) -> dict:
    if not fields.get("id"):
        raise BoardError("a Wait needs a non-empty --id")
    if any(lane["id"] == fields["id"] for lane in run["lanes"]):
        raise BoardError(f"{fields['id']} is already a Lane; Lane and Wait ids share one namespace so --after stays unambiguous")
    if any(w["id"] == fields["id"] for w in run["waits"]):
        raise BoardError(f"Wait {fields['id']} exists; use `wait set --id {fields['id']}`")
    wait = {"state": "running", "started_at": now_iso(now)}
    apply_fields(wait, fields)
    wait["updated_at"] = now_iso(now)
    run["waits"].append(wait)
    return wait


def set_wait(run: dict, key: str, fields: dict, now: float | None = None) -> dict:
    wait = find(run["waits"], key, "Wait")
    if fields.get("state") and fields["state"] not in WAIT_STATES:
        raise BoardError(f"unknown Wait state {fields['state']}; use one of {', '.join(WAIT_STATES)}")
    apply_fields(wait, fields)
    wait["updated_at"] = now_iso(now)
    return wait


def add_ask(run: dict, fields: dict, now: float | None = None) -> dict:
    missing = [k for k in ("question", "recommend", "evidence", "blocks") if not fields.get(k)]
    if fields.get("outward"):
        missing += [k for k in ("recipient", "channel", "draft") if not fields.get(k)]
    if missing:
        flags = " ".join(f"--{k}" for k in missing)
        raise BoardError(f"an Ask needs {flags}: the user must see the recommendation, the evidence, what it blocks, and for outward actions the recipient, channel and full draft")
    if any(a["id"] == fields["id"] for a in run["asks"]):
        raise BoardError(f"Ask {fields['id']} exists; answer it with `ask answer --id {fields['id']}`")
    ask = {"state": "open", "asked_at": now_iso(now)}
    apply_fields(ask, fields)
    run["asks"].append(ask)
    return ask


def answer_ask(run: dict, key: str, answer: str, now: float | None = None) -> dict:
    ask = find(run["asks"], key, "Ask")
    ask.update({"state": "answered", "answer": answer, "answered_at": now_iso(now)})
    return ask


def add_grant(run: dict, scope: str, words: str, outward: bool, now: float | None = None) -> dict:
    if not scope or not words:
        raise BoardError("a Standing Grant needs --scope (exactly what it covers) and --words (the user's own words)")
    grant = {
        "id": f"G{len(run['grants']) + 1}",
        "scope": scope,
        "words": words,
        "outward": outward,
        "lasts": "this Run" if outward else "until the user withdraws it",
        "at": now_iso(now),
    }
    run["grants"].append(grant)
    return grant


def close_run(run_dir: str, run: dict, now: float | None = None) -> str:
    archive = archive_of(run_dir)
    if os.path.exists(archive):
        raise BoardError(f"{archive} already exists; move it away before closing this Run")
    run["state"] = "closed"
    old = os.path.abspath(run_dir) + os.sep
    for row in run["lanes"] + run["waits"]:  # event files kept in the Run directory move with it
        for key in PATH_FIELDS:
            value = row.get(key)
            if isinstance(value, str) and value.startswith(old):
                row[key] = os.path.join(archive, value[len(old):])
    save_run(run_dir, run, now)
    os.makedirs(os.path.dirname(archive), exist_ok=True)
    shutil.move(run_dir, archive)
    register(run, archive, old_dir=run_dir)
    write_closed_board(archive, board_path(run_dir))
    return archive


def write_closed_board(archive: str, board: str) -> None:
    """Leave a final page at the Board path so an open tab shows the Run as closed."""
    if os.path.exists(board):
        view = derive(load_run(archive))
        view["archive"] = archive
        atomic_write(board, render_html(view, refresh=0))


# ---------- event streams ----------


def raw_line_before(f, end: int, limit: int = 64_000_000) -> tuple[int, bytes]:
    """The line ending at byte `end` (trailing newlines skipped), read backwards in full up to limit."""
    while end > 0:
        f.seek(end - 1)
        if f.read(1) not in (b"\n", b"\r"):
            break
        end -= 1
    start, chunk = end, 65536
    while start > 0 and end - start < limit:
        step = min(chunk, start)
        f.seek(start - step)
        cut = f.read(step).rfind(b"\n")
        if cut >= 0:
            start = start - step + cut + 1
            break
        start -= step
    f.seek(start)
    return start, f.read(end - start)


def last_event_line(f, size: int, max_lines: int = 50) -> bytes:
    """The last line that parses as a JSON object, skipping trailing blanks and diagnostics."""
    end = size
    for _ in range(max_lines):
        if end <= 0:
            break
        start, line = raw_line_before(f, end)
        try:
            if isinstance(json.loads(line.decode("utf-8", errors="replace")), dict):
                return line
        except ValueError:
            pass
        end = start
    return b""


def read_tail(path: str, max_bytes: int = TAIL_BYTES) -> list[dict]:
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - max_bytes))
            raw = f.read()
            if size > max_bytes:
                raw = raw[raw.find(b"\n") + 1:] if b"\n" in raw else b""  # drop the cut first line
                last = last_event_line(f, size)
                if last and last.strip() not in raw:
                    raw = raw + b"\n" + last
    except OSError:
        return []
    data = raw.decode("utf-8", errors="replace")
    events = []
    for line in data.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if isinstance(ev, dict):
            events.append(ev)
    return events


def short(text: object, limit: int = 60) -> str:
    """First meaningful line as plain text: Markdown tables, bullets and emphasis are dropped."""
    lines = [l.strip() for l in str(text or "").splitlines()]
    line = next((l for l in lines if l and not l.startswith("|") and set(l) - set("-|: ")), "")
    value = " ".join(line.replace("**", "").replace("`", "").lstrip("#>-* ").split())
    return value if len(value) <= limit else value[: limit - 1] + "…"


def last_line(path: str | None, max_bytes: int = 8192) -> str | None:
    if not path:
        return None
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - max_bytes))
            lines = [l.strip() for l in f.read().decode("utf-8", errors="replace").splitlines() if l.strip()]
    except OSError:
        return None
    return short(lines[-1], 80) if lines else None


def short_path(path: str, limit: int = 50) -> str:
    """At most `limit` characters, always ending with the whole file name; the parent is cut from the left."""
    path = str(path).rstrip("/")
    if len(path) <= limit:
        return path
    parent, _, name = path.rpartition("/")
    if len(name) + 1 >= limit:
        return "…" + name[-(limit - 1):]
    room = limit - len(name) - 2  # "…" and "/"
    return "…" + parent[-room:] + "/" + name if room > 0 else "…/" + name


def tail_path(path: str | None) -> str:
    if not path:
        return "-"
    parts = path.rstrip("/").split("/")
    return path if len(parts) <= 3 else "…/" + "/".join(parts[-2:])


def local_time(now: float | None = None) -> str:
    return dt.datetime.fromtimestamp(now if now is not None else time.time()).strftime("%H:%M:%S")


def as_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def summarize_events(events: list[dict]) -> dict:
    """Return {activity, ended, failed, subagents, cost} from any supported stream.

    A later event that shows new work (a resumed session appending to the same file)
    clears an earlier end, so a resumed Lane is not reported as finished.
    """
    info = {"activity": None, "ended": False, "failed": False, "subagents": [], "cost": None}
    grok_text: list[str] = []

    def working(activity: str) -> None:
        info["activity"] = activity
        info["ended"] = False
        info["failed"] = False

    for ev in events:
        etype = ev.get("type")
        # Claude stream-json
        if etype == "assistant":
            content = as_dict(ev.get("message")).get("content")
            for part in content if isinstance(content, list) else []:
                part = as_dict(part)
                if part.get("type") == "tool_use":
                    name = str(part.get("name") or "tool")
                    inp = as_dict(part.get("input"))
                    if name in ("Task", "Agent"):
                        info["subagents"].append(str(inp.get("subagent_type") or "subagent"))
                    path = inp.get("file_path")
                    text = inp.get("description") or inp.get("command")
                    if text or not path:
                        detail = short(text or inp.get("pattern") or "", 50)
                    else:
                        detail = short_path(path)  # not passed through short(): its tail cut would drop the file name
                    working(f"{name}: {detail}" if detail else name)
                elif part.get("type") == "text" and part.get("text"):
                    working(f"说：{short(part['text'], 50)}")
        elif etype == "result" and ("subtype" in ev or "is_error" in ev):
            info["ended"] = True
            info["failed"] = bool(ev.get("is_error")) or ev.get("subtype") not in (None, "success")
            cost = ev.get("total_cost_usd")
            info["cost"] = cost if isinstance(cost, (int, float)) else None
        # Codex exec --json (item.type; pre-0.44 used item_type and assistant_message)
        elif etype in ("item.started", "item.completed", "item.updated"):
            item = as_dict(ev.get("item"))
            itype = item.get("type") or item.get("item_type")
            if itype == "command_execution":
                working(f"命令: {short(item.get('command'), 50)}")
            elif itype in ("agent_message", "assistant_message"):
                working(f"说：{short(item.get('text'), 50)}")
            elif itype == "file_change":
                changes = item.get("changes") if isinstance(item.get("changes"), list) else []
                paths = [str(as_dict(c).get("path")) for c in changes if as_dict(c).get("path")]
                working(f"改文件: {short(', '.join(paths), 50)}")
            elif itype in ("mcp_tool_call", "web_search"):
                working(f"{itype}: {short(item.get('tool') or item.get('query'), 50)}")
            elif itype in ("collab_tool_call", "subagent"):
                info["subagents"].append(str(item.get("agent") or "subagent"))
            # an item of type "error" is a warning (e.g. unstable-feature notice), not a failed run
        elif etype in ("turn.started", "thread.started"):
            info["ended"] = False
            info["failed"] = False
        elif etype == "turn.completed":
            info["ended"] = True
        elif etype == "turn.failed":
            info["ended"] = True
            info["failed"] = True
        # Grok streaming-json (ACP session updates)
        elif etype == "tool_call":
            name = str(ev.get("toolName") or ev.get("title") or "tool")
            raw = as_dict(ev.get("rawInput"))
            if name == "spawn_subagent":
                info["subagents"].append(str(raw.get("agent") or "subagent"))
            detail = raw.get("command") or raw.get("path") or raw.get("pattern") or ""
            working(f"{name}: {short(detail, 50)}" if detail else name)
            grok_text = []
        elif etype == "text" and isinstance(ev.get("data"), str):
            grok_text.append(ev["data"])
            working(f"说：{short(''.join(grok_text), 50)}")
        elif etype == "end":
            info["ended"] = True
            info["failed"] = ev.get("stopReason") not in (None, "end_turn")
            grok_text = []
    return info


# ---------- Orca ----------


def orca_workers(orca_run: str | None) -> dict[str, dict]:
    if not orca_run or not shutil.which("orca"):
        return {}
    try:
        out = subprocess.run(
            ["orca", "orchestration", "worker-list", "--run", orca_run, "--json"],
            capture_output=True, text=True, timeout=15,
        )
        data = json.loads(out.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}
    rows = {}
    for worker in (data.get("result") or {}).get("workers") or []:
        proj = worker.get("projection") or {}
        observed = as_dict(proj.get("evidence")).get("lastObservedAt") or as_dict(proj.get("liveness")).get("observedAt")
        rows[worker.get("dispatchId")] = {
            "liveness": as_dict(proj.get("liveness")).get("verdict"),
            "activity": as_dict(proj.get("stage")).get("activity"),
            "outcome": proj.get("outcome"),
            "observed_at": observed / 1000 if isinstance(observed, (int, float)) else None,
        }
    return rows


# ---------- derived view ----------


def age(seconds: float | None) -> str:
    if seconds is None:
        return "-"
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    return f"{seconds // 3600}h{(seconds % 3600) // 60:02d}m"


def order_lanes(lanes: list[dict]) -> list[dict]:
    """Each Lane followed by its Subagents; the Coordinator's own Subagents last."""
    ids = {l["id"] for l in lanes if l.get("kind") != "subagent"}
    children: dict[str, list[dict]] = {}
    for lane in lanes:
        if lane.get("kind") == "subagent":
            children.setdefault(lane.get("parent") if lane.get("parent") in ids else "coordinator", []).append(lane)
    ordered = []
    for lane in lanes:
        if lane.get("kind") != "subagent":
            ordered.append(lane)
            ordered.extend(children.get(lane["id"], []))
    return ordered + children.get("coordinator", [])


def plain_age(seconds: float | None) -> str:
    minutes = max(0, int(seconds or 0)) // 60
    return f"{minutes // 60} 小时 {minutes % 60} 分钟" if minutes >= 60 else f"{minutes} 分钟"


def resolve(run: dict, path: str | None) -> str | None:
    if not path or os.path.isabs(path) or not run.get("_dir"):
        return path
    return os.path.join(run["_dir"], path)


def derive(run: dict, now: float | None = None, orca: dict | None = None) -> dict:
    now = now if now is not None else time.time()
    orca = orca or {}
    done_ids = {l["id"] for l in run["lanes"] if l["state"] == "done"} | {w["id"] for w in run["waits"] if w["state"] == "done"}
    pools = {lane["id"]: lane.get("pool") for lane in run["lanes"]}
    titles = {row["id"]: str(row.get("title") or row["id"]) for row in run["lanes"] + run["waits"]}
    lane_ids = {l["id"] for l in run["lanes"] if l.get("kind") != "subagent"}
    lanes = []
    for lane in order_lanes(run["lanes"]):
        view = dict(lane)
        view["_under_parent"] = lane.get("parent") in lane_ids
        out = resolve(run, lane.get("output"))
        events = read_tail(out) if out else []
        info = summarize_events(events)
        live = orca.get(lane.get("dispatch")) if lane.get("dispatch") else None
        last_seen = os.path.getmtime(out) if out and os.path.exists(out) else None
        if last_seen is None and live and live.get("observed_at"):
            last_seen = live["observed_at"]
        if last_seen is None:
            last_seen = parse_iso(lane.get("updated_at"))
        finished = lane["state"] not in ACTIVE_LANE_STATES
        activity = info["activity"]
        if not activity and live and live.get("activity"):
            activity = f"Orca：{live['activity']}（{live.get('liveness') or '?'}）"
        if not activity and lane["state"] == "working" and not events:
            activity = "启动中，还没有输出"
        if not activity and lane["state"] == "queued":
            activity = "排队中"
        view["activity"] = (lane.get("note") if finished else None) or activity or lane.get("note") or "-"
        view["activity_label"] = "结果" if finished else "正在"
        view["subagents"] = info["subagents"]
        view["cost"] = info["cost"]
        view["ended"] = info["ended"]
        view["stream_failed"] = info["failed"]
        view["silent_for"] = (now - last_seen) if last_seen else None
        view["elapsed"] = now - (parse_iso(lane.get("started_at")) or now)
        view["round"] = int(lane.get("round") or 1) if str(lane.get("round") or 1).isdigit() else 1
        view["waiting_on"] = [titles.get(a, a) for a in lane.get("after") or [] if a not in done_ids]
        view["stale"] = lane["state"] == "working" and not info["ended"] and view["silent_for"] is not None and view["silent_for"] >= STALE_SECONDS
        flags = []
        target = lane.get("reviews")
        if lane.get("role") == "review" and target and lane.get("pool") and pools.get(target) == lane.get("pool"):
            flags.append("审查和编写用的是同一个账号额度，复审不够独立")
        if info["ended"] and lane["state"] == "working":
            flags.append("输出已结束，待协调者集成" if not info["failed"] else "输出以失败结束")
        if live:
            view["orca"] = live
            if live.get("liveness") == "exited" and lane["state"] == "working":
                flags.append("Orca 报告进程已退出")
        if view["stale"]:
            flags.append(f"{plain_age(view['silent_for'])}没有新动静，协调者会去查看")
        view["flags"] = flags
        lanes.append(view)
    waits = []
    for wait in run["waits"]:
        view = dict(wait)
        log = resolve(run, wait.get("log"))
        seen = os.path.getmtime(log) if log and os.path.exists(log) else parse_iso(wait.get("updated_at"))
        view["silent_for"] = (now - seen) if seen else None
        view["stale"] = wait["state"] == "running" and view["silent_for"] is not None and view["silent_for"] >= STALE_SECONDS
        view["last_line"] = last_line(log)
        view["waiting_on"] = [titles.get(a, a) for a in wait.get("after") or [] if a not in done_ids]
        waits.append(view)
    open_asks = [a for a in run["asks"] if a.get("state") == "open"]
    running = [l for l in lanes if l["state"] in ACTIVE_LANE_STATES]
    running_waits = [w for w in waits if w["state"] == "running"]
    return {"run": run, "lanes": lanes, "waits": waits, "open_asks": open_asks, "running": running, "running_waits": running_waits, "paused": False}


def state_line(view: dict, board_path: str | None = None) -> str:
    n, m, k = len(view["running"]), len(view["running_waits"]), len(view["open_asks"])
    where = f" · 看板 {board_path}" if board_path else ""
    if view["run"].get("state") == "closed":
        return f"已结束：共 {len(view['lanes'])} 项任务，{k} 个问题没回答{where}"
    if view.get("paused"):
        return f"已暂停派新任务：还有 {n} 项任务、{m} 项外部等待没停下，{k} 个问题等你回答{where}"
    if n or m or k:
        return f"进行中：{n} 项任务在做 · {m} 项外部等待 · {k} 个问题等你回答{where}"
    return f"暂时没有在做的事：0 项任务 · 0 项外部等待 · 0 个问题{where}"


def lane_name(lane: dict, shown: set | None = None) -> str:
    """shown: Lane ids already listed in the same section, so a Subagent can sit under its parent."""
    role = {"write": "写", "review": "审", "research": "研", "draft": "稿"}.get(lane.get("role") or "", lane.get("role") or "")
    title = str(lane.get("title") or lane["id"])
    account = str(lane.get("account") or "")
    existing = [p.strip() for p in title.split("·")]
    parts = [title] + [p for p in (role, account) if p and p not in existing]
    name = " · ".join(p for p in parts if p)
    if lane.get("kind") == "subagent":
        parent = lane.get("parent") or "coordinator"
        if shown is not None and parent in shown:
            return f"  └ {name}"
        return f"  └ {'协调者' if parent == 'coordinator' else parent} 的 {name}"
    return name


def render_text(view: dict, board_path: str | None = None) -> str:
    run = view["run"]
    out = [state_line(view, board_path), f"目标：{run['objective']}  (Run {run['id']})", ""]
    out.append("运行中")
    active = [l for l in view["lanes"] if l["state"] in ACTIVE_LANE_STATES]
    if not active:
        out.append("  （无）")
    shown: set = set()
    for lane in active:
        state = STATE_LABELS.get(lane["state"], lane["state"])
        sub = f" · 子任务 {len(lane['subagents'])}" if lane["subagents"] else ""
        name = lane_name(lane, shown)
        shown.add(lane["id"])
        out.append(f"  {name}  [{state}]  第 {lane['round']}/3 轮  已用 {age(lane['elapsed'])}  上次输出 {age(lane['silent_for'])} 前{sub}")
        out.append(f"      {lane['activity_label']}：{lane['activity']}")
        if lane["waiting_on"]:
            out.append(f"      等：{'、'.join(lane['waiting_on'])}")
        meta = lane.get("branch") or ""
        if meta:
            out.append(f"      {meta}")
        for flag in lane["flags"]:
            out.append(f"      ⚠ {flag}")
    out.append("")
    out.append("外部等待（部署、CI、构建）")
    if not view["running_waits"]:
        out.append("  （无）")
    for wait in view["running_waits"]:
        stale = f"  ⚠ {plain_age(wait['silent_for'])}没有新动静" if wait["stale"] else ""
        out.append(f"  {wait.get('title') or wait['id']}  阶段：{wait.get('stage') or '-'}{stale}")
        if wait["waiting_on"]:
            out.append(f"      等：{'、'.join(wait['waiting_on'])}")
        if wait.get("last_line"):
            out.append(f"      日志最后一行：{wait['last_line']}")
        out.append(f"      日志：{wait.get('log') or '-'}")
    out.append("")
    out.append("等你回答（在对话里回复，例如：A1 按推荐）")
    if not view["open_asks"]:
        out.append("  （无）")
    for ask in view["open_asks"]:
        out.append(f"  {ask['id']}  {ask['question']}")
        out.append(f"      推荐：{ask['recommend']}")
        out.append(f"      依据：{ask['evidence']}")
        out.append(f"      卡住：{ask['blocks']}")
        if ask.get("outward"):
            out.append(f"      发给：{ask.get('recipient')}（{ask.get('channel')}）")
            out.append(f"      草稿：{ask.get('draft')}")
    if run["grants"]:
        out.append("")
        out.append("长期授权")
        for grant in run["grants"]:
            out.append(f"  {grant['id']}  {grant['scope']}（有效期：{'本 Run' if grant['outward'] else '直到撤回'}）原话：{grant['words']}")
    finished = [l for l in view["lanes"] if l["state"] not in ACTIVE_LANE_STATES]
    if finished:
        out.append("")
        out.append("已结束")
        shown = set()
        for lane in finished:
            cost = f"  ${lane['cost']:.2f}" if isinstance(lane.get("cost"), (int, float)) else ""
            name = lane_name(lane, shown)
            shown.add(lane["id"])
            out.append(f"  {name}  [{STATE_LABELS.get(lane['state'], lane['state'])}]{cost}")
    return "\n".join(out) + "\n"


HTML_STYLE = """
:root{--bg:#f6f5f2;--card:#fff;--fg:#1f1f1f;--muted:#6b6b6b;--line:#e3e0da;--warn:#b45309;--ok:#15803d;--bad:#b91c1c;--accent:#2563eb}
@media (prefers-color-scheme: dark){:root{--bg:#161616;--card:#202020;--fg:#ececec;--muted:#9a9a9a;--line:#333;--warn:#f59e0b;--ok:#4ade80;--bad:#f87171;--accent:#60a5fa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:16px}
main{max-width:1080px;margin:0 auto}h1{font-size:18px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 16px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 12px}
h2{font-size:14px;margin:0 0 8px;color:var(--muted)}.row{padding:8px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
.name{font-weight:600}.pill{display:inline-block;padding:0 8px;border-radius:999px;border:1px solid var(--line);font-size:12px;margin-left:6px}
.working,.running{color:var(--accent)}.needs-you{color:var(--warn)}.done{color:var(--ok)}.failed{color:var(--bad)}.queued,.stopped{color:var(--muted)}
.meta{color:var(--muted);font-size:12px}.flag{color:var(--warn);font-size:12px}.empty{color:var(--muted)}code{font-size:12px;word-break:break-all}
.ask{border-left:3px solid var(--warn);padding-left:10px}
"""


def render_html(view: dict, refresh: int = 5) -> str:
    e = html.escape
    run = view["run"]

    def lane_rows(lanes: list[dict]) -> str:
        shown: set = set()
        rows = []
        for lane in lanes:
            rows.append(lane_row(lane, lane_name(lane, shown)))
            shown.add(lane["id"])
        return "".join(rows)

    def lane_row(lane: dict, name: str) -> str:
        flags = "".join(f'<div class="flag">⚠ {e(f)}</div>' for f in lane["flags"])
        sub = f" · 子任务 {len(lane['subagents'])}（{e(', '.join(lane['subagents']))}）" if lane["subagents"] else ""
        meta = e(str(lane.get("branch") or ""))
        cost = f" · ${lane['cost']:.2f}" if isinstance(lane.get("cost"), (int, float)) else ""
        waiting = f'<div class="meta">等：{e("、".join(lane["waiting_on"]))}</div>' if lane["waiting_on"] else ""
        return (
            f'<div class="row"><span class="name">{e(name)}</span>'
            f'<span class="pill {e(str(lane["state"]))}">{e(STATE_LABELS.get(lane["state"], str(lane["state"])))}</span>'
            f'<div>{e(lane["activity_label"])}：{e(str(lane["activity"]))}</div>{waiting}'
            f'<div class="meta">第 {int(lane["round"])}/3 轮 · 已用 {age(lane["elapsed"])} · 上次输出 {age(lane["silent_for"])} 前{sub}{cost}{(" · " + meta) if meta else ""}</div>{flags}</div>'
        )

    active = [l for l in view["lanes"] if l["state"] in ACTIVE_LANE_STATES]
    finished = [l for l in view["lanes"] if l["state"] not in ACTIVE_LANE_STATES]
    parts = [
        f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + (f'<meta http-equiv="refresh" content="{int(refresh)}">' if refresh else "") + f'<title>Run 看板 · {e(run["id"])}</title><style>{HTML_STYLE}</style></head><body><main>',
        f'<h1>{e(state_line(view))}</h1><p class="sub">目标：{e(str(run["objective"]))} · Run {e(str(run["id"]))} · '
        + (f"每 {int(refresh)} 秒刷新" if refresh else f"已归档到 {e(view.get('archive') or '')}")
        + f' · 更新于 {local_time()}</p>',
        ('<section class="ask"><h2>已暂停派新任务</h2><div>协调者正在逐项停下下面还在运行的任务，停不了的会在对话里告诉你。</div></section>' if view.get("paused") else ""),
        "<section><h2>运行中</h2>" + (lane_rows(active) or '<div class="empty">（无）</div>') + "</section>",
    ]
    waits = "".join(
        f'<div class="row"><span class="name">{e(w.get("title") or w["id"])}</span><span class="pill running">进行中</span>'
        f'<div>阶段：{e(str(w.get("stage") or "-"))}</div>'
        + (f'<div class="meta">等：{e("、".join(w["waiting_on"]))}</div>' if w["waiting_on"] else "")
        + ''
        + (f'<div>日志最后一行：<code>{e(w["last_line"])}</code></div>' if w.get("last_line") else "")
        + f'<div class="meta">日志：<code title="{e(w.get("log") or "")}">{e(tail_path(w.get("log")))}</code> · 上次输出 {age(w["silent_for"])} 前</div>'
        + (f'<div class="flag">⚠ {plain_age(w["silent_for"])}没有新动静，协调者会去查看</div>' if w["stale"] else "")
        + "</div>"
        for w in view["running_waits"]
    )
    parts.append("<section><h2>外部等待（部署、CI、构建）</h2>" + (waits or '<div class="empty">（无）</div>') + "</section>")
    asks = "".join(
        f'<div class="row ask"><span class="name">{e(a["id"])} {e(a["question"])}</span>'
        f'<div>推荐：{e(a["recommend"])}</div><div class="meta">依据：{e(a["evidence"])}</div><div class="meta">卡住：{e(a["blocks"])}</div>'
        + (f'<div class="meta">发给：{e(a.get("recipient") or "")}（{e(a.get("channel") or "")}）</div><div>草稿：{e(a.get("draft") or "")}</div>' if a.get("outward") else "")
        + "</div>"
        for a in view["open_asks"]
    )
    parts.append("<section><h2>等你回答（在对话里回复，例如：A1 按推荐）</h2>" + (asks or '<div class="empty">（无）</div>') + "</section>")
    if run["grants"]:
        grants = "".join(
            f'<div class="row"><span class="name">{e(g["id"])} {e(g["scope"])}</span><div class="meta">有效期：{"本 Run" if g["outward"] else "直到撤回"} · 原话：{e(g["words"])}</div></div>'
            for g in run["grants"]
        )
        parts.append("<section><h2>长期授权</h2>" + grants + "</section>")
    if finished:
        parts.append("<section><h2>已结束</h2>" + lane_rows(finished) + "</section>")
    if run.get("state") != "closed":
        parts.append('<p class="sub">想看进度或改主意，直接在对话里说，例如“现在到哪了”。说“停”时，协调者会停止派新任务，'
                     '并逐项停下正在做的事，停不了的会告诉你。页面会自己刷新，不用操作。</p>')
    parts.append("</main></body></html>\n")
    return "".join(parts)


def render_all(rows: list[dict]) -> str:
    active = [r for r in rows if r.get("state") == "active" and os.path.exists(os.path.join(r.get("dir", ""), LEDGER))]
    if not active:
        return "没有进行中的 Run。\n"
    lines = []
    for row in active:
        try:
            view = derive(load_run(row["dir"]))
        except BoardError:
            continue
        lines.append(f"{row['id']}  {state_line(view)}\n    目标：{row['objective']}\n    {row['dir']}")
    return "\n".join(lines) + "\n"


# ---------- CLI ----------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="agent-dispatch Run ledger and Board")
    p.add_argument("--run", help="Run directory (default: $AGENT_DISPATCH_RUN or the only active Run in this repo)")
    sub = p.add_subparsers(dest="cmd", required=True)

    init = sub.add_parser("init", help="start a Run ledger")
    init.add_argument("--objective", required=True)
    init.add_argument("--run-id")
    init.add_argument("--orca-run", help="Orca orchestration Run id, to read worker liveness")
    init.add_argument("--account", help="the Coordinator's account, e.g. claude:008")

    lane = sub.add_parser("lane", help="add or update a Lane or Subagent")
    lane.add_argument("action", choices=("add", "set"))
    lane.add_argument("--id", required=True)
    for flag in ("title", "role", "account", "pool", "branch", "worktree", "output", "dispatch", "note", "reviews", "parent"):
        lane.add_argument(f"--{flag}")
    lane.add_argument("--after", help="comma-separated Lane or Wait ids this Lane waits on")
    lane.add_argument("--kind", choices=("lane", "subagent"))
    lane.add_argument("--state", choices=LANE_STATES)
    lane.add_argument("--round", type=int)

    wait = sub.add_parser("wait", help="add or update a Wait (deploy, CI, build, background shell)")
    wait.add_argument("action", choices=("add", "set"))
    wait.add_argument("--id", required=True)
    for flag in ("title", "stage", "log", "note"):
        wait.add_argument(f"--{flag}")
    wait.add_argument("--after", help="comma-separated Lane or Wait ids this Wait starts after")
    wait.add_argument("--state", choices=WAIT_STATES)

    ask = sub.add_parser("ask", help="add or answer an Ask")
    ask.add_argument("action", choices=("add", "answer"))
    ask.add_argument("--id", required=True)
    for flag in ("question", "recommend", "evidence", "blocks", "recipient", "channel", "draft", "answer"):
        ask.add_argument(f"--{flag}")
    ask.add_argument("--outward", action="store_true", help="the Ask approves sending, publishing or deploying")

    grant = sub.add_parser("grant", help="record a Standing Grant")
    grant.add_argument("action", choices=("add",))
    grant.add_argument("--scope", required=True)
    grant.add_argument("--words", required=True)
    grant.add_argument("--outward", action="store_true", help="covers deploy, send or publish; lasts this Run only")

    show = sub.add_parser("show", help="print the Board")
    show.add_argument("--line", action="store_true", help="print only the Run state line")
    show.add_argument("--html", action="store_true", help="also write the self-refreshing HTML Board at <base>/boards/<run-id>.html")
    show.add_argument("--watch", type=float, help="redraw every N seconds until the Run closes")
    show.add_argument("--all", action="store_true", help="list every active Run on this machine")
    show.add_argument("--json", action="store_true")

    sub.add_parser("open", help="write the Board and open it for the user (Orca tab, else the system browser)")
    sub.add_parser("close", help="close the Run and move it to archive/")
    return p


def lane_fields(args: argparse.Namespace) -> dict:
    keys = ("id", "title", "role", "account", "pool", "branch", "worktree", "output", "dispatch", "note", "reviews", "parent", "kind", "state", "round", "after")
    return {k: getattr(args, k) for k in keys if getattr(args, k, None) is not None}


def orca_reachable() -> bool:
    if not shutil.which("orca"):
        return False
    try:
        out = subprocess.run(["orca", "status", "--json"], capture_output=True, text=True, timeout=10)
        result = as_dict(as_dict(json.loads(out.stdout)).get("result"))
        return bool(as_dict(result.get("runtime")).get("reachable") or result.get("runtimeReachable"))
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


def open_board(path: str) -> str:
    """Open the Board for the user: an Orca browser tab when Orca runs, else the system browser."""
    url = "file://" + os.path.abspath(path)
    if orca_reachable():
        try:
            out = subprocess.run(["orca", "tab", "create", "--url", url, "--json"], capture_output=True, text=True, timeout=20)
            if out.returncode == 0 and as_dict(json.loads(out.stdout or "{}")).get("ok"):
                return "orca"
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
    try:
        if sys.platform == "darwin":
            return "browser" if subprocess.run(["open", path], capture_output=True, timeout=20).returncode == 0 else "none"
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
            return "browser"
        if shutil.which("xdg-open"):
            return "browser" if subprocess.run(["xdg-open", path], capture_output=True, timeout=20).returncode == 0 else "none"
    except (OSError, subprocess.TimeoutExpired):
        pass
    return "none"


def existing_board(run_dir: str) -> str | None:
    path = board_path(run_dir)
    return path if os.path.exists(path) else None


def show_once(run_dir: str, args: argparse.Namespace) -> bool:
    run = load_run(run_dir)
    view = derive(run, orca=orca_workers(run.get("orca_run")))
    view["paused"] = stopped(run_dir)
    board = existing_board(run_dir)
    if args.html:
        board = board_path(run_dir)
        # A closed ledger still in runs/ was read between close's write and its move; its paths already
        # point at the archive, so leave the final page to close (or to the watcher's archived branch).
        if run.get("state") != "closed":
            atomic_write(board, render_html(view))
    if args.json:
        print(json.dumps({k: v for k, v in view.items() if k != "run"} | {"line": state_line(view, board)}, ensure_ascii=False, default=str))
    elif args.line:
        print(state_line(view, board))
    else:
        if args.watch:
            sys.stdout.write("\033[2J\033[H")
        sys.stdout.write(render_text(view, board))
        sys.stdout.flush()
    return run.get("state") == "active"


def watch(run_dir: str, args: argparse.Namespace) -> int:
    while True:
        try:
            active = show_once(run_dir, args)
        except (BoardError, OSError):
            archive = archive_of(run_dir)
            if not os.path.exists(os.path.join(run_dir, LEDGER)) and os.path.exists(os.path.join(archive, LEDGER)):
                # closed while watching: our last write may have raced the close, so rewrite the final page
                write_closed_board(archive, board_path(run_dir))
                print(f"已结束，归档在 {archive}。")
                return 0
            raise
        if not active:
            return 0
        time.sleep(args.watch)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cwd = os.getcwd()
    try:
        if args.cmd == "init":
            run_dir = init_run(args.objective, cwd, args.run_id, args.orca_run, args.account)
            print(run_dir)
            return 0
        if args.cmd == "show" and args.all:
            sys.stdout.write(render_all(load_registry()))
            return 0
        run_dir = resolve_run_dir(args.run, cwd)
        if args.cmd == "show":
            if args.watch:
                return watch(run_dir, args)
            show_once(run_dir, args)
            return 0
        if args.cmd == "open":
            show_once(run_dir, build_parser().parse_args(["show", "--html", "--line"]))
            where = open_board(board_path(run_dir))
            print({"orca": "已在 Orca 内置浏览器打开", "browser": "已在系统浏览器打开",
                   "none": "看板没能打开：在对话里用文字汇报进度（show 的输出），不要让用户自己找路径"}[where])
            return 0 if where != "none" else 3
        run = load_run(run_dir)
        if args.cmd == "close":
            print(close_run(run_dir, run))
            return 0
        if args.cmd == "lane":
            fields = lane_fields(args)
            (add_lane(run, fields, run_dir=run_dir) if args.action == "add" else set_lane(run, args.id, fields))
        elif args.cmd == "wait":
            fields = {k: getattr(args, k) for k in ("id", "title", "stage", "log", "note", "state", "after") if getattr(args, k) is not None}
            (add_wait(run, fields) if args.action == "add" else set_wait(run, args.id, fields))
        elif args.cmd == "ask":
            if args.action == "add":
                fields = {k: getattr(args, k) for k in ("id", "question", "recommend", "evidence", "blocks", "recipient", "channel", "draft") if getattr(args, k)}
                fields["outward"] = args.outward
                add_ask(run, fields)
            else:
                if not args.answer:
                    raise BoardError("pass --answer with the user's reply")
                answer_ask(run, args.id, args.answer)
        elif args.cmd == "grant":
            add_grant(run, args.scope, args.words, args.outward)
        save_run(run_dir, run)
        view = derive(run)
        view["paused"] = stopped(run_dir)
        board = existing_board(run_dir)
        if board:  # keep an open Board current without waiting for the next --watch tick
            atomic_write(board, render_html(view))
        print(state_line(view, board))
        return 0
    except BoardError as exc:
        print(f"dispatch_board: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
