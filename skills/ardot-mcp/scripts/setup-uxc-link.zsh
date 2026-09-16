#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
skill_dir="${script_dir:h}"
source "$script_dir/lib/defaults.zsh"
source "$script_dir/lib/uxc-release.zsh"
source "$script_dir/lib/uxc-owned-binary.zsh"
source "$script_dir/lib/uxc-link-contract.zsh"

fail_closed() {
  print -u2 -- "STATUS=ERROR"
  print -u2 -- "ERROR_CLASS=$1"
  exit 69
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print -- "usage: zsh setup-uxc-link.zsh"
  print -- "  creates or repairs the owned ardot-mcp-cli link; fails closed on a foreign link or binary"
  exit 0
fi

[[ $# -eq 0 ]] || fail_closed "unexpected_arguments"

link_dir="$(ardot_mcp_resolve_link_dir)"
link_path="$link_dir/$ARDOT_MCP_LINK_NAME"
endpoint="$ARDOT_MCP_ENDPOINT"

[[ -d "$skill_dir" && -f "$skill_dir/SKILL.md" ]] || fail_closed "skill_missing"
[[ -d "$link_dir" ]] || fail_closed "link_dir_missing"

link_exists="NO"
if [[ -e "$link_path" || -L "$link_path" ]]; then
  ardot_mcp_uxc_link_contract_matches "$link_path" "$endpoint" "$skill_dir" || \
    fail_closed "link_contract_mismatch"
  link_exists="YES"
fi

[[ -z "${ARDOT_MCP_UXC_BIN:-}" ]] || fail_closed "uxc_override_forbidden"
uxc_bin="$link_dir/uxc"
ardot_mcp_verify_owned_uxc "$uxc_bin" || fail_closed "foreign_uxc"
[[ "$("$uxc_bin" --version 2>/dev/null || true)" == "uxc $UXC_VERSION" ]] || fail_closed "version_mismatch"

if [[ "$link_exists" == "YES" ]] && ardot_mcp_uxc_link_contract_matches "$link_path" "$endpoint" "$skill_dir"; then
  print -- "ARDOT_MCP_UXC_LINK=READY"
  print -- "UXC_VERSION=$UXC_VERSION"
  print -- "LINK_PATH=$link_path"
  print -- "LINK=NOT_NEEDED"
  exit 0
fi

tmp_dir="$(mktemp -d "$link_dir/.ardot-mcp-link.XXXXXX")"
cleanup() {
  /bin/rm -rf -- "$tmp_dir"
}
trap cleanup EXIT INT TERM
ardot_mcp_render_uxc_link "$endpoint" "$skill_dir" "$link_dir" >"$tmp_dir/link"
/bin/chmod 755 "$tmp_dir/link"
if [[ "$link_exists" == YES ]]; then
  ardot_mcp_uxc_link_contract_matches "$link_path" "$endpoint" "$skill_dir" || fail_closed "link_changed"
else
  [[ ! -e "$link_path" && ! -L "$link_path" ]] || fail_closed "link_changed"
fi
/bin/mv "$tmp_dir/link" "$link_path"

ardot_mcp_uxc_link_contract_matches "$link_path" "$endpoint" "$skill_dir" || \
  fail_closed "managed_link_invalid"

print -- "ARDOT_MCP_UXC_LINK=READY"
print -- "UXC_VERSION=$UXC_VERSION"
print -- "LINK_PATH=$link_path"
print -- "LINK=PERFORMED"
