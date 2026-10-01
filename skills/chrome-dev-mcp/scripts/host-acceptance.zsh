#!/bin/zsh

# Run the read-only multi-host acceptance from references/host-verification.md.
# By default each host gets a fresh headless session that may run only this
# skill's readiness helper and shared CLI. --bypass (explicit user approval only)
# gives every host its approve-everything flag instead.

set -euo pipefail

skill_dir="${0:A:h:h}"
timeout_s=300
out_dir=""
keep_raw=false
bypass=false
typeset -a hosts all_hosts
all_hosts=(claude codex grok cursor)

fail_closed() {
  print -u2 -- "STATUS=ERROR"
  print -u2 -- "ERROR_CLASS=$1"
  exit 69
}

while (( $# > 0 )); do
  case "$1" in
    --host)
      [[ $# -ge 2 && " ${all_hosts[*]} " == *" $2 "* ]] || fail_closed "unknown_host"
      hosts+=("$2")
      shift 2
      ;;
    --timeout)
      [[ $# -ge 2 && "$2" == <-> ]] || fail_closed "bad_timeout"
      timeout_s="$2"
      shift 2
      ;;
    --out)
      [[ $# -ge 2 && -n "$2" ]] || fail_closed "missing_option_value"
      out_dir="$2"
      shift 2
      ;;
    --keep-raw)
      keep_raw=true
      shift
      ;;
    --bypass)
      bypass=true
      shift
      ;;
    *) fail_closed "unexpected_arguments" ;;
  esac
done
(( ${#hosts} > 0 )) || hosts=("${all_hosts[@]}")
[[ -n "$out_dir" ]] || out_dir="$(mktemp -d "${TMPDIR:-/tmp}/chrome-dev-mcp-acceptance.XXXXXX")"
/bin/mkdir -p "$out_dir"
/bin/chmod 700 "$out_dir"

prompt='只读验收：必须通过 chrome-dev-mcp skill 的共享 CLI 真实调用 list_pages 一次；不要导航、点击，也不要输出页面 URL、标题或正文。成功只回答 CHROME_DEV_MCP_READY，共享调用失败只回答 CHROME_DEV_MCP_FAIL。不要自动回退到 native MCP。'

# Commands each host may run, matching the skill's documented entry points.
readiness_rule='zsh scripts/uxc-readiness.zsh'
cli_rule='chrome-dev-mcp-cli'

run_host() {
  local host="$1" raw="$out_dir/$1.raw" final="$out_dir/$1.final"
  : >| "$final"
  case "$host:$bypass" in
    claude:false)
      claude -p "/chrome-dev-mcp $prompt" \
        --output-format stream-json --verbose \
        --allowedTools "Skill(chrome-dev-mcp)" "Bash($readiness_rule*)" "Bash($cli_rule *)"
      ;;
    claude:true)
      claude -p "/chrome-dev-mcp $prompt" \
        --output-format stream-json --verbose --permission-mode bypassPermissions
      ;;
    codex:false)
      # workspace-write keeps the sandbox; the shared daemon socket and cache live in ~/.uxc.
      codex exec --skip-git-repo-check -C "$skill_dir" \
        -s workspace-write -c sandbox_workspace_write.network_access=true \
        --add-dir "$HOME/.uxc" -o "$final" \
        "\$chrome-dev-mcp $prompt"
      ;;
    codex:true)
      codex exec --skip-git-repo-check -C "$skill_dir" \
        --dangerously-bypass-approvals-and-sandbox -o "$final" \
        "\$chrome-dev-mcp $prompt"
      ;;
    grok:false)
      grok -p "/chrome-dev-mcp $prompt" --output-format streaming-json \
        --allow "Bash($readiness_rule*)" --allow "Bash($cli_rule*)"
      ;;
    grok:true)
      grok -p "/chrome-dev-mcp $prompt" --output-format streaming-json --always-approve
      ;;
    cursor:false)
      # Shell permissions come from the user's cursor-agent cli-config.json allow list.
      cursor-agent -p --trust --output-format stream-json "$prompt"
      ;;
    cursor:true)
      cursor-agent -p --trust --force --output-format stream-json "$prompt"
      ;;
  esac >| "$raw" 2>&1
}

