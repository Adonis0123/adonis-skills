#!/usr/bin/env python3
"""Aggregate extract.py rows into one summary JSON for judging practices.

Usage: aggregate.py SESSIONS.jsonl [-o SUMMARY.json] [--practices practices.json]

Per host it summarises human sessions (the ones a person drove); headless,
subagent and unknown-entrypoint sessions are counted separately. Cross-host
"concepts" map different tool names that mean the same thing (plan mode, asking
the user, subagents, todo lists) so practices can be judged once for every host.
"Cohorts" count the sessions a practice applies to (complex, wide-exploration,
long, parallel, repeated) with thresholds read from practices.json rule.params.
The summary holds counts only: no prompt text, not even correction examples.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import statistics
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from safe_output import UnsafeOutput, safe_file_target  # noqa: E402

from audit_common import (ASK_USER_TOOLS, CHECK_TAGS, EDIT_TOOLS, LOW_SAMPLE, PRACTICES_PATH,  # noqa: E402,F401
                          load_rules, repo_identity, tilde, worktree_root)

# Tool names (any host) that count as evidence for a concept. get_command_or_subagent_output (Grok) reads
# the output of a shell command or a subagent, so it is not a subagent launch.
CONCEPTS = {
    "plan_mode": {"ExitPlanMode", "EnterPlanMode", "exit_plan_mode"},
    "ask_user": ASK_USER_TOOLS,
    "subagent": {"Agent", "Task", "spawn_agent", "spawn_subagent"},
    "todo": {"TodoWrite", "update_plan", "todo_write", "TaskCreate", "TaskUpdate"},
    "skill": {"Skill"},
    "web": {"WebFetch", "WebSearch", "web_fetch", "web_search"},
}
# Hosts whose logs record plan mode; elsewhere its absence is not evidence (only substitutes count).
PLAN_MODE_HOSTS = {"claude"}
CLEAR_CMDS = ("clear", "new", "reset")
INTERVIEW_WORDS = ("grill", "interview", "brainstorm", "clarify")
# Planning-skill names: plan*, grill*, writing-plans, grilling (a plugin prefix like `x:` is allowed).
PLANNING_SKILL = re.compile(r"(?:^|[:/_-])(plan|grill)", re.I)


def full_access(r: dict) -> bool:
    """No approval and no sandbox together: Claude bypassPermissions, Grok yolo, or a Codex turn context with
    approval=never and danger-full-access in the same turn (extract.py's `full-access` mode)."""
    m = r.get("modes") or {}
    return bool(m.get("bypassPermissions") or m.get("yolo") or m.get("full-access"))


def is_coding(r: dict) -> bool:
    return (any(r["tools"].get(n) for n in EDIT_TOOLS) or bool(r["tools"].get("bash:commit"))
            or bool(r.get("edited_files")))


def load_rows(path: str) -> tuple[list[dict], int]:
    """Rows from extract.py; a malformed line or an error row counts as one error instead of stopping."""
    rows, errors = [], 0
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                errors += 1
                continue
            if not isinstance(r, dict) or "error" in r or not isinstance(r.get("tools"), dict):
                errors += 1
            else:
                rows.append(r)
    return rows, errors


def epoch(ts) -> float | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def minutes(r: dict) -> float | None:
    a, b = epoch(r.get("start")), epoch(r.get("end"))
    return (b - a) / 60 if a is not None and b is not None else None


def pct(n: int, d: int) -> float:
    return round(100 * n / d, 1) if d else 0.0


def tool_total(r: dict) -> int:
    return sum(v for k, v in r["tools"].items() if ":" not in k)


def has_concept(r: dict, concept: str) -> bool:
    if concept == "plan_mode" and "plan" in (r.get("modes") or {}):
        return True
    return any(r["tools"].get(n) for n in CONCEPTS[concept])


def skill_names(r: dict) -> list[str]:
    return [k[6:] for k in r["tools"] if k.startswith("Skill:")] + list(r.get("cmds") or {})


def pre_edit_skills(r: dict) -> list[str]:
    """Skills and slash commands seen before the session's first file edit (extract.py `pre_edit`); rows from an
    older extract.py without that field fall back to every skill in the session."""
    if "pre_edit" not in r:
        return skill_names(r)
    return [k.split(":", 1)[1] for k in r["pre_edit"] if k.startswith(("Skill:", "cmd:"))]


def asked_before_edit(r: dict) -> bool:
    return "ask" in r["pre_edit"] if "pre_edit" in r else has_concept(r, "ask_user")


def planning_skill(r: dict) -> bool:
    return any(PLANNING_SKILL.search(n) for n in pre_edit_skills(r))


def interviewed(r: dict) -> bool:
    """Asked the user, or ran an interview-style skill, before the first file edit."""
    return asked_before_edit(r) or any(w in n.lower() for n in pre_edit_skills(r) for w in INTERVIEW_WORDS)


def offloaded(r: dict) -> bool:
    """A linked subagent transcript did read/search calls itself; where the host keeps no linked subagent
    transcript for this session, any subagent call counts."""
    if r.get("sub_linked"):
        return num(r.get("sub_explore")) > 0
    return has_concept(r, "subagent")


def top(counter: collections.Counter, n: int) -> list:
    return [[k, v] for k, v in counter.most_common(n)]


def repo_of(cwd: str | None) -> str:
    """Working directory with worktree checkouts folded into their repository (see audit_common.WORKTREE_RX)."""
    return worktree_root(cwd)[0]


def cwd_key(r: dict) -> str:
    return r.get("cwd_id") or str(r.get("cwd"))


def repo_key(r: dict) -> str:
    """Full repository identity (hashed by extract.py); rows without it fall back to the folded path."""
    return r.get("repo_id") or repo_identity(r.get("cwd"))


def repo_label(r: dict) -> str:
    return r.get("repo") or tilde(repo_of(r.get("cwd")))


def need(rules: dict, pid: str, *keys: str) -> dict | None:
    """rule.params of one practice when every key is present, else None (the cohort is then left out)."""
    p = rules.get(pid) or {}
    return p if all(k in p for k in keys) else None


def link_subagents(rows: list[dict]) -> None:
    """Add each subagent transcript's read/search calls to its parent session (`explore_all`), so offloaded
    exploration still counts toward the wide-exploration cohort. Linked: Claude sidechains (path), Codex
    parent_thread_id, Grok parent_session_id; unlinked subagents count only in their own row."""
    by_sid = {(r["host"], r.get("sid")): r for r in rows if r.get("sid") and r["kind"] != "subagent"}
    for r in rows:
        r["explore_all"] = num(r.get("explore"))
    for r in rows:
        if r["kind"] == "subagent" and r.get("parent"):
            parent = by_sid.get((r["host"], r["parent"]))
            if parent is not None:
                parent["explore_all"] += num(r.get("explore"))
                parent["sub_explore"] = num(parent.get("sub_explore")) + num(r.get("explore"))
                parent["sub_linked"] = True


def fresh_start(r: dict) -> bool:
    """A session that opens a clean context: one started by /clear or /new, or any new human session
    (another account, another host, a sideby handoff, or a plain new window; Grok logs no /new)."""
    return r.get("started_by") in CLEAR_CMDS or (r.get("kind") == "human" and num(r.get("prompts")) > 0)


def mark_cleared(rows: list[dict], gap_minutes: float) -> None:
    """A long session counts as cleared when a different fresh session (see fresh_start) in the same working
    directory, on any host or account, begins within gap_minutes after its end (or, in older logs, when
    /clear appears inside it). A handoff session (its first prompt points at a handoffs/ brief) may start up
    to gap_minutes before the end, since the old session can log its last reply after the handoff began."""
    starts = collections.defaultdict(list)
    for r in rows:
        if fresh_start(r) and epoch(r.get("start")) is not None:
            starts[cwd_key(r)].append((epoch(r["start"]), id(r), bool(r.get("handoff"))))
    gap = gap_minutes * 60
    for r in rows:
        end = epoch(r.get("end"))
        # A different session that starts at or after this one ends, within the gap; never the session itself.
        succ = end is not None and any(rid != id(r) and (0 <= s - end <= gap or (ho and abs(s - end) <= gap))
                                       for s, rid, ho in starts.get(cwd_key(r), ()))
        r["_cleared"] = bool(succ or (r.get("cmds") or {}).get("clear"))


def per100(rs: list[dict]) -> float:
    """Corrections per 100 prompts."""
    p = sum(r["prompts"] for r in rs)
    return round(100 * sum(r["corrections"] for r in rs) / p, 1) if p else 0.0


def cohorts(hs: list[dict], rules: dict) -> dict:
    """Sessions where a practice applies, and how many of them follow it (thresholds from practices.json).
    A cohort whose rule.params are missing is left out."""
    out = {}
    count = lambda rs, f: sum(1 for r in rs if f(r))  # noqa: E731
    pm = need(rules, "plan-mode-first", "complex_edited_files", "complex_tool_calls")
    if pm:
        cx = [r for r in hs if num(r.get("edited_files")) >= pm["complex_edited_files"]
              or tool_total(r) >= pm["complex_tool_calls"]]
        out["complex"] = {"n": len(cx), "plan": count(cx, lambda r: has_concept(r, "plan_mode")),
                          "plan_or_sub": count(cx, lambda r: has_concept(r, "plan_mode") or asked_before_edit(r)
                                               or planning_skill(r)),
                          "interview": count(cx, interviewed),
                          "plan_logged": bool(hs) and hs[0]["host"] in PLAN_MODE_HOSTS}
    sub = need(rules, "ctx-subagent-offload", "wide_explore")
    if sub:
        wide = [r for r in hs if num(r.get("explore_all", r.get("explore"))) >= sub["wide_explore"]]
        out["wide"] = {"n": len(wide), "subagent": count(wide, offloaded)}
    cl = need(rules, "ctx-clear-between-tasks", "long_tools")
    if cl:
        long_ = [r for r in hs if tool_total(r) > cl["long_tools"]]
        out["long"] = {"n": len(long_), "cleared": count(long_, lambda r: r.get("_cleared")),
                       "compact": count(long_, lambda r: r["compactions"]),
                       "corr_per100": per100(long_)}
    return out


def idle_gaps(hs: list[dict]) -> dict:
    """{"idle_gaps": {n, compacted, auto, sessions}} when extract.py recorded idle gaps for these rows (Claude), else
    {}. `compacted`: the user's /compact came right before the gap; `auto`: only an auto-compaction did."""
    rs = [r for r in hs if "idle_gaps" in r]
    if not rs:
        return {}
    return {"idle_gaps": {"n": int(sum(num(r["idle_gaps"]) for r in rs)),
                          "compacted": int(sum(num(r.get("idle_gaps_compacted")) for r in rs)),
                          "auto": int(sum(num(r.get("idle_gaps_auto")) for r in rs)),
                          "sessions": sum(1 for r in rs if num(r["idle_gaps"]))}}


def num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def host_summary(hs: list[dict], rules: dict) -> dict:
    n = len(hs)
    has = lambda f: sum(1 for r in hs if f(r))  # noqa: E731
    tools, skills, agents, cmds, efforts, models, modes, cats = (collections.Counter() for _ in range(8))
    for r in hs:
        for k, v in r["tools"].items():
            if k.startswith("Skill:"):
                skills[k[6:]] += 1
            elif k.startswith("Agent:"):
                agents[k[6:]] += v
            else:
                tools[k] += 1
        cmds.update(set(r.get("cmds") or {}))
        cats.update(r.get("corr_cats") or {})
        if r.get("efforts"):
            efforts[max(r["efforts"], key=r["efforts"].get)] += 1
        if r.get("models"):
            models[max(r["models"], key=r["models"].get)] += 1
        modes.update(set(r.get("modes") or {}))
    tt = [tool_total(r) for r in hs]
    ds = [d for d in (minutes(r) for r in hs) if d is not None]
    co = cohorts(hs, rules)
    coding = [r for r in hs if is_coding(r)]
    long_tools = (rules.get("ctx-clear-between-tasks") or {}).get("long_tools")
    long_ = [r for r in hs if long_tools is not None and tool_total(r) > long_tools]
    return {
        "sessions": n,
        "median_prompts": statistics.median(r["prompts"] for r in hs),
        "p90_prompts": sorted(r["prompts"] for r in hs)[min(n - 1, int(n * 0.9))],
        "median_prompt_chars": round(statistics.median(r["prompt_chars"] / r["prompts"] for r in hs)),
        "median_tool_calls": statistics.median(tt),
        "long_sessions": len(long_),
        "pct_compaction_long": pct(sum(1 for r in long_ if r["compactions"]), len(long_)),
        # Hand-typed /compact commands and those with a focus argument (Claude <command-args>).
        "compact_cmds": int(sum(num((r.get("cmds") or {}).get("compact")) for r in hs)),
        "compact_focus": int(sum(num(r.get("compact_focus")) for r in hs)),
        "corrections_per100_prompts": per100(hs),
        "median_minutes": round(statistics.median(ds), 1) if ds else None,
        "pct_with_compaction": pct(has(lambda r: r["compactions"] > 0), n),
        "pct_with_correction": pct(has(lambda r: r["corrections"] > 0), n),
        "corrections_total": sum(r["corrections"] for r in hs),
        "correction_categories": dict(cats.most_common()),
        "pct_with_interrupt": pct(has(lambda r: r["interrupts"] > 0), n),
        "pct_with_denial": pct(has(lambda r: r["denials"] > 0), n),
        "pct_started_by_clear": pct(has(lambda r: r.get("started_by") in CLEAR_CMDS), n),
        "pct_first_prompt_done_when": pct(has(lambda r: r.get("first_done_when")), n),
        "full_access_sessions": has(full_access),
        "coding_sessions": len(coding),
        "pct_coding_with_check": pct(sum(1 for r in coding if any(r["tools"].get(t) for t in CHECK_TAGS)), len(coding)),
        "cohorts": co,
        **idle_gaps(hs),
        "concepts_pct": {c: pct(has(lambda r, c=c: has_concept(r, c)), n) for c in CONCEPTS},
        "pct_session_tool_use": {k: pct(v, n) for k, v in tools.most_common(40) if not k.startswith("bash:")},
        "pct_session_bash_tags": {k[5:]: pct(v, n) for k, v in tools.most_common() if k.startswith("bash:")},
        "top_skills": top(skills, 25),
        "agent_types_calls": top(agents, 12),
        "slash_cmds_sessions": top(cmds, 25),
        "efforts": top(efforts, 10),
        "models": top(models, 8),
        "modes_sessions": top(modes, 12),
        "accounts": top(collections.Counter(r.get("account") for r in hs), 10),
        # Sessions per account that ran without permission prompts (Claude bypass/auto, Grok yolo): which
        # settings roots were actually exercised that way.
        "bypass_by_account": dict(collections.Counter(
            r.get("account") for r in hs if set(r.get("modes") or {}) & {"bypassPermissions", "auto", "yolo"})),
        "cwd_top": top(collections.Counter(repo_label(r) for r in hs), 12),
        "longest_sessions": [[tilde(r.get("path")), tool_total(r), r["compactions"]] for r in
                             sorted(long_, key=tool_total, reverse=True)[:5]],
    }


def edits_files(r: dict) -> bool:
    return bool(num(r.get("edited_files"))) or any(r["tools"].get(n) for n in EDIT_TOOLS)


def project_key(r: dict) -> str:
    """Which project a session works on: the git remote shared by every clone (hashed by extract.py), else
    the full repository identity. Clones of one remote in different directories group together."""
    return r.get("remote_id") or repo_key(r)


def checkout_key(r: dict) -> str:
    """The working tree itself: a worktree checkout or another clone is a different one."""
    return r.get("checkout_id") or cwd_key(r)


def checkouts(r: dict) -> set:
    """Checkouts a session edited in (extract.py `edit_checkouts`: a session that switched into a worktree
    counts there), else the checkout it started in."""
    return set(r.get("edit_checkouts") or ()) or {checkout_key(r)}


def parallel(hs: list[dict], max_span_hours: float, min_overlap_minutes: float) -> dict:
    """Human sessions that edited files while another human session (any host) edited the same project for
    at least min_overlap_minutes. A session is isolated only when none of its
    overlapping partners shares its checkout: a worktree checkout or another clone of the same remote has
    its own checkout_id, so a worktree tag alone does not exempt two sessions in one worktree.

    Sessions longer than max_span_hours (often resumed across days), sessions in ~ and sessions that edited
    nothing are left out.
    """
    by_project = collections.defaultdict(list)
    for r in hs:
        # Grouped by project (remote, else full repository identity with worktrees folded), so /one/app and
        # /two/app stay apart unless they are clones of one remote. Only counts leave this function.
        repo, a, b = repo_key(r), epoch(r.get("start")), epoch(r.get("end"))
        if not repo or repo_label(r) == "~" or a is None or b is None or b - a > max_span_hours * 3600:
            continue
        if not edits_files(r):
            continue
        by_project[project_key(r)].append((a, b, r))
    partners: dict[int, list[dict]] = collections.defaultdict(list)
    par: dict[int, dict] = {}
    for items in by_project.values():
        items.sort(key=lambda x: x[0])
        for i, (a, b, r) in enumerate(items):
            for a2, b2, r2 in items[i + 1:]:
                if a2 >= b:
                    break  # sorted by start: no later session overlaps r
                if min(b, b2) - a2 >= min_overlap_minutes * 60:
                    partners[id(r)].append(r2)
                    partners[id(r2)].append(r)
                    par[id(r)], par[id(r2)] = r, r2
    rs = list(par.values())

    def isolated(r: dict) -> bool:
        # The checkouts decide, worktree tag or not: a worktree has its own checkout_id, while two sessions
        # editing in the same worktree (or one that ran `git worktree add` but kept editing the main
        # checkout) still share one. Isolated = no edited checkout in common with any overlapping partner.
        mine = checkouts(r)
        return all(not (mine & checkouts(p)) for p in partners[id(r)])
    iso = [r for r in rs if isolated(r)]
    wt = [r for r in rs if r["tools"].get("bash:worktree")]
    by_host = collections.Counter(r["host"] for r in rs)
    iso_host = collections.Counter(r["host"] for r in iso)
    return {"sessions": len(rs), "isolated": len(iso), "with_worktree": len(wt),
            "separate_clone": sum(1 for r in iso if not r["tools"].get("bash:worktree")),
            "isolated_worktree": sum(1 for r in iso if r["tools"].get("bash:worktree")),
            "repos": len({project_key(r) for r in rs}),
            "by_host": {h: [by_host[h], iso_host[h]] for h in sorted(by_host)}}


def repeated(rows: list[dict], repeat_min: int) -> dict:
    """Sessions whose first prompt shares its shape with at least repeat_min - 1 others (a repeated task)."""
    shapes = collections.Counter(r.get("shape") for r in rows if r.get("shape"))
    reps = {s for s, c in shapes.items() if c >= repeat_min}
    return {"shapes": len(reps), "sessions": sum(shapes[s] for s in reps)}


def aggregate(rows: list[dict], errors: int = 0, rules: dict | None = None) -> dict:
    rules = load_rules() if rules is None else rules
    link_subagents(rows)
    gap = need(rules, "ctx-clear-between-tasks", "clear_gap_minutes")
    mark_cleared(rows, gap["clear_gap_minutes"] if gap else 0)
    out = {
        "files": len(rows) + errors,
        "errors": errors,
        "kinds": dict(collections.Counter(f"{r['host']}/{r['kind']}" for r in rows)),
        "entries": dict(collections.Counter(f"{r['host']}/{r.get('entry')}" for r in rows)),
        "cohort_params": {k: rules.get(k) for k in ("plan-mode-first", "ctx-subagent-offload",
                                                    "ctx-clear-between-tasks", "auto-worktrees", "auto-headless")},
        "hosts": {},
    }
    human = [r for r in rows if r["kind"] == "human" and r["prompts"] > 0]
    for host in sorted({r["host"] for r in rows}):
        hs = [r for r in human if r["host"] == host]
        if hs:
            out["hosts"][host] = host_summary(hs, rules)
    head = [r for r in rows if r["kind"] == "headless"]
    own = [r for r in head if r.get("self_audit")]
    user_head = [r for r in head if not r.get("self_audit")]
    hp = need(rules, "auto-headless", "repeat_min")
    wp = need(rules, "auto-worktrees", "max_span_hours", "min_overlap_minutes")
    out["headless"] = {
        "sessions": len(head),
        "self_audit": len(own),
        "scheduled": sum(1 for r in head if r.get("scheduled")),
        "by_host": dict(collections.Counter(r["host"] for r in head)),
        "repeated": repeated(user_head, hp["repeat_min"]) if hp else None,
        "efforts_by_host": {h: top(collections.Counter(max(r["efforts"], key=r["efforts"].get)
                                                       for r in head if r["host"] == h and r.get("efforts")), 6)
                            for h in sorted({r["host"] for r in head})},
    }
    out["human_repeated"] = repeated(human, hp["repeat_min"]) if hp else None
    out["parallel"] = parallel(human, wp["max_span_hours"], wp["min_overlap_minutes"]) if wp else None
    out["subagent"] = {"sessions": sum(1 for r in rows if r["kind"] == "subagent")}
    out["unknown"] = {"sessions": sum(1 for r in rows if r["kind"] == "unknown"),
                      "by_host": dict(collections.Counter(r["host"] for r in rows if r["kind"] == "unknown"))}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("sessions", help="JSONL written by extract.py")
    ap.add_argument("-o", "--out", help="write the summary here instead of stdout")
    ap.add_argument("--practices", default=PRACTICES_PATH, help="practices.json whose rule.params define cohorts")
    a = ap.parse_args(argv)
    if a.out:
        try:
            a.out = safe_file_target(a.out)
        except UnsafeOutput as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
    rows, errors = load_rows(a.sessions)
    text = json.dumps(aggregate(rows, errors, load_rules(a.practices)), ensure_ascii=False, indent=1)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
