#!/usr/bin/env python3
"""bash-prompt-guard.py — PreToolUse hook (Bash): deny commands Claude Code cannot check.

Claude Code parses Bash commands as bash. Two shapes make its safety check ask for confirmation even
under bypass permissions, which stops an unattended session (a background subagent waits on the
prompt until someone clicks, or the request is denied after a minute):

1. zsh-only syntax: parameter flags such as `${(f)"$(cmd)"}`, modifiers such as `${f:t}` and glob
   qualifiers such as `*(N)`: "Dangerous rm operation not ruled out — the shell may read this command
   differently than it was parsed".
2. `rm` / `rmdir` in the same command as a multi-line inline shell script (`bash -c '<newline>...'`,
   `sh -c`, `zsh -c`): "This shell -c script runs rm and could not be checked". A one-line
   `xargs sh -c '...'` next to `rm` ran without a prompt (Claude Code 2.1.312, 2026-10-27).
3. `rm` targets Claude Code counts as critical paths (permission-modes docs, "Other targets that count
   as critical paths"): a glob or trailing slash under an unguarded variable (`rm -f $D/*.png`), and a
   recursive removal of a command substitution (`rm -rf "$(cmd)"`). A subagent waited 4,222 s on one.
4. A `$(` that never gets its `)`, usually a literal `$(` meant for grep inside double quotes
   (`grep "[a-z$(]"`): the shell starts a command substitution there, so it reads the command
   differently than it was parsed ("Dangerous rm operation not ruled out", 2026-10-29).
5. A `${` the shell does not read as a parameter expansion, usually a JavaScript template literal meant
   for grep inside double quotes (`grep "frame ${size(frame.innerWidth)}"`): same prompt (2026-11-02).

Denying is cheaper than the prompt: the model gets the reason at once and rewrites the command.
For rule 1, text the shell does not expand is ignored: single-quoted strings, backslash escapes,
comments and the bodies of quoted heredocs (<<'EOF', <<"EOF"; JavaScript or Python passed through a
heredoc may contain `${(`). Commands over MAX_COMMAND_CHARS are allowed unchecked, so the scan stays
well inside the hook's 5 s timeout.

Every error, missing field or non-Bash tool allows the call: exit 0, no output. No network, no model.
Deny = {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",...}} on stdout.
The reason opens with `[bash-prompt-guard] ` and says how to rewrite the command (`Fix: ...`).

Usage: bash-prompt-guard.py
Env:   BASH_PROMPT_GUARD=0   disable entirely
"""
import json
import os
import re
import sys

MAX_COMMAND_CHARS = 512_000
ZSH_EXPANSION = re.compile(r"\$\{\(|\$\{[A-Za-z_][A-Za-z0-9_]*(?::[aAhtrelquQ])+\}")
# A glob qualifier is `(N)`, `(.)`, `(om[1])`... right after a word that contains `*` or `?`. The word is
# checked in one forward pass (has_glob_qualifier), not with a regex that rescans from every `*`.
GLOB_QUALIFIER = re.compile(r"\((?:N|[./@]|o[nmL]|O[nmL])[^)\s]{0,4}\)")
WORD_BREAK = set(" \t\n()<>;&|")
# A quoted delimiter may hold any text but its quote and a newline (`'END-OF-SCRIPT'`, `'123'`).
QUOTED_HEREDOC_START = re.compile(r"<<(-?)[ \t]*(['\"])([^'\"\n]+)\2")
# An unquoted heredoc keeps its body (the shell expands it), but its lines are not scanned for quotes.
UNQUOTED_HEREDOC_START = re.compile(r"<<(-?)[ \t]*([A-Za-z_][A-Za-z0-9_-]*)")
# `[ \t]*`, not `\s*`, after the anchor: with re.M a `\s*` spanning newlines rescans every blank line
# (quadratic on whitespace-heavy input); `^` already matches at each line start.
# `sudo` may carry options before the command: `-n`, `-E`, `-u root`, `--preserve-env=PATH`.
SUDO = r"\bsudo(?:[ \t]+(?:-[ugCDhprtTU][ \t]*[^\s-]\S*|--?[A-Za-z][A-Za-z0-9-]*(?:=\S*)?|--(?=[ \t])))*[ \t]"
RM_COMMAND = re.compile(
    r"(?:^|[;&|(`{'\"]|\$\(|" + SUDO + r"|\b(?:xargs|then|do|else)\s)[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*"
    r"(?:command\s+)?(?:/bin/)?rm(?:dir)?\s", re.M)
MULTILINE_INLINE_SCRIPT = re.compile(
    r"(?:^|[\s;&|(`{])(?:/bin/|/usr/bin/(?:env\s+)?)?(?:ba|z|da|k)?sh\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*c[A-Za-z]*\s+"
    # the part before the first newline cannot hold one, so a missing closing quote is scanned once
    r"(?:'[^'\n]*\n[^']*'|\"[^\"\n]*\n[^\"]*\")", re.M)
