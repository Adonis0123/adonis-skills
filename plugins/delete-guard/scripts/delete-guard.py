#!/usr/bin/env python3
"""delete-guard.py — PreToolUse hook (Bash): deny shell commands that delete files an agent cannot get back.

Works in Claude Code and Codex (plugin hooks/hooks.json) and in Grok Build (a hook file that runs this
script). It is meant for agents run with full permissions: it only stops an agent from deleting by
mistake. It is a guard against accidents, not a sandbox: eval of a variable, a Python or
Node one-liner that deletes files, and anything else it cannot read statically still run.

Denied (each pipeline segment is checked; `;` `&&` `||` `|` `&` newlines, `$(...)`, backticks and the
string given to `bash -c` / `sh -c` / `zsh -c` / `eval` are split out and checked too):
  - recursive rm in any spelling: -r -R -rf -fr -Rf, `-r -f`, --recursive, flags after the target,
    /bin/rm, \\rm, `command rm`, `sudo rm`, `xargs rm -r`, unless every target is inside a temp root
  - find ... -delete and find ... -exec/-execdir/-ok rm, unless every start path is inside a temp root
  - git reset --hard, git clean -f/--force (not -n/--dry-run), git checkout -- <path>, git checkout .,
    git restore without --staged (or with --worktree), git stash drop, git stash clear
Allowed: non-recursive rm, trash, git restore --staged, and recursive deletes whose targets all resolve
inside /tmp, /private/tmp, /var/folders, /private/var/folders or $TMPDIR. A target that cannot be resolved
(a variable other than $TMPDIR, a $'...' string, brace expansion, a glob whose fixed part is outside a temp
root, xargs input, `{}` unless every find start point is safe, a relative path with no known cwd) counts
as outside. Relative paths are checked against every cwd the command may run in: `cd X && cmd` runs cmd
in X, but after `;`, `||`, `|`, `&` or a newline cd may have failed, so both X and the old cwd count;
`env -C dir` / `sudo -D dir` set the inner command's cwd; a command substitution uses the cwd where it
appears. An unquoted heredoc body's $(...) and backticks are checked; a quoted heredoc body is not.

Input: hook JSON on stdin. Claude and Codex send tool_name "Bash" with tool_input.command; Grok sends
toolName "run_terminal_command" with toolInput.command (and the Claude-style names too). The working
directory comes from tool_input.cwd/workdir, else the payload's cwd.
Output on deny: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
"permissionDecisionReason":...}}; all three hosts read it, and the reason opens with `[delete-guard] `.
For rm and find the reason names a trash command for this system: `trash` on macOS, `trash-put` or
`gio trash` on Linux (including WSL); without one it suggests `mv <路径> /tmp/` or asking the user.
Exit code is always 0. Every error, missing
field or non-shell tool allows the call (fail-open). Standard library only, no network.

Usage: delete-guard.py
Env:   DELETE_GUARD=0   disable entirely
"""
import json
import os
import re
import shutil
import sys

MAX_COMMAND_CHARS = 512_000
MAX_DEPTH = 8
SHELL_TOOLS = {"Bash", "run_terminal_command", "Shell", "shell", "local_shell", "exec_command"}
SHELLS = {"sh", "bash", "zsh", "dash", "ksh", "fish"}
KEYWORDS = {"if", "then", "else", "elif", "do", "while", "until", "!", "{", "}", "time", "fi", "done"}
TMPDIR_VAR = re.compile(r"^\$\{?TMPDIR(?::?-[^}]*)?\}?$")

# Label that opens every deny reason, so this hook's denials can be counted from session logs
REASON_TAG = "[delete-guard] "
REPO_URL = "https://github.com/Adonis0123/adonis-skills"
RM_REASON = ("这条命令会递归删除临时目录以外的路径（{target}），删了找不回。{alternative}")
FIND_REASON = ("这条 `find` 会删除临时目录以外的文件（起点 {target}），删了找不回。{alternative}")
GIT_REASON = ("`{target}` 会丢弃未提交的改动，丢了找不回。先 `git stash` 保存改动，或请用户确认。")
TRASH_HINT = "改用 `{command} <路径>`，删进废纸篓可找回。"
NO_TRASH_HINT = "本机没找到废纸篓命令：改用 `mv <路径> /tmp/` 移到临时目录，或请用户自己删。"
SUPPORT_NOTE = "（目前只为 macOS 和 Linux（含 WSL）给出替代命令，其他系统欢迎提 PR：" + REPO_URL + "）"


