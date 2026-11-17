#!/bin/zsh
# Tests for delete-guard.py (PreToolUse hook for Claude Code, Codex and Grok that denies
# recursive deletes outside temp dirs and git commands that discard uncommitted work).
# Run: zsh plugins/delete-guard/tests/delete-guard.test.zsh   (needs python3 and jq)

set -u
script_dir="${0:A:h}"
hook="${script_dir:h}/scripts/delete-guard.py"
fail() { print -u2 -- "FAIL: $1"; exit 1 }
count=0

[[ -f $hook ]] || fail "missing $hook"

export TMPDIR=/private/var/folders/zz/test-tmpdir/T/
cwd=$HOME/delete-guard-test-project

# decision <format> <tool> <command> [cwd] -> "deny" or "" ; exit code must always be 0
decision() {
  local fmt=$1 tool=$2 cmd=$3 dir=${4-$cwd} payload out rc
  case $fmt in
    claude|codex) payload=$(jq -nc --arg t "$tool" --arg c "$cmd" --arg d "$dir" \
      '{hook_event_name:"PreToolUse",tool_name:$t,tool_input:{command:$c},cwd:$d}') ;;
    grok) payload=$(jq -nc --arg t "$tool" --arg c "$cmd" --arg d "$dir" \
      '{hookEventName:"pre_tool_use",hook_event_name:"PreToolUse",toolName:$t,toolInput:{command:$c},cwd:$d,toolInputTruncated:false}') ;;
  esac
  out=$(print -rn -- "$payload" | python3 "$hook"); rc=$?
  [[ $rc == 0 ]] || fail "exit code $rc for: $cmd"
  [[ -z $out ]] && return
  print -rn -- "$out" | jq -r '.hookSpecificOutput.permissionDecision'
}
reason() {
  jq -nc --arg c "$1" --arg d "$cwd" '{tool_name:"Bash",tool_input:{command:$c},cwd:$d}' | python3 "$hook" \
    | jq -r '.hookSpecificOutput.permissionDecisionReason'
}
# reason_as <format> <tool> <command> -> the deny reason for that host's payload shape
reason_as() {
  local payload
  case $1 in
    claude|codex) payload=$(jq -nc --arg t "$2" --arg c "$3" --arg d "$cwd" \
      '{hook_event_name:"PreToolUse",tool_name:$t,tool_input:{command:$c},cwd:$d}') ;;
    grok) payload=$(jq -nc --arg t "$2" --arg c "$3" --arg d "$cwd" \
      '{hookEventName:"pre_tool_use",hook_event_name:"PreToolUse",toolName:$t,toolInput:{command:$c},cwd:$d,toolInputTruncated:false}') ;;
  esac
  print -rn -- "$payload" | python3 "$hook" | jq -r '.hookSpecificOutput.permissionDecisionReason'
}
denies() { (( count++ )); [[ "$(decision claude Bash "$1" "${2-$cwd}")" == deny ]] || fail "should deny: $1" }
allows() { (( count++ )); [[ -z "$(decision claude Bash "$1" "${2-$cwd}")" ]] || fail "should allow: $1" }

# ── 1. recursive rm in every spelling ────────────────────────────────────────
denies 'rm -r build'
denies 'rm -R build'
denies 'rm -rf ~/delete-guard-probe'
denies 'rm -fr ~/x'
denies 'rm -Rf ~/x'
denies 'rm -r -f ~/x'
denies 'rm -f -r ~/x'
denies 'rm --recursive --force ~/x'
denies 'rm ~/x -rf'
denies '/bin/rm -rf ~/x'
denies 'sudo rm -rf /opt/x'
denies 'sudo -u root rm -rf /opt/x'
denies 'command rm -rf ~/x'
denies '\rm -rf ~/x'
denies 'find . -name node_modules | xargs rm -r'
denies 'git ls-files -o | xargs -0 rm -rf'
denies 'FOO=1 rm -rf ~/x'
denies 'env -i rm -rf ~/x'
denies 'rm -rf node_modules 2>/dev/null'
denies 'rm -rf /'

# ── 2. git commands that discard uncommitted work ────────────────────────────
denies 'git reset --hard'
denies 'git reset --hard HEAD~1'
denies 'git -C ~/repo reset --hard origin/main'
denies 'git clean -f'
denies 'git clean -fdx'
denies 'git clean --force -d'
denies 'git checkout -- src/a.ts'
denies 'git checkout HEAD -- src/a.ts'
denies 'git checkout .'
denies 'git restore src/a.ts'
denies 'git restore .'
denies 'git restore --staged --worktree src/a.ts'
denies 'git stash drop'
denies 'git stash drop stash@{1}'
denies 'git stash clear'

