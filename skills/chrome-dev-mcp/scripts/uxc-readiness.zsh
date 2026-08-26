#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
skill_dir="${script_dir:h}"
source "$script_dir/lib/load-config.zsh"
source "$script_dir/lib/uxc-release.zsh"
source "$script_dir/lib/uxc-owned-binary.zsh"
source "$script_dir/lib/uxc-link-contract.zsh"

report_error() {
  print -- "STATUS=ERROR"
  print -- "SHARED_TRANSPORT=FAIL"
  print -- "ERROR_CLASS=$1"
  print -- "NATIVE_COMPAT=NOT_USED"
  exit 69
}

[[ $# -eq 0 ]] || report_error "unexpected_arguments"
chrome_dev_mcp_load_config || report_error "local_config_missing"

link_dir="${CHROME_DEV_MCP_LINK_DIR:-}"
link_path="$link_dir/chrome-dev-mcp-cli"
wrapper="${CHROME_DEV_MCP_WRAPPER:-}"
exclusive_key="${CHROME_DEV_MCP_UXC_EXCLUSIVE_KEY:-}"
[[ -n "$link_dir" ]] || report_error "link_dir_missing"
[[ -x "$wrapper" ]] || report_error "wrapper_missing"
[[ -n "$exclusive_key" ]] || report_error "exclusive_key_missing"
[[ -x /usr/bin/jq ]] || report_error "missing_jq"
chrome_dev_mcp_uxc_link_contract_matches \
  "$link_path" "$wrapper" "$exclusive_key" "$skill_dir" || \
  report_error "link_contract_mismatch"

[[ -z "${CHROME_DEV_MCP_UXC_BIN:-}" ]] || report_error "uxc_override_forbidden"
uxc_bin="$link_dir/uxc"
chrome_dev_mcp_verify_owned_uxc "$uxc_bin" || report_error "foreign_uxc"
[[ "$("$uxc_bin" --version 2>/dev/null || true)" == "uxc $UXC_VERSION" ]] || report_error "version_mismatch"

tmp_dir="$(mktemp -d)"
cleanup() {
  /bin/rm -rf -- "$tmp_dir"
}
trap cleanup EXIT INT TERM

cd "$skill_dir" || report_error "fixed_cwd_missing"
exit_code=0
PATH="$link_dir:${PATH:-/usr/bin:/bin}" "$link_path" --timeout-ms 45000 list_pages \
  >"$tmp_dir/stdout" 2>"$tmp_dir/stderr" || exit_code=$?

if ! /usr/bin/jq -e . "$tmp_dir/stdout" >/dev/null 2>&1; then
  report_error "parse_error"
fi

if [[ "$exit_code" -ne 0 ]] || ! /usr/bin/jq -e \
  '.ok == true and .protocol == "mcp" and .operation == "list_pages"' \
  "$tmp_dir/stdout" >/dev/null 2>&1; then
  combined="$(<"$tmp_dir/stdout")$(<"$tmp_dir/stderr")"
  if [[ "$combined" == *"chrome-devtools-mcp-safe"* ]]; then
    report_error "wrapper_fail_closed"
  elif [[ "$combined" == *"timed out"* || "$combined" == *"timeout"* ]]; then
    report_error "timeout"
  else
    report_error "uxc_envelope"
  fi
fi

reuse="$(/usr/bin/jq -r '.meta.daemon_session_reused // "unknown"' "$tmp_dir/stdout")"
case "$reuse" in
  true) reuse_label="YES" ;;
  false) reuse_label="NO" ;;
  *) reuse_label="UNKNOWN" ;;
esac

print -- "STATUS=READY"
print -- "SHARED_TRANSPORT=OK"
print -- "DAEMON_SESSION_REUSED=$reuse_label"
print -- "NATIVE_COMPAT=NOT_USED"
