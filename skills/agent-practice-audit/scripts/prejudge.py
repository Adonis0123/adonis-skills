#!/usr/bin/env python3
"""Pre-judge every practice from summary.json and config-scan.json into one small judge-input.json.

Usage: prejudge.py --summary SUMMARY.json --config CONFIG.json [--practices P] [--days N] [-o OUT]

For each practice id the output holds its `detect` and `rule` text, only the
numbers they need per host (human sessions, largest host first), and a
deterministic first verdict (`draft`) from the thresholds in the practice's
`rule.params` (practices.json is the single source of truth; no threshold lives
in code: a missing param leaves `draft: null` with a note). Drafts
judge applicability first: a workload the user does not have is `na`, not `no`.
Semantic practices get `draft: null` and a `note`. The agent accepts or
overrides each draft; it does not have to read the full summary or config scan.

Output carries counts, ratios, config keys and `~/...` paths only: no prompt
excerpts, no env values, no deny rules.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from safe_output import UnsafeOutput, safe_file_target  # noqa: E402

from audit_common import LOW_SAMPLE, PRACTICES_PATH, rules_from, tilde  # noqa: E402

DEFAULT_PRACTICES = PRACTICES_PATH
GLOBAL_DIR_PREFIXES = (".claude", ".codex", ".grok", ".gemini")
SECRET_KEYS = ("key_files", "ssh", "aws", "cloud_credentials")  # secret paths besides .env files
CHECK_TAGS = ("test", "lint", "typecheck", "screenshot")
# Practices drafted from session logs: with only low-sample hosts they get no verdict.
LOG_BASED = {"ctx-clear-between-tasks", "ctx-subagent-offload", "ctx-compact-focus", "ctx-compact-before-break",
             "safe-low-risk-preset", "plan-mode-first", "plan-interview", "verify-runnable-checks", "auto-worktrees",
             "auto-headless"}


# ---------------------------------------------------------------- helpers

def pairs(v) -> dict:
    """[[k, n], ...] from aggregate.py as a dict (bad shapes become {})."""
    out = {}
    for p in v or []:
        if isinstance(p, (list, tuple)) and len(p) == 2:
            out[str(p[0])] = p[1]
    return out


def safe_key(k) -> str:
    """A log-derived name as an output key: path-like names keep only their last component."""
    k = str(k)
    if "/" not in k and "\\" not in k:
        return k
    return os.path.basename(k.replace("\\", "/").rstrip("/")) or "(path)"


def safe_pairs(v, limit: int) -> dict:
    out = {}
    for k, n in pairs(v).items():
        if len(out) >= limit:
            break
        k = safe_key(k)
        out[k] = out.get(k, 0) + n
    return out


def tilde_only(p: str) -> str:
    """audit_common.tilde: `~/...` kept, anything else reduced to `(outside ~)/<name>`."""
    return tilde(p)


def num(v) -> int | float:
    """A count or ratio from the summary; fractions are kept (an int only when the value is whole)."""
    try:
        f = float(v or 0)
    except (TypeError, ValueError):
        return 0
    return int(f) if f.is_integer() else f


def round1(x) -> float:
    return round(float(x), 1)


class Ctx:
    def __init__(self, summary: dict, config: dict, rules: dict | None = None):
        self.summary = summary if isinstance(summary, dict) else {}
        self.config = config if isinstance(config, dict) else {}
        self.rules = rules if rules is not None else {}
        hosts = self.summary.get("hosts") if isinstance(self.summary.get("hosts"), dict) else {}
        hosts = {h: v for h, v in hosts.items() if isinstance(v, dict)}
        self.hosts = dict(sorted(hosts.items(), key=lambda kv: -num(kv[1].get("sessions"))))
        self.low = [h for h, v in self.hosts.items() if num(v.get("sessions")) < LOW_SAMPLE]
        self.main = [h for h in self.hosts if h not in self.low]
        accounts = pairs((self.hosts.get("claude") or {}).get("accounts"))
        self.active = set(accounts) if accounts else None  # None: no account data, judge every root
        self.bypass = (self.hosts.get("claude") or {}).get("bypass_by_account") or {}

    def n(self, h: str) -> int:
        return num(self.hosts[h].get("sessions"))

    def p(self, pid: str) -> dict:
        return self.rules.get(pid) or {}

    def weighted(self, getter) -> float | None:
        """Session-weighted mean of a per-host percentage over hosts with enough sessions."""
        num_ = den = 0.0
        for h in self.main:
            v = getter(self.hosts[h])
            if v is None:
                continue
            num_ += float(v) * self.n(h)
            den += self.n(h)
        return round1(num_ / den) if den else None

    def cohort(self, name: str, *fields: str):
        """({host: [n, *fields]}, totals over hosts with enough sessions) for one aggregate cohort,
        or None when the summary has no cohorts (an older aggregate.py)."""
        per, tot, found = {}, dict.fromkeys(("n",) + fields, 0), False
        for h, v in self.hosts.items():
            c = (v.get("cohorts") or {}).get(name) if isinstance(v.get("cohorts"), dict) else None
            if not isinstance(c, dict):
                continue
            found = True
            per[h] = [num(c.get(k)) for k in ("n",) + fields]
            if h in self.main:
                for k in tot:
                    tot[k] += num(c.get(k))
        return (per, tot) if found else None


def pct(n, d) -> float:
    return round1(100 * n / d) if d else 0.0


def draft(status: str, reason: str, ctx: Ctx | None = None) -> dict:
    d = {"status": status, "reason": reason}
    if ctx is not None and ctx.low:
        d["low_sample"] = ctx.low
    return d


def concept(h: dict, c: str):
    return (h.get("concepts_pct") or {}).get(c)


# ---------------------------------------------------------------- config views

def root_account(r: dict) -> str:
    return os.path.basename(str(r.get("root") or "").rstrip("/"))


def inactive_roots(config: dict, active: set | None) -> int:
    """Claude roots with no human session in the window: listed, not judged."""
    if active is None:
        return 0
    return sum(1 for r in config.get("claude") or [] if isinstance(r, dict) and root_account(r) not in active)


def claude_setups(config: dict, key: str = "claude", active: set | None = None) -> tuple[list[dict], int]:
    """Distinct Claude settings setups (multi-account roots often symlink one file) and roots without settings.
    With `active` (account names seen in the window), global roots of other accounts are left out."""
    groups, no_settings = {}, 0
    for r in config.get(key) or []:
        if not isinstance(r, dict):
            continue
        if key == "claude" and active is not None and root_account(r) not in active:
            continue
        files = [r[n] for n in ("settings.json", "settings.local.json")
                 if isinstance(r.get(n), dict) and not r[n].get("unreadable")]
        skills = r.get("skills") if isinstance(r.get("skills"), dict) else {}
        if not files:
            no_settings += 1
            continue
        cov_keys = sorted({k for f in files for k in (f.get("deny_coverage") or {})})
        s = {
            "hooks": sum(int(f.get("hook_entries") or 0) for f in files),
            "enforcing": sum(int(f.get("enforcing_hook_entries") or 0) for f in files),
            "deny": sum(int(f.get("deny_count") or 0) for f in files),
            "deny_coverage": {k: any((f.get("deny_coverage") or {}).get(k) for f in files) for k in cov_keys},
            "default_mode": next((f.get("default_mode") for f in files if f.get("default_mode")), None),
            "custom_subagents": int(r.get("custom_subagents") or 0),
            "skills": int(skills.get("count") or 0),
            "skills_over_500_lines": int(skills.get("over_500_lines") or 0),
        }
        # Topics of every hook (a formatter after edits enforces too); older scans have blocking-hook topics only.
        s["hook_topics"] = sorted({t for f in files for t in (f.get("hook_topics") if "hook_topics" in f
                                                               else f.get("enforcing_hook_topics")) or []})
        s["deny_topics"] = sorted({t for f in files for t in f.get("deny_topics") or []})
        s["sandbox"] = any(f.get("sandbox_enabled") for f in files)
        # Size of the enforced set: every hook entry and every deny rule, as the page counts them.
        s["enforced"] = s["hooks"] + s["deny"]
        gkey = json.dumps(s, sort_keys=True)
        g = groups.setdefault(gkey, dict(s, roots=0, accounts=[], example=tilde_only(r.get("root"))))
        g["roots"] += 1
        g["accounts"].append(root_account(r))
    return sorted(groups.values(), key=lambda g: -g["roots"]), no_settings


def instruction_files(config: dict) -> list[dict]:
    """Instruction files deduplicated by realpath; `codex` marks files Codex reads. Subdirectory files
    (`subdir`) are left out: only doc-test-commands reads them, straight from repo_instructions."""
    by_real: dict[str, dict] = {}
    for scope in ("global_instructions", "repo_instructions"):
        for f in config.get(scope) or []:
            if not isinstance(f, dict) or f.get("subdir"):
                continue
            path = str(f.get("path") or "")
            name, parent = os.path.basename(path), os.path.basename(os.path.dirname(path))
            is_global = scope == "global_instructions" or parent.startswith(GLOBAL_DIR_PREFIXES)
            codex = name in ("AGENTS.md", "AGENTS.override.md") and (not is_global or parent.startswith(".codex"))
            real = str(f.get("realpath") or path)
            e = by_real.setdefault(real, {"path": tilde_only(real), "bytes": int(f.get("bytes") or 0),
                                          "lines": int(f.get("lines") or 0), "must": num(f.get("must_rules")),
                                          "topics": f.get("must_topics") if isinstance(f.get("must_topics"), dict)
                                          else {},
                                          "compact": bool(f.get("compact_instructions")),
                                          "compact_notes": bool(f.get("compact_notes")), "codex": False,
                                          "claude_md": False, "global": True})
            e["codex"] = e["codex"] or codex
            e["claude_md"] = e["claude_md"] or name == "CLAUDE.md"  # also a CLAUDE.md symlinked to another file
            e["global"] = e["global"] and is_global
    return list(by_real.values())


def codex_doc_limit(config: dict, default: int) -> int:
    vals = [c.get("project_doc_max_bytes") for c in config.get("codex") or [] if isinstance(c, dict)]
    vals = [v for v in vals if isinstance(v, int) and v > 0]
    return min(vals) if vals else default


def full_access(h: dict) -> int | None:
    """Human sessions with no approval and no sandbox in the same session, from aggregate's joint count.

    None when the host logs no modes, or when an older summary lacks the joint count: separate
    approval/sandbox counts cannot tell whether both happened in one session.
    """
    if not pairs(h.get("modes_sessions")) or "full_access_sessions" not in h:
        return None
    return num(h.get("full_access_sessions"))


# ---------------------------------------------------------------- practices
# Each returns (metrics, draft | None, note | None). Thresholds come from the practice's rule.params
# (ctx.p); the rule text travels with the item, so draft reasons state only the measured numbers.
# A draft rates applicability first: a workload the user does not have is na, never no.

def p_ctx_clear(ctx: Ctx):
    r = ctx.p("ctx-clear-between-tasks")
    m = {}
    for h, v in ctx.hosts.items():
        long_ = (v.get("cohorts") or {}).get("long") or {}
        m[h] = {"long": num(v.get("long_sessions")), "cleared": num(long_.get("cleared")),
                "started_by_clear_pct": v.get("pct_started_by_clear"),
                "corr100": num(v.get("corrections_per100_prompts")), "corr100_long": num(long_.get("corr_per100"))}
    if not ctx.main:
        return m, None, "only low-sample hosts"
    n = sum(ctx.n(h) for h in ctx.main)
    long_n = sum(m[h]["long"] for h in ctx.main)
    cleared = sum(m[h]["cleared"] for h in ctx.main)
    long_pct, clear_pct = pct(long_n, n), pct(cleared, long_n)
    # Corrections per prompt (floats), and only where enough long sessions exist to mean anything.
    worse = [h for h in ctx.main if m[h]["long"] >= r["min_long"]
             and float(m[h]["corr100_long"]) > float(m[h]["corr100"])]
    reason = (f"{long_n}/{n} ({long_pct}%) long; {cleared}/{long_n} ({clear_pct}%) followed by a /clear or /new "
              f"session; more corrections per prompt when long: {worse or 'none'}")
    if long_pct < r["long_ok_pct"] or (long_n and clear_pct >= r["clear_ok_pct"]):
        return m, draft("ok", reason, ctx), None
    # Task relatedness is not logged: long sessions are only a proxy, so the worst draft is part.
    if long_pct >= r["long_part_pct"] and worse:
        return m, draft("part", reason, ctx), None
    return m, draft("na", reason + ": long sessions may each be one task", ctx), None


def cohort_draft(ctx: Ctx, co, min_cohort: int, what: str, empty: str):
    """Shared na / missing-cohort handling: (metrics, early result or None, cohort size)."""
    if co is None:
        return {}, ({}, None, "summary has no cohorts; rerun aggregate.py"), 0
    per, tot = co
    if not ctx.main:
        return {"hosts": per}, ({"hosts": per}, None, "only low-sample hosts"), 0
    m = {"hosts": per, "all": tot}
    n = int(tot["n"])
    if n < min_cohort:
        return m, (m, draft("na", f"{n} {what} (< {min_cohort}): {empty}", ctx), None), n
    return m, None, n


def p_ctx_subagent(ctx: Ctx):
    r = ctx.p("ctx-subagent-offload")
    m, early, n = cohort_draft(ctx, ctx.cohort("wide", "subagent"), r["min_cohort"],
                                  "wide-exploration sessions", "too few to judge offloading")
    if early:
        return early
    k = int(m["all"]["subagent"])
    share = pct(k, n)
    reason = f"subagents in {k}/{n} ({share}%) wide-exploration sessions"
    status = "ok" if share >= r["ok_pct"] else ("part" if k else "no")
    return m, draft(status, reason, ctx), None


def p_ctx_custom_subagents(ctx: Ctx):
    def defs(key: str, active: set | None = None) -> list[int]:  # agents/*.md per root, settings file or not
        return [int(r.get("custom_subagents") or 0) for r in ctx.config.get(key) or []
                if isinstance(r, dict) and (active is None or root_account(r) in active)]
    m = {"claude_custom_subagents": max(defs("claude", ctx.active), default=0),
         "project_custom_subagents": sum(defs("claude_projects"))}
    for h, v in ctx.hosts.items():
        types = pairs(v.get("agent_types_calls"))
        if types:
            m[h] = {"agent_types": safe_pairs(v.get("agent_types_calls"), 4)}
    if not m["claude_custom_subagents"] and not m["project_custom_subagents"]:
        return m, draft("na", "no custom subagent definitions (agents/*.md): no definition to set a model in",
                        ctx), None
    return m, None, "semantic: read agents/*.md; simple ones should set model: haiku or another smaller model"


def p_ctx_compact_focus(ctx: Ctx):
    r = ctx.p("ctx-compact-focus")
    files = [f for f in instruction_files(ctx.config) if f["compact"]]
    m = {"compact_cmds": {h: [num(v.get("compact_cmds")), num(v.get("compact_focus"))] for h, v in ctx.hosts.items()
                          if num(v.get("compact_cmds"))}}
    cmds = sum(num(v.get("compact_cmds")) for v in ctx.hosts.values())
    focus = sum(num(v.get("compact_focus")) for v in ctx.hosts.values())
    if files:
        m["files"] = [f["path"] for f in files][:2]
        return m, draft("ok", f"{len(files)} instruction file(s) with Compact instructions", ctx), None
    notes = [f for f in instruction_files(ctx.config) if f.get("compact_notes")]
    if notes:
        m["notes_files"] = [f["path"] for f in notes][:2]
    reason = (f"no Compact instructions heading{f'; compaction notes in {len(notes)} file(s)' if notes else ''}; "
              f"{focus}/{cmds} hand-typed /compact commands carry a focus")
    if cmds and pct(focus, cmds) >= r["focus_ok_pct"]:
        return m, draft("ok", reason, ctx), None
    if focus or notes:  # some focus given, or what to keep is written down without the heading
        return m, draft("part", reason, ctx), None
    if cmds >= r["min_compacts"]:
        return m, draft("no", reason, ctx), None
    return m, draft("na", reason + ": auto-compaction alone is not judged", ctx), None


def p_ctx_compact_before_break(ctx: Ctx):
    r = ctx.p("ctx-compact-before-break")
    # [gaps, after the user's /compact, after an auto-compaction only]; the rule counts /compact.
    m = {h: [num(g.get("n")), num(g.get("compacted")), num(g.get("auto"))] for h, v in ctx.hosts.items()
         if isinstance(g := v.get("idle_gaps"), dict)}
    if not m:
        return {}, None, "summary has no idle-gap counts (Claude logs only; rerun extract.py and aggregate.py)"
    n = sum(m[h][0] for h in m if h in ctx.main)
    k = sum(m[h][1] for h in m if h in ctx.main)
    auto = sum(m[h][2] for h in m if h in ctx.main)
    reason = (f"/compact before {k}/{n} ({pct(k, n)}%) idle gaps of >= {r['gap_minutes']} min; "
              f"auto-compaction alone before {auto}")
    if n < r["min_gaps"]:
        return m, draft("na", reason + f" (< {r['min_gaps']} gaps)", ctx), None
    status = "ok" if pct(k, n) >= r["ok_pct"] else ("part" if pct(k, n) >= r["part_pct"] else "no")
    return m, draft(status, reason, ctx), None


def p_safe_low_risk(ctx: Ctx):
    r = ctx.p("safe-low-risk-preset")
    setups, _ = claude_setups(ctx.config, active=ctx.active)
    # Today's sandbox setting is not applied to past sessions: they still count as full access.
    sandbox_now = bool(setups) and all(s["sandbox"] for s in setups)
    m = {}
    num_ = den = 0
    for h, v in ctx.hosts.items():
        fa = full_access(v)
        if fa is None:
            continue  # the host does not log modes
        m[h] = {"full_access": fa}
        if h in ctx.main:
            num_ += fa
            den += ctx.n(h)
    codex = {}
    for c in ctx.config.get("codex") or []:
        if isinstance(c, dict) and c.get("present"):
            key = f"approval={c.get('approval_policy')} sandbox={c.get('sandbox_mode')}"
            codex[key] = codex.get(key, 0) + 1
    if codex:
        m["codex_config_roots"] = codex
    m["claude_sandbox_now"] = sandbox_now
    if not den:
        return m, None, "no host has a joint full-access count (modes not logged, or rerun aggregate.py)"
    share = pct(num_, den)
    m["full_access_pct"] = share
    reason = (f"{num_}/{den} ({share}%) human sessions ran full access; Claude sandbox is "
              f"{'now enabled (not applied to past sessions)' if sandbox_now else 'not enabled'}; "
              "trusted repos and isolated machines are not logged")
    status = "no" if share >= r["no_pct"] else ("part" if share >= r["ok_below_pct"] else "ok")
    return m, draft(status, reason, ctx), None


def p_safe_hooks_for_musts(ctx: Ctx):
    setups, no_settings = claude_setups(ctx.config, active=ctx.active)
    projects, _ = claude_setups(ctx.config, "claude_projects")
    files = instruction_files(ctx.config)
    must = sum(f["must"] for f in files)
    must_topics = sorted({t for f in files for t in f["topics"]})
    every = setups + projects
    enforced_topics = sorted({t for s in every for t in s["hook_topics"] + s["deny_topics"]})
    m = {"must_rule_lines": must, "must_topics": must_topics, "enforced_topics": enforced_topics,
         "setups": [[s["roots"], s["enforcing"], s["deny"]] for s in setups]}
    if projects:
        m["project_setups"] = {"count": sum(s["roots"] for s in projects),
                               "with_enforcing_or_deny": sum(s["roots"] for s in projects if s["enforcing"] or s["deny"])}
    if not must:
        return m, draft("na", "no must-rule lines in instruction files", ctx), None
    if not every:
        return m, None, "no Claude settings found; check other hosts' hook support"
    covered = sorted(set(must_topics) & set(enforced_topics))
    missing = sorted(set(must_topics) - set(enforced_topics))
    reason = f"{must} must-rule lines on {must_topics or 'no known topic'}; enforced: {covered or 'none'}"
    if must_topics and not missing:
        return m, draft("ok", reason, ctx), None
    if covered or any(s["enforcing"] or s["deny"] or s["hooks"] for s in every):
        return m, draft("part", reason + f"; not enforced: {missing or 'topics unknown'}", ctx), None
    return m, draft("no", reason, ctx), None


def p_safe_small_set(ctx: Ctx):
    r = ctx.p("safe-small-enforced-set")
    setups, _ = claude_setups(ctx.config, active=ctx.active)
    m = {"setups": [{"roots": s["roots"], "hooks": s["hooks"], "deny": s["deny"], "enforced": s["enforced"]}
                    for s in setups]}
    if inactive_roots(ctx.config, ctx.active):
        m["inactive_roots"] = inactive_roots(ctx.config, ctx.active)
    if not setups:
        return m, draft("na", "no Claude settings files in active roots", ctx), None
    worst = max(setups, key=lambda s: s["enforced"])
    n = worst["enforced"]
    reason = f"{n} enforced rules ({worst['hooks']} hooks + {worst['deny']} deny) in {worst['example']}"
    status = "ok" if n < r["ok_below"] else ("part" if n < r["no_from"] else "no")
    return m, draft(status, reason, ctx), None


def p_safe_deny_secrets(ctx: Ctx):
    setups, no_settings = claude_setups(ctx.config, active=ctx.active)
    m = {"setups": [], "roots_without_settings": no_settings}
    if inactive_roots(ctx.config, ctx.active):
        m["inactive_roots"] = inactive_roots(ctx.config, ctx.active)
    # Deny rules hold in every permission mode, so every active setup is graded; bypass/auto use is reported only.
    grades = []
    for s in setups:
        cov = s["deny_coverage"]
        env, other = bool(cov.get("env_files")), [k for k in SECRET_KEYS if cov.get(k)]
        m["setups"].append({"roots": s["roots"], "default_mode": s["default_mode"], "env_files": env,
                            "other_secrets": other,
                            "bypass_sessions": sum(num(ctx.bypass.get(a)) for a in s["accounts"])})
        grades.append((2 if env else (1 if other else 0), s))
    if not setups:
        return m, None, "no Claude settings files in active roots; check other hosts or mark na"
    score, worst = min(grades, key=lambda g: g[0])
    status = ("no", "part", "ok")[score]
    what = {0: "neither .env files nor other secret paths", 1: "other secret paths but not .env files",
            2: ".env files"}[score]
    return m, draft(status, f"deny covers {what} in {worst['example']} (worst of {len(setups)} active setups)",
                    ctx), None


def p_doc_short(ctx: Ctx):
    r = ctx.p("doc-short-instructions")
    files = instruction_files(ctx.config)
    long_ = [f for f in files if f["claude_md"] and f["lines"] > r["line_target"]]  # the 200-line target is CLAUDE.md's
    m = {"files": len(files), "max_bytes": max((f["bytes"] for f in files), default=0),
         "max_lines": max((f["lines"] for f in files), default=0),
         "over_lines": [{"path": f["path"], "lines": f["lines"]} for f in long_][:2]}
    chains = []
    for c in ctx.config.get("codex") or []:
        if isinstance(c, dict) and isinstance(c.get("instruction_chain_bytes_max"), int):
            limit = c.get("project_doc_max_bytes")
            limit = limit if isinstance(limit, int) and limit > 0 else r["codex_doc_bytes"]
            chains.append((c["instruction_chain_bytes_max"], limit, c.get("instruction_chain_repo"),
                           c.get("global_instructions_bytes")))
    if chains:
        worst = max(chains, key=lambda x: x[0] - x[1])
        m["codex_chain"] = {"bytes": worst[0], "limit": worst[1], "repo": tilde_only(worst[2]) if worst[2] else None}
        if isinstance(worst[3], int):
            m["codex_chain"]["global_bytes"] = worst[3]
        chains = [c[:3] for c in chains]
        over = [c for c in chains if c[0] > c[1]]
    else:  # older config scan: per-file sizes of files Codex reads
        limit = codex_doc_limit(ctx.config, r["codex_doc_bytes"])
        over = [(f["bytes"], limit, f["path"]) for f in files if f["codex"] and f["bytes"] > limit]
        m["codex_limit_bytes"] = limit
    if not files and not chains:
        return m, draft("na", "no instruction files found", ctx), None
    parts = []
    if over:  # Codex stops adding files at the cap; raising it is allowed, so this is part, never no
        b, limit, _ = max(over, key=lambda x: x[0])
        parts.append(f"Codex instruction chain {b} bytes > {limit}")
    if long_:
        parts.append(f"{len(long_)} CLAUDE.md file(s) over {r['line_target']} lines")
    if parts:
        return m, draft("part", "; ".join(parts), ctx), None
    return m, draft("ok", f"every CLAUDE.md and the Codex chain within limits ({len(files)} distinct files)", ctx), None


def p_doc_test_commands(ctx: Ctx):
    repos: dict[str, dict] = {}
    for f in ctx.config.get("repo_instructions") or []:
        if not isinstance(f, dict):
            continue
        # The scan tags each file (root or subdirectory) with its repository; older scans hold root files only.
        d = str(f.get("repo") or os.path.dirname(str(f.get("path") or "")))
        if os.path.basename(d.rstrip("/")).startswith(GLOBAL_DIR_PREFIXES):
            continue  # a global config dir, exempt
        r = repos.setdefault(d, {"build": False, "test": False, "lint": False, "files": 0})
        for k in ("build", "test", "lint"):  # lint includes typecheck commands (config_scan RE_LINT)
            r[k] = r[k] or bool(f.get("mentions_" + k))
        r["files"] += 1
    kinds = ("build", "test", "lint")
    checked = [d for d, r in repos.items() if any(r[k] for k in kinds)]
    # Each repository names what it lacks of Codex's build / test / lint list; listed, not scored.
    m = {"repos": len(repos), "with_check": len(checked),
         "with": {k: sum(r[k] for r in repos.values()) for k in kinds},
         "missing": [{"repo": tilde_only(d), "lacks": [k for k in kinds if not r[k]], "files": r["files"]}
                     for d, r in repos.items() if not all(r[k] for k in kinds)][:4]}
    if not repos:
        return m, draft("na", "no repository instruction files among the most-used directories", ctx), None
    reason = f"{len(checked)}/{len(repos)} repositories name a build, test, lint or typecheck command"
    if len(checked) == len(repos):
        return m, draft("ok", reason, ctx), None
    return m, draft("part" if checked else "no", reason, ctx), None


def p_doc_update(ctx: Ctx):
    m = {h: {"corr_pct": v.get("pct_with_correction"),
             "categories": dict(list((v.get("correction_categories") or {}).items())[:2])}
         for h, v in ctx.hosts.items()}
    return m, None, "semantic: compare correction category counts with rules in the instruction files"


def p_doc_skills(ctx: Ctx):
    r = ctx.p("doc-skills-on-demand")
    setups, _ = claude_setups(ctx.config, active=ctx.active)
    other = ctx.config.get("other_skills") if isinstance(ctx.config.get("other_skills"), dict) else {}
    claude_skills = max((s["skills"] for s in setups), default=0)
    skills = claude_skills + num(other.get("codex")) + num(other.get("agents"))
    long_skills = max((s["skills_over_500_lines"] for s in setups), default=0)
    m = {"skills": {"claude": claude_skills, "codex": num(other.get("codex")), "agents": num(other.get("agents"))},
         "skills_over_500_lines": long_skills}
    m["used_pct"] = {h: concept(v, "skill") for h, v in ctx.hosts.items() if concept(v, "skill")}  # context only
    long_docs = [f for f in instruction_files(ctx.config) if f["claude_md"] and f["lines"] > r["line_target"]]
    if long_docs:
        m["long_claude_md"] = [{"path": f["path"], "lines": f["lines"]} for f in long_docs][:2]
        return m, draft("part", f"{skills} skills installed; {len(long_docs)} CLAUDE.md file(s) over "
                                f"{r['line_target']} lines", ctx), None
    if skills:
        return m, draft("ok", f"{skills} skills installed; every CLAUDE.md within {r['line_target']} lines", ctx), None
    return m, draft("na", "no skills and short CLAUDE.md files: nothing to move", ctx), None


def p_plan_mode(ctx: Ctx):
    r = ctx.p("plan-mode-first")
    m, early, n = cohort_draft(ctx, ctx.cohort("complex", "plan", "plan_or_sub"), r["min_cohort"],
                               "complex sessions", "too few to judge planning")
    if early:
        return early
    # Hosts that log plan mode are judged on plan mode itself (substitutes reach part); hosts that do not
    # are judged on substitutes alone (ok / part, never no). The verdict is session-weighted across both.
    logged = [h for h in ctx.main if ((ctx.hosts[h].get("cohorts") or {}).get("complex") or {}).get("plan_logged")]
    other = [h for h in ctx.main if h not in logged]
    m["plan_logged_hosts"] = logged
    groups, parts = [], []
    ln, lplan, lsub = (sum(m["hosts"][h][i] for h in logged) for i in (0, 1, 2))
    if ln >= r["min_cohort"]:
        s = "ok" if pct(lplan, ln) >= r["ok_pct"] else ("part" if pct(lsub, ln) >= r["part_pct"] else "no")
        groups.append((s, ln))
        parts.append(f"plan mode in {lplan}/{ln} ({pct(lplan, ln)}%) on {logged}")
    on, osub = (sum(m["hosts"][h][i] for h in other) for i in (0, 2))
    if on >= r["min_cohort"]:
        s = "ok" if pct(osub, on) >= r["ok_pct"] else ("part" if pct(osub, on) >= r["part_pct"] else "na")
        if s != "na":
            groups.append((s, on))
        parts.append(f"substitutes in {osub}/{on} ({pct(osub, on)}%) on {other}")
    reason = "; ".join(parts) or f"{n} complex sessions"
    if not groups:
        return m, draft("na", reason, ctx), None
    score = sum({"ok": 2, "part": 1, "no": 0}[s] * k for s, k in groups) / sum(k for _, k in groups)
    return m, draft("ok" if score >= 1.5 else ("part" if score >= 0.5 else "no"), reason, ctx), None


def p_plan_interview(ctx: Ctx):
    r = ctx.p("plan-interview")
    m, early, n = cohort_draft(ctx, ctx.cohort("complex", "interview"), r["min_cohort"],
                               "complex sessions", "too few to judge interviews")
    if early:
        return early
    k = int(m["all"]["interview"])
    reason = f"ask-user or an interview skill in {k}/{n} ({pct(k, n)}%) complex sessions"
    # Interviewing is an option for vague requests: a rate below the bar is no evidence either way.
    return m, draft("ok" if pct(k, n) >= r["ok_pct"] else "na", reason, ctx), None


def p_plan_done_when(ctx: Ctx):
    m = {h: v.get("pct_first_prompt_done_when") for h, v in ctx.hosts.items()
         if v.get("pct_first_prompt_done_when") is not None}
    return m, None, "semantic: the share is a keyword hint only; usually na unless instruction files ask for done-when"


def p_verify_checks(ctx: Ctx):
    r = ctx.p("verify-runnable-checks")
    m = {}
    for h, v in ctx.hosts.items():
        tags = v.get("pct_session_bash_tags") or {}
        m[h] = {t: tags.get(t, 0) for t in CHECK_TAGS}
    num_ = den = 0.0
    for h in ctx.main:
        v = ctx.hosts[h]
        if "pct_coding_with_check" in v and num(v.get("coding_sessions")):
            m[h]["coding"] = num(v.get("coding_sessions"))
            m[h]["check_pct"] = v.get("pct_coding_with_check")
            num_ += float(v.get("pct_coding_with_check") or 0) * num(v.get("coding_sessions"))
            den += num(v.get("coding_sessions"))
    if not den:
        # Older summary: the max per-tag share is only a lower bound, so it can prove ok but never part/no.
        low = ctx.weighted(lambda v: max([(v.get("pct_session_bash_tags") or {}).get(t, 0) for t in CHECK_TAGS]))
        if low is not None and low >= r["ok_pct"]:
            return m, draft("ok", f">= {low}% of human sessions ran a check (lower bound)", ctx), None
        return m, None, "no any-check coverage in summary (rerun aggregate.py); per-tag max is only a lower bound"
    if den < LOW_SAMPLE:
        return m, draft("na", f"{int(den)} coding sessions (< {LOW_SAMPLE}): too few to judge", ctx), None
    w = round1(num_ / den)
    m["coding_with_check_pct"] = w
    reason = f"{w}% of {int(den)} coding sessions ran test/lint/typecheck/screenshot"
    status = "ok" if w >= r["ok_pct"] else ("part" if w >= r["part_pct"] else "no")
    return m, draft(status, reason, ctx), None


def p_verify_revert(ctx: Ctx):
    return {}, draft("na", "no single log signal for revert-and-retry (git, /rewind or manual edits)", ctx), None


def p_auto_worktrees(ctx: Ctx):
    r = ctx.p("auto-worktrees")
    par = ctx.summary.get("parallel")
    if not isinstance(par, dict):
        return {}, None, "summary has no parallel-session count; rerun aggregate.py"
    # `isolated` (worktree or a separate clone of the same remote); older summaries only have with_worktree.
    n, k = num(par.get("sessions")), num(par.get("isolated", par.get("with_worktree")))
    m = {"parallel": n, "isolated": k, "with_worktree": num(par.get("with_worktree")),
         "separate_clone": num(par.get("separate_clone")), "isolated_worktree": num(par.get("isolated_worktree")),
         "repos": num(par.get("repos")),
         "by_host": par.get("by_host") or {}}
    if n < r["min_cohort"]:
        return m, draft("na", f"{n} parallel editing sessions in one repository (< {r['min_cohort']}): "
                              "no parallel work seen", ctx), None
    reason = (f"worktree or separate clone in {k}/{n} ({pct(k, n)}%) parallel editing sessions across "
              f"{m['repos']} repos ({m['isolated_worktree']} in a worktree, {m['separate_clone']} in another checkout; "
              f"{m['with_worktree']} carry a worktree tag)")
    status = "ok" if pct(k, n) >= r["ok_pct"] else ("part" if k else "no")
    return m, draft(status, reason, ctx), None


def schedulers(ctx: Ctx) -> tuple[int, int]:
    s = ctx.config.get("schedulers") if isinstance(ctx.config.get("schedulers"), dict) else {}
    return sum(num(s.get(k)) for k in ("launchd", "cron", "ci")), num(s.get("with_limits"))


def p_auto_headless(ctx: Ctx):
    r = ctx.p("auto-headless")
    head = ctx.summary.get("headless") if isinstance(ctx.summary.get("headless"), dict) else {}
    rep = head.get("repeated") if isinstance(head.get("repeated"), dict) else None
    hum = ctx.summary.get("human_repeated") if isinstance(ctx.summary.get("human_repeated"), dict) else {}
    jobs, _ = schedulers(ctx)
    sched = num(head.get("scheduled"))
    m = {"headless": num(head.get("sessions")), "self_audit": num(head.get("self_audit")),
         "by_host": head.get("by_host") or {}, "scheduled_jobs": jobs, "scheduled_runs": sched}
    if rep is None:
        return m, None, "summary has no repeated-shape counts; rerun aggregate.py"
    x, h = num(rep.get("sessions")), num(hum.get("sessions"))
    own = num(head.get("sessions")) - num(head.get("self_audit"))
    m.update(headless_repeated=x, human_repeated=h)
    reason = f"{own} headless sessions besides this skill's own; {jobs} scheduled jobs, {sched} scheduled runs"
    if h >= r["min_repeat_sessions"]:  # listed as script candidates, not scored
        reason += f"; {h} hand-typed sessions repeat a first-prompt shape"
    # The pages say where headless runs fit, not that they are a duty: no use is na, never no.
    return m, draft("ok" if own > 0 or jobs or sched else "na", reason, ctx), None


def p_auto_headless_limits(ctx: Ctx):
    head = ctx.summary.get("headless") if isinstance(ctx.summary.get("headless"), dict) else {}
    n = num(head.get("sessions")) - num(head.get("self_audit"))
    jobs, limited = schedulers(ctx)
    m = {"headless": n, "scheduled_jobs": jobs, "jobs_with_limits": limited}
    if not jobs:  # scheduled jobs are the unattended runs the logs can see; other headless runs may be attended
        return m, draft("na", f"no scheduled headless jobs ({n} other headless sessions)", ctx), None
    status = "ok" if limited >= jobs else ("part" if limited else "no")
    reason = f"{limited}/{jobs} scheduled headless jobs pass --max-turns / --max-budget-usd"
    if status != "ok":
        reason += "; an account spend limit is not visible locally"
    return m, draft(status, reason, ctx), None


PRACTICES = {
    "ctx-clear-between-tasks": p_ctx_clear,
    "ctx-subagent-offload": p_ctx_subagent,
    "ctx-custom-subagents": p_ctx_custom_subagents,
    "ctx-compact-focus": p_ctx_compact_focus,
    "ctx-compact-before-break": p_ctx_compact_before_break,
    "safe-low-risk-preset": p_safe_low_risk,
    "safe-hooks-for-musts": p_safe_hooks_for_musts,
    "safe-small-enforced-set": p_safe_small_set,
    "safe-deny-secrets": p_safe_deny_secrets,
    "doc-short-instructions": p_doc_short,
    "doc-test-commands": p_doc_test_commands,
    "doc-update-on-repeat": p_doc_update,
    "doc-skills-on-demand": p_doc_skills,
    "plan-mode-first": p_plan_mode,
    "plan-interview": p_plan_interview,
    "plan-done-when": p_plan_done_when,
    "verify-runnable-checks": p_verify_checks,
    "verify-revert-retry": p_verify_revert,
    "auto-worktrees": p_auto_worktrees,
    "auto-headless": p_auto_headless,
    "auto-headless-limits": p_auto_headless_limits,
}


# ---------------------------------------------------------------- assembly

def counts(ctx: Ctx) -> dict:
    kinds = ctx.summary.get("kinds") if isinstance(ctx.summary.get("kinds"), dict) else {}
    hosts = sorted({k.split("/", 1)[0] for k in kinds} | set(ctx.hosts),
                   key=lambda h: -(ctx.n(h) if h in ctx.hosts else 0))
    out = {}
    for h in hosts:
        judged = ctx.n(h) if h in ctx.hosts else 0
        out[h] = {"human": kinds.get(f"{h}/human", 0), "headless": kinds.get(f"{h}/headless", 0),
                  "subagent": kinds.get(f"{h}/subagent", 0), "judged": judged}
        if kinds.get(f"{h}/unknown"):
            out[h]["unknown"] = kinds[f"{h}/unknown"]  # entrypoint not recognised: neither human nor headless
        if judged < LOW_SAMPLE:
            out[h]["low_sample"] = True
    return out


def lang_hint() -> dict:
    base = os.environ.get("AGENT_PRACTICE_AUDIT_DIR") or "~/.local/share/agent-practice-audit"
    try:
        with open(os.path.join(os.path.expanduser(base), "config.json"), encoding="utf-8") as f:
            lang = (json.load(f) or {}).get("lang")
        if lang in ("zh", "en"):
            return {"hint": lang, "from": "config.json"}
    except (OSError, ValueError, AttributeError):
        pass
    env = os.environ.get("LC_ALL") or os.environ.get("LANG") or ""
    return {"hint": "zh" if env.lower().startswith("zh") else "en", "from": "LANG" if env else "default",
            "note": "the user's own language wins"}


def prejudge(summary: dict, config: dict, practices: list[dict], days: int | None = None) -> dict:
    rules = rules_from(practices)
    ctx = Ctx(summary, config, rules)
    items = []
    for p in practices:
        if not isinstance(p, dict) or not p.get("id"):
            continue
        rule = p.get("rule") if isinstance(p.get("rule"), dict) else {}
        # detect stays on every item: without it the judge tends to rubber-stamp drafts.
        item = {"id": p["id"], "title": p.get("title"), "detect": p.get("detect"),
                "rule": rule.get("text"), "metrics": {}, "draft": None}
        fn = PRACTICES.get(p["id"])
        if fn is None:
            item["note"] = "no pre-judge mapping; judge from detect with summary.json / config-scan.json"
        else:
            try:
                metrics, d, note = fn(ctx)
                if not ctx.main and p["id"] in LOG_BASED and d is not None and d["status"] != "na":
                    d, note = None, "only low-sample hosts: no verdict from session logs"
                item["metrics"], item["draft"] = metrics, d
                if note:
                    item["note"] = note
            except KeyError as e:  # thresholds live only in practices.json; none are filled in by code
                item["note"] = f"rule.params.{e.args[0]} missing in practices.json; judge from detect and rule"
            except Exception as e:  # a malformed input must not stop the other practices
                item["note"] = f"pre-judge failed ({type(e).__name__}); judge from summary.json / config-scan.json"
        if not item["rule"]:
            del item["rule"]
        items.append(item)
    out = {"window_days": days, "lang": lang_hint(), "low_sample_below": LOW_SAMPLE, "counts": counts(ctx),
           "headless_total": (ctx.summary.get("headless") or {}).get("sessions", 0),
           "subagent_total": (ctx.summary.get("subagent") or {}).get("sessions", 0),
           "practices": items}
    if days is None:
        del out["window_days"]
    return out


def render(doc: dict) -> str:
    """One practice per line keeps the file small and still easy to read in chunks."""
    head = {k: v for k, v in doc.items() if k != "practices"}
    lines = [json.dumps(head, ensure_ascii=False, separators=(",", ":"))[:-1] + ',"practices":[']
    body = [json.dumps(p, ensure_ascii=False, separators=(",", ":")) for p in doc["practices"]]
    return "\n".join(lines) + "\n" + ",\n".join(body) + "\n]}\n"


def load_json(path: str):
    with open(os.path.expanduser(path), encoding="utf-8") as f:
        return json.load(f)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--summary", required=True, help="aggregate.py output")
    ap.add_argument("--config", required=True, help="config_scan.py output")
    ap.add_argument("--practices", default=DEFAULT_PRACTICES)
    ap.add_argument("--days", type=int, help="window length, copied into the output")
    ap.add_argument("-o", "--out", help="write judge-input.json here instead of stdout")
    a = ap.parse_args(argv)
    if a.out:
        try:
            a.out = safe_file_target(a.out)
        except UnsafeOutput as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
    practices = load_json(a.practices)
    practices = practices.get("practices") if isinstance(practices, dict) else practices
    text = render(prejudge(load_json(a.summary), load_json(a.config), practices or [], a.days))
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
