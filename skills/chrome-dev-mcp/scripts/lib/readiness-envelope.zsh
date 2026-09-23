#!/bin/zsh

# Classify one readiness `list_pages` call. Prints OK or one error class.
# A UXC envelope with ok=true proves transport only; the wrapped MCP tool
# reports its own failure in data.isError (for example "Could not connect to
# Chrome"), so both must pass before readiness is claimed.
chrome_dev_mcp_classify_readiness() {
  local stdout_file="$1" stderr_file="$2" exit_code="$3" combined

  if ! /usr/bin/jq -e . "$stdout_file" >/dev/null 2>&1; then
    print -- "parse_error"
    return 0
  fi

  if [[ "$exit_code" -eq 0 ]] && /usr/bin/jq -e \
    '.ok == true and .protocol == "mcp" and .operation == "list_pages" and (.data.isError != true)' \
    "$stdout_file" >/dev/null 2>&1; then
    print -- "OK"
    return 0
  fi

  combined="$(<"$stdout_file")$(<"$stderr_file")"

  # Checked before the wrapper match: a tool-level error envelope still names
  # the wrapper as its endpoint.
  if /usr/bin/jq -e '.ok == true and .data.isError == true' "$stdout_file" >/dev/null 2>&1; then
    if [[ "$combined" == *"Could not connect to Chrome"* ]]; then
      print -- "chrome_unreachable"
    else
      print -- "tool_error"
    fi
    return 0
  fi

  if [[ "$combined" == *"currently using daemon exclusive key"* ]]; then
    print -- "exclusive_key_busy"
  elif [[ "$combined" == *"chrome-devtools-mcp-safe"* ]]; then
    print -- "wrapper_fail_closed"
  elif [[ "$combined" == *"timed out"* || "$combined" == *"timeout"* ]]; then
    print -- "timeout"
  else
    print -- "uxc_envelope"
  fi
}
