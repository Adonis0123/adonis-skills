# Product adapter contracts

Read only the selected product sections. Installed CLI help is the source of
truth because flags and output envelopes can change between versions.

## Shared rules

- Canonical IDs are `codex`, `claude-code`, `grok-build`, and `cursor-cli`.
- Reviewer and Fixer are separate sessions, even when they use the same
  product.
- Reviewer mode must prevent writes. Prompt-only instructions are insufficient
  when the product exposes a real read-only sandbox or plan mode.
- External Fixer mode must use a user-authorized isolated writable checkout
  that was frozen as the authoritative `$REPO` before round 1. Whole-workspace
  sandboxes plus a later diff check do not prove path-scoped writes. This
  version has no patch-transfer protocol.
- Prefer structured-output/schema options. If unavailable, validate the final
  JSON and allow one same-session correction.
- Pass prompts through stdin or a private prompt file when supported. Avoid
  process-list disclosure and command-line length limits. Cursor versions that
  only accept a prompt argument require a non-secret bounded prompt.
- Record the actual product version, invocation shape, session ID, exit code,
  and output path. Never log credentials or full environment variables.
- Partition resumable state by repository, loop ID, role, and canonical
  product ID. Never resume the latest unnamed session in automation.
- Do not retry a timeout, connection loss, empty output, or unknown delivery
  state automatically. The first model call may have completed remotely.
- Enforce the frozen per-call deadline, 10 minutes by default. A living quiet
  process is in progress only until that deadline. Use a host-owned process
  group timer; do not assume the product CLI enforces the deadline. On expiry,
  terminate the exact process group, preserve partial output, and record a
  timeout instead of retrying.
- Use `scripts/extract_product_output.py` before contract validation. For a
  Reviewer result, pass the host-recorded session ID when the envelope does not
  contain it; the extractor makes product/session identity host-authoritative.
- Do not hard-code a model ID. A user-selected model is adapter input and must
  be checked against the installed CLI rather than silently substituted.

## Codex

Current CLIs commonly expose `codex exec`, `--sandbox read-only`,
`--sandbox workspace-write`, `--output-schema`, `--output-last-message`, and
`exec resume`. Confirm them with `codex exec --help` before use.

- Reviewer: use `codex exec` with the read-only sandbox and an output schema.
- Send the prompt on stdin. Use `--output-last-message` as the extractor input;
  `--json` stdout is an event stream used to record the exact thread ID, not
  the final review object.
- Fixer: use a separate `codex exec` session with `workspace-write` only inside
  the authorized isolated target. `workspace-write` covers the working
  directory; it is not a frozen-path boundary. Without that target, return
  `HUMAN_GATE`. Do not use `--dangerously-bypass-approvals-and-sandbox`.
- Resume only a session ID recorded from Codex for this repository and role.
- Put approval mode before the `exec` subcommand on versions where it is a
  top-level flag. Do not use `--skip-git-repo-check`; this Skill requires Git.

Verified invocation shape:

```bash
codex -a never -C "$REPO" exec -s read-only \
  --json \
  --output-schema "$SKILL_DIR/references/review-schema.json" \
  --output-last-message "$ROUND_DIR/raw-review.json" -
```

## Claude Code

Current CLIs commonly expose `claude -p`, `--safe-mode`, `--tools`,
`--permission-mode`, `--json-schema`, `--output-format json`, and `--resume`.
Confirm them with `claude -p --help` before use.

- Reviewer: use safe mode, an explicit read-only `--tools` set, and explicitly
  disallow edit/write/shell/subagent tools. If repository rules are disabled by
  safe mode, include the required rules in the prompt bundle.
- Fixer: use a separate session with only read/edit/write tools. Let the host
  run tests unless exact shell commands were separately authorized.
  Do not use `--dangerously-skip-permissions`.
- Claude Code does not provide an OS-level path sandbox. Use an isolated
  authoritative checkout when external Claude is Fixer; without one, return
  `HUMAN_GATE`. A host-enforced post-diff gate alone is insufficient.
