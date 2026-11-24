#!/bin/zsh
# Tests for bash-prompt-guard.py (PreToolUse hook that denies Bash commands Claude Code cannot check).
# Run: zsh plugins/bash-prompt-guard/tests/bash-prompt-guard.test.zsh   (needs python3 and jq)

set -u
script_dir="${0:A:h}"
hook="${script_dir:h}/scripts/bash-prompt-guard.py"
fail() { print -u2 -- "FAIL: $1"; exit 1 }

[[ -f $hook ]] || fail "missing $hook"

# decision <tool> <command> -> "deny" or "" ; exit code must always be 0
decision() {
  local out rc
  out=$(jq -nc --arg t "$1" --arg c "$2" '{hook_event_name:"PreToolUse",tool_name:$t,tool_input:{command:$c}}' | python3 "$hook"); rc=$?
  [[ $rc == 0 ]] || fail "exit code $rc for: $2"
  [[ -z $out ]] && return
  print -rn -- "$out" | jq -r '.hookSpecificOutput.permissionDecision'
}
denies() { [[ "$(decision Bash "$1")" == deny ]] || fail "should deny: $1" }
allows() { [[ -z "$(decision "${2:-Bash}" "$1")" ]] || fail "should allow: $1" }

# ── 1. the command that held a subagent for 5 hours, and other zsh flags ─
denies 'cd /repo; FILES=(${(f)"$(git status --porcelain | awk '"'"'{print $2}'"'"')"}); pnpm exec eslint --fix $FILES'
denies 'parts=(${(s:,:)LIST}); echo $parts'
denies 'echo "${(j: :)arr}"'

# ── 2. bash-parsable commands pass ─
allows 'git diff --name-only --diff-filter=d | xargs pnpm exec eslint --fix'
allows 'echo ${#FILES} ${HOME} ${x:-default} $(date)'
allows 'B=(python3 board.py --run x); "${B[@]}" status'

# ── 3. text the shell does not expand passes ─
allows "printf '%s' '\${(f)x}'"
allows $'S=/tmp; $S/run.sh <<\'JS\'\nconst s = `${(a + b)}`\nJS\necho done'
allows $'cat > /tmp/x <<"EOF"\n${(f)y}\nEOF'
denies $'cat > /tmp/x <<EOF\n${(f)y}\nEOF'
denies $'cat <<\'EOF\'; echo ${(f)x}\nhello\nEOF'
denies $'echo "it\'s ${(f)x} it\'s"'
allows '# example ${(f)x}'
allows 'echo "\${(f)x}"'

# ── 4. rm together with a multi-line inline shell script (bash -c, sh -c, zsh -c) ─
denies $'rm -rf "/Volumes/Data/.Trash/App 1.app" && rmdir ~/Downloads/x; bash -c \'\nset -euo pipefail\necho hi\''
denies $'sh -c \'cd /tmp\nrm -rf a\''
denies $'sh -c \'echo a\nX=1 rm -f /tmp/a\''
denies $'find . -name \'*.log\' | xargs rm -f; zsh -lc "\necho ok"'
allows "rm -f /tmp/a; ls *.md | xargs -P 3 -I{} sh -c 'echo {}'"
allows "sh -c 'rm -rf /tmp/a'"
allows 'eval "$CMD"; rm -f /tmp/a'
allows 'rm -rf "/Volumes/Data/.Trash/App 1.app" && rmdir ~/Downloads/x'
allows "bash -c 'set -e; echo hi'"
allows 'bash /tmp/scratch/run-checks.sh'
allows 'grep -n "rm -rf" docs/x.md; echo done'
allows 'git rm --cached a.txt'
allows 'claude plugin eval . --eval-dir evals/x && rm -rf evals/x/out'
allows $'rm -rf /tmp/run && python3 - <<\'EOF\'\nprint("bash -c and eval in text")\nEOF'
allows $'rm -f /tmp/a\n# check bash -c usage later\necho ok'

