#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
skill_dir="${script_dir:h}"
source "$script_dir/lib/load-config.zsh"
source "$script_dir/lib/uxc-release.zsh"
source "$script_dir/lib/uxc-owned-binary.zsh"
source "$script_dir/lib/uxc-link-contract.zsh"

fail_closed() {
  print -u2 -- "STATUS=ERROR"
  print -u2 -- "ERROR_CLASS=$1"
  exit 69
}

[[ $# -eq 0 ]] || fail_closed "unexpected_arguments"
chrome_dev_mcp_load_config || fail_closed "local_config_missing"

wrapper="${CHROME_DEV_MCP_WRAPPER:-}"
exclusive_key="${CHROME_DEV_MCP_UXC_EXCLUSIVE_KEY:-}"
link_dir="${CHROME_DEV_MCP_LINK_DIR:-}"
link_path="$link_dir/chrome-dev-mcp-cli"

[[ -x "$wrapper" ]] || fail_closed "wrapper_missing"
[[ -n "$exclusive_key" ]] || fail_closed "exclusive_key_missing"
[[ -n "$link_dir" ]] || fail_closed "link_dir_missing"
[[ -d "$skill_dir" && -f "$skill_dir/SKILL.md" ]] || fail_closed "skill_missing"

link_exists="NO"
if [[ -e "$link_path" || -L "$link_path" ]]; then
  chrome_dev_mcp_uxc_link_contract_matches \
    "$link_path" "$wrapper" "$exclusive_key" "$skill_dir" || \
    chrome_dev_mcp_uxc_link_contract_matches \
      "$link_path" "$wrapper" "$exclusive_key" "$skill_dir" legacy || \
    fail_closed "link_contract_mismatch"
  link_exists="YES"
fi

[[ -z "${CHROME_DEV_MCP_UXC_BIN:-}" ]] || fail_closed "uxc_override_forbidden"
uxc_bin="$link_dir/uxc"
chrome_dev_mcp_verify_owned_uxc "$uxc_bin" || fail_closed "foreign_uxc"
[[ "$("$uxc_bin" --version 2>/dev/null || true)" == "uxc $UXC_VERSION" ]] || fail_closed "version_mismatch"

if [[ "$link_exists" == "YES" ]] && chrome_dev_mcp_uxc_link_contract_matches "$link_path" "$wrapper" "$exclusive_key" "$skill_dir"; then
  print -- "CHROME_DEV_MCP_UXC_LINK=READY"
  print -- "UXC_VERSION=$UXC_VERSION"
  print -- "LINK_PATH=$link_path"
  print -- "LINK=NOT_NEEDED"
  exit 0
fi

# Stage on the destination filesystem, then replace only the exact owned contract.
tmp_dir="$(mktemp -d "$link_dir/.chrome-dev-mcp-link.XXXXXX")"
cleanup() {
  /bin/rm -rf -- "$tmp_dir"
}
trap cleanup EXIT INT TERM
chrome_dev_mcp_render_uxc_link "$wrapper" "$exclusive_key" "$skill_dir" "$link_dir" > "$tmp_dir/link"
/bin/chmod 755 "$tmp_dir/link"
if [[ "$link_exists" == YES ]]; then
  chrome_dev_mcp_uxc_link_contract_matches "$link_path" "$wrapper" "$exclusive_key" "$skill_dir" legacy || fail_closed "link_changed"
  /bin/cp -p "$link_path" "$tmp_dir/previous"
  backup_path="$(mktemp "$link_dir/.chrome-dev-mcp-legacy.XXXXXX")"
  /bin/cp -p "$tmp_dir/previous" "$backup_path"
else
  [[ ! -e "$link_path" && ! -L "$link_path" ]] || fail_closed "link_changed"
fi
/bin/mv "$tmp_dir/link" "$link_path"

chrome_dev_mcp_uxc_link_contract_matches \
  "$link_path" "$wrapper" "$exclusive_key" "$skill_dir" || \
  fail_closed "managed_link_invalid"

print -- "CHROME_DEV_MCP_UXC_LINK=READY"
print -- "UXC_VERSION=$UXC_VERSION"
print -- "LINK_PATH=$link_path"
print -- "LINK=PERFORMED"