# ── 3. find that deletes ─────────────────────────────────────────────────────
denies 'find . -name "*.log" -delete'
denies 'find ~/x -type f -delete'
denies 'find ~ -name "*.bak" -exec rm {} \;'
denies 'find . -exec rm -rf {} +'
denies 'find . -execdir rm -f {} \;'
denies "find . -type d -exec sh -c 'rm -rf {}' \\;"

# ── 4. commands split by operators, newlines, substitutions and shell -c ─────
denies 'echo ok; rm -rf ~/x'
denies 'true && rm -rf ~/x'
denies 'false || rm -rf ~/x'
denies 'echo a | rm -rf ~/x'
denies 'sleep 1 & rm -rf ~/x'
denies $'echo a\nrm -rf ~/x'
denies 'echo $(rm -rf ~/x)'
denies 'echo `rm -rf ~/x`'
denies "bash -c 'rm -rf ~/x'"
denies 'sh -c "cd ~ && rm -rf x"'
denies "zsh -lc 'git reset --hard'"
denies "bash -c \"sh -c 'rm -rf ~/x'\""
denies 'eval "rm -rf ~/x"'
denies '(cd /tmp); rm -rf build'
denies 'cd ~ && rm -rf build'

# ── 5. targets that cannot be resolved count as outside temp dirs ────────────
denies 'rm -rf "$HOME/x"'
denies 'rm -rf $DIR'
denies 'rm -rf "${D:?}"/*'
denies 'rm -rf "$(mktemp -d)"'
denies 'rm -rf /tm*'
denies 'rm -rf /tmp/../Users/you'
denies 'rm -rf /tmp/*/../../etc'
denies 'rm -rf /tmp'
denies 'rm -rf build' ''
denies 'rm -rf ~user/x'
denies 'rm -rf {a,b}'

# ── 6. recursive deletes inside temp dirs pass ───────────────────────────────
allows 'rm -rf /tmp/delete-guard-probe'
allows 'rm -rf /private/tmp/a /tmp/b'
allows 'rm -rf /tmp/build/*'
allows 'rm -rf /tmp/*'
allows 'rm -rf "$TMPDIR/x"'
allows 'rm -rf ${TMPDIR}/x'
allows 'rm -rf /private/var/folders/ab/cd/T/x'
allows 'rm -rf /var/folders/ab/cd/T/x'
allows 'rm -rf build' /private/tmp/delete-guard-test/scratch
allows 'cd /tmp/work && rm -rf build'
allows 'find /tmp/x -name "*.log" -delete'
allows 'find /tmp -exec rm -rf {} +'
allows "bash -c 'rm -rf /tmp/x'"
allows 'TMPDIR= rm -rf /tmp/x'

# ── 7. non-recursive rm, trash and safe git forms pass ───────────────────────
allows 'rm a.txt'
allows 'rm -f ~/a.txt'
allows 'rm -- -weird-name'
allows 'rm *.pyc'
allows 'find . -name "*.pyc" | xargs rm'
allows 'trash ~/x'
allows '/usr/bin/trash ~/delete-guard-probe'
allows 'git restore --staged src/a.ts'
allows 'git restore -S .'
allows 'git clean -n'
allows 'git clean -fn'
allows 'git clean --dry-run -d'
allows 'git checkout -b feat/x'
allows 'git checkout main'
allows 'git reset HEAD~1'
allows 'git reset --soft HEAD~1'
allows 'git stash'
allows 'git stash list'
allows 'git stash pop'
allows 'git rm --cached a.txt'
allows 'find . -name "*.ts" -exec grep -l foo {} \;'
allows 'rmdir ~/empty'

# ── 8. text that is not run passes ───────────────────────────────────────────
allows 'grep -n "rm -rf ~" docs/x.md'
allows "echo 'git reset --hard'"
allows '# rm -rf ~/x'
allows $'cat > /tmp/notes.md <<\'EOF\'\nrm -rf ~\ngit reset --hard\nEOF'
allows 'command -v rm'

