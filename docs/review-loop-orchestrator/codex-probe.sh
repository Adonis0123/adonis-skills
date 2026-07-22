#!/bin/sh
# Disposable probe: does codex exec reach its model + can it write under the relay-read-only profile?
REPO="$1"
RELAY="$REPO/tmp/relay"
printf 'Create a file at tmp/relay/probe-out.txt containing exactly the word PONG. Use apply_patch. Then stop.' | \
codex exec --json -C "$REPO" \
  -c 'default_permissions="relay-read-only"' \
  -c 'permission_profile="relay-read-only"' \
  -c "permissions.relay-read-only.file_system={mode=\"Restricted\",entries=[{access=\"read\",path=\":workspace_roots\"},{access=\"write\",path=\"$RELAY\"}],glob_scan_max_depth=8}" \
  -c 'permissions.relay-read-only.network={enabled=false}' \
  -
echo "----EXIT=$?----"
echo "----probe-out:----"
cat "$RELAY/probe-out.txt" 2>&1
