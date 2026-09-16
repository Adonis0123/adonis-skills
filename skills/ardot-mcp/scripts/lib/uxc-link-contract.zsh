#!/bin/zsh

ardot_mcp_render_uxc_link() {
  local endpoint="$1" skill_dir="$2" link_dir="$3"
  local value
  for value in "$endpoint" "$skill_dir" "$link_dir"; do
    [[ "$value" != *"'"* && "$value" != *$'\n'* ]] || return 69
  done
  print -r -- '#!/usr/bin/env sh'
  print -r -- "$ARDOT_MCP_UXC_LINK_MARKER"
  print -r -- "cd '$skill_dir' || exit 69"
  print -r -- "UXC_LINK_SKILL='ardot-mcp' UXC_LINK_SKILL_PATH='$skill_dir' UXC_LINK_NAME='$ARDOT_MCP_LINK_NAME' exec '$link_dir/uxc' '$endpoint' \"\$@\""
}

ardot_mcp_uxc_link_contract_matches() {
  local link_path="$1" endpoint="$2" skill_dir="$3"
  local expected
  [[ ! -L "$link_path" && -f "$link_path" && -x "$link_path" ]] || return 69
  expected="$(ardot_mcp_render_uxc_link "$endpoint" "$skill_dir" "${link_path:h}")" || return 69
  [[ "$(<"$link_path")" == "$expected" ]]
}
