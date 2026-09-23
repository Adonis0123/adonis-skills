# Ownership gate script

Fill the variables from the facade contract and run this before install, link, or readiness. It prints `GATE=PASS`, `LINK=ABSENT`, or `GATE_FAIL=<reason>`. Adapt the link-content checks if the installed `uxc link` writes a different shortcut format.

```zsh
#!/usr/bin/env zsh
# Fill from the contract. Prints GATE=PASS, LINK=ABSENT, or GATE_FAIL=<reason>.
set -u
UXC_ROOT="<install-root>"        # binary owner's install root
UXC_PIN="<X.Y.Z>"                # pinned version without the leading v
UXC_DIGEST="<sha256-of-binary>"  # from the binary owner's manifest
BINARY_OWNER="<binary-owner-skill>"
OWNER_FILE="$UXC_ROOT/uxc.$BINARY_OWNER.manifest"  # or the owner's OWNER file; must contain OWNER=<binary-owner-skill>
LINK_NAME="<link-name>"
LINK_HOST="<host-or-stdio-command>"
fail() { print -r -- "GATE_FAIL=$1"; exit 1; }

# Binary gate: symlink, foreign or unknown owner, digest mismatch, version conflict
bin="$UXC_ROOT/uxc"
[[ -e "$bin" ]] || fail BINARY_MISSING
[[ -L "$bin" ]] && fail BINARY_SYMLINK
[[ -f "$OWNER_FILE" ]] || fail BINARY_NO_OWNER
grep -qx "OWNER=$BINARY_OWNER" "$OWNER_FILE" || fail BINARY_FOREIGN_OWNER
[[ "$(shasum -a 256 "$bin" | cut -d' ' -f1)" == "$UXC_DIGEST" ]] || fail BINARY_DIGEST
[[ "$("$bin" --version)" == "uxc $UXC_PIN" ]] || fail BINARY_VERSION

# Link gate: non-UXC command, foreign link owner, owner/host target mismatch
link_path="$(command -v "$LINK_NAME" 2>/dev/null)" || { print -r -- "LINK=ABSENT"; exit 0; }
[[ -L "$link_path" ]] && fail LINK_SYMLINK
grep -q "uxc" "$link_path" || fail LINK_NOT_UXC
grep -qF -- "$LINK_HOST" "$link_path" || fail LINK_HOST_MISMATCH
print -r -- "GATE=PASS"
```

The binary gate rejects a symlink, a foreign or unknown owner, a digest mismatch, and a version conflict. The link gate rejects a non-UXC command, a foreign link owner, and an owner or host target mismatch. Treat the wrapper target, exclusivity key, idle TTL, owner skill, and skill path as one exact link contract.
