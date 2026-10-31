#!/usr/bin/env python3
"""Run ledger and Board for agent-dispatch.

Only the Coordinator writes the ledger (through this script). Live activity is
derived from each Worker's event stream (Claude stream-json, Codex exec --json,
Grok streaming-json) and, in Orca mode, from `orca orchestration worker-list`; it is
printed by `show`. Live views and messaging belong to sideby's Panel, not to this script.

Usage (see references/run-board.md):
  dispatch_board.py init --objective TEXT [--orca-run RUN_ID]
  dispatch_board.py lane add --id B9 --title "看板卡片" --role write --account claude:003 --pool claude:003 --output PATH [--after ID,ID]
  dispatch_board.py lane set --id B9 --state done
  dispatch_board.py wait add --id deploy --title "正在部署测试环境（test）" --log PATH --stage "正在打包网页（web 构建中）"
  dispatch_board.py ask add --id A1 --question Q --recommend R --evidence E --blocks B
  dispatch_board.py ask answer --id A1 --answer TEXT
  dispatch_board.py grant add --scope S --words W [--outward]
  dispatch_board.py show [--line] [--html] [--all]
  dispatch_board.py open [--panel]   # opens the Board report once (Orca tab or system browser)
  dispatch_board.py close

Layout under <base> (<repo>/.agent-dispatch or ~/.local/state/agent-dispatch):
  runs/<id>/run.json   active ledgers      archive/<id>/   closed Runs
The Board is a static report page outside any repository, under <state>/boards
(<state>: AGENT_DISPATCH_STATE_DIR, else $XDG_STATE_HOME/agent-dispatch, else
~/.local/state/agent-dispatch): <id>.html and <id>.<lane>.report.html (full reports). Only
init, lane add, milestone commands (step, lane set --result/--summary, decision/artifact/commit add,
ask add/answer, close) and open write it, only when content changes. show never writes files.
Every ledger change also rebuilds <state>/session-index.json, the session index other tools (sideby) read.
A STOP file in the Run directory pauses dispatch: new Lanes are refused and the Board says so.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fnmatch
import hashlib
import html
import re
import json
import os
import shutil
import subprocess
import sys
import time
from urllib.parse import quote

from sideby_sessions import session_label, SessionReader, detect_coordinator

SESSION_READER = SessionReader()

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
MAX_ROUNDS = 3  # the first run plus 2 fix rounds (SKILL.md "Dispatching workers")
TAIL_BYTES = 4_000_000
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
DIR_NAME = ".agent-dispatch"
SESSION_LABELS = {"busy": "进行中", "idle": "等新活中", "needs-you": "等你回答", "unknown": "状态未知"}
STATE_LABELS = {
    "queued": "排队",
    "working": "进行中",
    "needs-you": "等你回答",
    "finished": "待主控 AI 汇总",
    "done": "完成",
    "failed": "失败",
    "stopped": "已停止",
    "running": "进行中",
}


class BoardError(Exception):
    """A usage error whose message says how to fix it."""


# ---------- locations ----------


def state_dir() -> str:
    if os.environ.get("AGENT_DISPATCH_STATE_DIR"):
        return os.environ["AGENT_DISPATCH_STATE_DIR"]
    if os.environ.get("XDG_STATE_HOME"):
        return os.path.join(os.environ["XDG_STATE_HOME"], "agent-dispatch")
    return os.path.expanduser("~/.local/state/agent-dispatch")


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
def file_lock(path: str):
    """An exclusive advisory lock held for one read-modify-write cycle."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a+b") as lock:
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


def registry_lock():
    """Several Coordinators share one registry; serialize its read-modify-write."""
    return file_lock(registry_path() + ".lock")


def ledger_lock(run_dir: str):
    """CLI mutations of one Run serialize their read-modify-write cycles."""
    return file_lock(os.path.join(run_dir, ".board.lock"))


def register(run: dict, run_dir: str, old_dir: str | None = None) -> None:
    drop = {os.path.realpath(d) for d in (run_dir, old_dir) if d}
    with registry_lock():
        rows = [r for r in load_registry() if os.path.realpath(r.get("dir") or "") not in drop]
        rows.append({"id": run["id"], "dir": os.path.abspath(run_dir), "objective": run["objective"], "state": run["state"]})
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


def boards_dir() -> str:
    return os.path.join(state_dir(), "boards")


def run_id_of(run_dir: str) -> str:
    return os.path.basename(os.path.abspath(run_dir))


def board_path(run_dir: str) -> str:
    """Outside every repository: an editor or agent that read it once is not sent a diff on each change."""
    return os.path.join(boards_dir(), run_id_of(run_dir) + ".html")


def legacy_board_path(run_dir: str) -> str:
    return os.path.join(base_of(run_dir), "boards", run_id_of(run_dir) + ".html")