COMMENT_LINE = re.compile(r"^[ \t]*#.*$", re.M)
BRACE_EXPANSION_START = re.compile(r"\$\{")
# What bash accepts after `${`: optional `#`/`!`, a name, positional digits or a special parameter,
# then `}` or an operator (`:-`, `#`, `%`, `/`, `^`, `,`, `[`, `@Q`, `!prefix*`).
BASH_PARAM_EXPANSION = re.compile(r"\$\{[#!]?(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!0-])[}:=?+#%/^,\[@*-]")
RM_ARGS = re.compile(
    r"(?:^|[;&|(`{]|\$\(|" + SUDO + r"|\b(?:xargs|then|do|else)\s)[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*"
    r"(?:command\s+)?(?:/bin/)?rm(?:dir)?\s([^;&|\n`)]*)", re.M)
VAR_SLASH = re.compile(r"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\"?/")
ARG_WORD = re.compile(r"[^\s;|&]+")
SUBSTITUTION_TARGET = re.compile(r"(?:^|\s)\"?\$\(")
RECURSIVE_FLAG = re.compile(r"(?:^|\s)(?:-[A-Za-z]*[rR]|--recursive\b)")
# Label that opens every deny reason, so this hook's denials can be counted from session logs
REASON_TAG = "[bash-prompt-guard] "
SCRIPT_HINT = " For a long sequence, write it to a script file and run `bash <script>` or `zsh <script>`."
ZSH_REASON = ("The command uses zsh-only syntax: a parameter flag `${(f)...}`, a modifier `${f:t}` or a glob qualifier "
              "`*(N)`. Claude Code parses commands as bash, so it cannot check this one and asks for confirmation "
              "(\"Dangerous rm operation not ruled out\"), even under bypass permissions, which stalls an unattended run. "
              "Fix: rewrite it in syntax bash also reads, for example "
              "`git diff --name-only --diff-filter=d | xargs pnpm exec eslint --fix` or "
              "`while IFS= read -r f; do ...; done < <(cmd)`." + SCRIPT_HINT)
RM_REASON = ("The command combines `rm`/`rmdir` with a multi-line inline script (`bash -c '...'`, `sh -c`, `zsh -c`). "
             "Claude Code cannot check inline scripts, so it asks for confirmation (\"This shell -c script runs rm and "
             "could not be checked\"), even under bypass permissions, which stalls or fails an unattended run. "
             "Fix: run the removal as its own Bash call with literal target paths, and run the other steps in a "
             "separate call as plain commands without `bash -c`." + SCRIPT_HINT)

TARGET_REASON = ("An `rm` target is a variable followed by a glob or a trailing slash (such as `rm -f $D/*.png`), or a "
                 "recursive removal of a command substitution (such as `rm -rf \"$(cmd)\"`). Claude Code treats these "
                 "as critical paths that could reach the root directory and asks for confirmation, even under bypass "
                 "permissions, which stalls an unattended run. "
                 "Fix: guard the variable as `\"${D:?}\"/*.png` so the shell stops with an error when it is empty; for a "
                 "command substitution, run the command first, then remove the literal path it printed.")

SUBSTITUTION_REASON = ("The command has a `$(` that is never closed (such as `grep \"[a-z$(]\"` meant to match a "
                       "literal `$(`). The shell starts a command substitution there, Claude Code sees that the shell "
                       "reads the command differently than it parsed it and asks for confirmation (\"Dangerous rm "
                       "operation not ruled out\"), even under bypass permissions. "
                       "Fix: put the literal `$` and `(` in single quotes (`grep '[a-z$(]'`), or write `\\$(` inside "
                       "double quotes.")

BRACE_REASON = ("The command has a `${...}` the shell does not read as a parameter expansion (such as "
                "`grep \"frame ${size(frame.innerWidth)}\"` meant to find a JavaScript template literal). Inside double "
                "quotes `${` starts a parameter expansion, Claude Code sees that the shell reads the command differently "
                "than it parsed it and asks for confirmation (\"Dangerous rm operation not ruled out\"), even under bypass "
                "permissions. "
                "Fix: search for the literal with single quotes and `-F`: `grep -rnF 'frame ${size(frame.innerWidth)}' <path>`, "
                "or write `\\${` inside double quotes; the Grep tool also works. To change a file, use the Edit tool "
                "instead of a command chained into the same Bash call.")