# ── 5. zsh modifiers and glob qualifiers ─
denies 'for f in *.png; do echo ${f:t}; done'
denies 'n=${r:t:r:r}; echo $n'
denies 'ls -d /tmp/x/*(N) 2>/dev/null'
allows 'echo "[ADR](./adr/0002.md)" ${x:-y} ${#a}'
allows "grep -E 'a*(b)' f.txt"
allows 'grep -vE "^\s*(//|\*)" a.ts; grep -nE "^ *(N|B)[0-9]+" b.md'
denies 'for r in /tmp/x/*.txt(N); do echo $r; done'

# ── 6. rm targets Claude Code counts as critical paths ─
denies 'S=/tmp/scratch/burst; mkdir -p $S; rm -f $S/*; ls'
denies 'rm -f "$D"/*.json'
denies 'rm -rf $OUT/'
denies 'rm -rf "$(getconf DARWIN_USER_TEMP_DIR)/x"'
allows 'rm -f "${D:?}"/*.json'
allows 'rm -f "$(getconf DARWIN_USER_TEMP_DIR)x.log"'
allows 'rm -rf "$OUT"'
allows 'rm -f /tmp/scratch/a.json && echo $D/*.json'
denies 'rm -f $D/?.png'
denies 'rm --recursive "$(printf %s /tmp/x)"'
allows "rm -f '\$D/*.png'"
allows "printf '%s\\n' 'example; rm -rf \$D/*'"

# ── 7. a `$(` that never closes ─
denies 'W=/x; F=$W/a.ts; grep -n "^  [a-zA-Z$(]" $F | grep -v "^[0-9]*:  \(async \)\?function" | head -40'
denies 'echo "$(date"'
allows 'echo "$(git log -1 --format="%h %s")" "$(( 1 + 2 ))"'
allows "grep -n '^  [a-zA-Z\$(]' a.ts"
allows 'grep -n "^  [a-zA-Z\$(]" a.ts'
allows 'x=$(case $y in a) echo A;; esac); echo $x'
allows $'# a comment with $( inside\necho ok'
allows $'cat <<\'EOF\'\n$( not closed\nEOF'

# ── 8. a `${` bash does not read as a parameter expansion ─
denies $'python3 -I - <<\'EOF\'\nold="""timer = ${a.b}"""\nEOF\ngrep -rn "frame ${size(frame.innerWidth)}" packages/x/src/layout-trace.ts'
denies 'grep -rn "${obj.key}" src'
denies 'echo ${a b}'
denies $'cat <<EOF\nconst s = `${user.name}`\nEOF'
allows "grep -rnF 'frame \${size(frame.innerWidth)}' src"
allows 'grep -rn "frame \${size(x)}" src'
allows $'cat <<\'EOF\'\nconst s = `${user.name}`\nEOF'
allows 'echo ${HOME} ${1} ${10} ${#} ${#arr[@]} ${!ref} ${!pre*} ${x:-a} ${x#*/} ${x%.*} ${x/a/b} ${x^^} ${x,} ${x@Q} ${@} ${*} ${?} ${$} ${-} "${D:?}"'

# ── 8a. a subshell after an operator inside `$(...)` (probed headless, Claude Code 2.1.331) ─
denies 'for t in v2.71.40 v2.72.0; do c=$(git rev-parse -q --verify "refs/tags/$t^{commit}" || (git fetch -q origin "refs/tags/$t:refs/tags/$t" && git rev-parse "refs/tags/$t^{commit}")); echo "$t $c"; done'
denies 'echo "$(echo a || (echo b))"'
denies 'c=$(echo a && (echo b)); echo "$c"'
denies 'c=$(echo a; (echo b)); echo "$c"'
denies 'c=$(echo a | (cat)); echo "$c"'
denies $'c=$(echo a\n(echo b)); echo "$c"'
allows 'c=$( (echo a) || echo b ); echo "$c"'
allows 'echo a || (echo b)'
allows 'c=$(echo a || { echo b; }); echo "$c"'
allows 'c=$(case a in (a) echo A;; (b) echo B;; esac); echo "$c"'
allows 'c=$(echo a; ((x=1)); echo $((1+2))); echo "$c"'
allows "c=\$(echo 'a || (b)'); echo \"\$c\""
allows 'c=`echo a || (echo b)`; echo "$c"'

