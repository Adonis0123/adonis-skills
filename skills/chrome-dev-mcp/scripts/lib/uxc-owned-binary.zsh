#!/bin/zsh

typeset -gr CHROME_DEV_MCP_UXC_OWNER="chrome-dev-mcp"

chrome_dev_mcp_uxc_target_triple() {
  [[ "$(/usr/bin/uname -s)" == "Darwin" ]] || return 69

  case "$(/usr/bin/uname -m)" in
    arm64|aarch64) print -r -- "aarch64-apple-darwin" ;;
    x86_64) print -r -- "x86_64-apple-darwin" ;;
    *) return 69 ;;
  esac
}

chrome_dev_mcp_uxc_asset_sha256() {
  case "$1" in
    aarch64-apple-darwin) print -r -- "$UXC_SHA256_AARCH64_APPLE_DARWIN" ;;
    x86_64-apple-darwin) print -r -- "$UXC_SHA256_X86_64_APPLE_DARWIN" ;;
    *) return 69 ;;
  esac
}

chrome_dev_mcp_uxc_binary_sha256() {
  case "$1" in
    aarch64-apple-darwin) print -r -- "$UXC_BINARY_SHA256_AARCH64_APPLE_DARWIN" ;;
    x86_64-apple-darwin) print -r -- "$UXC_BINARY_SHA256_X86_64_APPLE_DARWIN" ;;
    *) return 69 ;;
  esac
}

chrome_dev_mcp_uxc_manifest_value() {
  local manifest_path="$1"
  local manifest_key="$2"

  /usr/bin/awk -F= -v manifest_key="$manifest_key" '
    $1 == manifest_key {
      count += 1
      value = substr($0, index($0, "=") + 1)
    }
    END {
      if (count != 1) exit 1
      print value
    }
  ' "$manifest_path"
}

chrome_dev_mcp_verify_owned_uxc() {
  local target="$1"
  local manifest_path="$target.chrome-dev-mcp.manifest"
  local target_triple expected_asset_sha256 expected_binary_sha256
  local owner manifest_version manifest_triple manifest_asset_sha256
  local manifest_binary_sha256 actual_binary_sha256

  CHROME_DEV_MCP_UXC_VERIFY_REASON="foreign_uxc"
  [[ ! -L "$target" && -f "$target" && -x "$target" ]] || return 69
  [[ ! -L "$manifest_path" && -f "$manifest_path" ]] || return 69

  target_triple="$(chrome_dev_mcp_uxc_target_triple)" || return 69
  expected_asset_sha256="$(chrome_dev_mcp_uxc_asset_sha256 "$target_triple")" || return 69
  expected_binary_sha256="$(chrome_dev_mcp_uxc_binary_sha256 "$target_triple")" || return 69

  owner="$(chrome_dev_mcp_uxc_manifest_value "$manifest_path" OWNER)" || return 69
  manifest_version="$(chrome_dev_mcp_uxc_manifest_value "$manifest_path" UXC_VERSION)" || return 69
  manifest_triple="$(chrome_dev_mcp_uxc_manifest_value "$manifest_path" TARGET_TRIPLE)" || return 69
  manifest_asset_sha256="$(chrome_dev_mcp_uxc_manifest_value "$manifest_path" ASSET_SHA256)" || return 69
  manifest_binary_sha256="$(chrome_dev_mcp_uxc_manifest_value "$manifest_path" BINARY_SHA256)" || return 69

  [[ "$owner" == "$CHROME_DEV_MCP_UXC_OWNER" ]] || return 69
  [[ "$manifest_version" == "$UXC_VERSION" ]] || return 69
  [[ "$manifest_triple" == "$target_triple" ]] || return 69
  [[ "$manifest_asset_sha256" == "$expected_asset_sha256" ]] || return 69
  [[ "$manifest_binary_sha256" == "$expected_binary_sha256" ]] || return 69

  actual_binary_sha256="$(/usr/bin/shasum -a 256 "$target" | /usr/bin/awk '{print $1}')" || return 69
  [[ "$actual_binary_sha256" == "$expected_binary_sha256" ]] || return 69

  CHROME_DEV_MCP_UXC_VERIFY_REASON=""
}
