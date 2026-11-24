#!/bin/sh
# completion-claim-check.sh — Stop hook: block once when the agent claims "done" without verification evidence.
#
# Works as a synchronous Stop hook in Claude Code and Codex (plugin hooks/hooks.json) and Grok Build.
# Blocks only when ALL hold:
#   - the stop flag is not active (stop_hook_active / stopHookActive), so it blocks at most once per turn
#   - cwd is inside a git worktree with uncommitted changes (git status --porcelain non-empty)
#   - the last assistant message claims completion (已完成 / 改完 / done / fixed ...; "未完成" is not a claim)
#   - the message carries no verification evidence (验证 / 测试 / pytest / PASS / UNVERIFIED / ``` ...)
# Block = one JSON object on stdout: {"decision":"block","reason":"..."} (same protocol on all three hosts).
# Anything else, including every error, allows the stop: exit 0, no output. No network, no model.
#
# The host is read from the payload itself: Claude Code and Codex send snake_case fields
# (last_assistant_message, stop_hook_active, cwd), Grok sends camelCase (lastAssistantMessage,
# stopHookActive, workspaceRoot). Both namings are read on every call, so --agent is optional; it is
# kept for existing hook files that pass it.
#
# Usage: completion-claim-check.sh [--agent claude|codex|grok]
# Needs: sh, jq, git; perl (optional) bounds git status by a timeout.
# Env:
#   COMPLETION_CHECK=0                  disable entirely
#   COMPLETION_CHECK_GIT_TIMEOUT=3      seconds before git status is abandoned (then allow)

agent=""
while [ $# -gt 0 ]; do
  case $1 in
    --agent) agent="${2:-}"; shift ;;
    --agent=*) agent="${1#--agent=}" ;;
  esac
  shift
done
case $agent in claude|codex|grok|agy|"") ;; *) exit 0 ;; esac

is_agy=0
[ "$agent" = "agy" ] && is_agy=1
allow_stop() {
  [ "$is_agy" = "1" ] && printf '%s\n' '{"decision":""}'
  exit 0
}

[ "${COMPLETION_CHECK:-1}" = "0" ] && allow_stop
command -v jq >/dev/null 2>&1 || allow_stop
command -v git >/dev/null 2>&1 || allow_stop

input="$(cat 2>/dev/null)" || allow_stop
[ -n "$input" ] || allow_stop

# Detect Antigravity Stop payloads (terminationReason / conversationId) and extract last PLANNER_RESPONSE from transcriptPath when needed.
meta="$(printf '%s' "$input" | jq -r '
  [
    (if (has("terminationReason") or has("conversationId")) then "1" else "0" end),
    ((.terminationReason // "-") | tostring | if length == 0 then "-" else . end),
    ((.last_assistant_message // .lastAssistantMessage // "") | if type == "string" and length > 0 then "1" else "0" end),
    ((.transcriptPath // "-") | tostring | if length == 0 then "-" else . end)
  ] | @tsv
' 2>/dev/null)" || allow_stop
tab="$(printf '\t')"
IFS="$tab" read -r detected_agy term_reason has_msg transcript_path <<EOF
$meta
EOF
[ "$detected_agy" = "1" ] && is_agy=1
if [ "$term_reason" != "-" ] && [ "$term_reason" != "NO_TOOL_CALL" ]; then
  allow_stop
fi

agy_msg=""
if [ "$has_msg" = "0" ] && [ "$transcript_path" != "-" ] && [ -r "$transcript_path" ]; then
  agy_msg="$(jq -rs '[.[] | select(.type == "PLANNER_RESPONSE" and (.content | type == "string") and (.content | length > 0)) | .content] | last // ""' "$transcript_path" 2>/dev/null)" || agy_msg=""
fi

# One jq pass: snake_case (Claude, Codex) or camelCase (Grok, Antigravity) fields -> "<active>\t<claim>\t<evidence>\t<cwd>".
verdict="$(printf '%s' "$input" | jq -r --arg fallback_msg "$agy_msg" '
  def flag: if . == true or . == "true" then "1" else "0" end;
  ((.last_assistant_message // .lastAssistantMessage // $fallback_msg) | if type == "string" then . else "" end) as $msg
  | ($msg
     | gsub("(未|没有|没|尚未|还没有|还没|并未|不算|待)(全部|完全)?(完成|改完|修复|修好|搞定)"; "")
     | gsub("完成(条件|标准|度|情况|进度|前|后|时)"; "")
     | gsub("(not|n.t)( yet| quite)? (done|fixed|all set)"; ""; "i")) as $claimtext
  | ((.stop_hook_active // .stopHookActive // .continuationActive // false) | flag) as $active
  | ($claimtext | test("已完成|完成了|已经完成|全部完成|改完|已修复|修复了|修好了|搞定|\\bdone\\b|\\bfixed\\b|\\ball set\\b"; "i")) as $claim
  | ($msg | test("验证|测试|\\btests?\\b|pytest|vitest|jest|pnpm|npm|yarn|cargo test|go test|zsh [^\n]*test|\\bPASS|\\bFAIL|UNVERIFIED|未验证|跑了|exit code|退出码|```"; "i")) as $evidence
  | [$active, ($claim | tostring), ($evidence | tostring), ((.cwd // .workspaceRoot // "") | tostring)] | @tsv
' 2>/dev/null)" || allow_stop

IFS="$tab" read -r active claim evidence cwd <<EOF
$verdict
EOF

[ "$active" = "0" ] || allow_stop
[ "$claim" = "true" ] || allow_stop
[ "$evidence" = "false" ] || allow_stop
[ -n "$cwd" ] && [ -d "$cwd" ] || allow_stop

# git status bounded by a perl alarm (macOS ships no timeout(1)); a timeout or any git error allows the stop.
secs="${COMPLETION_CHECK_GIT_TIMEOUT:-3}"
if command -v perl >/dev/null 2>&1; then
  dirty="$(perl -e 'alarm shift; exec @ARGV or exit 1' "$secs" git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)" || allow_stop
else
  dirty="$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)" || allow_stop
fi
[ -n "$dirty" ] || allow_stop

if [ "$is_agy" = "1" ]; then
  printf '%s\n' '{"decision":"continue","reason":"你说已完成，但工作区有未提交改动，回复里没有验证证据。补上验证命令和结果，或把没验证的项标成 UNVERIFIED。"}'
else
  printf '%s\n' '{"decision":"block","reason":"你说已完成，但工作区有未提交改动，回复里没有验证证据。补上验证命令和结果，或把没验证的项标成 UNVERIFIED。"}'
fi
exit 0