# ── 8b. gaps found in review (Codex), each with a neighbouring form that still passes ─
# 1) find -exec sub-commands are always checked; only `{}` is exempt, and only under safe start points
denies 'find /tmp -exec rm -rf /Users/you \;'
denies 'find /tmp -name a -exec sh -c "rm -rf ~/x" \;'
allows 'find /tmp -exec rm -rf {} \;'
allows 'find /tmp -name a -exec rm -rf /tmp/other \;'
# 2) $'...' escapes and brace expansion in a recursive rm target
denies $'rm -rf $\'/tmp/\\x2e\\x2e/Users/you\''
denies 'rm -rf /tmp/{a,../Users/you}'
denies 'rm -rf /tmp/{a,b}'
allows 'rm -rf /tmp/a /tmp/b'
allows "bash -c \$'rm -rf /tmp/x'"
# 3) cd that may fail: after `;`, `||` or a newline the old cwd is still possible
denies 'cd /tmp/nonexistent; rm -rf build'
denies $'cd /tmp/w\nrm -rf build'
denies 'cd /tmp/w || exit 1; rm -rf build'
denies 'cd /tmp/w && echo hi; rm -rf build'
allows 'cd /tmp/w && rm -rf build'
allows 'cd /tmp/w; rm -rf build' /tmp
allows 'cd /tmp/w && echo hi && rm -rf build'
# 4) a command substitution is checked with the cwd where it appears
denies 'echo $(rm -rf build); cd /tmp'
denies 'echo "$(rm -rf build)" && cd /tmp'
allows 'cd /tmp && echo $(rm -rf build)'
# 5) env -C / --chdir and sudo -D set the inner command's cwd
denies 'env -C /Users rm -rf build' /tmp
denies 'env --chdir=/Users rm -rf build' /tmp
denies 'env -C/Users rm -rf build' /tmp
denies 'sudo -D /Users rm -rf build' /tmp
allows 'env -C /tmp/w rm -rf build'
allows 'env FOO=1 rm -rf build' /tmp/w
# 6) an unquoted heredoc body runs $(...) and backticks; a quoted one does not
denies $'cat <<EOF\n$(rm -rf ~/x)\nEOF'
denies $'cat <<EOF > /tmp/out\n`git reset --hard`\nEOF'
denies $'cat <<-EOF\n\tline $(rm -rf ~/x)\n\tEOF'
allows $'cat <<\'EOF\'\n$(rm -rf ~/x)\nEOF'
allows $'cat <<"EOF"\n`rm -rf ~/x`\nEOF'
allows $'cat <<\\EOF\n$(rm -rf ~/x)\nEOF'
allows $'cat <<EOF\n\\$(rm -rf ~/x) $((1 + 2))\nEOF'
# 7) git options are parsed by meaning: after `--` all are paths, -e/-s take a value
denies 'git clean -f -- -notes'
denies 'git clean -f -e notes'
denies 'git clean -f -en'
allows 'git clean -fn'
allows 'git clean -f -n -e notes'
denies 'git restore -sSNAP file'
denies 'git restore --source SNAP file'
allows 'git restore -s HEAD -S file'
allows 'git restore --source=HEAD --staged file'
denies 'git checkout -f -- -b'
allows 'git checkout -b feat/x -- '
denies 'git reset -q --hard'
allows 'git reset -- --hard'
# 8) any unique prefix of --recursive
denies 'rm --rec /Users/you'
denies 'rm --r /Users/you'
denies 'rm --recursive=x ~/x'
allows 'rm --re /tmp/x'
allows 'rm --force ~/a.txt'

# ── 9. Codex and Grok payloads ───────────────────────────────────────────────
(( count++ )); [[ "$(decision codex Bash 'rm -rf ~/x')" == deny ]] || fail "codex payload must deny"
(( count++ )); [[ -z "$(decision codex Bash 'rm -rf /tmp/x')" ]] || fail "codex temp delete must allow"
(( count++ )); [[ "$(decision grok run_terminal_command 'rm -rf ~/x')" == deny ]] || fail "grok payload must deny"
(( count++ )); [[ "$(decision grok run_terminal_command 'git reset --hard')" == deny ]] || fail "grok git must deny"
(( count++ )); [[ -z "$(decision grok run_terminal_command 'rm -rf /tmp/x')" ]] || fail "grok temp delete must allow"
(( count++ )); [[ -z "$(decision claude Read 'rm -rf ~/x')" ]] || fail "non-shell tools must allow"
(( count++ )); out=$(jq -nc '{toolName:"run_terminal_command",toolInput:{command:"rm -rf build",cwd:"/tmp/w"},cwd:"/Users/you"}' | python3 "$hook")
[[ -z $out ]] || fail "grok toolInput.cwd must win over the session cwd"