def trash_command(platform=None, which=shutil.which):
    """The trash command for this system, or None: macOS `trash` (built into recent macOS),
    Linux `trash-put` (trash-cli, made for the command line), else `gio trash` (GLib)."""
    platform = platform or sys.platform
    if platform == "darwin":
        return "trash" if which("trash") else None
    if platform.startswith("linux"):
        if which("trash-put"):
            return "trash-put"
        if which("gio"):
            return "gio trash"
    return None


def alternative(platform=None, which=shutil.which):
    command = trash_command(platform, which)
    return (TRASH_HINT.format(command=command) if command else NO_TRASH_HINT) + SUPPORT_NOTE


class Deny(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


# ── tokenizer ────────────────────────────────────────────────────────────────
# A word is a list of (kind, text) parts: "lit" literal text, "exp" a shell expansion ($VAR, ${...},
# $(...), backticks), "glob" an unquoted * ? [ or {, "tilde" a leading unquoted ~.
# Tokens are ("word", parts) or ("op", text); ops split commands, "redir" eats the next word.

def _match_paren(s, i):
    """s[i] is just after '$(' or '('. Return the index of the matching ')' (or len(s))."""
    depth, n = 1, len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "'":
            j = s.find("'", i + 1)
            i = n if j < 0 else j + 1
            continue
        if c == '"':
            i = _match_dquote(s, i + 1) + 1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n


def _match_dquote(s, i):
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == '"':
            return i
        if c == "$" and s.startswith("$(", i):
            i = _match_paren(s, i + 2) + 1
            continue
        if c == "`":
            j = s.find("`", i + 1)
            i = n if j < 0 else j + 1
            continue
        i += 1
    return n


def _read_dollar(s, i, subs):
    """s[i] == '$'. Return (part, next_index). Command substitutions go to subs for checking."""
    n = len(s)
    if s.startswith("$((", i):
        end = _match_paren(s, i + 3)
        end = end + 1 if end + 1 < n and s[end + 1] == ")" else end
        return ("exp", s[i:end + 1]), end + 1
    if s.startswith("$(", i):
        end = _match_paren(s, i + 2)
        subs.append(s[i + 2:end])
        return ("exp", s[i:end + 1]), end + 1
    if s.startswith("${", i):
        end = s.find("}", i + 2)
        end = n - 1 if end < 0 else end
        return ("exp", s[i:end + 1]), end + 1
    m = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])", s[i:])
    if m:
        return ("exp", m.group(0)), i + len(m.group(0))
    return ("lit", "$"), i + 1


HEREDOC_START = re.compile(
    r"<<-?[ \t]*(?:'([^'\n]+)'|\"([^\"\n]+)\"|\\([A-Za-z_0-9.-]+)|([A-Za-z_0-9.-]+))")


def heredoc_subs(body, subs):
    """An unquoted heredoc body expands $(...) and backticks: collect them for checking."""
    i, n = 0, len(body)
    while i < n:
        c = body[i]
        if c == "\\":
            i += 2
        elif body.startswith("$((", i):
            i = _match_paren(body, i + 3) + 1
        elif body.startswith("$(", i):
            end = _match_paren(body, i + 2)
            subs.append(body[i + 2:end])
            i = end + 1
        elif c == "`":
            j = body.find("`", i + 1)
            j = n if j < 0 else j
            subs.append(body[i + 1:j])
            i = j + 1
        else:
            i += 1


