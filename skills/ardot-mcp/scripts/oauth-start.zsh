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
  print -- "usage: zsh oauth-start.zsh"
  print -- "  starts Ardot OAuth authorization_code login via the owned UXC binary"
  exit 0
fi

[[ $# -eq 0 ]] || fail_closed "unexpected_arguments"

link_dir="$(ardot_mcp_resolve_link_dir)"
uxc_bin="$link_dir/uxc"
ardot_mcp_verify_owned_uxc "$uxc_bin" || fail_closed "foreign_uxc"
[[ "$("$uxc_bin" --version 2>/dev/null || true)" == "uxc $UXC_VERSION" ]] || fail_closed "version_mismatch"

exec "$uxc_bin" auth oauth start "$ARDOT_MCP_CREDENTIAL_ID" \
  --endpoint "$ARDOT_MCP_ENDPOINT" \
  --redirect-uri "$ARDOT_MCP_REDIRECT_URI" \
  --scope "$ARDOT_MCP_OAUTH_SCOPE"