# ── 10. reasons are Chinese and name the fix for this system ─────────────────
# The rm reason on this machine, with PATH limited to a scratch bin dir so the result does not
# depend on which trash commands are installed. reason_with_bin <bin dir> <command>
py=$(python3 -c 'import sys; print(sys.executable)')
reason_with_bin() {
  jq -nc --arg c "$2" --arg d "$cwd" '{tool_name:"Bash",tool_input:{command:$c},cwd:$d}' \
    | PATH=$1 "$py" "$hook" | jq -r '.hookSpecificOutput.permissionDecisionReason'
}
# TMPDIR above is a fake path for the temp-dir rules, so the scratch dir goes under /tmp.
bins=$(mktemp -d /tmp/delete-guard-bins.XXXXXX) || fail "cannot create a scratch dir"
trap 'rm -rf -- "$bins"' EXIT
mkdir -p "$bins/none" "$bins/trash"
for name in trash trash-put; do print '#!/bin/sh' > "$bins/trash/$name"; chmod +x "$bins/trash/$name"; done
(( count++ )); [[ "$(reason_with_bin "$bins/trash" 'rm -rf ~/x')" == *'改用 `'*' <路径>`，删进废纸篓可找回。'*'macOS 和 Linux（含 WSL）'*'github.com/Adonis0123/adonis-skills'* ]] || fail "rm reason must suggest a trash command when one is on PATH"
(( count++ )); [[ "$(reason_with_bin "$bins/none" 'rm -rf ~/x')" == *'本机没找到废纸篓命令：改用 `mv <路径> /tmp/`'*'macOS 和 Linux（含 WSL）'*'github.com/Adonis0123/adonis-skills'* ]] || fail "rm reason without a trash command must still give a <路径> command"
(( count++ )); [[ "$(reason 'rm -rf ~/x')" == *'改用 `'*'<路径>'* ]] || fail "rm reason must give a command with <路径> on this machine"
(( count++ )); [[ "$(reason 'git reset --hard')" == *'git stash'*用户确认* ]] || fail "git reason must suggest git stash"
(( count++ )); [[ "$(reason 'find ~ -delete')" == *废纸篓* ]] || fail "find reason must suggest trash"
# hint <platform> <commands on PATH...> -> the alternative the reason gives on that system
hint() {
  local platform=$1; shift
  python3 - "$hook" "$platform" "$@" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("delete_guard", sys.argv[1])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
found = set(sys.argv[3:])
print(mod.alternative(sys.argv[2], lambda name: "/bin/" + name if name in found else None))
PY
}
(( count++ )); [[ "$(hint darwin trash)" == '改用 `trash <路径>`'* ]] || fail "macOS suggests trash"
(( count++ )); [[ "$(hint linux gio trash-put)" == '改用 `trash-put <路径>`'* ]] || fail "Linux with both prefers trash-put"
(( count++ )); [[ "$(hint linux trash-put)" == '改用 `trash-put <路径>`'* ]] || fail "Linux with trash-cli suggests trash-put"
(( count++ )); [[ "$(hint linux gio)" == '改用 `gio trash <路径>`'* ]] || fail "Linux with only gio suggests gio trash"
(( count++ )); [[ "$(hint linux)" == '本机没找到废纸篓命令：改用 `mv <路径> /tmp/`'*'请用户自己删'* ]] || fail "Linux without a trash command says to move or ask"
(( count++ )); [[ "$(hint darwin)" == '本机没找到废纸篓命令'* ]] || fail "macOS without trash says to move or ask"
(( count++ )); [[ "$(hint win32 trash gio)" == '本机没找到废纸篓命令'*'欢迎提 PR'* ]] || fail "other systems fall back and invite a PR"

# ── 10b. every reason opens with the hook's label, for all three hosts ───────
(( count++ )); [[ "$(reason 'rm -rf ~/x')" == '[delete-guard] 这条命令会递归删除'* ]] || fail "rm reason must open with the label"
(( count++ )); [[ "$(reason 'git reset --hard')" == '[delete-guard] `git reset --hard`'* ]] || fail "git reason must open with the label"
(( count++ )); [[ "$(reason 'find ~ -delete')" == '[delete-guard] 这条 `find`'* ]] || fail "find reason must open with the label"
(( count++ )); [[ "$(reason_as codex Bash 'rm -rf ~/x')" == '[delete-guard] '* ]] || fail "codex reason must open with the label"
(( count++ )); [[ "$(reason_as grok run_terminal_command 'rm -rf ~/x')" == '[delete-guard] '* ]] || fail "grok rm reason must open with the label"
(( count++ )); [[ "$(reason_as grok run_terminal_command 'git reset --hard')" == '[delete-guard] '* ]] || fail "grok git reason must open with the label"
(( count++ )); [[ "$(reason_as grok run_terminal_command 'find ~ -delete')" == '[delete-guard] '* ]] || fail "grok find reason must open with the label"

# ── 11. bad input, oversized input and the off switch allow (fail-open) ──────
for bad in '' 'not json' '[]' '{"tool_name":"Bash"}' '{"tool_name":"Bash","tool_input":{"command":42}}' \
           '{"tool_name":"Bash","tool_input":"rm -rf ~"}'; do
  (( count++ )); out=$(print -rn -- "$bad" | python3 "$hook"); [[ $? == 0 && -z $out ]] || fail "bad input must allow: $bad"
done
(( count++ )); out=$(jq -nc '{tool_name:"Bash",tool_input:{command:"rm -rf ~/x"}}' | DELETE_GUARD=0 python3 "$hook")
[[ -z $out ]] || fail "DELETE_GUARD=0 disables"

print -- "PASS: delete-guard ($count checks)"