# ── 8b. every reason opens with the hook's label ─
reason() {
  jq -nc --arg c "$1" '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$c}}' | python3 "$hook" \
    | jq -r '.hookSpecificOutput.permissionDecisionReason'
}
labelled() {
  local r; r=$(reason "$1")
  [[ $r == "[bash-prompt-guard] $2"* ]] || fail "reason must open with the label and '$2': $1"
  [[ $r == *"Fix: "* ]] || fail "reason must say how to fix: $1"
}
labelled 'echo "${(j: :)arr}"' 'The command uses zsh-only syntax'
labelled 'echo "$(date"' 'The command has a `$(` that is never closed'
labelled 'grep -rn "${obj.key}" src' 'The command has a `${...}` the shell does not read'
labelled 'c=$(a || (b)); echo $c' 'The command has a `( ... )` subshell after'
labelled $'sh -c \'cd /tmp\nrm -rf a\'' 'The command combines `rm`/`rmdir` with a multi-line inline script'
labelled 'rm -rf $OUT/' 'An `rm` target is a variable followed by a glob or a trailing slash'

# ── 9. other tools, bad input and the off switch ─
allows 'FILES=(${(f)x})' Read
out=$(print -rn -- 'not json' | python3 "$hook"); [[ $? == 0 && -z $out ]] || fail "bad json must allow"
out=$(jq -nc '{tool_name:"Bash",tool_input:{command:"x=(${(f)y})"}}' | BASH_PROMPT_GUARD=0 python3 "$hook"); [[ -z $out ]] || fail "BASH_PROMPT_GUARD=0 must allow"

out=$(jq -nc '{tool_name:"Bash",tool_input:{command:"echo ${(f)x}"}}' | PYTHONIOENCODING=ascii python3 "$hook"); [[ $? == 0 && $(print -rn -- "$out" | jq -r '.hookSpecificOutput.permissionDecision') == deny ]] || fail "ascii stdout must still deny"
# a missing heredoc end marker in a 4 MB command must not hang the hook (5 s timeout)
start=$SECONDS
out=$(python3 -c 'import json; print(json.dumps({"tool_name":"Bash","tool_input":{"command":"cat <<OUTER\n" + "cat <<\x27MISSING\x27\n" * 270000 + "OUTER"}}))' | python3 "$hook"); rc=$?
[[ $rc == 0 ]] && (( SECONDS - start < 3 )) || fail "4 MB command must finish fast with exit 0"
start=$SECONDS
out=$(python3 -c 'import json; print(json.dumps({"tool_name":"Bash","tool_input":{"command":"cat <<OUTER\n" + "cat <<\x27MISSING\x27\n" * 25000 + "OUTER\nx=(${(f)y})"}}))' | python3 "$hook"); rc=$?
[[ $rc == 0 ]] && (( SECONDS - start < 3 )) || fail "400 KB command must finish fast with exit 0"
# whitespace-heavy input under the size limit must not go quadratic
start=$SECONDS
out=$(python3 -c 'import json; print(json.dumps({"tool_name":"Bash","tool_input":{"command":"\n" * 20000 + "echo safe"}}))' | python3 "$hook"); rc=$?
[[ $rc == 0 && -z $out ]] && (( SECONDS - start < 3 )) || fail "20,000 newlines must finish fast and allow"
for big in '"echo " + "*a" * 40000' '"echo " + "?" * 40000' '"rm " + "$a/" * 13000' '"[[ x =~ " * 60000' '"=~ " * 150000 + "]]"'; do
  start=$SECONDS
  out=$(python3 -c "import json; print(json.dumps({'tool_name':'Bash','tool_input':{'command':$big}}))" | python3 "$hook"); rc=$?
  [[ $rc == 0 ]] && (( SECONDS - start < 3 )) || fail "glob-heavy input must finish fast: $big"