def tokenize(s):
    """Tokens: ("word", parts), ("op", text) and ("sub", text) for a command substitution, placed where
    it appears so it is checked with the cwd of that point."""
    tokens, parts, i, n = [], [], 0, len(s)
    in_word = False
    heredocs = []
    subs = []

    def flush():
        nonlocal parts, in_word
        if in_word:
            tokens.append(("word", parts))
        parts, in_word = [], False

    while i < n:
        if subs:
            tokens.extend(("sub", x) for x in subs)
            subs.clear()
        c = s[i]
        if c == "\n":
            flush()
            tokens.append(("op", "\n"))
            i += 1
            while heredocs and i < n:  # skip heredoc bodies; an unquoted one still runs $(...)
                delim, quoted = heredocs.pop(0)
                body = []
                while i < n:
                    j = s.find("\n", i)
                    j = n if j < 0 else j
                    line = s[i:j]
                    i = j + 1
                    if line.strip() == delim:
                        break
                    body.append(line)
                if not quoted:
                    heredoc_subs("\n".join(body), subs)
            continue
        if c in " \t":
            flush()
            i += 1
            continue
        if c == "#" and not in_word:
            j = s.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "\\":
            if i + 1 < n and s[i + 1] == "\n":
                i += 2
                continue
            parts.append(("lit", s[i + 1:i + 2]))
            in_word = True
            i += 2
            continue
        if c == "'":
            j = s.find("'", i + 1)
            j = n if j < 0 else j
            parts.append(("lit", s[i + 1:j]))
            in_word = True
            i = j + 1
            continue
        if c == '"':
            in_word = True
            i += 1
            buf = []
            parts.append(("lit", ""))
            while i < n and s[i] != '"':
                d = s[i]
                if d == "\\" and i + 1 < n and s[i + 1] in '$`"\\\n':
                    buf.append(s[i + 1])
                    i += 2
                elif d == "$":
                    part, i2 = _read_dollar(s, i, subs)
                    if part[0] == "exp":
                        if buf:
                            parts.append(("lit", "".join(buf)))
                            buf = []
                        parts.append(part)
                    else:
                        buf.append("$")
                    i = i2
                elif d == "`":
                    j = s.find("`", i + 1)
                    j = n if j < 0 else j
                    subs.append(s[i + 1:j])
                    if buf:
                        parts.append(("lit", "".join(buf)))
                        buf = []
                    parts.append(("exp", s[i:j + 1]))
                    i = j + 1
                else:
                    buf.append(d)
                    i += 1
            if buf:
                parts.append(("lit", "".join(buf)))
            i += 1
            continue
        if c == "$":
            if s.startswith("$'", i):  # ANSI-C string: escapes such as \x2e hide the path, so no path check trusts it
                j = i + 2
                while j < n and s[j] != "'":
                    j += 2 if s[j] == "\\" else 1
                parts.append(("ansi", s[i + 2:j]))
                in_word = True
                i = j + 1
                continue
            part, i = _read_dollar(s, i, subs)
            parts.append(part)
            in_word = True
            continue
        if c == "`":
            j = s.find("`", i + 1)
            j = n if j < 0 else j
            subs.append(s[i + 1:j])
            parts.append(("exp", s[i:j + 1]))
            in_word = True
            i = j + 1
            continue
        if c in ";&|":
            flush()
            op = s[i:i + 2] if s[i:i + 2] in ("&&", "||", ";;", "|&", "&>") else c
            if op == "&>":
                tokens.append(("op", "redir"))
            else:
                tokens.append(("op", op))
            i += len(op)
            continue
        if c in "<>":
            word_text = "".join(t for _, t in parts)
            if in_word and not word_text.isdigit():
                flush()
            parts, in_word = [], False  # drop an fd number such as the 2 in 2>
            if s.startswith("<<", i) and not s.startswith("<<<", i):
                m = HEREDOC_START.match(s, i)
                if m:
                    delim = next(g for g in m.groups() if g is not None)
                    heredocs.append((delim, m.group(4) is None))
                    i += len(m.group(0))
                    continue
            if s.startswith("<(", i) or s.startswith(">(", i):
                end = _match_paren(s, i + 2)
                subs.append(s[i + 2:end])
                tokens.append(("word", [("exp", s[i:end + 1])]))
                i = end + 1
                continue
            j = i + 1
            while j < n and s[j] in "<>&|":
                j += 1
            tokens.append(("op", "redir"))
            # `>&2`: the fd number after & is the redirect target, read as the next word
            i = j
            continue
        if c in "()":
            flush()
            tokens.append(("op", c))
            i += 1
            continue
        if c == "~" and not in_word:
            parts.append(("tilde", "~"))
            in_word = True
            i += 1
            continue
        if c in "*?[{":
            # a lone { or } is a group keyword; inside a word { starts brace expansion
            if c == "{" and not in_word and (i + 1 >= n or s[i + 1] in " \t\n"):
                parts.append(("lit", "{"))
            elif c == "{" and s.startswith("{}", i):
                parts.append(("glob", "{}"))
                i += 2
                in_word = True
                continue
            else:
                parts.append(("glob", c))
            in_word = True
            i += 1
            continue
        parts.append(("lit", c))
        in_word = True
        i += 1
    flush()
    tokens.extend(("sub", x) for x in subs)
    return tokens


