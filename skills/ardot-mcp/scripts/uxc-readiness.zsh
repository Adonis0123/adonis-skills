#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
skill_dir="${script_dir:h}"
source "$script_dir/lib/defaults.zsh"
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

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print -- "usage: zsh uxc-readiness.zsh [--private-result]"
  print -- "  default: shared search_style_guide proof, prints sanitized STATUS fields; --private-result: prints the JSON envelope"
  exit 0
fi

output_mode="sanitized"
if [[ $# -eq 1 && "$1" == "--private-result" ]]; then
  output_mode="private-result"
elif [[ $# -ne 0 ]]; then
  report_error "unexpected_arguments"
fi

link_dir="$(ardot_mcp_resolve_link_dir)"
link_path="$link_dir/$ARDOT_MCP_LINK_NAME"
endpoint="$ARDOT_MCP_ENDPOINT"

[[ -x /usr/bin/jq ]] || report_error "missing_jq"
ardot_mcp_uxc_link_contract_matches "$link_path" "$endpoint" "$skill_dir" || \
  report_error "link_contract_mismatch"

[[ -z "${ARDOT_MCP_UXC_BIN:-}" ]] || report_error "uxc_override_forbidden"
uxc_bin="$link_dir/uxc"
ardot_mcp_verify_owned_uxc "$uxc_bin" || report_error "foreign_uxc"
[[ "$("$uxc_bin" --version 2>/dev/null || true)" == "uxc $UXC_VERSION" ]] || report_error "version_mismatch"

tmp_dir="$(mktemp -d)"
cleanup() {
  /bin/rm -rf -- "$tmp_dir"
}
trap cleanup EXIT INT TERM

cd "$skill_dir" || report_error "fixed_cwd_missing"
exit_code=0
PATH="$link_dir:${PATH:-/usr/bin:/bin}" "$link_path" --timeout-ms 45000 search_style_guide \
  'styleKeywords=SaaS dashboard modern clean' \
  topK=1 \
  >"$tmp_dir/stdout" 2>"$tmp_dir/stderr" || exit_code=$?

if ! /usr/bin/jq -e . "$tmp_dir/stdout" >/dev/null 2>&1; then
  combined="$(<"$tmp_dir/stdout")$(<"$tmp_dir/stderr")"
  if [[ "$combined" == *"OAUTH"* || "$combined" == *"401"* || "$combined" == *"unauthorized"* ]]; then
    report_error "oauth_required"
  fi
  report_error "parse_error"
fi

if [[ "$exit_code" -ne 0 ]] || ! /usr/bin/jq -e \
  '.ok == true and .protocol == "mcp" and (.operation == "search_style_guide" or .data != null)' \
  "$tmp_dir/stdout" >/dev/null 2>&1; then
  combined="$(<"$tmp_dir/stdout")$(<"$tmp_dir/stderr")"
  if [[ "$combined" == *"OAUTH"* || "$combined" == *"401"* || "$combined" == *"unauthorized"* ]]; then
    report_error "oauth_required"
  elif [[ "$combined" == *"timed out"* || "$combined" == *"timeout"* ]]; then
    report_error "timeout"
  else
    report_error "uxc_envelope"
  fi
fi

if [[ "$output_mode" == "private-result" ]]; then
  /bin/cat "$tmp_dir/stdout"
  exit 0
fi

print -- "STATUS=READY"
print -- "SHARED_TRANSPORT=OK"
print -- "ARDOT_MCP_READY=YES"
print -- "READINESS_OPERATION=search_style_guide"
print -- "NATIVE_COMPAT=NOT_USED"
