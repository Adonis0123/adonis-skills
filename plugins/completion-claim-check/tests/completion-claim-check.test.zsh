#!/bin/zsh
# Tests for completion-claim-check.sh (temp git repos).
# Run: zsh plugins/completion-claim-check/tests/completion-claim-check.test.zsh   (needs sh, jq and git)

set -u
script_dir="${0:A:h}"
hook="${script_dir:h}/scripts/completion-claim-check.sh"
fail() { print -u2 -- "FAIL: $1"; exit 1 }
assert_equal() { [[ "$2" == "$1" ]] || fail "$3 (expected=$1 actual=$2)" }
assert_grep() { grep -q -- "$1" "$2" || fail "$3 (missing: $1)" }

[[ -f $hook ]] || fail "missing $hook"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/completion-check-test.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
TMP=${TMP:A}

dirty="$TMP/dirty"; clean="$TMP/clean"; plain="$TMP/plain"
for r in $dirty $clean; do
  git init -q "$r"; git -C "$r" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
done
print change > "$dirty/file.txt"; mkdir -p "$plain"

# run <agent> <message> <cwd> [active] -> stdout of the hook; exit code must always be 0
run() {
  local agent=$1 msg=$2 cwd=$3 active=${4:-false} payload rc
  if [[ $agent == grok || $agent == auto-grok ]]; then
    payload=$(jq -nc --arg m "$msg" --arg c "$cwd" --argjson a "$active" '{hookEventName:"stop",lastAssistantMessage:$m,cwd:$c,stopHookActive:$a}')
  else
    payload=$(jq -nc --arg m "$msg" --arg c "$cwd" --argjson a "$active" '{hook_event_name:"Stop",last_assistant_message:$m,cwd:$c,stop_hook_active:$a,transcript_path:"/nonexistent"}')
  fi
  if [[ $agent == auto || $agent == auto-grok ]]; then
    out=$(print -rn -- "$payload" | sh "$hook"); rc=$?
  else
    out=$(print -rn -- "$payload" | sh "$hook" --agent "$agent"); rc=$?
  fi
  assert_equal 0 $rc "hook exit code ($agent: $msg)"
  print -rn -- "$out"
}
blocks() { [[ "$(run "$@" | jq -r '.decision' 2>/dev/null)" == block ]] }

# ── 1. each agent's field naming: claim without evidence in a dirty tree blocks ─
for agent in claude codex grok; do
  blocks $agent '已完成修改。' "$dirty" || fail "$agent: claim w/o evidence must block"
done
reason=$(run claude '改完了' "$dirty" | jq -r .reason)
assert_equal '你说已完成，但工作区有未提交改动，回复里没有验证证据。补上验证命令和结果，或把没验证的项标成 UNVERIFIED。' "$reason" "block reason text"
blocks codex 'All done, the bug is fixed.' "$dirty" || fail "English claim must block"
# camelCase message must be read even when --agent says claude (no cross-field loss)
out=$(jq -nc --arg c "$dirty" '{lastAssistantMessage:"搞定",cwd:$c,stopHookActive:false}' | sh "$hook" --agent claude)
assert_equal block "$(print -r -- "$out" | jq -r .decision)" "camelCase fields read for any agent"

# ── 1b. no --agent (plugin hooks.json): the payload's field naming is enough ─
blocks auto '已完成修改。' "$dirty" || fail "no --agent, snake_case payload must block"
blocks auto-grok '已完成修改。' "$dirty" || fail "no --agent, camelCase payload must block"
assert_equal '' "$(run auto '已完成' "$dirty" true)" "no --agent: stop_hook_active true allows"
assert_equal '' "$(run auto-grok '已完成' "$dirty" true)" "no --agent: stopHookActive true allows"
assert_equal '' "$(run auto '已完成' "$clean")" "no --agent: clean tree allows"
out=$(jq -nc --arg c "$dirty" '{hookEventName:"stop",lastAssistantMessage:"搞定",workspaceRoot:$c,stopHookActive:false}' | sh "$hook")
assert_equal block "$(print -r -- "$out" | jq -r .decision)" "no --agent: Grok workspaceRoot is the cwd"

# ── 2. stop flag active -> allow (block at most once per turn) ───────────────
for agent in claude codex grok; do
  assert_equal '' "$(run $agent '已完成' "$dirty" true)" "$agent: stop_hook_active true allows"
done

# ── 3. clean tree / non-git cwd / missing cwd -> allow ───────────────────────
assert_equal '' "$(run claude '已完成' "$clean")" "clean tree allows"
assert_equal '' "$(run codex '已完成' "$plain")" "non-git dir allows"
assert_equal '' "$(run grok '已完成' "$TMP/nope")" "missing cwd allows"

# ── 4. claim + evidence -> allow ─────────────────────────────────────────────
for msg in '已完成，跑了 `zsh scripts/tests/a.test.zsh`，PASS' '已修复，测试通过' 'Done. Ran pnpm test: all green' \
           "已完成。\n\`\`\`\nok\n\`\`\`" '改完了，浏览器部分 UNVERIFIED' 'fixed; exit code 0'; do
  assert_equal '' "$(run claude "${(g::)msg}" "$dirty")" "evidence allows: $msg"
done

# ── 5. negations and non-claims are not completion claims ────────────────────
for msg in '还未完成，下一步改 B。' '没完成：缺配置' '完成条件是 X' '尚未修复' 'not done yet' "It isn't fixed yet" '我先看一下代码'; do
  assert_equal '' "$(run codex "$msg" "$dirty")" "not a claim: $msg"
done

# ── 6. malformed / empty / null input -> allow; disabled -> allow ────────────
for payload in '{' 'not json' '' '[]' '{"last_assistant_message":null,"cwd":"'$dirty'"}' '{"last_assistant_message":42,"cwd":"'$dirty'"}'; do
  out=$(print -rn -- "$payload" | sh "$hook" --agent codex); rc=$?
  assert_equal 0 $rc "malformed exit code: $payload"; assert_equal '' "$out" "malformed allows: $payload"
done
out=$(jq -nc --arg c "$dirty" '{last_assistant_message:"已完成",cwd:$c}' | COMPLETION_CHECK=0 sh "$hook" --agent claude)
assert_equal '' "$out" "COMPLETION_CHECK=0 disables"
out=$(jq -nc --arg c "$dirty" '{last_assistant_message:"已完成",cwd:$c}' | sh "$hook" --agent bogus)
assert_equal '' "$out" "unknown agent allows"

print -r -- "PASS: completion-claim-check tests"
