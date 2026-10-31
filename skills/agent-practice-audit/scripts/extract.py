#!/usr/bin/env python3
"""Extract per-session behaviour stats from local coding-agent transcripts.

One adapter per host turns a session file into the same row shape, so the
aggregator never needs to know which host wrote it. Rows hold no prompt text:
only counts, tags, a first-prompt shape hash, a done-when keyword flag,
correction categories and the working directory (home shown as `~`).
Read-only: transcripts are opened for reading and nothing else on disk is
touched except the output file.

Usage: extract.py OUT.jsonl [--days 60] [--hosts claude,codex,grok,workbuddy]
"""

from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from safe_output import UnsafeOutput, safe_file_target  # noqa: E402
from audit_common import EDIT_TOOLS, OWN_RUN, repo_identity, tilde, worktree_root  # noqa: E402

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

CMD = re.compile(r"<command-name>/?([\w:.-]+)</command-name>")
# The innermost <user_query> block: injected reminders may mention the tag itself before the real one.
USER_QUERY = re.compile(r"<user_query>\s*((?:(?!<user_query>).)*?)\s*</user_query>", re.S)
COMPACT_MARKERS = ("This session is being continued", "<cb_summary>", "<conversation_history_summary>")
# Text Codex injects as role=user messages; everything else in the Desktop fallback is a real prompt,
# including prompts that start with Markdown headings or XML-like tags.
CODEX_INJECTED = ("# AGENTS.md instructions", "<environment_context>", "<user_instructions>", "<INSTRUCTIONS>",
                  "<external_codex_apps_open_page")


CORRECT = re.compile(
    r"不对|不是这样|错了|搞错|不要这样|别这样|为什么(没|不)|你(又|没)|重新做|重来|撤回|回滚|不是我要|理解错"
    r"|\b(that'?s (wrong|not right)|not what i (asked|wanted|meant)|you (didn'?t|forgot|broke)|try again|start over"
    r"|revert (that|this|it)|undo (that|this))\b",
    re.I,
)
# Correction prompts are reported only as counts per bucket (first match wins; else "other"), never as text.
CORR_CATS = {
    "not_verified": re.compile(r"没(跑|测|验证|检查)|未验证|没有?测试|\b(didn'?t (test|run|verify|check)|not (tested|verified))\b", re.I),
    "misunderstood": re.compile(r"理解错|不是我要|不是这个意思|\b(not what i (asked|wanted|meant)|misunderst)", re.I),
    "unrequested_change": re.compile(r"不要(改|动)|别(改|动)|没让你|谁让你|\b(don'?t (change|touch|modify)|i didn'?t ask)", re.I),
    "redo": re.compile(r"重新做|重来|\b(try again|start over)\b", re.I),
    "revert": re.compile(r"撤回|回滚|\b(revert|undo)\b", re.I),
    "broke_or_forgot": re.compile(r"你(又|没)|忘了|漏了|搞错|错了|\byou (forgot|broke|didn'?t)\b", re.I),
}
# A first prompt that states when the task is done (weak keyword hint for plan-done-when).
DONE_WHEN = re.compile(r"done when|until (it|all|the|every)|acceptance|验收|直到|完成(标准|条件)|确保.{0,30}(通过|成功)"
                       r"|make sure .{0,40}pass|(should|must) pass", re.I)
SHAPE_CHARS, SHAPE_MIN = 48, 20  # first-prompt "shape": normalised first 48 chars; shorter prompts get none
VERIFY_PROMPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "references", "verify-prompt.md")


def self_marker(path: str = VERIFY_PROMPT) -> str | None:
    """Opening words of the verifier prompt, read from the template so the marker cannot drift."""
    try:
        with open(path, encoding="utf-8") as f:
            tpl = f.read().split("<!-- template -->", 1)[-1]
    except OSError:
        return None
    line = next((x.strip() for x in tpl.splitlines() if x.strip()), "")
    line = line.split("{{", 1)[0].strip()
    return line[:60] or None


