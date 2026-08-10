#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
source "$script_dir/lib/load-config.zsh"
source "$script_dir/lib/uxc-release.zsh"
source "$script_dir/lib/uxc-owned-binary.zsh"

fail_closed() {
  print -u2 -- "STATUS=ERROR"
  print -u2 -- "ERROR_CLASS=$1"
  exit 69
}

if [[ "${1:-}" == "--manifest" ]]; then
  [[ $# -eq 1 ]] || fail_closed "unexpected_arguments"
  print -- "UXC_VERSION=$UXC_VERSION"
  print -- "UXC_REPOSITORY=$UXC_REPOSITORY"
  print -- "UXC_SHA256_AARCH64_APPLE_DARWIN=$UXC_SHA256_AARCH64_APPLE_DARWIN"
  print -- "UXC_SHA256_X86_64_APPLE_DARWIN=$UXC_SHA256_X86_64_APPLE_DARWIN"
  print -- "UXC_BINARY_SHA256_AARCH64_APPLE_DARWIN=$UXC_BINARY_SHA256_AARCH64_APPLE_DARWIN"
  print -- "UXC_BINARY_SHA256_X86_64_APPLE_DARWIN=$UXC_BINARY_SHA256_X86_64_APPLE_DARWIN"
  exit 0
fi

[[ $# -eq 0 ]] || fail_closed "unexpected_arguments"

if [[ -z "${UXC_INSTALL_DIR:-}" ]]; then
  chrome_dev_mcp_load_config || fail_closed "local_config_missing"
fi
target_dir="${UXC_INSTALL_DIR:-${CHROME_DEV_MCP_LINK_DIR:-}}"
[[ -n "$target_dir" ]] || fail_closed "install_dir_missing"
target="$target_dir/uxc"
manifest_path="$target.chrome-dev-mcp.manifest"

if [[ -e "$target_dir" || -L "$target_dir" ]]; then
  [[ ! -L "$target_dir" && -d "$target_dir" ]] || fail_closed "foreign_install_dir"
else
  /bin/mkdir -p "$target_dir" || fail_closed "install_dir_failed"
fi

if [[ -e "$target" || -L "$target" || -e "$manifest_path" || -L "$manifest_path" ]]; then
  chrome_dev_mcp_verify_owned_uxc "$target" || fail_closed "foreign_uxc"
  installed_version="$("$target" --version 2>/dev/null || true)"
  if [[ "$installed_version" == "uxc $UXC_VERSION" ]]; then
    print -- "UXC_INSTALL=READY"
    print -- "UXC_VERSION=$UXC_VERSION"
    print -- "INSTALL=NOT_NEEDED"
    exit 0
  fi
  fail_closed "installed_version_invalid"
fi

target_triple="$(chrome_dev_mcp_uxc_target_triple)" || fail_closed "unsupported_platform"
expected_sha256="$(chrome_dev_mcp_uxc_asset_sha256 "$target_triple")" || fail_closed "unsupported_platform"
expected_binary_sha256="$(chrome_dev_mcp_uxc_binary_sha256 "$target_triple")" || fail_closed "unsupported_platform"

asset="uxc-v$UXC_VERSION-$target_triple.tar.gz"
tmp_dir="$(mktemp -d)"
cleanup() {
  /bin/rm -rf -- "$tmp_dir"
}
trap cleanup EXIT INT TERM

if ! /usr/bin/curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --proto '=https' \
  --tlsv1.2 \
  --output "$tmp_dir/$asset" \
  "$UXC_RELEASE_BASE/$asset"; then
  fail_closed "download_failed"
fi

actual_sha256="$(/usr/bin/shasum -a 256 "$tmp_dir/$asset" | /usr/bin/awk '{print $1}')"
[[ "$actual_sha256" == "$expected_sha256" ]] || fail_closed "checksum_mismatch"

/usr/bin/tar -xzf "$tmp_dir/$asset" -C "$tmp_dir" || fail_closed "extract_failed"
source_binary="$tmp_dir/uxc-v$UXC_VERSION-$target_triple/uxc"
[[ -x "$source_binary" ]] || fail_closed "archive_invalid"
source_binary_sha256="$(/usr/bin/shasum -a 256 "$source_binary" | /usr/bin/awk '{print $1}')"
[[ "$source_binary_sha256" == "$expected_binary_sha256" ]] || fail_closed "binary_checksum_mismatch"

/usr/bin/install -m 0755 "$source_binary" "$target" || fail_closed "install_failed"
{
  print -- "OWNER=$CHROME_DEV_MCP_UXC_OWNER"
  print -- "UXC_VERSION=$UXC_VERSION"
  print -- "TARGET_TRIPLE=$target_triple"
  print -- "ASSET_SHA256=$expected_sha256"
  print -- "BINARY_SHA256=$expected_binary_sha256"
} >"$tmp_dir/uxc.chrome-dev-mcp.manifest"
/usr/bin/install -m 0644 "$tmp_dir/uxc.chrome-dev-mcp.manifest" "$manifest_path" || fail_closed "manifest_install_failed"
chrome_dev_mcp_verify_owned_uxc "$target" || fail_closed "installed_ownership_invalid"
[[ "$("$target" --version 2>/dev/null || true)" == "uxc $UXC_VERSION" ]] || fail_closed "installed_version_invalid"

print -- "UXC_INSTALL=READY"
print -- "UXC_VERSION=$UXC_VERSION"
print -- "INSTALL=PERFORMED"