def report_path(run_dir: str, lane_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", lane_id)
    if safe != lane_id:
        safe += "-" + hashlib.sha256(lane_id.encode()).hexdigest()[:8]
    return os.path.join(boards_dir(), f"{run_id_of(run_dir)}.{safe}.report.html")


def archive_of(run_dir: str) -> str:
    return os.path.join(base_of(run_dir), "archive", os.path.basename(os.path.abspath(run_dir)))


def stopped(run_dir: str) -> bool:
    return os.path.exists(os.path.join(run_dir, STOP))


def learn_sessions(run_dir: str, run: dict) -> None:
    """Collect stream ids while the caller holds the ledger lock."""
    run["_dir"] = os.path.abspath(run_dir)
    for lane in run["lanes"]:
        if not lane.get("session") and lane.get("output"):
            session = summarize_events(read_tail(resolve(run, lane["output"]))).get("session")
            if session:
                lane["session"] = session


def save_run(run_dir: str, run: dict, now: float | None = None, *, report: bool = False) -> None:
    """Caller holds the ledger lock: save, publish the board, then rebuild the index.

    Each file is atomic; this is not a cross-file transaction.
    """
    learn_sessions(run_dir, run)
    run["updated_at"] = now_iso(now)
    stored = {k: v for k, v in run.items() if k != "_dir"}
    atomic_write(os.path.join(run_dir, LEDGER), json.dumps(stored, ensure_ascii=False, indent=2) + "\n")
    if run.get("state") != "closed" and (report or not os.path.exists(board_path(run_dir))):
        view = derive(run)
        view["paused"] = stopped(run_dir)
        write_board(run_dir, view, now)
    register(run, run_dir)
    rebuild_index(now)


def resolve_run_dir(explicit: str | None, cwd: str) -> str:
    if explicit:
        return os.path.abspath(explicit)  # the registry is read from other directories
    env = os.environ.get("AGENT_DISPATCH_RUN")
    if env:
        return os.path.abspath(env)
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
    other = next((r["dir"] for r in load_registry() if r.get("id") == rid), None)
    if other:  # boards are named by Run id alone, so a second Run would overwrite the first one's page
        raise BoardError(f"Run id {rid} is already used at {other}; pick another --run-id")
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
    with ledger_lock(run_dir):
        save_run(run_dir, run, now, report=True)
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
        if key in ("after", "files", "owns") and isinstance(value, str):
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
    budget = run.get("budget_usd")
    if isinstance(budget, (int, float)) and fields.get("kind") != "subagent":
        spent = run_spend(run)
        if spent >= budget:
            raise BoardError(f"the Run has spent ${spent:.2f} of its ${budget:.2f} budget, so no new Lane may start; "
                             "ask the user (an Ask with the spend so far) before raising it with `run set --budget-usd <dollars>`")
    lane = {"kind": "lane", "round": 1, "started_at": now_iso(now)}
    apply_fields(lane, fields)
    lane["state"] = state
    lane["updated_at"] = now_iso(now)
    if state not in ACTIVE_LANE_STATES:
        lane["ended_at"] = now_iso(now)
    check_lane_rules(run, lane)
    run["lanes"].append(lane)
    return lane


def _pattern_base(pattern: str) -> str:
    """The literal directory part of a path or glob: `packages/core/**` -> `packages/core`."""
    parts = []
    for part in pattern.strip().lstrip("./").strip("/").split("/"):
        if any(ch in part for ch in "*?["):
            break
        parts.append(part)
    return "/".join(parts)


def owns_overlap(a: str, b: str) -> bool:
    """Conservative: two ownership entries overlap when one could match a file the other also covers."""
    a, b = a.strip().lstrip("./").strip("/"), b.strip().lstrip("./").strip("/")
    if not a or not b:
        return False
    if a == b or fnmatch.fnmatch(a, b) or fnmatch.fnmatch(b, a):
        return True
    base_a, base_b = _pattern_base(a), _pattern_base(b)
    a_dir, b_dir = base_a != a, base_b != b  # a glob covers everything under its literal base
    if a_dir and (b == base_a or b.startswith(base_a + "/") or not base_a):
        return True
    if b_dir and (a == base_b or a.startswith(base_b + "/") or not base_b):
        return True
    return False


def check_lane_rules(run: dict, lane: dict) -> None:
    """Hard limits the harness enforces instead of trusting the prompt (writable sets, self-review)."""
    if lane.get("role") == "write" and lane.get("owns") and lane.get("state") in ACTIVE_LANE_STATES:
        for other in run["lanes"]:
            if other["id"] == lane["id"] or other.get("role") != "write" or other.get("state") not in ACTIVE_LANE_STATES:
                continue
            for mine in lane["owns"]:
                clash = next((theirs for theirs in other.get("owns") or [] if owns_overlap(mine, theirs)), None)
                if clash:
                    raise BoardError(f"{lane['id']} may edit {mine}, which overlaps {other['id']}'s {clash}: parallel writers need "
                                     "disjoint files, so merge the two into one Lane, or land the shared part first and fan out after")
    target = lane.get("reviews")
    if lane.get("role") == "review" and target and lane.get("session"):
        writer = next((l for l in run["lanes"] if l["id"] == target), None)
        if writer and writer.get("session") == lane["session"]:
            raise BoardError(f"{lane['id']} would review {target} in the writer's own session {lane['session']}: "
                             "the writer never reviews its own diff; start a fresh session (another account or product) for the review")


def run_spend(run: dict) -> float:
    """Known dollars across every Lane and archived round; unknown costs count as nothing, never as zero spend proof."""
    total = 0.0
    for lane in run["lanes"]:
        current = lane.get("cost")
        session = lane.get("session")
        if current is None and lane.get("output"):
            info = summarize_events(read_tail(resolve(run, lane.get("output"))))
            current, session = info.get("cost"), session or info.get("session")
        prior, _ = prior_rounds(lane, session)
        total += (current if isinstance(current, (int, float)) else 0.0) + prior
    return total


def set_lane(run: dict, key: str, fields: dict, now: float | None = None) -> dict:
    lane = find(run["lanes"], key, "Lane")
    if fields.get("state") and fields["state"] not in LANE_STATES:
        raise BoardError(f"unknown Lane state {fields['state']}; use one of {', '.join(LANE_STATES)}")
    current = int(lane.get("round") or 1) if str(lane.get("round") or 1).isdigit() else 1
    if fields.get("round") is not None and fields["round"] > MAX_ROUNDS:
        raise BoardError(f"round {fields['round']} of {lane['id']} is past the {MAX_ROUNDS}-round budget (the first run plus "
                         f"{MAX_ROUNDS - 1} fix rounds), which means the spec was wrong: rewrite the spec and start a new Lane "
                         f"(`lane add --id {lane['id']}-v2`), or take the task back into the Coordinator")
    if fields.get("round") is not None and fields["round"] > current:
        archive_round(run, lane, current, fields, now)
    if fields.get("round") is not None and fields.get("note") is not None:
        lane.setdefault("history", []).append({"round": fields["round"], "note": fields["note"], "at": now_iso(now)})
    previous_state = lane["state"]
    candidate = dict(lane)
    apply_fields(candidate, fields)
    check_lane_rules(run, candidate)
    apply_fields(lane, fields)
    if lane["state"] not in ACTIVE_LANE_STATES:
        lane.setdefault("ended_at", lane.get("updated_at") if previous_state not in ACTIVE_LANE_STATES else now_iso(now))
    elif previous_state not in ACTIVE_LANE_STATES:
        lane.pop("ended_at", None)
    lane["updated_at"] = now_iso(now)
    return lane


def archive_round(run: dict, lane: dict, current: int, fields: dict, now: float | None = None) -> None:
    """A new round starts clean: the old round's result moves into history, so the Board never shows it as current.

    A resumed Worker writes a new stream; reusing the ended one keeps the Lane reading "做完了" with the old result.
    """
    if lane.get("output") and not lane.get("dispatch"):
        new = fields.get("output")
        if not new or os.path.abspath(os.path.expanduser(new)) == os.path.abspath(resolve(run, lane["output"]) or ""):
            raise BoardError(f"round {fields['round']} of {lane['id']} needs a new --output (e.g. {lane['id']}{fields['round']}.jsonl): "
                             f"the round-{current} stream has ended, so reusing it keeps showing the old result")
    info = summarize_events(read_tail(resolve(run, lane.get("output")))) if lane.get("output") else {}
    entry = {"round": current, "archived": True, "at": now_iso(now), "output": lane.get("output"),
             "session": lane.get("session") or info.get("session"),
             "cost": lane.get("cost", info.get("cost")), "tokens": info.get("tokens")}
    for key in ("summary", "result"):
        if lane.get(key) is not None:
            entry[key] = lane[key]
    first = first_sentence(lane_summary(run, lane))
    entry["note"] = f"第 {current} 轮结果：{first}" if first else f"第 {current} 轮结束"
    lane.setdefault("history", []).append(entry)
    for key in ("summary", "result", "cost", "ended_at", "session"):  # the next stream reports its own session
        lane.pop(key, None)
    if fields.get("state") is None:
        fields["state"] = "working"


def prior_rounds(lane: dict, session: str | None) -> tuple[float, dict]:
    """Cost and tokens of archived rounds. A Claude resume reports a cumulative cost, so a round on the
    current session is already counted in the current stream."""
    cost, tokens = 0.0, {"input": 0, "output": 0}
    for row in lane.get("history", []):
        if not row.get("archived"):
            continue
        if isinstance(row.get("cost"), (int, float)) and not (session and row.get("session") == session):
            cost += row["cost"]
        for key in tokens:
            tokens[key] += int(as_dict(row.get("tokens")).get(key) or 0)
    return cost, tokens


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
    learn_sessions(run_dir, run)
    run["state"] = "closed"
    olds = {os.path.abspath(run_dir) + os.sep, os.path.realpath(run_dir) + os.sep}  # /tmp and /private/tmp are one place
    for row in run["lanes"] + run["waits"] + run.get("artifacts", []) + [h for l in run["lanes"] for h in l.get("history", [])]:
        for key in (*PATH_FIELDS, "path"):  # local files move with the Run
            value = row.get(key)
            if not isinstance(value, str):
                continue
            for old in olds:
                for form in (value, os.path.realpath(value)):
                    if form.startswith(old):
                        row[key] = os.path.join(archive, form[len(old):])
                        break
                else:
                    continue
                break
    save_run(run_dir, run, now)
    os.makedirs(os.path.dirname(archive), exist_ok=True)
    shutil.move(run_dir, archive)
    register(run, archive, old_dir=run_dir)
    write_closed_board(archive, now)
    return archive


def write_closed_board(archive: str, now: float | None = None) -> None:
    """Closing is a milestone: the final report stays at the Board path."""
    view = derive(load_run(archive))
    view["archive"] = archive
    write_board(archive, view, now)


# ---------- session index ----------


def index_path() -> str:
    return os.path.join(state_dir(), "session-index.json")


def file_url(path: str, fragment: str = "") -> str:
    return "file://" + quote(os.path.abspath(path)) + (f"#{quote(fragment, safe='-')}" if fragment else "")


def index_entries() -> dict:
    """session id -> {entries: [...]} for every active Run on this machine; a session may serve several."""
    sessions: dict[str, dict] = {}

    def add(session: object, entry: dict) -> None:
        if isinstance(session, str) and session:
            sessions.setdefault(session, {"entries": []})["entries"].append(entry)

    for row in load_registry():
        run_dir = row.get("dir") or ""
        if row.get("state") != "active" or not os.path.exists(os.path.join(run_dir, LEDGER)):
            continue
        try:
            run = load_run(run_dir)
        except BoardError:
            continue
        if run.get("state") != "active":
            continue
        board = board_path(run_dir)
        common = {"run": run["id"], "runTitle": run.get("objective") or "", "board": board}
        add(run.get("coordinator_session"), {**common, "lane": None, "laneTitle": None, "role": "coordinator", "url": file_url(board)})
        for lane in run["lanes"]:
            add(lane.get("session"), {**common, "lane": lane["id"], "laneTitle": str(lane.get("title") or lane["id"]),
                                      "role": lane.get("role") or ("subagent" if lane.get("kind") == "subagent" else "worker"),
                                      "url": file_url(board, "lane-" + lane["id"])})
    return sessions


def rebuild_index(now: float | None = None) -> bool:
    """Rewrite <state>/session-index.json from all active ledgers; the revision rises only when the content changes."""
    with file_lock(os.path.join(state_dir(), "index.lock")):
        sessions = index_entries()
        try:
            with open(index_path(), encoding="utf-8") as f:
                old = json.load(f)
        except (OSError, ValueError):
            old = {}
        old = old if isinstance(old, dict) else {}
        if old.get("schemaVersion") == 1 and old.get("sessions") == sessions:
            with contextlib.suppress(FileNotFoundError):
                os.remove(os.path.join(state_dir(), "sessions.json"))
            return False
        revision = old.get("revision") if isinstance(old.get("revision"), int) else 0
        index = {"schemaVersion": 1, "revision": revision + 1, "generatedAt": now_iso(now), "sessions": sessions}
        atomic_write(index_path(), json.dumps(index, ensure_ascii=False, indent=2) + "\n")
        with contextlib.suppress(FileNotFoundError):
            os.remove(os.path.join(state_dir(), "sessions.json"))
        return True


# ---------- board files ----------

MOVED_MARK = '<meta name="agent-dispatch-moved"'
FINGERPRINT_RE = re.compile(r'<meta name="board-fingerprint" content="([0-9a-f]+)">')
CHANGED_CLOCK = "__BOARD_CHANGED_CLOCK__"  # replaced after fingerprinting: the time is not content


def moved_stub(new_path: str) -> str:
    url = html.escape("file://" + quote(os.path.abspath(new_path)), quote=True)
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            f'{MOVED_MARK} content="1"><meta http-equiv="refresh" content="0; url={url}">'
            '<title>看板已搬家</title></head><body style="font:15px/1.6 -apple-system,sans-serif;margin:40px">'
            f'<p>看板已搬到仓库外，避免打扰正在工作的 AI。<a href="{url}">打开新看板</a></p></body></html>\n')