SELF_MARKER = self_marker()


# ---------------------------------------------------------------- tool tagging
# bash:* tags come only from shell tools, matched at command position (start of a command or after
# &&, ||, ;, |, a subshell, or wrappers such as sudo, env, xargs, npx, pnpm exec, uv run, python -m).
# screenshot and worktree also come from tools: screenshot-named tools, computer-use screenshot actions,
# a Read of an image the session itself produced, Claude EnterWorktree, or a cwd inside a worktree dir.
SHELL_TOOLS = {"Bash", "bash", "shell", "shell_command", "exec_command", "local_shell_call", "local_shell",
               "run_terminal_cmd", "run_terminal_command", "run_shell_command", "execute_command", "container.exec"}
EXPLORE_TOOLS = {"Read", "Grep", "Glob", "LS", "read_file", "grep", "list_dir", "codebase_search", "file_search",
                 "search_files", "glob", "list_files", "list_files_by_prefix", "view_file"}
HEAD_TAGS = {
    "test": re.compile(r"^(?:vitest|jest|pytest|py\.test|unittest|playwright test|go test|cargo (?:test|nextest)"
                       r"|deno test|node --test|(?:pnpm|npm|yarn|bun) (?:test|t)\b|make (?:test|check)\b|mvn test"
                       r"|\S*gradlew? test|rspec|phpunit|tox\b|nox\b|ctest|swift test|xcodebuild test|dotnet test"
                       r"|mix test|(?:python[\d.]*|node|bun|deno|tsx|ts-node) \S*(?:test_|_test\.|\.test\.|\.spec\.)\S*)"),
    "lint": re.compile(r"^(?:eslint|biome (?:check|lint|ci)|ruff\b|golangci-lint|cargo clippy|clippy|stylelint|shellcheck"
                       r"|flake8|pylint|oxlint|prettier (?:--check|-c)\b|(?:pnpm|npm|yarn|bun) lint\b|make lint\b"
                       r"|swiftlint|rubocop)"),
    "typecheck": re.compile(r"^(?:tsc|vue-tsc|mypy|pyright|basedpyright|cargo check|go vet|make typecheck"
                            r"|(?:pnpm|npm|yarn|bun) (?:typecheck|type-check|tsc|check-types)\b)"),
    "worktree": re.compile(r"^(?:git worktree add\b|claude\b.*\s--worktree\b)"),
    "git_diff": re.compile(r"^git (?:diff|show)\b"),
    "commit": re.compile(r"^git commit\b"),
    "headless": re.compile(r"^(?:claude\b.*\s(?:-p|--print)\b|codex (?:exec|e)\b|gemini\b.*\s(?:-p|--prompt)\b"
                           r"|grok\b.*\s(?:-p|--print)\b|cursor-agent\b.*\s(?:-p|--print)\b)"),
    "screenshot": re.compile(r"^(?:screencapture\b|(?!(?:echo|printf|cat|grep|rg|git|sed|awk|ls|find|head|tail|open)\b)"
                             r"\S+\s(?:\S+\s)*?(?:screenshot|--screenshot)\b)"),
}
EXPLORE_HEAD = re.compile(r"^(?:rg|grep|egrep|ag|ack|fd|find|ls|tree|cat|head|tail|sed -n|wc|bat|nl)\b")
HEREDOC = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n.*?\n\s*\1\b", re.S)
SHELL_C = re.compile(r"""\b(?:bash|zsh|sh)\s+-[a-z]*c[a-z]*\s+(?:'([^']*)'|"((?:[^"\\]|\\.)*)")""")
QUOTED = re.compile(r"'[^'\n]*'|\"(?:[^\"\\\n]|\\.)*\"")
SEGMENT = re.compile(r"&&|\|\||[;|\n&]|\$\(|[`(){}]")
PREFIX_WORDS = {"sudo", "time", "nice", "nohup", "env", "exec", "command", "caffeinate", "!", "then", "do", "else",
                "if", "while", "until"}
