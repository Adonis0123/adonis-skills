#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
source "$script_dir/lib/defaults.zsh"
source "$script_dir/lib/uxc-release.zsh"
source "$script_dir/lib/uxc-owned-binary.zsh"

fail_closed() {
  print -u2 -- "STATUS=ERROR"
  print -u2 -- "ERROR_CLASS=$1"
  exit 69
}

usage() {
  print -- "usage: zsh oauth-complete.zsh --session-id <id> --authorization-response <callback-url>"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

session_id=""
authorization_response=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session-id)
      [[ $# -ge 2 ]] || fail_closed "missing_session_id"
      session_id="$2"
      shift 2
      ;;
    --authorization-response)
      [[ $# -ge 2 ]] || fail_closed "missing_authorization_response"
      authorization_response="$2"
      shift 2
      ;;
    *)
      fail_closed "unexpected_arguments"
      ;;
  esac
done

[[ -n "$session_id" ]] || fail_closed "missing_session_id"
[[ -n "$authorization_response" ]] || fail_closed "missing_authorization_response"

link_dir="$(ardot_mcp_resolve_link_dir)"
uxc_bin="$link_dir/uxc"
ardot_mcp_verify_owned_uxc "$uxc_bin" || fail_closed "foreign_uxc"
[[ "$("$uxc_bin" --version 2>/dev/null || true)" == "uxc $UXC_VERSION" ]] || fail_closed "version_mismatch"

exec "$uxc_bin" auth oauth complete "$ARDOT_MCP_CREDENTIAL_ID" \
  --session-id "$session_id" \
  --authorization-response "$authorization_response"