def heredoc_starts(line: str, stack):
    """Heredoc operators the shell acts on in this line, as (strip_tabs, delimiter, quoted), plus the quoting
    stack at the end of the line. `stack` is what the previous line left open: `'`, `"`, or `$(` (a command
    substitution, which starts a fresh context even inside double quotes). Operators inside quotes, in
    comments, after a backslash and in `<<<` are ignored."""
    stack, found, i, n, word_start = list(stack), [], 0, len(line), True
    while i < n:
        c, ctx = line[i], (stack[-1] if stack else None)
        if c == "\\" and ctx != "'":
            i += 2
            word_start = False
            continue
        if ctx == "'":
            if c == "'":
                stack.pop()
        elif ctx == '"':
            if c == '"':
                stack.pop()
            elif line.startswith("$(", i):
                stack.append("$(")
                i += 2
                word_start = True
                continue
        elif c in "'\"":
            stack.append(c)
        elif c == "#" and word_start:
            break
        elif line.startswith("$(", i):
            stack.append("$(")
            i += 2
            word_start = True
            continue
        elif c == "(" and ctx == "$(":
            stack.append("$(")
        elif c == ")" and ctx == "$(":
            stack.pop()
        elif line.startswith("<<<", i):
            i += 3
            word_start = False
            continue
        elif line.startswith("<<", i):
            m = QUOTED_HEREDOC_START.match(line, i)
            if m:
                found.append((m.group(1) == "-", m.group(3), True))
            else:
                m = UNQUOTED_HEREDOC_START.match(line, i)
                if m:
                    found.append((m.group(1) == "-", m.group(2), False))
            if m:
                i = m.end()
                word_start = False
                continue
        word_start = (not stack or stack[-1] == "$(") and c in " \t;&|()"
        i += 1
    return found, stack


# In an unquoted heredoc body quotes and `#` are literal text, but `$` expansions still run. The body is
# kept with those characters blanked, so the later scans still see its expansions and do not mistake a
# body apostrophe for an opening quote.
BODY_QUOTES = str.maketrans({"'": " ", '"': " "})
BODY_COMMENT = re.compile(r"(^|[ \t])#")


def blank_body_literals(line: str) -> str:
    """Blank quotes and a word-initial `#` (which would start a comment); `${#arr[@]}`, `${p##*/}` keep theirs."""
    return BODY_COMMENT.sub(r"\1 ", line.translate(BODY_QUOTES))


def strip_quoted_heredoc_bodies(command: str) -> str:
    """Drop the body and end line of each quoted heredoc; keep the line that opens it. One pass.
    The end line must equal the delimiter exactly; `<<-` also allows leading tabs. Quoting carries
    across lines; an unquoted heredoc body is kept with its quotes and `#` blanked."""
    kept, pending, stack = [], [], []
    for line in command.split("\n"):
        if pending:
            strip_tabs, word, quoted = pending[0]
            if (line.lstrip("\t") if strip_tabs else line) == word:
                pending.pop(0)
                if not quoted:
                    kept.append(line)
            elif not quoted:
                kept.append(blank_body_literals(line))
            continue
        kept.append(line)
        found, stack = heredoc_starts(line, stack)
        pending.extend(found)
    return "\n".join(kept)


def expanded_text(command: str, keep_double_quoted: bool = True) -> str:
    """The command without single-quoted strings, backslash escapes and comments. One pass.
    With keep_double_quoted=False, double-quoted text goes too (globs do not expand there).
    A `$(...)` inside double quotes is its own context: its single quotes and comments go as well."""
    out, i, n, stack, word_start = [], 0, len(command), ["top"], True
    while i < n:
        c, ctx = command[i], stack[-1]
        if c == "\\":
            i += 2
            word_start = False
            continue
        if ctx == "dq":
            if c == '"':
                stack.pop()
                out.append(c)
            elif command.startswith("$(", i):
                stack.append("sub")
                out.append("$(")
                i += 2
                word_start = True
                continue
            elif keep_double_quoted:
                out.append(c)
            i += 1
            word_start = False
            continue
        if c == "'":
            end = command.find("'", i + 1)
            i = n if end < 0 else end + 1
            out.append("''")
            word_start = False
            continue
        if c == "#" and word_start:
            end = command.find("\n", i)
            i = n if end < 0 else end
            continue
        if c == '"':
            stack.append("dq")
        elif ctx == "sub" and c == "(":
            stack.append("sub")
        elif ctx == "sub" and c == ")":
            stack.pop()
        out.append(c)
        word_start = c in " \t\n;&|()"
        i += 1
    return "".join(out)


def uses_zsh_param_flag(command: str) -> bool:
    text = strip_quoted_heredoc_bodies(command)
    return bool(ZSH_EXPANSION.search(expanded_text(text))
                or has_glob_qualifier(expanded_text(text, keep_double_quoted=False)))