run_with_timeout() {
  local host="$1" pid watchdog rc
  ( cd "$skill_dir" && run_host "$host" ) &
  pid=$!
  # Poll instead of one long sleep so no orphaned sleep holds the caller's pipes open.
  (
    integer waited=0
    while kill -0 "$pid" 2>/dev/null && (( waited < timeout_s )); do
      sleep 1
      (( waited += 1 ))
    done
    kill -TERM "$pid" 2>/dev/null || true
  ) >/dev/null 2>&1 &
  watchdog=$!
  rc=0
  wait "$pid" || rc=$?
  wait "$watchdog" 2>/dev/null || true
  print -r -- "$rc" >| "$out_dir/$host.exit"
}

extract_final() {
  local host="$1" raw="$out_dir/$1.raw" final="$out_dir/$1.final"
  [[ -s "$final" ]] && return
  case "$host" in
    claude|cursor)
      /usr/bin/jq -rR 'fromjson? | select(.type == "result") | .result // empty' "$raw" >| "$final" 2>/dev/null || true
      ;;
    grok)
      # The answer is the text streamed after the last tool call; thoughts may quote the prompt's sentinels.
      /usr/bin/jq -rRs '[split("\n")[] | fromjson? | select(type == "object")]
        | (map(.type) | rindex("tool_call_update") // -1) as $last
        | .[($last + 1):] | map(select(.type == "text") | .data // empty) | join("")' \
        "$raw" >| "$final" 2>/dev/null || true
      ;;
  esac
  # Fallback: the last sentinel the host printed.
  /usr/bin/grep -q "[^[:space:]]" "$final" 2>/dev/null || /usr/bin/grep -oE 'CHROME_DEV_MCP_(READY|FAIL)' "$raw" 2>/dev/null | /usr/bin/tail -1 >| "$final" || true
}

# Private page URLs for the leak check; never printed.
url_file="$out_dir/.page-urls"
chrome-dev-mcp-cli --timeout-ms 20000 list_pages 2>/dev/null |
  /usr/bin/jq -r '.data.content[0].text // empty' |
  /usr/bin/sed -nE 's/^[0-9]+: .*\(([^()]*)\)( \[selected\])?$/\1/p' >| "$url_file" || true

for host in "${hosts[@]}"; do
  if command -v "${${host/cursor/cursor-agent}}" >/dev/null 2>&1; then
    run_with_timeout "$host" &
  else
    print -r -- "127" >| "$out_dir/$host.exit"
    : >| "$out_dir/$host.raw"
  fi
done
wait

overall=0
for host in "${hosts[@]}"; do
  extract_final "$host"
  raw="$out_dir/$host.raw"
  final="$out_dir/$host.final"
  rc="$(<"$out_dir/$host.exit")"
  trace=NO
  /usr/bin/grep -qE 'uxc-readiness\.zsh|chrome-dev-mcp-cli' "$raw" 2>/dev/null && trace=YES
  sentinel=NONE
  if /usr/bin/grep -q 'CHROME_DEV_MCP_FAIL' "$final" 2>/dev/null; then
    sentinel=FAIL
  elif /usr/bin/grep -q 'CHROME_DEV_MCP_READY' "$final" 2>/dev/null; then
    sentinel=READY
  fi
  leak=NO
  if [[ -s "$url_file" ]] && /usr/bin/grep -qFf "$url_file" "$final" 2>/dev/null; then
    leak=YES
  fi
  result=UNVERIFIED
  if [[ "$rc" == 127 ]]; then
    result=HOST_MISSING
  elif [[ "$sentinel" == READY && "$trace" == YES && "$leak" == NO && "$rc" == 0 ]]; then
    result=VERIFIED
  elif [[ "$sentinel" == FAIL || "$leak" == YES ]]; then
    result=FAIL
  fi
  [[ "$result" == VERIFIED ]] || overall=1
  print -r -- "HOST=$host RESULT=$result SENTINEL=$sentinel TOOL_TRACE=$trace LEAK=$leak EXIT=$rc"
done

/bin/rm -f -- "$url_file"
if [[ "$keep_raw" == true ]]; then
  print -r -- "RAW_DIR=$out_dir"
else
  /bin/rm -f -- "$out_dir"/*.raw
fi
print -r -- "OUT_DIR=$out_dir"
exit "$overall"