done

# ── 10. quoting edge cases ─
allows "echo \"\$(printf '%s' '\${obj.key}')\""          # single quotes inside "$(...)" stay literal
denies 'echo "$(echo ${(f)x})"'                            # but a zsh flag there still expands
allows $'cat <<\'EOF\'\n EOF\n${obj.key}\nEOF'           # an indented EOF is body, not the end line
denies $'cat <<-\'EOF\'\n\tEOF\necho ${(f)x}'             # <<- ends at a tab-indented EOF
denies $'# example <<\'EOF\'\necho ${(f)items}'          # a heredoc in a comment opens nothing
denies $'echo "<<\'EOF\'"\necho ${(f)items}'             # nor one inside double quotes
denies $'printf "%s\\n" "\n<<\'EOF\'\n"\necho ${(f)items}' # nor one inside a multi-line double-quoted string
allows $'cat <<\'END-OF-SCRIPT\'\nconst name = `${user.name}`;\nEND-OF-SCRIPT'  # any quoted delimiter
allows $'cat <<\'123\'\nconst name = `${user.name}`;\n123'
allows $'cat <<EOF\nit\'s fine\nEOF\ncat <<\'JS\'\nconst s = `${a.b}`\nJS'  # an unquoted body does not open a quote
denies $'cat <<EOF\n${(f)x}\nEOF'                          # an unquoted body still expands
allows 'cat <<< "hello"; echo ok'                          # a here-string is not a heredoc
denies $'cat <<EOF\nit\'s fine\nEOF\necho ${(f)x}'         # a body apostrophe does not hide the next command
denies $'cat <<EOF\n\'${obj.key}\'\nEOF'                  # body quotes do not stop expansion
allows $'value="$(cat <<\'EOF\'\n${obj.key}\nEOF\n)"; printf \'%s\\n\' "$value"'  # quoted heredoc inside "$(...)"
allows $'items=(a b c); cat <<EOF\nCount: ${#items[@]}\nEOF'  # `#` inside an expansion in an unquoted body
allows $'p=/tmp/example; cat <<EOF\nName: ${p##*/}\nEOF'
denies $'cat <<EOF\n# Title ${(f)x}\nEOF'                  # a body line starting with `#` still expands

# ── 11. sudo options before rm ─
denies 'sudo rm -rf $D/*'
denies 'sudo -n rm -rf $D/*'
denies 'sudo -u root rm -rf $D/*'
denies 'sudo -E --preserve-env=PATH rm -f $D/*.png'
allows 'sudo -n rm -rf "${D:?}"/*'
denies 'sudo -n -- rm -rf $D/*'                             # `--` ends sudo options
allows $'version=v1.2.3; [[ "$version" =~ ^v?(.*)$ ]]; printf \'%s\\n\' "${BASH_REMATCH[1]}"'  # a bash regex is not a glob
denies 'ls *.txt(N) && [[ x =~ y ]]'                       # a real qualifier outside the regex still counts
start=$SECONDS
out=$(python3 -c 'import json; print(json.dumps({"tool_name":"Bash","tool_input":{"command":"rm -f /tmp/x; printf \"%s\" \"x bash -c \x27" + "\n" * 200000 + "\""}}))' | python3 "$hook"); rc=$?
[[ $rc == 0 ]] && (( SECONDS - start < 3 )) || fail "unclosed bash -c quote with 200,000 newlines must finish fast"

print "PASS bash-prompt-guard"