PM = ("pnpm", "npm", "yarn", "bun")
PM_VALUE_FLAGS = {"--filter", "-F", "-C", "--dir", "--prefix", "--cwd", "--workspace"}
XARGS_VALUE_FLAGS = {"-I", "-n", "-P", "-L", "-d", "-s", "-E"}
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")
OUTPUT_FLAGS = {"-o", "--out", "--output", "--path", "--filename", "--file", ">"}


def skip_flags(t: list[str], value_flags=()) -> list[str]:
    while t and t[0].startswith("-"):
        t = t[2:] if t[0] in value_flags else t[1:]
    return t


def peel(t: list[str]) -> list[str]:
    """Drop env assignments and wrapper commands so the real command comes first."""
    while t:
        w = t[0]
        if re.match(r"^[A-Za-z_]\w*=", w) or w in PREFIX_WORDS:
            t = skip_flags(t[1:])
        elif w == "xargs":
            t = skip_flags(t[1:], XARGS_VALUE_FLAGS)
        elif w == "timeout":
            t = skip_flags(t[1:])[1:]
        elif w in ("npx", "bunx"):
            t = skip_flags(t[1:], {"-p", "--package"})
        elif w in PM and len(t) > 1 and t[1] in ("exec", "dlx", "x"):
            t = skip_flags(t[2:])
        elif w in ("uv", "poetry", "pipenv", "hatch", "rye", "pdm") and t[1:2] == ["run"]:
            t = skip_flags(t[2:])
        elif re.match(r"^python[\d.]*$", w) and t[1:2] == ["-m"] and len(t) > 2:
            t = t[2:]
        elif w == "bundle" and t[1:2] == ["exec"]:
            t = t[2:]
        elif w in PM:
            rest = skip_flags(t[1:], PM_VALUE_FLAGS)
            if rest[:1] in (["run"], ["run-script"]):
                rest = skip_flags(rest[1:], PM_VALUE_FLAGS)
            return [w] + rest
        elif w == "git":
            return [w] + skip_flags(t[1:], {"-C", "-c"})
        elif "/" in w and os.path.basename(w) and (not w.startswith("./") or "node_modules/.bin/" in w):
            t = [os.path.basename(w)] + t[1:]  # /usr/bin/git, ./node_modules/.bin/vitest
        else:
            break
    return t


def command_heads(cmd: str) -> list[list[str]]:
    """Token lists, one per command in a shell string, wrappers peeled; quoted text and heredocs dropped
    (except the script of `bash -c '...'`, which is unwrapped first)."""
    cmd = SHELL_C.sub(lambda m: "\n" + (m.group(1) if m.group(1) is not None else m.group(2)) + "\n", HEREDOC.sub(" ", cmd))
    cmd = QUOTED.sub("''", cmd)
    return [t for t in (peel(seg.split()) for seg in SEGMENT.split(cmd)) if t]


def shell_command(r: dict, cmd) -> None:
    if isinstance(cmd, list):
        parts = [str(x) for x in cmd]
        # ["bash", "-lc", "pytest -q"] -> the script itself
        cmd = parts[-1] if len(parts) >= 3 and os.path.basename(parts[0]) in ("bash", "zsh", "sh") \
            and parts[1].startswith("-") and "c" in parts[1] else " ".join(parts)
    if not isinstance(cmd, str) or not cmd:
        return
    found = set()
    if OWN_RUN.search(cmd[:4000]):
        r["self_audit"] = True
    for toks in command_heads(cmd[:4000]):
        head = " ".join(toks)
        for k, rx in HEAD_TAGS.items():
            if k not in found and rx.match(head):
                found.add(k)
        if EXPLORE_HEAD.match(head):
            r["explore"] += 1
        if HEAD_TAGS["screenshot"].match(head) or any(t in OUTPUT_FLAGS for t in toks):
            r["_images"].update(os.path.basename(t) for t in toks if t.lower().endswith(IMAGE_EXT))
    for k in found:
        r["tools"]["bash:" + k] += 1


