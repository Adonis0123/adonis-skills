#!/usr/bin/env python3
"""Paired outcome benchmark: does working with agent-dispatch beat working solo? (references/measure.md)

Each trial clones the repository at a task commit's parent, asks a headless Claude Code session to redo the
change (arm `solo`: on its own; arm `dispatch`: through the agent-dispatch skill, which may dispatch other
CLIs), then copies the commit's own tests over the result and runs the task's acceptance commands. Grading
looks only at the outcome, never at the path. One JSON line per trial goes to <out>/results.jsonl; read it
with compare.py.

Safety: every trial works in its own clone with the `origin` remote removed and `git push` disallowed, and
its agent-dispatch ledgers live in the clone, never in the user's state directory.

  python3 run_bench.py --out <dir> --runs 3 --agent-cmd "sideby run {account} --" \
      --accounts claude:001,claude:002,claude:008
  python3 run_bench.py --out <dir> --fake reference   # harness self-check: every task must pass
  python3 run_bench.py --out <dir> --fake noop        # harness self-check: every task must fail
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import glob
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ARMS = {
    "solo": (
        "Work on this yourself in this repository checkout. Do not delegate to other agents, CLIs or accounts, "
        "and do not use the agent-dispatch skill."
    ),
    "dispatch": (
        "Use the agent-dispatch skill (/agent-dispatch) to decide how to do this, then carry it out in this "
        "repository checkout; dispatch to other CLIs or accounts only if the skill decides to. For this checkout "
        "everything is authorized: worktrees and short branches under it, local commits on those branches, and "
        "headless workers whose permissions cover this checkout. The user is away: decide reversible choices "
        "yourself as recommended."
    ),
}
COMMON = (
    "Leave the finished change in this checkout's working tree (uncommitted is fine). Do not push, deploy, "
    "publish or message anyone. Finish with a short summary of what you changed and how you verified it."
)
NODE_MODULES = ("node_modules", "apps/web/node_modules")
_write_lock = threading.Lock()


def sh(args: list[str], cwd: str, timeout: int = 600, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)


def load_tasks(path: str, only: list[str] | None) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        tasks = json.load(f)["tasks"]
    if only:
        missing = set(only) - {t["id"] for t in tasks}
        if missing:
            raise SystemExit(f"unknown task id(s) {', '.join(sorted(missing))}; tasks.json has {', '.join(t['id'] for t in tasks)}")
        tasks = [t for t in tasks if t["id"] in only]
    return tasks


def build_prompt(task: dict, arm: str) -> str:
    return f"{task['prompt'].strip()}\n\n{ARMS[arm]} {COMMON}"


def prepare_clone(repo: str, task: dict, work: str) -> None:
    if os.path.exists(work):
        shutil.rmtree(work)
    os.makedirs(os.path.dirname(work), exist_ok=True)
    sh(["git", "clone", "--quiet", "--shared", repo, work], cwd=os.path.dirname(work)).check_returncode()
    sh(["git", "checkout", "--quiet", f"{task['commit']}^"], cwd=work).check_returncode()
    sh(["git", "remote", "remove", "origin"], cwd=work)  # nothing to push to, whatever the agent tries
    if task.get("needs_node_modules"):
        for rel in NODE_MODULES:
            src = os.path.join(repo, rel)
            if os.path.isdir(src) and not os.path.exists(os.path.join(work, rel)):
                os.symlink(src, os.path.join(work, rel))


def changed_paths(repo: str, commit: str) -> list[str]:
    out = sh(["git", "diff", "--name-only", f"{commit}^", commit], cwd=repo)
    return [p for p in out.stdout.splitlines() if p]


def run_agent(cmd: list[str], prompt: str, work: str, log: str, timeout: int) -> dict:
    env = dict(os.environ, AGENT_DISPATCH_STATE_DIR=os.path.join(work, ".bench-state"))
    argv = cmd + ["-p", prompt, "--output-format", "stream-json", "--verbose",
                  "--permission-mode", "bypassPermissions", "--disallowedTools", "Bash(git push:*)"]
    start = time.time()
    timed_out = False
    with open(log, "w", encoding="utf-8") as out:
        proc = subprocess.Popen(argv, cwd=work, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, env=env)
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            proc.kill()  # this trial's own process, by pid
            proc.wait()
    return {"wall_s": round(time.time() - start, 1), "exit": proc.returncode, "timed_out": timed_out, **read_stream(log)}


def read_stream(log: str) -> dict:
    info = {"cost_usd": None, "turns": None, "model": None, "is_error": None, "final": ""}
    try:
        lines = open(log, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return info
    for line in lines:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "system" and ev.get("subtype") == "init":
            info["model"] = ev.get("model")
        if ev.get("type") == "result":
            info.update(cost_usd=ev.get("total_cost_usd"), turns=ev.get("num_turns"),
                        is_error=ev.get("is_error"), final=str(ev.get("result") or "")[-4000:])
    return info


def dispatch_facts(work: str, final: str) -> dict:
    """What the dispatch arm actually did, read from its own ledgers and its dispatch line."""
    lanes = []
    for ledger in glob.glob(os.path.join(work, ".agent-dispatch", "*", "*", "run.json")):
        try:
            lanes += json.load(open(ledger, encoding="utf-8")).get("lanes", [])
        except (OSError, ValueError):
            continue
    # The skill asks for a `Dispatch: L<n>` line; headless runs often only name the tier in prose (判为 L1).
    tier = re.search(r"Dispatch:\s*(L\d|Research|Writing)", final) or re.search(r"(?<![A-Za-z0-9])(L[0-3])(?![0-9])", final)
    costs = [l["cost"] for l in lanes if isinstance(l.get("cost"), (int, float))]
    return {"tier": tier.group(1) if tier else None, "lanes": len(lanes),
            "lane_accounts": sorted({str(l.get("account")) for l in lanes if l.get("account")}),
            "lane_cost_usd": round(sum(costs), 4) if costs else None, "lanes_without_cost": len(lanes) - len(costs)}


def accept(repo: str, task: dict, work: str) -> dict:
    for rel in task["hidden_tests"]:
        content = sh(["git", "show", f"{task['commit']}:{rel}"], cwd=repo)
        content.check_returncode()
        os.makedirs(os.path.dirname(os.path.join(work, rel)) or work, exist_ok=True)
        with open(os.path.join(work, rel), "w", encoding="utf-8") as f:
            f.write(content.stdout)
    checks = []
    for command in task["accept"]:
        try:
            res = sh(["bash", "-lc", command], cwd=work, timeout=900)
            checks.append({"cmd": command, "rc": res.returncode, "tail": (res.stdout + res.stderr)[-1500:]})
        except subprocess.TimeoutExpired:
            checks.append({"cmd": command, "rc": None, "tail": "timed out"})
    return {"pass": all(c["rc"] == 0 for c in checks), "checks": checks}


def done_trials(out: str) -> set[tuple[str, str, int]]:
    """(task, arm, rep) already recorded in <out>/results.jsonl, so an interrupted run can resume."""
    path = os.path.join(out, "results.jsonl")
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    return {(r["task"], r["arm"], r["rep"]) for r in rows}


def trial(args: argparse.Namespace, task: dict, arm: str, rep: int) -> dict:
    name = f"{task['id']}-{arm}-{rep}"
    work = os.path.join(args.out, "work", name)
    log = os.path.join(args.out, "logs", f"{name}.jsonl")
    os.makedirs(os.path.dirname(log), exist_ok=True)
    prepare_clone(args.repo, task, work)
    row = {"task": task["id"], "arm": arm, "rep": rep, "commit": task["commit"], "started": time.strftime("%Y-%m-%dT%H:%M:%S")}
    if args.fake == "reference":
        sh(["git", "checkout", task["commit"], "--", *changed_paths(args.repo, task["commit"])], cwd=work).check_returncode()
        row.update(wall_s=0.0, cost_usd=0.0, account="fake")
    elif args.fake == "noop":
        row.update(wall_s=0.0, cost_usd=0.0, account="fake")
    else:
        account = args.accounts[(rep - 1) % len(args.accounts)] if args.accounts else ""
        cmd = shlex.split(args.agent_cmd.format(account=account))
        row["account"] = account
        row.update(run_agent(cmd, build_prompt(task, arm), work, log, args.timeout))
        if arm == "dispatch":
            row.update(dispatch_facts(work, row.get("final", "")))
    row.update(accept(args.repo, task, work))
    known = [v for v in (row.get("cost_usd"), row.get("lane_cost_usd")) if isinstance(v, (int, float))]
    row["total_known_cost_usd"] = round(sum(known), 4) if known else None
    with _write_lock, open(os.path.join(args.out, "results.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"{name}: {'PASS' if row['pass'] else 'FAIL'} {row.get('wall_s')}s ${row.get('total_known_cost_usd')}", flush=True)
    return row


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True, help="results and clones go here (outside the repository)")
    p.add_argument("--tasks", default=os.path.join(HERE, "tasks.json"))
    p.add_argument("--repo", default=None, help="repository the task commits belong to (default: git toplevel of this script)")
    p.add_argument("--only", help="comma-separated task ids")
    p.add_argument("--arms", default="solo,dispatch")
    p.add_argument("--runs", type=int, default=3, help="repetitions per task and arm (default 3; failures can show in only some runs)")
    p.add_argument("--jobs", type=int, default=2, help="trials at once (each dispatch trial starts its own workers)")
    p.add_argument("--agent-cmd", default="claude", help="headless Claude Code command; {account} is replaced per run")
    p.add_argument("--accounts", help="comma-separated accounts, rotated by repetition so both arms of a run share one")
    p.add_argument("--timeout", type=int, default=2700, help="seconds per agent run (default 45 min)")
    p.add_argument("--fake", choices=("reference", "noop"), help="skip the agent: apply the real commit, or nothing")
    p.add_argument("--skip-done", action="store_true", help="skip trials already in <out>/results.jsonl (resume an interrupted run)")
    args = p.parse_args(argv)
    args.repo = args.repo or sh(["git", "rev-parse", "--show-toplevel"], cwd=HERE).stdout.strip()
    args.out = os.path.abspath(args.out)
    if os.path.commonpath([args.out, args.repo]) == args.repo:
        raise SystemExit(f"--out {args.out} is inside the repository; pick a directory outside it so clones never land in git status")
    args.accounts = [a for a in (args.accounts or "").split(",") if a]
    arms = [a for a in args.arms.split(",") if a]
    bad = set(arms) - set(ARMS)
    if bad:
        raise SystemExit(f"unknown arm(s) {', '.join(sorted(bad))}; use {', '.join(ARMS)}")
    tasks = load_tasks(args.tasks, [t for t in (args.only or "").split(",") if t] or None)
    jobs = [(t, a, r) for r in range(1, args.runs + 1) for t in tasks for a in arms]
    if args.skip_done:
        done = done_trials(args.out)
        jobs = [(t, a, r) for t, a, r in jobs if (t["id"], a, r) not in done]
    os.makedirs(args.out, exist_ok=True)
    failures = 0
    with cf.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for fut in cf.as_completed([pool.submit(trial, args, *j) for j in jobs]):
            try:
                fut.result()
            except Exception as exc:  # one broken trial must not hide the others' results
                failures += 1
                print(f"trial error: {exc}", file=sys.stderr, flush=True)
    print(f"done: {len(jobs) - failures}/{len(jobs)} trials recorded in {os.path.join(args.out, 'results.jsonl')}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