def drop_bash_regex_operands(text: str) -> str:
    """Remove the right side of `[[ ... =~ ... ]]` (a bash regex, not a glob: `^v?(.*)$` is no qualifier).
    The operand ends at the next `]]` on the same line. One forward pass."""
    out, i, close, eol = [], 0, -1, -1
    while True:
        op = text.find("=~", i)
        if op < 0:
            break
        if close < op:  # each find resumes past the previous hit, so the scan stays linear
            close = text.find("]]", op)
            if close < 0:
                break
        if eol < op:
            eol = text.find("\n", op)
            eol = len(text) if eol < 0 else eol
        if eol < close:
            out.append(text[i:eol])
            i = eol
            continue
        out.append(text[i:op] + "=~ ")
        i = close
    out.append(text[i:])
    return "".join(out)


def has_glob_qualifier(text: str) -> bool:
    """True when a word containing `*` or `?` is directly followed by a zsh glob qualifier. One pass."""
    text = drop_bash_regex_operands(text)
    globbed = False
    for i, c in enumerate(text):
        if c == "(" and globbed and GLOB_QUALIFIER.match(text, i):
            return True
        if c in WORD_BREAK:
            globbed = False
        elif c in "*?":
            globbed = True
    return False


def unguarded_var_glob(args: str) -> bool:
    """True when an rm argument is `$VAR/` followed by a glob in the same word, or ends right after the slash
    (`$D/*.png`, `$D/`). Each word is scanned once."""
    for word in ARG_WORD.findall(args):
        first = VAR_SLASH.search(word)
        if not first:
            continue
        if any(c in "*?[" for c in word[first.end():]):
            return True
        if any(m.end() == len(word) or word[m.end()] in "\"'" for m in VAR_SLASH.finditer(word)):
            return True
    return False


def mixes_rm_with_inline_script(command: str) -> bool:
    shell_text = COMMENT_LINE.sub("", strip_quoted_heredoc_bodies(command))
    return bool(RM_COMMAND.search(shell_text) and MULTILINE_INLINE_SCRIPT.search(shell_text))


def removes_critical_target(command: str) -> bool:
    shell_text = expanded_text(strip_quoted_heredoc_bodies(command))
    for m in RM_ARGS.finditer(shell_text):
        args = m.group(1)
        if unguarded_var_glob(args):
            return True
        if SUBSTITUTION_TARGET.search(args) and RECURSIVE_FLAG.search(args):
            return True
    return False


def has_unclosed_substitution(command: str) -> bool:
    """True when a `$(` never gets its `)`, as in `grep "[a-z$(]"`. One pass over quotes and `$(` nesting."""
    text = strip_quoted_heredoc_bodies(command)
    stack, i, n, word_start = ["top"], 0, len(text), True
    while i < n:
        c, ctx = text[i], stack[-1]
        if c == "\\" and ctx != "sq":
            i += 2
            word_start = False
            continue
        if ctx == "sq":
            if c == "'":
                stack.pop()
        elif ctx == "dq":
            if c == '"':
                stack.pop()
            elif c == "$" and text.startswith("$(", i):
                stack.append("sub")
                i += 1
        elif c == "#" and word_start:
            end = text.find("\n", i)
            i = n if end < 0 else end
            continue
        elif c == "'":
            stack.append("sq")
        elif c == '"':
            stack.append("dq")
        elif c == "$" and text.startswith("$(", i):
            stack.append("sub")
            i += 1
        elif c == "(" and ctx == "sub":
            stack.append("sub")
        elif c == ")" and ctx == "sub":
            stack.pop()
        word_start = c in " \t\n;&|()"
        i += 1
    return "sub" in stack


def has_invalid_brace_expansion(command: str) -> bool:
    """True when a `${` outside single quotes and quoted heredocs is not a bash parameter expansion."""
    text = expanded_text(strip_quoted_heredoc_bodies(command))
    return any(not BASH_PARAM_EXPANSION.match(text, m.start()) for m in BRACE_EXPANSION_START.finditer(text))


def deny_reason(command: str):
    if uses_zsh_param_flag(command):
        return ZSH_REASON
    if has_unclosed_substitution(command):
        return SUBSTITUTION_REASON
    if has_invalid_brace_expansion(command):
        return BRACE_REASON
    if mixes_rm_with_inline_script(command):
        return RM_REASON
    if removes_critical_target(command):
        return TARGET_REASON
    return None


def main() -> int:
    if os.environ.get("BASH_PROMPT_GUARD") == "0":
        return 0
    try:
        payload = json.load(sys.stdin)
        if payload.get("tool_name") != "Bash":
            return 0
        command = (payload.get("tool_input") or {}).get("command")
        if not isinstance(command, str) or len(command) > MAX_COMMAND_CHARS:
            return 0
        reason = deny_reason(command)
        if not reason:
            return 0
        sys.stdout.write(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": REASON_TAG + reason,
        }}) + "\n")
        sys.stdout.flush()
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