def is_screenshot_call(name: str, args: dict) -> bool:
    """Screenshot-named tools and computer-use screenshot actions; Figma design screenshots are not checks."""
    n = name.lower()
    if "figma" in n:
        return False
    if any(w in n for w in ("screenshot", "screencapture", "capture_screen")):
        return True
    if str(args.get("action", "")).lower() in ("screenshot", "zoom"):
        return True
    # A desktop/browser observation in image mode is a screenshot; image *generation* tools are not.
    if args.get("mode") == "image" and any(w in n for w in ("browser", "computer", "chrome", "app_state", "window")):
        return True
    for a in args.get("actions") or []:  # browser_batch-style nested calls
        if isinstance(a, dict) and is_screenshot_call(str(a.get("name", "")), a.get("input") or {}):
            return True
    inner = args.get("tool_input")
    if args.get("tool_name"):  # Grok use_tool wrapper
        return is_screenshot_call(str(args["tool_name"]), inner if isinstance(inner, dict) else {})
    return False


def patch_files(text: str) -> list[str]:
    return re.findall(r"^\*\*\* (?:Update|Add|Delete) File: (.+?)\s*$", text, re.M)


def parse_args(args) -> dict:
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            return {"_raw": args}
    return args if isinstance(args, dict) else {}


def tool_call(r: dict, name: str, args) -> None:
    """Count one tool call; tag shell commands, edits, exploration, screenshots and worktrees."""
    r["tools"][name] += 1
    args = parse_args(args)
    if name in ("Skill",):
        r["tools"]["Skill:" + str(args.get("skill", ""))[:40]] += 1
    if name in ("Agent", "Task"):
        r["tools"]["Agent:" + str(args.get("subagent_type", "general"))[:30]] += 1
    if name in SHELL_TOOLS:
        shell_command(r, args.get("command") or args.get("cmd") or args.get("_raw"))
    elif name == "apply_patch":
        r["_edited"].update(patch_files(str(args.get("_raw") or args.get("input") or args.get("patch") or "")))
    if name == "EnterWorktree":
        r["tools"]["bash:worktree"] += 1
    target = str(args.get("file_path") or args.get("path") or args.get("target_file") or args.get("notebook_path") or "")
    if name in EDIT_TOOLS and target:
        r["_edited"].add(target)
    if name in EXPLORE_TOOLS:
        r["explore"] += 1
    if is_screenshot_call(name, args):
        r["tools"]["bash:screenshot"] += 1
        r["_images"].update(os.path.basename(str(v)) for k, v in args.items()
                            if k in ("path", "filePath", "file_path", "filename", "savePath", "output")
                            and str(v).lower().endswith(IMAGE_EXT))
    elif target.lower().endswith(IMAGE_EXT) and os.path.basename(target) in r["_images"]:
        r["tools"]["bash:screenshot"] += 1  # reading back an image this session produced


JS_TOOL = re.compile(r"\btools\.(\w+)\s*\(")
JS_KV = re.compile(r"""\b(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)""")


def js_string(lit: str) -> str:
    if lit.startswith('"'):
        try:
            return json.loads(lit)
        except ValueError:
            pass
    return lit[1:-1].replace("\\n", "\n").replace("\\'", "'").replace('\\"', '"')


def js_call_args(code: str, start: int) -> dict:
    """String-valued keys of the object literal passed to one tools.<name>({...}) call (best effort)."""
    seg = code[start:start + 2000]
    end = seg.find("})")
    seg = seg[:end if end >= 0 else len(seg)]
    return {k: js_string(v) for k, v in JS_KV.findall(seg)}


def codex_code_cell(r: dict, code: str) -> None:
    """Codex code mode: one `exec` call runs JS that calls tools.<name>(...). Each nested call goes through
    tool_call, so shell tags, exploration, edits and screenshots are counted as for a direct call."""
    calls = list(JS_TOOL.finditer(code))
    if not calls:
        r["tools"]["exec"] += 1
        return
    for m in calls:
        name, args = m.group(1), js_call_args(code, m.end())
        if name == "apply_patch":
            args = {"_raw": code}
        tool_call(r, name, args)