def split_commands(tokens):
    """Group tokens into simple commands. Items: ("cmd", words, operator after it or None),
    ("sub", text) for a command substitution, and ("(",) / (")",)."""
    out, words, skip_next = [], [], False
    for kind, val in tokens:
        if kind == "sub":
            out.append(("sub", val))
            continue
        if kind == "word":
            if skip_next:
                skip_next = False
                continue
            words.append(val)
            continue
        if val == "redir":
            skip_next = True
            continue
        if words:
            out.append(("cmd", words, val))
        words = []
        if val in ("(", ")"):
            out.append((val,))
    if words:
        out.append(("cmd", words, None))
    return out


def text_of(word):
    return "".join(t for _, t in word)


def is_literal(word):
    return all(k == "lit" for k, _ in word)


# ── path checks ──────────────────────────────────────────────────────────────

def temp_roots():
    roots = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"]
    tmp = os.environ.get("TMPDIR")
    if tmp and os.path.isabs(tmp):
        roots.append(os.path.normpath(tmp))
    return roots


def _real(path):
    """realpath of the parent directory plus the last name (rm does not follow a final symlink)."""
    path = os.path.normpath(path)
    parent, name = os.path.split(path)
    try:
        parent = os.path.realpath(parent)
    except OSError:
        pass
    return os.path.join(parent, name) if name else parent


def inside_temp(path, allow_root=False):
    path = os.path.normpath(path)
    roots = set()
    for root in temp_roots():
        roots.update({root.rstrip("/") or "/", os.path.realpath(root).rstrip("/") or "/"})

    def under(candidate):
        return any(candidate.startswith(r + "/") or (allow_root and candidate == r) for r in roots)
    # both the path as written and with symlinked parents resolved must be inside a temp root
    return under(path) and under(_real(path))


def resolve_target(word, cwd):
    """Return (path, allow_root) for a literal-enough word, or None when it cannot be resolved."""
    parts = [p for p in word if p != ("lit", "")]
    prefix = ""
    if parts and parts[0][0] == "tilde":
        rest = text_of(parts[1:2]) if len(parts) > 1 else ""
        if len(parts) > 1 and not (parts[1][0] == "lit" and rest.startswith("/")):
            return None  # ~user or ~$x
        prefix = os.path.expanduser("~")
        parts = parts[1:]
    elif parts and parts[0][0] == "exp" and TMPDIR_VAR.match(parts[0][1]):
        default = re.match(r"^\$\{TMPDIR:?-([^}]*)\}$", parts[0][1])
        tmp = os.environ.get("TMPDIR") or (default.group(1) if default else None)
        if not tmp or not os.path.isabs(tmp):
            return None
        prefix = tmp
        parts = parts[1:]
    if any(k in ("exp", "ansi") for k, _ in parts):
        return None  # a variable, substitution or $'...' escape: the real path is unknown
    if any(k == "glob" and t in ("{", "{}") for k, t in parts):
        return None  # brace expansion can name any path, e.g. /tmp/{a,../Users/you}
    glob_at = next((idx for idx, (k, _) in enumerate(parts) if k == "glob"), None)
    if glob_at is not None:
        # a glob matches names inside the directory before it: check that directory (it may be a temp root)
        fixed = prefix + text_of(parts[:glob_at])
        if ".." in text_of(parts[glob_at:]):
            return None
        directory = fixed[:fixed.rfind("/") + 1] if "/" in fixed else ""
        if not directory.startswith("/"):
            if not cwd:
                return None
            directory = os.path.join(cwd, directory)
        return (directory, True)
    path = prefix + text_of(parts)
    if not path:
        return None
    if not path.startswith("/"):
        if not cwd:
            return None
        path = os.path.join(cwd, path)
    return (path, False)