def migrate_legacy_board(run_dir: str) -> None:
    """An old Board inside the repository becomes a static pointer once, and is never rewritten."""
    legacy = legacy_board_path(run_dir)
    if os.path.realpath(os.path.dirname(legacy)) == os.path.realpath(boards_dir()) or not os.path.isfile(legacy):
        return
    try:
        with open(legacy, encoding="utf-8", errors="replace") as f:
            if MOVED_MARK in f.read(4096):
                return
    except OSError:
        return
    atomic_write(legacy, moved_stub(board_path(run_dir)))


def stored_fingerprint(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            match = FINGERPRINT_RE.search(f.read(4096))
    except OSError:
        return None
    return match.group(1) if match else None


def content_fingerprint(markup: str) -> str:
    return hashlib.sha256(markup.encode("utf-8")).hexdigest()[:20]


def write_if_changed(path: str, page: str, now: float | None = None) -> bool:
    """Write `page` (carrying the CHANGED_* placeholders) only when its content differs from the file."""
    fingerprint = content_fingerprint(page)
    if stored_fingerprint(path) == fingerprint:
        return False
    moment = now if now is not None else time.time()
    page = page.replace(CHANGED_CLOCK, dt.datetime.fromtimestamp(moment).strftime("%m-%d %H:%M"))
    page = page.replace("<head>", f'<head><meta name="board-fingerprint" content="{fingerprint}">', 1)
    atomic_write(path, page)
    return True


LEFTOVERS = ("{boards}/{run_id}.alive.js", "{run_dir}/serve.json")  # from the retired live Board


def remove_leftovers(run_dir: str) -> None:
    for pattern in LEFTOVERS:
        path = pattern.format(boards=boards_dir(), run_id=run_id_of(run_dir), run_dir=os.path.abspath(run_dir))
        with contextlib.suppress(FileNotFoundError):
            os.remove(path)


def write_board(run_dir: str, view: dict, now: float | None = None) -> str:
    from board_render import render_report_page
    path = board_path(run_dir)
    migrate_legacy_board(run_dir)
    remove_leftovers(run_dir)
    reports = {}
    for lane in view["lanes"]:
        if has_full_report(view["run"], lane):
            target = report_path(run_dir, lane["id"])
            write_if_changed(target, render_report_page(view["run"], lane, back=os.path.basename(path)), now)
            reports[lane["id"]] = os.path.basename(target)
    write_if_changed(path, render_html(view, board_file=path, reports=reports), now)
    return path


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


_TAILS: dict[tuple, list[dict]] = {}


def read_tail(path: str, max_bytes: int = TAIL_BYTES) -> list[dict]:
    """Parsed events at the end of a stream; one command reads each stream several times, so unchanged files are cached."""
    try:
        stat = os.stat(path)
    except (OSError, TypeError, ValueError):
        return []
    key = (os.path.abspath(path), stat.st_size, stat.st_mtime_ns, max_bytes)
    if key not in _TAILS:
        if len(_TAILS) > 64:
            _TAILS.clear()
        _TAILS[key] = _read_tail(path, max_bytes)
    return _TAILS[key]


def _read_tail(path: str, max_bytes: int = TAIL_BYTES) -> list[dict]:
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


OUTCOME_LINE = re.compile(r"\s*\**OUTCOME\**:\**\s*\**(\w+)\**[^\n]*(?:\n|$)", re.I)


def said(text: object) -> str:
    """What a Worker said, without the report's machine line `OUTCOME: ...`."""
    text = str(text or "")
    match = OUTCOME_LINE.match(text)
    rest = text[match.end():].strip() if match else text
    return f"AI 说：{short(rest, 50)}" if rest else "AI 交回了结果"


def summarize_events(events: list[dict]) -> dict:
    """Return {activity, ended, failed, subagents, cost} from any supported stream.

    A later event that shows new work (a resumed session appending to the same file)
    clears an earlier end, so a resumed Lane is not reported as finished.
    """
    info = {"activity": None, "ended": False, "failed": False, "subagents": [], "cost": None, "tokens": None}
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
                    working(said(part["text"]))
        elif etype == "result" and ("subtype" in ev or "is_error" in ev or "session_id" in ev):
            info["ended"] = True
            if isinstance(ev.get("session_id"), str):
                info["session"] = ev["session_id"]
            info["failed"] = bool(ev.get("is_error")) or ev.get("subtype") not in (None, "success")
            cost = ev.get("total_cost_usd")
            info["cost"] = cost if isinstance(cost, (int, float)) else None
        elif etype == "system" and isinstance(ev.get("session_id"), str):
            info["session"] = ev["session_id"]  # the init event: known while the Worker still runs
        # Codex exec --json (item.type; pre-0.44 used item_type and assistant_message)
        elif etype in ("item.started", "item.completed", "item.updated"):
            item = as_dict(ev.get("item"))
            itype = item.get("type") or item.get("item_type")
            if itype == "command_execution":
                working(f"运行了命令：{short(item.get('command'), 50)}")
            elif itype in ("agent_message", "assistant_message"):
                working(said(item.get("text")))
            elif itype == "file_change":
                changes = item.get("changes") if isinstance(item.get("changes"), list) else []
                paths = [str(as_dict(c).get("path")) for c in changes if as_dict(c).get("path")]
                working(f"修改了文件：{short(', '.join(paths), 50)}")
            elif itype in ("mcp_tool_call", "web_search"):
                working(f"{itype}: {short(item.get('tool') or item.get('query'), 50)}")
            elif itype in ("collab_tool_call", "subagent"):
                info["subagents"].append(str(item.get("agent") or "subagent"))
            # an item of type "error" is a warning (e.g. unstable-feature notice), not a failed run
        elif etype in ("turn.started", "thread.started"):
            if etype == "thread.started" and isinstance(ev.get("thread_id"), str):
                info["session"] = ev["thread_id"]  # what `codex exec resume` needs; no grepping the stream
            info["ended"] = False
            info["failed"] = False
        elif etype == "turn.completed":
            info["ended"] = True
            usage = as_dict(ev.get("usage"))
            if usage:  # Codex reports tokens, not dollars
                tokens = info["tokens"] or {"input": 0, "output": 0}
                tokens["input"] += int(usage.get("input_tokens") or 0)
                tokens["output"] += int(usage.get("output_tokens") or 0)
                info["tokens"] = tokens
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
            if sum(map(len, grok_text)) < 2000:  # the card needs one line; joining a whole long answer per delta is quadratic
                grok_text.append(ev["data"])
                working(said("".join(grok_text)))
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
    if not minutes:
        return "不到 1 分钟"
    return f"{minutes // 60} 小时 {minutes % 60} 分钟" if minutes >= 60 else f"{minutes} 分钟"


def resolve(run: dict, path: str | None) -> str | None:
    if not path or os.path.isabs(path) or not run.get("_dir"):
        return path
    return os.path.join(run["_dir"], path)


def derive(run: dict, now: float | None = None, orca: dict | None = None, sessions: dict | None = None) -> dict:
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
        if info.get("session") and not lane.get("session"):
            view["session"] = info["session"]
        session = next((s for s in (sessions or {}).get("sessions", []) if s["sessionId"] == view.get("session")), None)
        if session:
            view["session_label"] = session_label(session, lane.get("title") or lane["id"])
            view["session_status"] = session["status"]
            view["resume_command"] = session.get("resumeCommand")
            if lane["state"] in ("working", "needs-you"):
                if session["status"] == "needs-you":
                    view["state"] = "needs-you"
                elif session["status"] == "busy":
                    view["state"] = "working"
                elif session["status"] == "idle" and info["ended"] and not info["failed"]:
                    view["state"] = "finished"
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
            activity = "AI 刚接手，正在准备，几十秒后会有动静"
        if not activity and lane["state"] == "queued":
            activity = "排队中"
        view["activity"] = (lane.get("note") if finished else None) or activity or lane.get("note") or "-"
        view["activity_label"] = "结果" if finished else "正在"
        view["subagents"] = info["subagents"]
        prior_cost, prior_tokens = prior_rounds(lane, view.get("session"))
        current_cost = lane.get("cost", info["cost"])
        view["cost"] = (current_cost or 0) + prior_cost if isinstance(current_cost, (int, float)) or prior_cost else None
        tokens = {k: prior_tokens[k] + int(as_dict(info["tokens"]).get(k) or 0) for k in prior_tokens}
        view["tokens"] = tokens if any(tokens.values()) else None
        view["ended"] = info["ended"]
        view["stream_failed"] = info["failed"]
        view["silent_for"] = (now - last_seen) if last_seen else None
        end = (parse_iso(lane.get("ended_at")) or parse_iso(lane.get("updated_at"))) if finished else (last_seen if view["state"] == "finished" else now)
        view["elapsed"] = max(0, end - (parse_iso(lane.get("started_at")) or end)) if end else None
        view["round"] = int(lane.get("round") or 1) if str(lane.get("round") or 1).isdigit() else 1
        view["waiting_on"] = [titles.get(a, a) for a in lane.get("after") or [] if a not in done_ids]
        view["stale"] = (not session or session["status"] == "unknown") and lane["state"] == "working" and not info["ended"] and view["silent_for"] is not None and view["silent_for"] >= STALE_SECONDS
        flags = []
        target = lane.get("reviews")
        if lane.get("role") == "review" and target and lane.get("pool") and pools.get(target) == lane.get("pool"):
            flags.append("写代码和审代码用了同一个账号，自己审自己可能漏看问题")
        if info["ended"] and lane["state"] == "working" and (not session or session["status"] not in ("busy", "needs-you")):
            flags.append("这部分做完了，等主控 AI 汇总验收" if not info["failed"] else "这个任务跑报错了，等主控 AI 处理")
        if live:
            view["orca"] = live
            if live.get("liveness") == "exited" and lane["state"] == "working":
                flags.append("这个 AI 窗口已关闭（Orca 进程退出），主控 AI 会接手检查")
        if view["stale"]:
            view["stale_flag"] = f"{plain_age(view['silent_for'])}没新进展，主控 AI 会去催问"
            view["silent_since"] = last_seen
            flags.append(view["stale_flag"])
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
    unregistered = []
    if run.get("_dir") and os.path.isdir(run["_dir"]):
        known = {os.path.abspath(resolve(run, p)) for l in run["lanes"] for p in [l.get("output")] + [h.get("output") for h in l.get("history", [])] if p}
        unregistered = sorted(n for n in os.listdir(run["_dir"]) if n.endswith(".jsonl") and os.path.abspath(os.path.join(run["_dir"], n)) not in known)
    running_waits = [w for w in waits if w["state"] == "running"]
    return {"run": run, "lanes": lanes, "waits": waits, "open_asks": open_asks, "running": running, "running_waits": running_waits,
            "unregistered": unregistered, "paused": False}


def state_line(view: dict, board_path: str | None = None) -> str:
    n, m, k = len(view["running"]), len(view["running_waits"]), len(view["open_asks"])
    where = f" · 看板文件：{board_path}" if board_path else ""
    if view["run"].get("state") == "closed":
        return f"已全部结束：共 {len(view['lanes'])} 项任务；还有 {k} 个问题没答{where}"
    if view.get("paused"):
        return f"正在叫停：不再派新活，正等 {n} 个任务、{m} 个外部流程收尾；还有 {k} 个问题等你答复{where}"
    budget = view["run"].get("budget_usd")
    if isinstance(budget, (int, float)):
        spent = sum(l["cost"] for l in view["lanes"] if isinstance(l.get("cost"), (int, float)))
        where = (f" · 已知花费 ${spent:.2f} / 预算 ${budget:.2f}" + ("，已到上限，不再派新活" if spent >= budget else "")) + where
    if n or m or k:
        return f"正在忙：{n} 个任务在做 · {m} 项等外部结果 · {k} 个问题等你答复{where}"
    return f"目前没有正在跑的任务，也没有问题等你回答{where}"


def lane_name(lane: dict, shown: set | None = None) -> str:
    """shown: Lane ids already listed in the same section, so a Subagent can sit under its parent."""
    role = {"write": "正在改代码", "review": "审", "research": "研", "draft": "稿"}.get(lane.get("role") or "", lane.get("role") or "")
    title = str(lane.get("title") or lane["id"])
    account = str(lane.get("account") or "")
    existing = [p.strip() for p in title.split("·")]
    parts = [title] + [p for p in (role, account) if p and p not in existing]
    name = " · ".join(p for p in parts if p)
    if lane.get("kind") == "subagent":
        parent = lane.get("parent") or "coordinator"
        if shown is not None and parent in shown:
            return f"  └ {name}"
        return f"  └ {'主控 AI' if parent == 'coordinator' else parent} 派出的 {name}"
    return name


def render_text(view: dict, board_path: str | None = None) -> str:
    run = view["run"]
    out = [state_line(view, board_path), f"本次要做的事：{run['objective']}  (Run {run['id']})"]
    for name in view.get("unregistered", []):
        out.append(f"⚠ {name} 没有登记到任何任务：续跑或新开的 Worker 要先 lane add，或 lane set --round N --output {name}")
    if view["lanes"] and not run.get("steps") and run.get("state") != "closed":
        out.append("⚠ 看板还没有里程碑：用 step add 登记接下来几步（如 集成、审查、修复、验收），主人才看得出整体进度")
    out.append("")
    out.append("运行中")
    active = [l for l in view["lanes"] if l["state"] in ACTIVE_LANE_STATES]
    if not active:
        out.append("  目前没有；有新动态时会显示在这里")
    shown: set = set()
    for lane in active:
        state = STATE_LABELS.get(lane["state"], lane["state"])
        sub = f" · 含 {len(lane['subagents'])} 个小任务" if lane["subagents"] else ""
        name = lane_name(lane, shown)
        shown.add(lane["id"])
        out.append(f"  {name}  [{state}]  第 {lane['round']} 次尝试（最多 3 次）  耗时 {age(lane['elapsed'])}  {age(lane['silent_for'])}前有动静{sub}")
        if lane.get("session_label"):
            status = SESSION_LABELS.get(lane["session_status"], "状态未知")
            out.append(f"      {lane['session_label']} · {status}")
        out.append(f"      {lane['activity_label']}：{lane['activity']}")
        if lane["waiting_on"]:
            out.append(f"      正等着：{'、'.join(lane['waiting_on'])}")
        meta = lane.get("branch") or ""
        if meta:
            out.append(f"      {meta}")
        for flag in lane["flags"]:
            out.append(f"      ⚠ {flag}")
    out.append("")
    out.append("正等外部流程跑完（如打包、测试、上线）")
    if not view["running_waits"]:
        out.append("  目前没有；有新动态时会显示在这里")
    for wait in view["running_waits"]:
        stale = f"  ⚠ {plain_age(wait['silent_for'])}没新进展，可能卡住了" if wait["stale"] else ""
        out.append(f"  {wait.get('title') or wait['id']}  当前第几步：{wait.get('stage') or '-'}{stale}")
        if wait["waiting_on"]:
            out.append(f"      正等着：{'、'.join(wait['waiting_on'])}")
        if wait.get("last_line"):
            out.append(f"      最新一行输出：{wait['last_line']}")
        out.append(f"      输出记录：{wait.get('log') or '-'}")
    out.append("")
    out.append("等你拿主意（可回主对话说「A1 按推荐」）")
    if not view["open_asks"]:
        out.append("  目前没有；有新动态时会显示在这里")
    for ask in view["open_asks"]:
        out.append(f"  {ask['id']}  {ask['question']}")
        out.append(f"      AI 建议：{ask['recommend']}")
        out.append(f"      依据：{ask['evidence']}")
        out.append(f"      卡住：{ask['blocks']}")
        if ask.get("outward"):
            out.append(f"      发给：{ask.get('recipient')}（{ask.get('channel')}）")
            out.append(f"      草稿：{ask.get('draft')}")
    if run["grants"]:
        out.append("")
        out.append("长期授权")
        for grant in run["grants"]:
            out.append(f"  {grant['id']}  {grant['scope']}（{'本 Run' if grant['outward'] else '直到撤回'}）原话：{grant['words']}")
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



def copy_button(label: str, text: str) -> str:
    return f'<button type="button" data-copy="{html.escape(text, quote=True)}">{html.escape(label)}</button>'


SUMMARY_LINES = 12


def lane_result(run: dict, lane: dict, limit: int | None = 25) -> str:
    """Explicit results are snapshots; automatic output previews stay bounded (limit=None: the whole report)."""
    cut = (lambda text: "\n".join(text.splitlines()[:limit])) if limit else (lambda text: text)
    if lane.get("result") is not None:
        return str(lane["result"])
    path = resolve(run, lane.get("output"))
    if not path:
        return ""
    events = read_tail(path)
    for event in reversed(events):
        if event.get("type") == "result" and isinstance(event.get("result"), str):
            return cut(event["result"])
    if events:  # Never expose event JSON as a final result.
        return ""
    if str(path).lower().endswith((".jsonl", ".json", ".ndjson")):
        return ""
    try:
        with open(path, encoding="utf-8", errors="replace") as source:
            return cut(source.read(65536))
    except OSError:
        return ""


def report_text(run: dict, lane: dict) -> str:
    """The Worker's full report: shown on its own page, never inline on the Board."""
    return lane_result(run, lane, limit=None)


def lane_summary(run: dict, lane: dict) -> str:
    """At most SUMMARY_LINES lines: the registered --summary, else the report's opening up to its first section."""
    text = str(lane["summary"]) if lane.get("summary") is not None else ""
    if not text.strip():
        lines = []
        for line in report_text(run, lane).strip().splitlines():
            if lines and line.lstrip().startswith(("#", "|")) and any(l.strip() for l in lines):
                break
            lines.append(line)
        text = "\n".join(lines)
    match = OUTCOME_LINE.match(text)
    if match:  # the machine line belongs to the report; the reader gets what follows, or a plain word
        text = text[match.end():] if text[match.end():].strip() else first_sentence(text)
    lines = text.strip().splitlines()
    while len(lines) > SUMMARY_LINES or (lines and not lines[-1].strip()):
        lines.pop()
    return "\n".join(lines)


def first_sentence(text: str, limit: int = 120) -> str:
    """One plain sentence for a card: Markdown marks dropped, cut at the first sentence end.

    A report opens with the machine line `OUTCOME: succeeded|failed|blocked|handback` (task-spec.md); the
    reader needs the sentence after it, or a plain word when that line is all there is."""
    match = OUTCOME_LINE.match(str(text or ""))
    if match:
        rest = str(text)[match.end():]
        if rest.strip():
            return first_sentence(rest, limit)
        return {
            "succeeded": "已完成。",
            "failed": "没做完，详见完整报告。",
            "blocked": "卡住了，等你决定。",
            "handback": "超出范围，交回给主控。",
        }.get(match.group(1).lower(), match.group(1))
    line = short(text, 10_000)
    line = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", line).replace("__", "")
    match = re.search(r"[。！？!?](?=\s|$)|[。！？]|\.(?=\s|$)", line)
    if match:
        line = line[: match.end()]
    return line if len(line) <= limit else line[: limit - 1] + "…"


def has_full_report(run: dict, lane: dict) -> bool:
    report = report_text(run, lane).strip()
    return bool(report) and report != lane_summary(run, lane).strip()


def lane_produced(run: dict, lane: dict, board_file: str, report_url: str | None = None) -> str:
    e = lambda value: html.escape(str(value), quote=True)
    summary = lane_summary(run, lane)
    # A one-sentence summary is already the card's line; the disclosure adds only what the card lacks.
    content = f'<div class="md" data-md>{e(summary)}</div>' if summary.strip() and (lane.get("state") in ACTIVE_LANE_STATES or summary.strip() != first_sentence(summary)) else ""
    if report_url:
        content += f'<a class="report-link" href="{e(report_url)}">查看完整报告<span aria-hidden="true"> ↗</span></a>'
    files = lane.get("files")
    worktree = resolve(run, lane.get("worktree"))
    if files is None and worktree and os.path.isdir(worktree):
        status = git(worktree, "status", "--short")
        files = status.splitlines() if status else []
    facts = ""
    cost = lane.get("cost")
    for label, value in (("验证依据", lane.get("evidence")), ("改动文件", files),
                         ("提交记录", lane.get("commits")), ("费用", f"${cost:.2f}" if isinstance(cost, (int, float)) else cost)):
        if value is not None:
            text = "\n".join(map(str, value)) if isinstance(value, list) else str(value)
            if text.strip():
                facts += f'<dt>{label}</dt><dd><pre>{e(text)}</pre></dd>'
    for row in lane.get("history", []):
        when = parse_iso(row.get("at"))
        stamp = dt.datetime.fromtimestamp(when).strftime("%m-%d %H:%M") if when else str(row.get("at", ""))
        facts += f'<dt>第 {e(row.get("round"))} 次 · {e(stamp)}</dt><dd><pre>{e(row.get("note", ""))}</pre></dd>'
    if facts:
        content += f'<dl class="facts">{facts}</dl>'
    for artifact in run.get("artifacts", []):
        if artifact.get("lane") != lane["id"]:
            continue
        path = resolve(run, artifact.get("path"))
        label = e(artifact.get("label", "成果文件"))
        if not path or not os.path.isfile(path):
            content += f'<div class="artifact missing">{label}（文件已被移走或删除）</div>'
            continue
        relative = os.path.relpath(os.path.abspath(path), os.path.dirname(os.path.abspath(board_file)))
        url = e(quote(relative.replace(os.sep, "/"), safe="/"))
        preview = f'<img class="thumbnail" src="{url}" alt="{label}" loading="lazy">' if os.path.splitext(path)[1].lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif") else ""
        content += f'<div class="artifact"><a href="{url}">{preview}{label}</a></div>'
    return f'<div class="more produced" id="produced-{e(lane["id"])}"><h3>做出了什么</h3>{content}</div>' if content else ''


def render_html(view: dict, board_file: str | None = None, reports: dict | None = None) -> str:
    from board_render import render_page
    return render_page(view, board_file, reports=reports)


def render_all(rows: list[dict]) -> str:
    active = [r for r in rows if r.get("state") == "active" and os.path.exists(os.path.join(r.get("dir", ""), LEDGER))]
    if not active:
        return "现在没有正在跑的任务；派活后这里会显示进度。\n"
    lines = []
    for row in active:
        try:
            view = derive(load_run(row["dir"]))
        except BoardError:
            continue
        lines.append(f"{row['id']}  {state_line(view)}\n    要做的事：{row['objective']}\n    {row['dir']}")
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
    init.add_argument("--coordinator-session")
    init.add_argument("--budget-usd", type=float, help="stop starting new Lanes once known spend reaches this many dollars")
    config = sub.add_parser("run")
    config.add_argument("action", choices=("set",))
    config.add_argument("--coordinator-session")
    config.add_argument("--account", help="the Coordinator's account after a handoff, e.g. claude:main")
    config.add_argument("--budget-usd", type=float, help="raise or set the Run budget after the user agreed")
    init.add_argument("--account", help="the Coordinator's account, e.g. claude:008")

    lane = sub.add_parser("lane", help="add or update a Lane or Subagent")
    lane.add_argument("action", choices=("add", "set"))
    lane.add_argument("--id", required=True)
    for flag in ("title", "role", "account", "pool", "branch", "worktree", "output", "dispatch", "session", "note", "reviews", "parent", "evidence", "commits"):
        lane.add_argument(f"--{flag}")
    lane.add_argument("--after", help="comma-separated Lane or Wait ids this Lane waits on")
    lane.add_argument("--kind", choices=("lane", "subagent"))
    lane.add_argument("--state", choices=LANE_STATES)
    lane.add_argument("--round", type=int)
    result = lane.add_mutually_exclusive_group()
    result.add_argument("--result")
    result.add_argument("--result-file", help="read and persist a UTF-8 final result (including Codex -o)")
    summary = lane.add_mutually_exclusive_group()
    summary.add_argument("--summary", help=f"the Worker's short final summary; the Board shows at most {SUMMARY_LINES} lines")
    summary.add_argument("--summary-file", help="read and persist the short summary from a UTF-8 file")
    lane.add_argument("--files", help="comma-separated touched paths")
    lane.add_argument("--owns", help="comma-separated paths or globs a write Lane may edit; overlapping active write Lanes are refused")
    lane.add_argument("--cost", type=float)

    step = sub.add_parser("step", help="record overall milestones")
    step.add_argument("action", choices=("add", "set"))
    step.add_argument("--id", required=True)
    step.add_argument("--title")
    step.add_argument("--state", choices=("queued", "working", "done", "blocked"))
    step.add_argument("--note")
    for command, fields in (("decision", ("what", "choice", "why")),
                            ("artifact", ("lane", "path", "label")),
                            ("commit", ("repo", "hash", "subject"))):
        parser = sub.add_parser(command)
        parser.add_argument("action", choices=("add",))
        for field in fields:
            parser.add_argument("--" + field, required=True)
        if command == "decision":
            parser.add_argument("--options")

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
    for flag in ("question", "recommend", "evidence", "blocks", "recipient", "channel", "draft", "answer", "lane"):
        ask.add_argument(f"--{flag}")
    ask.add_argument("--outward", action="store_true", help="the Ask approves sending, publishing or deploying")

    grant = sub.add_parser("grant", help="record a Standing Grant")
    grant.add_argument("action", choices=("add",))
    grant.add_argument("--scope", required=True)
    grant.add_argument("--words", required=True)
    grant.add_argument("--outward", action="store_true", help="covers deploy, send or publish; lasts this Run only")

    show = sub.add_parser("show", help="print the Run's progress as text")
    show.add_argument("--line", action="store_true", help="print only the Run state line")
    show.add_argument("--html", action="store_true", help="deprecated compatibility flag; show is always read-only")
    show.add_argument("--all", action="store_true", help="list every active Run on this machine")
    show.add_argument("--json", action="store_true")

    watcher = sub.add_parser("watch", help="block until a Lane ends, fails, needs the user or goes silent; run it in the background")
    watcher.add_argument("--timeout", type=int, default=3600, help="seconds before giving up (default 3600)")
    watcher.add_argument("--interval", type=int, default=15, help="seconds between checks (default 15)")

    opener = sub.add_parser("open", help="write the Board report and open it once (Orca tab, else the system browser)")
    opener.add_argument("--panel", action="store_true", help="also open sideby's Panel (`sideby ui`) for live sessions and messages")
    closer = sub.add_parser("close", help="close the Run and move it to archive/")
    closer.add_argument("--force", action="store_true", help="close although an external wait still runs or a question is unanswered")
    return p


def in_run_dir(run_dir: str, path: str) -> str:
    """A bare stream or log name lives in the Run directory, wherever the Coordinator's shell happens to be."""
    path = os.path.expanduser(path)
    return path if os.path.isabs(path) else os.path.join(os.path.abspath(run_dir), path)


def lane_fields(args: argparse.Namespace) -> dict:
    keys = ("id", "title", "role", "account", "pool", "branch", "worktree", "output", "dispatch", "session", "note", "reviews", "parent", "kind", "state", "round", "after", "result", "summary", "files", "owns", "evidence", "commits", "cost")
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


def orca_json(*args: str) -> dict:
    out = subprocess.run(["orca", *args, "--json"], capture_output=True, text=True, timeout=20)
    data = as_dict(json.loads(out.stdout or "{}"))
    return data if out.returncode == 0 and data.get("ok") else {}


def open_in_orca(url: str) -> bool:
    """Reuse a tab already showing this file (navigating reloads it), else create one."""
    try:
        for tab in as_dict(orca_json("tab", "list", "--worktree", "all").get("result")).get("tabs") or []:
            page = as_dict(tab).get("browserPageId")
            if page and str(tab.get("url") or "").split("#")[0].split("?")[0] == url:
                if orca_json("goto", "--url", url, "--page", page):
                    orca_json("tab", "switch", "--page", page, "--focus")
                    return True
        return bool(orca_json("tab", "create", "--url", url))
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


def open_board(path: str) -> str:
    """Open the Board for the user once: an Orca browser tab when Orca runs, else the system browser."""
    if orca_reachable() and open_in_orca(file_url(path)):
        return "orca"
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
    """The Board path once a page exists, including a Run whose only page is still the in-repo one."""
    path = board_path(run_dir)
    return path if os.path.exists(path) or os.path.exists(legacy_board_path(run_dir)) else None



def watch_events(view: dict) -> dict[str, tuple[str, str]]:
    """What the Coordinator must act on, per Lane, as (kind, text): a stream end, a failure, a question, silence.
    watch compares kinds only: the silence text carries an age that changes every minute."""
    events = {}
    for lane in view["lanes"]:
        if lane["state"] not in ("working", "needs-you"):
            continue
        name = str(lane.get("title") or lane["id"])
        if lane["state"] == "needs-you":
            events[lane["id"]] = ("needs-you", f"{name}：在等回答")
        elif lane.get("ended"):
            events[lane["id"]] = ("ended", f"{name}：{'跑报错了' if lane.get('stream_failed') else '做完了'}，去汇总验收")
        elif lane.get("stale"):
            events[lane["id"]] = ("stale", f"{name}：{plain_age(lane['silent_for'])}没有动静，去看日志")
        elif lane.get("orca", {}).get("liveness") == "exited":
            events[lane["id"]] = ("exited", f"{name}：窗口已关闭")
    return events


def watch(run_dir: str, timeout: int, interval: int) -> int:
    """Exit as soon as something changes, so a backgrounded watch wakes the Coordinator instead of a user reply."""
    def current() -> tuple[dict, dict]:
        run = load_run(run_dir)
        view = derive(run, orca=orca_workers(run.get("orca_run")), sessions=SESSION_READER.read())
        return view, watch_events(view)

    view, before = current()
    watched = [l for l in view["lanes"] if l["state"] in ("working", "needs-you") and (l.get("output") or l.get("session") or l.get("dispatch"))]
    if not watched:
        print("没有可以盯的任务：在做的任务都没有 --output、--session 或 --dispatch")
        return 0
    # Only a change wakes the Coordinator: things already pending at start were seen when it chose to wait.
    def report(events: dict) -> int:
        fresh = {k: v for k, v in events.items() if before.get(k, ("",))[0] != v[0]}
        print("\n".join(text for _, text in fresh.values()))
        pending = [text for k, (_, text) in events.items() if k not in fresh]
        if pending:
            print("仍待处理：" + "；".join(pending))
        return 0

    deadline = time.time() + max(1, timeout)
    while time.time() < deadline:
        time.sleep(max(1, min(interval, deadline - time.time())))
        if stopped(run_dir):
            print("Run 已叫停")
            return 0
        view, now_events = current()
        if any(before.get(k, ("",))[0] != v[0] for k, v in now_events.items()):
            return report(now_events)
    print(f"{plain_age(timeout)}内没有任务结束；{state_line(view)}。需要的话再挂一次 watch")
    return 0


def next_step_hint(run_dir: str, view: dict) -> str | None:
    """After dispatching or asking, the Coordinator must keep watching Lanes, not wait for the user."""
    if any(l["state"] == "working" and (l.get("output") or l.get("session") or l.get("dispatch")) for l in view["lanes"]):
        script = os.path.abspath(__file__)
        return (f"下一步：后台运行 python3 {script} --run {run_dir} watch（Claude Code 用 run_in_background），"
                "任务结束、报错、要你回答或久无动静时它会退出提醒；别干等用户回复")
    return None


def show_once(run_dir: str, args: argparse.Namespace) -> None:
    run = load_run(run_dir)
    view = derive(run, orca=orca_workers(run.get("orca_run")), sessions=SESSION_READER.read())
    view["paused"] = stopped(run_dir)
    board = existing_board(run_dir)
    if args.json:
        print(json.dumps({k: v for k, v in view.items() if k != "run"} | {"line": state_line(view), "board": board}, ensure_ascii=False, default=str))
    elif args.line:  # leads a reply as is, so no file path (the user never gets one)
        print(state_line(view))
    else:
        sys.stdout.write(render_text(view, board))


def is_milestone(args: argparse.Namespace) -> bool:
    """Commands that change what the report says; the rest only update the ledger and the index."""
    if args.cmd in ("step", "decision", "artifact", "commit", "ask"):
        return True
    if args.cmd == "lane" and args.action == "add":
        return True
    if args.cmd in ("lane", "wait") and args.action == "set" and args.state is not None:
        return True  # an open Board must not keep saying 进行中 after the work ended
    return args.cmd == "lane" and args.action == "set" and any(
        getattr(args, flag) is not None for flag in ("result", "result_file", "summary", "summary_file", "round"))


def _main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cwd = os.getcwd()
    try:
        if args.cmd == "init":
            run_dir = init_run(args.objective, cwd, args.run_id, args.orca_run, args.account)
            with ledger_lock(run_dir):
                run = load_run(run_dir)
                run["coordinator_session"] = args.coordinator_session or detect_coordinator()
                if args.budget_usd is not None:
                    run["budget_usd"] = args.budget_usd
                save_run(run_dir, run, report=True)
            print(run_dir)
            return 0
        if args.cmd == "show" and args.all:
            sys.stdout.write(render_all(load_registry()))
            return 0
        run_dir = resolve_run_dir(args.run, cwd)
        if args.cmd == "show":
            show_once(run_dir, args)
            return 0
        if args.cmd == "watch":
            return watch(run_dir, args.timeout, args.interval)
        if args.cmd == "open":
            with ledger_lock(run_dir):
                view = derive(load_run(run_dir))
                view["paused"] = stopped(run_dir)
                write_board(run_dir, view)
            show_once(run_dir, build_parser().parse_args(["show", "--line"]))
            where = open_board(board_path(run_dir))
            print({"orca": "已在 Orca 浏览器里打开看板", "browser": "已在系统浏览器打开",
                   "none": "看板没打开；请直接在对话里贴出文字进度（show 的输出），别让主人自己找文件"}[where])
            if args.panel and shutil.which("sideby"):
                try:  # the Panel stays up on its own; `sideby ui --background` returns once it is listening
                    subprocess.run(["sideby", "ui", "--background"], capture_output=True, timeout=30)
                    print("已打开 sideby 面板：在「会话」页看谁在做什么、给某个 AI 发消息")
                except (OSError, subprocess.TimeoutExpired):
                    print("sideby 面板没打开；请让主人自己运行 sideby ui")
            return 0 if where != "none" else 3
        run = load_run(run_dir)
        if args.cmd == "close":
            view = derive(run)
            blocking = [f"外部等待 {w['id']}" for w in view["running_waits"]] + [f"问题 {a['id']}" for a in view["open_asks"]]
            if blocking and not args.force:
                raise BoardError(f"not closed: {'、'.join(blocking)} still open; settle them (wait set / ask answer) and "
                                 "tell the user what blocks the close, or pass --force when the user asked to close anyway")
            print(close_run(run_dir, run))
            return 0
        if args.cmd == "run":
            if args.coordinator_session is None and args.account is None and args.budget_usd is None:
                raise BoardError("run set needs --coordinator-session, --account or --budget-usd")
            if args.coordinator_session is not None:
                run["coordinator_session"] = args.coordinator_session
            if args.account is not None:
                run["coordinator"] = args.account
            if args.budget_usd is not None:
                run["budget_usd"] = args.budget_usd
        elif args.cmd == "lane":
            fields = lane_fields(args)
            if fields.get("output"):
                fields["output"] = in_run_dir(run_dir, fields["output"])
            for flag, key in (("result_file", "result"), ("summary_file", "summary")):
                if getattr(args, flag):
                    try:
                        with open(os.path.expanduser(getattr(args, flag)), encoding="utf-8") as source:
                            fields[key] = source.read()
                    except (OSError, UnicodeError) as exc:
                        raise BoardError(f"cannot read --{flag.replace('_', '-')}: {exc}") from exc
            lane = add_lane(run, fields, run_dir=run_dir) if args.action == "add" else set_lane(run, args.id, fields)
            if lane["state"] == "done" and lane.get("summary") is None and lane.get("result") is None and not lane.get("output"):
                print(f"dispatch_board: 提醒：{lane['id']} 已完成但没有成果。补一条 lane set --id {lane['id']} --summary-file <摘要>，"
                      "否则看板只写“完成”；子 agent 也要在派出前 lane add", file=sys.stderr)
        elif args.cmd in ("step", "decision", "artifact", "commit"):
            record = {k: v for k, v in vars(args).items() if k not in ("run", "cmd", "action") and v is not None}
            rows = run.setdefault({"step": "steps", "decision": "decisions", "artifact": "artifacts", "commit": "commits"}[args.cmd], [])
            if args.cmd == "step":
                if args.action == "set":
                    apply_fields(find(rows, args.id, "Step"), record)
                else:
                    if not args.title or not args.state:
                        raise BoardError("step add requires --title and --state")
                    if any(row["id"] == args.id for row in rows):
                        raise BoardError("Step exists; use step set")
                    rows.append(record)
            else:
                if args.cmd == "artifact":
                    find(run["lanes"], args.lane, "Lane")
                    record["path"] = os.path.abspath(os.path.expanduser(args.path))
                if args.cmd == "commit":
                    record["repo"] = os.path.abspath(os.path.expanduser(args.repo))
                rows.append(record)
        elif args.cmd == "wait":
            fields = {k: getattr(args, k) for k in ("id", "title", "stage", "log", "note", "state", "after") if getattr(args, k) is not None}
            if fields.get("log"):
                fields["log"] = in_run_dir(run_dir, fields["log"])
            (add_wait(run, fields) if args.action == "add" else set_wait(run, args.id, fields))
        elif args.cmd == "ask":
            if args.action == "add":
                fields = {k: getattr(args, k) for k in ("id", "question", "recommend", "evidence", "blocks", "recipient", "channel", "draft", "lane") if getattr(args, k)}
                fields["outward"] = args.outward
                add_ask(run, fields)
            else:
                if not args.answer:
                    raise BoardError("pass --answer with the user's reply")
                answer_ask(run, args.id, args.answer)
        elif args.cmd == "grant":
            add_grant(run, args.scope, args.words, args.outward)
        save_run(run_dir, run, report=is_milestone(args))
        view = derive(run, sessions=SESSION_READER.read())
        view["paused"] = stopped(run_dir)
        print(state_line(view, existing_board(run_dir)))
        if args.cmd in ("lane", "ask") and args.action in ("add", "set") and (hint := next_step_hint(run_dir, view)):
            print(hint)
        return 0
    except BoardError as exc:
        print(f"dispatch_board: {exc}", file=sys.stderr)
        return 2


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd in ("init", "show", "open", "watch"):  # watch sleeps, so it must not hold the ledger lock
        return _main(argv)
    try:
        run_dir = resolve_run_dir(args.run, os.getcwd())
        with ledger_lock(run_dir):
            return _main(argv)
    except (BoardError, OSError) as exc:
        print(f"dispatch_board: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    sys.exit(main())