def new_row(host: str, path: str) -> dict:
    return dict(host=host, path=path, account=account_of(path, host), kind="human", entry=None, cwd=None,
                start=None, end=None, prompts=0, prompt_chars=0, corrections=0, compactions=0, interrupts=0,
                denials=0, tools=collections.Counter(), cmds=collections.Counter(), efforts=collections.Counter(),
                models=collections.Counter(), modes=collections.Counter(), corr_cats=collections.Counter(),
                explore=0, shape=None, first_done_when=False, _edited=set(), _images=set())


def add_prompt(r: dict, s: str) -> None:
    """Count one typed prompt; only derived fields are kept, never the text."""
    r["prompts"] += 1
    r["prompt_chars"] += len(s)
    if r["prompts"] == 1:
        r["shape"] = prompt_shape(s)
        r["first_done_when"] = bool(DONE_WHEN.search(s[:1000]))
        head = s.lstrip()
        if (SELF_MARKER and head.startswith(SELF_MARKER)) or OWN_RUN.search(head[:400]):
            r["self_audit"] = True
    if CORRECT.search(s[:400]):
        r["corrections"] += 1
        r["corr_cats"][next((k for k, rx in CORR_CATS.items() if rx.search(s[:400])), "other")] += 1


def prompt_shape(s: str) -> str | None:
    """Hash of the normalised start of a prompt (digits, paths and spacing folded); None when too short."""
    norm = re.sub(r"\s+", " ", re.sub(r"\S*/\S*", "/", re.sub(r"\d+", "0", s.lower()))).strip()
    if len(norm) < SHAPE_MIN:
        return None
    return hashlib.sha1(norm[:SHAPE_CHARS].encode("utf-8")).hexdigest()[:10]


def finish(r: dict) -> dict:
    """Turn working sets into counts and reduce paths, so the row is plain JSON with no absolute path.

    `repo` is the reduced repository label; `cwd_id` and `repo_id` are short hashes of the full working
    directory and repository identity, so equal names in different places stay apart."""
    r["edited_files"] = len(r.pop("_edited", ()) or ())
    r.pop("_images", None)
    cwd = r.get("cwd")
    if cwd:
        cwd = os.path.expanduser(str(cwd))
        if worktree_root(cwd)[1] and not r["tools"].get("bash:worktree"):
            r["tools"]["bash:worktree"] += 1  # the session ran inside a worktree checkout
        repo = os.path.expanduser(repo_identity(cwd))
        r["cwd_id"], r["repo_id"] = short_hash(cwd), short_hash(repo)
        r["repo"] = tilde(repo)
    r["path"], r["cwd"] = tilde(r["path"]), tilde(cwd) if cwd else None
    return r


def short_hash(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]


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


# ---------------------------------------------------------------- Claude Code

CLAUDE_HUMAN = ("cli", "claude-vscode", "claude-desktop")
# User entries the harness writes (skill bodies, caveats, background-task notices), not typed by a person.
CLAUDE_INJECTED = ("<system-reminder>", "<local-command-stdout>", "Caveat:", "<local-command-caveat>",
                   "<task-notification>", "Base directory for this skill")