def target_safe(word, cwds, allow_root=False):
    """True when the word resolves inside a temp dir from every cwd the command may run in."""
    for cwd in cwds or (None,):
        resolved = resolve_target(word, cwd)
        if not (resolved and inside_temp(resolved[0], resolved[1] or allow_root)):
            return False
    return True


def change_dir(word, cwds):
    """The set of cwds after `cd <word>` from each of cwds; None marks an unknown directory."""
    out = set()
    for cwd in cwds or (None,):
        resolved = resolve_target(word, cwd) if word is not None else (os.path.expanduser("~"), False)
        out.add(os.path.normpath(resolved[0]) if resolved and not resolved[1] else None)
    return frozenset(out)


# ── command checks ───────────────────────────────────────────────────────────

def basename(word):
    return text_of(word).rsplit("/", 1)[-1]


def strip_wrappers(words):
    """Drop env assignments, keywords and wrappers (sudo, command, env, xargs...).
    Returns (words, via_xargs, chdir): chdir is the word given to `env -C` / `sudo -D`, else None."""
    via_xargs, chdir = False, None
    i = 0
    while i < len(words):
        w = text_of(words[i])
        name = basename(words[i])
        if words[i] and re.match(r"^[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?\+?=", w) and words[i][0][0] == "lit":
            i += 1
        elif w in KEYWORDS:
            i += 1
        elif name in ("sudo", "doas"):
            i += 1
            while i < len(words) and text_of(words[i]).startswith("-"):
                opt = text_of(words[i])
                if opt in ("-D", "--chdir") and i + 1 < len(words):
                    chdir = words[i + 1]
                elif opt.startswith("--chdir=") or (opt.startswith("-D") and len(opt) > 2):
                    chdir = [("lit", opt.split("=", 1)[1] if "=" in opt else opt[2:])]
                i += 2 if opt in ("-u", "-g", "-C", "-h", "-p", "-U", "-r", "-t", "-D", "--chdir") else 1
        elif name in ("command", "builtin", "exec", "nohup", "noglob", "stdbuf", "caffeinate"):
            if name == "command" and i + 1 < len(words) and text_of(words[i + 1]) in ("-v", "-V"):
                return [], False, None
            i += 1
            while i < len(words) and text_of(words[i]).startswith("-"):
                i += 1
        elif name == "env":
            i += 1
            while i < len(words):
                t = text_of(words[i])
                if t in ("-C", "--chdir") and i + 1 < len(words):
                    chdir = words[i + 1]
                    i += 2
                elif t.startswith("--chdir=") or (t.startswith("-C") and len(t) > 2):
                    chdir = [("lit", t.split("=", 1)[1] if "=" in t else t[2:])]
                    i += 1
                elif t in ("-u", "-S", "-P", "--unset", "--split-string"):
                    i += 2
                elif t.startswith("-") or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t):
                    i += 1
                else:
                    break
        elif name in ("nice", "timeout", "gtimeout"):
            i += 1
            while i < len(words) and text_of(words[i]).startswith("-"):
                t = text_of(words[i])
                i += 2 if t in ("-n", "-s", "-k") else 1
            if name != "nice" and i < len(words):
                i += 1  # the duration
        elif name == "xargs":
            via_xargs = True
            i += 1
            while i < len(words) and text_of(words[i]).startswith("-"):
                t = text_of(words[i])
                i += 2 if t in ("-I", "-J", "-n", "-P", "-L", "-d", "-E", "-s", "-R", "-S", "-a") else 1
        else:
            break
    return words[i:], via_xargs, chdir


def is_placeholder(word):
    return any(k == "glob" and t == "{}" for k, t in word)


def check_rm(args, cwds, via_xargs, ph_safe=False):
    """ph_safe: a `{}` from find stands for a path under start points that are all inside temp dirs."""
    recursive, targets, opts_done = False, [], False
    for w in args:
        t = text_of(w)
        if not opts_done and t == "--":
            opts_done = True
        elif not opts_done and t.startswith("--") and is_literal(w):
            # GNU rm takes any unique prefix of a long option: --r, --rec ... all mean --recursive
            recursive = recursive or "recursive".startswith(t[2:].split("=", 1)[0])
        elif not opts_done and t.startswith("-") and len(t) > 1 and is_literal(w):
            recursive = recursive or "r" in t[1:] or "R" in t[1:]
        else:
            targets.append(w)
    if not recursive:
        return
    if via_xargs:
        raise Deny(RM_REASON.format(target="xargs 传入的路径", alternative=alternative()))
    for w in targets:
        if ph_safe and is_placeholder(w) and ".." not in text_of(w):
            continue
        if not target_safe(w, cwds):
            raise Deny(RM_REASON.format(target=text_of(w), alternative=alternative()))
    if not targets:
        raise Deny(RM_REASON.format(target="未指定", alternative=alternative()))


