#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
source "$script_dir/lib/load-config.zsh"

mode="${1:---recover}"
check_reason="CHECK_FAILED"

die() {
  print -u2 -- "chrome-dev-mcp: $1"
  exit 69
}

[[ "$mode" == "--check" || "$mode" == "--recover" ]] || die "expected --check or --recover"
[[ $# -le 1 ]] || die "unexpected arguments"
chrome_dev_mcp_load_config || die "local configuration missing; run configure-local.zsh"

wrapper="${CHROME_DEV_MCP_WRAPPER:-}"
launcher="${CHROME_DEV_MCP_LAUNCHER:-}"
[[ -x "$wrapper" ]] || die "missing configured wrapper"
[[ -x "$launcher" ]] || die "missing configured launcher"

check_connection() {
  local check_error structured_reason

  if check_error="$("$wrapper" --check 2>&1)"; then
    check_reason="READY"
    return 0
  fi

  structured_reason="$(
    print -r -- "$check_error" |
      /usr/bin/awk -F= '$1 == "CHROME_DEVTOOLS_MCP_SAFE_REASON" { print $2; exit }'
  )"
  case "$structured_reason" in
    ENDPOINT_UNAVAILABLE|LISTENER_COUNT|WRONG_BINARY|WRONG_PROFILE|WEBSOCKET_MISMATCH|NOT_CHROME)
      check_reason="$structured_reason"
      return 1
      ;;
  esac

  case "$check_error" in
    *"endpoint unavailable"*) check_reason="ENDPOINT_UNAVAILABLE" ;;
    *"expected exactly one Chrome listener"*) check_reason="LISTENER_COUNT" ;;
    *"not the expected official Google Chrome binary"*) check_reason="WRONG_BINARY" ;;
    *"not using the shared isolated Chrome profile"*) check_reason="WRONG_PROFILE" ;;
    *"mismatched WebSocket address"*) check_reason="WEBSOCKET_MISMATCH" ;;
    *"did not identify itself as Google Chrome"*) check_reason="NOT_CHROME" ;;
    *) check_reason="CHECK_FAILED" ;;
  esac

  return 1
}

report_not_ready() {
  print -- "CHROME_DEV_MCP_CONNECTION=NOT_READY"
  print -- "REASON=$check_reason"
}

if check_connection; then
  print -- "CHROME_DEV_MCP_CONNECTION=READY"
  print -- "RECOVERY=NOT_NEEDED"
  exit 0
fi

if [[ "$mode" == "--check" ]]; then
  report_not_ready
  exit 69
fi

if [[ "$check_reason" != "ENDPOINT_UNAVAILABLE" ]]; then
  report_not_ready
  die "connection identity check failed closed"
fi

"$launcher" >/dev/null || die "configured launcher could not recover the connection"
if ! check_connection; then
  report_not_ready
  die "connection failed verification after recovery"
fi

print -- "CHROME_DEV_MCP_CONNECTION=READY"
print -- "RECOVERY=PERFORMED"