- Do not reuse a Reviewer session as the Fixer session.
- The JSON envelope stores the model object in `structured_output` and the
  recoverable ID in `session_id`. Do not parse the human-readable `result`.
- `--allowedTools` adds permissions; it is not a strict replacement for tools
  from settings. Combine `--safe-mode`, an explicit `--tools` set, disallowed
  mutating tools, and `--permission-mode dontAsk` for Reviewer isolation.

Verified Reviewer capability shape:

```bash
claude -p --safe-mode \
  --tools Read,Grep,Glob \
  --allowedTools Read,Grep,Glob \
  --disallowedTools Write,Edit,MultiEdit,NotebookEdit,Bash,Agent \
  --permission-mode dontAsk \
  --output-format json \
  --json-schema "$(jq -c . "$SKILL_DIR/references/review-schema.json")"
```

For a Fixer, use a separate session and replace the tool set with only
`Read,Grep,Glob,Edit,Write`; keep `Bash` and `Agent` disabled and let the host
run verification.

## Grok Build

Current CLIs commonly expose single-prompt mode, `--prompt-file`,
`--output-format json`, `--json-schema`, `--sandbox`, `--cwd`, and `--resume`.
Confirm the exact spelling and accepted sandbox profiles with `grok --help`.

- Reviewer: require the verified read-only sandbox and structured output.
- Compose the bounded instructions and the complete `bundle.json` into the
  private `0600` prompt file. The bundle lives outside `$REPO`, and Grok's
  read-only file tool must not be expected to open that path through the
  repository sandbox.
- Combine the sandbox with an explicit read-only tool allowlist and disable
  MCP, subagents, memory, and web access unless the review contract needs them.
  Treat a sandbox-enforcement warning as a hard failure.
- Fixer: use a distinct `workspace` sandbox only inside the authorized isolated
  authoritative checkout. It can write the whole CWD, so without that target
  return `HUMAN_GATE`. Do not default to `--always-approve`.
- Treat a living but quiet process as in progress until its declared deadline.
- The JSON envelope stores the schema-constrained object in
  `structuredOutput` and the session ID in `sessionId`. Never parse `text`: it
  can contain progress or multiple concatenated JSON attempts.
- Treat a warning that the built-in sandbox itself failed to apply as a hard
  failure. A separate user hook warning is noisy configuration, not proof of a
  sandbox failure; still require the sandbox plus tool allowlist as independent
  controls.
- Preflight `grok inspect --json`. Hooks and plugin components can still load
  independently of the model tool allowlist. Every active hook must be proven
  compatible with the Reviewer boundary. If a hook can execute, rewrite tool
  input, write files, or cause an external side effect and that compatibility
  cannot be proven, return `HUMAN_GATE`; do not assume `--tools` disabled the
  hook. User acceptance alone is not proof that a write-capable hook is
  read-only.

Verified Reviewer capability shape:

```bash
grok --cwd "$REPO" --prompt-file "$PROMPT_FILE" \
  --sandbox read-only --permission-mode dontAsk \
  --tools read_file,grep,list_dir \
  --disallowed-tools Agent --no-subagents \
  --disable-web-search --no-memory --deny 'MCPTool(*)' \
  --output-format json \
  --json-schema "$(jq -c . "$SKILL_DIR/references/review-schema.json")"
```

For a Fixer, use a separate session with the `workspace` sandbox,
`acceptEdits`, and only `read_file,grep,list_dir,search_replace`. Keep shell,
MCP, subagents, web, and memory disabled; let the host run checks.

## Cursor CLI

The executable may be installed as `cursor-agent` while a shell alias exposes
`cursor-cli`. Resolve it in the actual shell, then inspect `--help`.

Current CLIs commonly expose `--print`, `--mode plan`, `--mode ask`,
`--sandbox enabled`, `--output-format json`, `--workspace`, `--resume`, and
`--continue`.

- Reviewer: use ask or plan mode with the sandbox enabled, then validate the
  JSON because a model-output schema option may be unavailable. Preflight
  configured MCPs because Cursor lacks an equivalent strict tool allowlist.