def check_find(args, cwds, depth):
    starts, i = [], 0
    while i < len(args) and is_literal(args[i]) and text_of(args[i]) in ("-H", "-L", "-P", "-E", "-X", "-s", "-x", "-d"):
        i += 1
    while i < len(args):
        t = text_of(args[i])
        if (t.startswith("-") and is_literal(args[i])) or t in ("(", "!", "\\("):
            break
        starts.append(args[i])
        i += 1
    expr = args[i:]
    if not starts:
        starts = [[("lit", ".")]]
    safe = all(target_safe(w, cwds, allow_root=True) for w in starts)
    label = " ".join(text_of(w) for w in starts)
    j = 0
    while j < len(expr):
        t = text_of(expr[j])
        if t == "-delete" and not safe:
            raise Deny(FIND_REASON.format(target=label, alternative=alternative()))
        if t in ("-exec", "-execdir", "-ok", "-okdir"):
            k = j + 1
            while k < len(expr) and text_of(expr[k]) not in (";", "+"):
                k += 1
            sub = expr[j + 1:k]
            if sub:
                # the sub-command always gets checked; only `{}` is exempt, and only when every start is safe
                inner = strip_wrappers(sub)[0]
                if not safe and inner and basename(inner[0]) == "rm" and any(is_placeholder(w) for w in inner):
                    raise Deny(FIND_REASON.format(target=label, alternative=alternative()))
                check_command(sub, cwds, depth + 1, ph_safe=safe)
            j = k
        j += 1


def parse_opts(args, short_val="", long_val=()):
    """Split git-style arguments: (short flags, long flag names, positionals, saw `--`).
    A short option in short_val takes the rest of its cluster or the next argument as its value;
    everything after `--` is a positional."""
    shorts, longs, pos, dashdash, i = set(), set(), [], False, 0
    while i < len(args):
        t = args[i]
        if t == "--":
            pos.extend(args[i + 1:])
            dashdash = True
            break
        if t.startswith("--"):
            name = t[2:].split("=", 1)[0]
            longs.add(name)
            if "=" not in t and name in long_val:
                i += 1
        elif t.startswith("-") and len(t) > 1:
            for k, ch in enumerate(t[1:]):
                shorts.add(ch)
                if ch in short_val:
                    if k == len(t) - 2:
                        i += 1  # value is the next argument
                    break
        else:
            pos.append(t)
        i += 1
    return shorts, longs, pos, dashdash


GIT_OPTS_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"}


def check_git(args):
    i = 0
    while i < len(args):
        t = text_of(args[i])
        if t in GIT_OPTS_WITH_ARG:
            i += 2
        elif t.startswith("-"):
            i += 1
        else:
            break
    if i >= len(args):
        return
    sub, rest = text_of(args[i]), [text_of(w) for w in args[i + 1:]]
    if sub == "reset":
        _, longs, _, _ = parse_opts(rest)
        if "hard" in longs:
            raise Deny(GIT_REASON.format(target="git reset --hard"))
    if sub == "clean":
        shorts, longs, _, _ = parse_opts(rest, short_val="e", long_val=("exclude",))
        dry = "n" in shorts or "dry-run" in longs
        force = "f" in shorts or "force" in longs
        if force and not dry:
            raise Deny(GIT_REASON.format(target="git clean -f"))
    if sub == "checkout":
        shorts, longs, pos, dashdash = parse_opts(rest, short_val="bB", long_val=("orphan",))
        if "b" in shorts or "B" in shorts or "orphan" in longs:
            return
        if dashdash:
            raise Deny(GIT_REASON.format(target="git checkout -- <路径>"))
        if "." in pos:
            raise Deny(GIT_REASON.format(target="git checkout ."))
    if sub == "restore":
        shorts, longs, _, _ = parse_opts(rest, short_val="s", long_val=("source", "pathspec-from-file"))
        if "h" in shorts or "help" in longs:
            return
        staged = "S" in shorts or "staged" in longs
        worktree = "W" in shorts or "worktree" in longs
        if not staged or worktree:
            raise Deny(GIT_REASON.format(target="git restore"))
    if sub == "stash":
        pos = parse_opts(rest)[2]
        if pos and pos[0] in ("drop", "clear"):
            raise Deny(GIT_REASON.format(target="git stash " + pos[0]))


