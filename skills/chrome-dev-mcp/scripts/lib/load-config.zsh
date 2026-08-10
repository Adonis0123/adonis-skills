#!/bin/zsh

chrome_dev_mcp_config_path() {
  if [[ -n "${CHROME_DEV_MCP_CONFIG_FILE:-}" ]]; then
    print -r -- "$CHROME_DEV_MCP_CONFIG_FILE"
    return
  fi

  local config_root="${XDG_CONFIG_HOME:-${HOME}/.config}"
  print -r -- "$config_root/chrome-dev-mcp/config.zsh"
}

chrome_dev_mcp_load_config() {
  local config_path
  config_path="$(chrome_dev_mcp_config_path)"
  [[ -r "$config_path" ]] || return 69
  source "$config_path"
}