# Known script/SDK entrypoints. Anything else (missing or new) is "unknown": neither human nor headless.
CLAUDE_HEADLESS = ("sdk-cli", "sdk-ts", "sdk-py", "claude-code-github-action")


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
    if not s or s.startswith(CLAUDE_INJECTED):
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
            if d.get("isCompactSummary") or d.get("isMeta"):
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
                if r["prompts"] == 0 and "started_by" not in r:
                    r["started_by"] = m.group(1)  # /clear and /new open a fresh transcript
                continue
            add_prompt(r, s)
    # Session id links a subagent sidechain (<id>/subagents/agent-*.jsonl) to its parent transcript.
    r["sid"] = os.path.splitext(os.path.basename(path))[0]
    if "/subagents/" in path:
        r["parent"] = os.path.basename(path.split("/subagents/")[0])
    if sidechain:
        r["kind"] = "subagent"
    elif r["entry"] in CLAUDE_HUMAN:
        r["kind"] = "human"
    else:
        r["kind"] = "headless" if r["entry"] in CLAUDE_HEADLESS else "unknown"
    return finish(r)


# ---------------------------------------------------------------- Codex

CODEX_HUMAN = ("codex-tui", "codex_cli_rs", "codex_vscode", "Codex Desktop", "codex_work_desktop")
# Script, SDK and host-delegation originators; any other originator is "unknown", as for Claude.
CODEX_HEADLESS = ("codex_exec", "codex_sdk_ts", "codex_sdk_py", "Claude Code")


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
                r["sid"] = p.get("id")
                if p.get("parent_thread_id"):
                    r["parent"] = p.get("parent_thread_id")
            elif t == "turn_context":
                if p.get("effort"):
                    r["efforts"][p["effort"]] += 1
                if p.get("model"):
                    r["models"][p["model"]] += 1
                sp = p.get("sandbox_policy")
                sandbox = sp.get("type") if isinstance(sp, dict) else sp
                r["modes"][f"approval={p.get('approval_policy')}"] += 1
                r["modes"][f"sandbox={sandbox}"] += 1
                if p.get("approval_policy") == "never" and sandbox == "danger-full-access":
                    r["modes"]["full-access"] += 1  # both in the same turn, not across turns
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
            elif t == "response_item" and p.get("type") == "custom_tool_call" and p.get("name") == "exec" \
                    and isinstance(p.get("input"), str):
                codex_code_cell(r, p["input"])
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
    if subagent:
        r["kind"] = "subagent"
    elif r["entry"] in CODEX_HUMAN:
        r["kind"] = "human"
    else:
        r["kind"] = "headless" if r["entry"] in CODEX_HEADLESS else "unknown"
    return finish(r)


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
    r["sid"] = os.path.basename(d)
    if summary.get("parent_session_id"):
        r["parent"] = str(summary["parent_session_id"])
    headless = summary.get("session_kind") == "headless" or bool(ctx.get("is_non_interactive"))
    if relationship not in (None, "primary") or str(summary.get("session_kind") or "").startswith("subagent"):
        r["kind"] = "subagent"
    else:
        r["kind"] = "headless" if headless else "human"
    return finish(r)


# ---------------------------------------------------------------- WorkBuddy

AUTOMATION_TOOLS = ("send_automation_result", "automation_update")


def workbuddy(path: str) -> dict:
    r = new_row("workbuddy", path)
    scheduled = False
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
                scheduled = scheduled or "<automation_system_reminder>" in text
                s = user_query_text(text)
                if s:
                    add_prompt(r, s)
    r["kind"] = "headless" if scheduled or any(r["tools"].get(n) for n in AUTOMATION_TOOLS) else "human"
    if scheduled:
        r["scheduled"] = True  # a WorkBuddy scheduled automation run
    return finish(r)


ADAPTERS = {"claude": claude, "codex": codex, "grok": grok, "workbuddy": workbuddy}


def work(item: tuple[str, str]) -> dict:
    host, path = item
    try:
        return ADAPTERS[host](path)
    except OSError:  # one unreadable file must not stop the run
        return {"host": host, "path": tilde(path), "error": "unreadable"}
    except Exception as e:  # noqa: BLE001 - only the exception type is kept: its text can quote log content
        return {"host": host, "path": tilde(path), "error": "parse-" + type(e).__name__}


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
              f"subagent={c['subagent']:<5} unknown={c['unknown']:<4} errors={c['error']} "
              f"dropped-outside-window={c['outside']} spans-window-start={c['spans']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