- The OCR bundle lives outside the repository. Stream the bounded instructions
  and complete bundle through stdin after verifying that the installed version
  accepts piped input. Do not put a sensitive whole bundle in argv. Do not use
  `--add-dir "$ROUND_DIR"`: current headless builds can stop for interactive
  workspace trust, and `--trust` is prohibited.
- Require no configured MCPs, or an already-present project permission policy
  that denies `Mcp(*)`, shell, and writes for the Reviewer. Do not edit user or
  project Cursor settings as an implicit preflight step. Without an enforceable
  boundary, return `HUMAN_GATE`.
- Audit user, project, and managed [Cursor Hooks](https://cursor.com/docs/hooks)
  before starting the Reviewer. Hooks are spawned processes and are not made
  read-only by agent tool permission tokens. If any active hook can execute,
  rewrite input, write files, or cause an external side effect and cannot be
  proven compatible with the Reviewer boundary, return `HUMAN_GATE`. User
  acceptance alone is not proof that a write-capable hook is read-only.
- Fixer: current headless versions may require `--force` to write. Do not use
  it by default. Require explicit Cursor-Fixer authorization plus an isolated
  writable target and sandbox/permission preflight; otherwise return
  `HUMAN_GATE`.
- Cursor chat resume is continuity, not durable Goal state or proof that the
  code snapshot stayed unchanged.
- The JSON envelope stores the model result as a string in `result` and the
  chat ID in `session_id`. Parse `result` with one strict JSON decode. Prefix or
  suffix prose is malformed output and gets at most one same-session
  correction; never scan for the first `{...}` fragment.

Verified Reviewer capability shape:

```bash
{
  printf '%s\n' "$BOUNDED_NON_SECRET_PROMPT"
  printf '%s\n' 'BEGIN_FROZEN_BUNDLE_JSON'
  sed -n '1,$p' "$ROUND_DIR/bundle.json"
  printf '%s\n' 'END_FROZEN_BUNDLE_JSON'
} | cursor-agent --print --mode ask --sandbox enabled \
  --output-format json --workspace "$REPO"
```

This stdin shape was exercised with Cursor Agent
`2026.08.11-e8db854`. Capability-probe other versions and return
`HUMAN_GATE` if stdin is ignored; never fall back to `--trust` or a
whole-bundle argv.

Before a Cursor Fixer, inspect repository and user permissions. In the
isolated writable target, deny shell, MCP, web, Git metadata writes, and paths
outside the frozen boundary. Only then may an explicitly authorized Cursor
Fixer use `--force --sandbox enabled`; never add `--trust`, `--approve-mcps`,
or disable the sandbox.

## Version-gated dogfood record

On 2026-08-16, the complete Reviewer → separate Fixer → original Reviewer
resume path was exercised in isolated Git fixtures with the versions below.
Every Reviewer found the same seeded defect; every final resumed review
validated as `NO_FINDINGS` on the same refreshed OCR evidence, with host tests
passing. This is compatibility evidence for these versions, not permission to
skip the per-run help/capability preflight.

| Product      | Tested version       | Structured result source                      | Write verification                                             |
| ------------ | -------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| Codex        | `0.147.0`            | `--output-last-message`; thread ID from JSONL | Host Git diff + tests                                          |
| Claude Code  | `2.1.224`            | `structured_output`                           | Host Git diff + tests                                          |
| Grok Build   | `1.0.4`              | `structuredOutput`                            | Host caught and corrected one claimed `FIXED` with no mutation |
| Cursor Agent | `2026.08.11-e8db854` | strict JSON decode of `result`                | Isolated target + permission deny rules + host Git diff/tests  |

## Missing or incompatible capability

Return `HUMAN_GATE` when the requested product exists but cannot enforce its
assigned role. Return `MISSING_DEPENDENCIES` when the explicitly required
product is absent before edits. Never silently map one product ID to another
or reuse a session ID across products.

A Fixer timeout or delivery loss may leave mutations behind. Recompute the Git
diff, report `DELIVERY_UNKNOWN_WITH_MUTATION`, and stop without retry or reset.
