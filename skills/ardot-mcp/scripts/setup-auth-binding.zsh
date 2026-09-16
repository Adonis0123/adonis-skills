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

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print -- "usage: zsh setup-auth-binding.zsh"
  print -- "  creates or updates the Ardot endpoint binding to credential ardot-mcp"
  exit 0
fi

[[ $# -eq 0 ]] || fail_closed "unexpected_arguments"

link_dir="$(ardot_mcp_resolve_link_dir)"
uxc_bin="$link_dir/uxc"
ardot_mcp_verify_owned_uxc "$uxc_bin" || fail_closed "foreign_uxc"
[[ "$("$uxc_bin" --version 2>/dev/null || true)" == "uxc $UXC_VERSION" ]] || fail_closed "version_mismatch"

existing_match="$("$uxc_bin" auth binding match "$ARDOT_MCP_ENDPOINT" 2>/dev/null || true)"
if /usr/bin/jq -e --arg id "$ARDOT_MCP_BINDING_ID" --arg cred "$ARDOT_MCP_CREDENTIAL_ID" '
  (.ok == true) and (
    (.data.id == $id and .data.credential == $cred) or
    (.data.binding.id == $id and .data.binding.credential == $cred) or
    (.data[]? | select(.id == $id and .credential == $cred))
  )
' >/dev/null 2>&1 <<<"$existing_match"; then
  print -- "ARDOT_MCP_BINDING=READY"
  print -- "BINDING_ID=$ARDOT_MCP_BINDING_ID"
  print -- "CREDENTIAL_ID=$ARDOT_MCP_CREDENTIAL_ID"
  print -- "BINDING=NOT_NEEDED"
  exit 0
fi

if ! "$uxc_bin" auth binding add \
  --id "$ARDOT_MCP_BINDING_ID" \
  --host ardot.tencent.com \
  --path-prefix /mcp \
  --scheme https \
  --credential "$ARDOT_MCP_CREDENTIAL_ID" \
  --priority 100; then
  fail_closed "binding_add_failed"
fi

match_json="$("$uxc_bin" auth binding match "$ARDOT_MCP_ENDPOINT")"
[[ -n "$match_json" ]] || fail_closed "binding_match_empty"
print -- "ARDOT_MCP_BINDING=READY"
print -- "BINDING_ID=$ARDOT_MCP_BINDING_ID"
print -- "CREDENTIAL_ID=$ARDOT_MCP_CREDENTIAL_ID"
print -- "BINDING=PERFORMED"