def check_command(words, cwds, depth, ph_safe=False):
    """Check one simple command run from any of cwds. Returns the new cwd set for cd, else None."""
    words, via_xargs, chdir = strip_wrappers(words)
    if not words:
        return None
    if chdir is not None:
        cwds = change_dir(chdir, cwds)
    name = basename(words[0])
    args = words[1:]
    if name == "cd" or name == "pushd":
        if any(text_of(w) == "-" for w in args):
            return frozenset({None})
        dests = [w for w in args if not text_of(w).startswith("-")]
        return change_dir(dests[0] if dests else None, cwds)
    if name == "rm":
        check_rm(args, cwds, via_xargs, ph_safe)
    elif name == "find":
        check_find(args, cwds, depth)
    elif name == "git":
        check_git(args)
    elif name in SHELLS:
        for idx, w in enumerate(args):
            t = text_of(w)
            if t.startswith("-") and not t.startswith("--") and "c" in t[1:] and is_literal(w):
                if idx + 1 < len(args):
                    check_text(text_of(args[idx + 1]), cwds, depth + 1, ph_safe)
                break
            if not t.startswith("-"):
                break
    elif name == "eval":
        check_text(" ".join(text_of(w) for w in args), cwds, depth + 1, ph_safe)
    return None


def check_text(command, cwds, depth=0, ph_safe=False):
    """Check every command in the text. cwds is the set of directories the next command may run in.
    `cd X && ...` moves the && chain to X; after `;`, `||`, `|`, `&` or a newline, cd may have failed,
    so the next commands may run in X or in the old cwd and both must be safe."""
    if depth > MAX_DEPTH:
        return
    cwds = frozenset(cwds)
    fallback = None  # cwds to add back when the && chain after a cd ends
    stack = []
    for item in split_commands(tokenize(command)):
        kind = item[0]
        if kind == "sub":
            check_text(item[1], cwds, depth + 1, ph_safe)
            continue
        if kind == "(":
            stack.append((cwds, fallback))
            fallback = None
            continue
        if kind == ")":
            if stack:
                cwds, fallback = stack.pop()
            continue
        words, op = item[1], item[2]
        new = check_command(words, cwds, depth, ph_safe)
        if new is not None:
            if op == "&&":
                fallback = cwds | (fallback or frozenset())
                cwds = new
            else:
                cwds = cwds | new
        if op != "&&" and fallback is not None:
            cwds, fallback = cwds | fallback, None


def deny_reason(command, cwd):
    try:
        check_text(command, frozenset({cwd}))
    except Deny as d:
        return d.reason
    return None


def main() -> int:
    if os.environ.get("DELETE_GUARD") == "0":
        return 0
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            return 0
        tool = payload.get("tool_name") or payload.get("toolName")
        if tool not in SHELL_TOOLS:
            return 0
        tool_input = payload.get("tool_input") or payload.get("toolInput") or {}
        if not isinstance(tool_input, dict):
            return 0
        command = tool_input.get("command") or tool_input.get("cmd")
        if isinstance(command, list) and all(isinstance(c, str) for c in command):
            command = " ".join("'" + c.replace("'", "'\\''") + "'" for c in command)
        if not isinstance(command, str) or len(command) > MAX_COMMAND_CHARS:
            return 0
        cwd = tool_input.get("cwd") or tool_input.get("workdir") or payload.get("cwd")
        cwd = os.path.normpath(os.path.expanduser(cwd)) if isinstance(cwd, str) and cwd else None
        if cwd and not os.path.isabs(cwd):
            base = payload.get("cwd")
            cwd = os.path.normpath(os.path.join(base, cwd)) if isinstance(base, str) and os.path.isabs(base) else None
        reason = deny_reason(command, cwd)
        if not reason:
            return 0
        sys.stdout.write(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": REASON_TAG + reason,
        }}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
