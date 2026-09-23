---
name: dev-environment-roi-audit
description: Audit a local coding-agent environment with real logs and controlled ablations, then make evidence-backed keep, narrow, on-demand, or remove decisions for MCP servers, skills, instruction files, plugins, commands, hooks, and memory. Use whenever the user asks to audit or slim a Claude, Codex, Grok, Cursor, or similar development setup; find unused tools; quantify context or startup tax; or clean agent configuration by ROI. Enforces discovered paths, per-file JSONL schema probes, OUT_DIR-only artifacts, secret-safe output, and item-by-item approval before mutations.
license: MIT
metadata:
  author: Adonis0123
---

# Development Environment ROI Audit

Measure whether each coding-agent component saves more loop time than it taxes. Use local evidence instead of generic best practices.

## Operating contract

1. Ask for or agree on an absolute `OUT_DIR` and analysis window before collecting data. Default to 90 days; if less data exists, report the actual window and session count.
2. Keep source and configuration read-only during measurement. Write only under `OUT_DIR`. Git write operations are outside this workflow.
3. Before every command, tell the user what will run and which numbers it should produce. Afterward, show the relevant raw output before interpreting it.
4. Attach at least one measured number to every conclusion. Put unsupported opinions under `UNVERIFIED`; never blend them into findings.
5. Discover paths and wrappers from the machine. Do not assume home-directory layouts, project names, account aliases, or config inheritance.
6. Require item-by-item approval before changing configuration, disabling components, moving files, or deleting anything. A completed audit is not blanket mutation authority.

Read [references/artifact-contract.md](references/artifact-contract.md) before starting. Read [references/metrics-and-decisions.md](references/metrics-and-decisions.md) before calculating ROI or proposing a decision.

## Security boundary

- Never print a complete config node when it may contain `headers`, `env`, credentials, cookies, or tokens. Print keys, value types, and lengths instead.
- Pass credentials internally from their existing config only when a read-only probe genuinely requires them. Never put secret values in commands, output files, recovery copies, or reports.
- Redact stdout and stderr before `tee`. If a secret is accidentally displayed, stop repeating it, identify the affected filesystem copies without showing their contents, report their count, and request explicit approval to sanitize or remove them. Until approval, mark the audit blocked on credential residue and recommend server-side rotation.
- Recovery artifacts must contain only the target component and must strip authentication fields. Do not back up an entire config to recover one entry.
- Treat tools that create orders, send messages, write repositories, manage credentials, or read personal/account data as write-capable or sensitive even if their server name sounds harmless.

## Phase 0: initialize and probe capabilities

Run the bundled initializer:

```bash
python3 <skill-dir>/scripts/init_audit.py --out-dir "$OUT_DIR" --window-days 90
```

It creates only the audit directory, records the chosen window, and copies helper scripts to `$OUT_DIR/scripts/` for reproducibility.

Discover relevant hosts and utilities with version or command-resolution checks. Probe the requested agent CLIs plus `jq`, `python3`, and `rg`. Only inspect `--help` after a real command or flag fails.

Write `00-capabilities.json`. Record wrapper/function provenance without printing function bodies that may contain credentials.

## Phase 1: inventory the tax side

Inventory each host independently and retain its actual status vocabulary.

### MCP and plugins

- Prefer structured CLI/init interfaces over manually reconstructing config.
- Record server status, tool count, schema bytes per tool, write-capable tools, sensitive-read tools, initialization time, and errors.
- Compare exact tool names and semantic capability overlap. Keep exact overlap and inferred semantic overlap separate.
- Mark servers configured on only one host. Distinguish active config, historical metadata cache, plugin-provided config, and compatibility imports.
- Never equate an absent server in one config-layer list with absence from runtime init; validate the runtime layer when the decision depends on it.

### Skills

- Measure always-resident `name + description` separately from on-demand body bytes.
- Evaluate whether each description has a precise trigger, overlaps another skill, under-triggers, or matches almost everything.
- Usage count zero means “zero observed in this window,” not “never used.” Preserve the observation scope.

### Instructions, commands, hooks, and memory

- Discover `CLAUDE.md`, `AGENTS.md`, Cursor rules, host-global instructions, commands, agents, hooks, and memory files.
- Classify instruction sections as effective, redundant, stale, or contradicted by code. Give an evidence path for every contradiction.
- Benchmark hooks with repeated samples. Report p50/p95 and event count; a no-op hook still pays process startup tax.
- Keep generated architecture prose, copied README material, directory trees, and project summaries only when measured evidence shows they reduce loop time.

Write `01-inventory.json` as data only, without recommendations.

## Phase 2: mine the benefit side

Discover all candidate session roots, including renamed projects, moved directories, worktrees, and account-specific homes. List candidates by mtime before assigning ownership.

For every JSONL file, inspect its first line before parsing that file:

```bash
python3 "$OUT_DIR/scripts/probe_jsonl_schema.py" <discovered-roots...> \
  > "$OUT_DIR/raw/jsonl-schema-inventory.json"
```

Do not reuse an expected schema after one representative file. A parser must validate each file's probed keys and skip or separately handle mismatches. Record every schema deviation.

Calculate M1-M8 exactly as defined in the metrics reference. Pay special attention to exposed tools with zero calls, wrapper calls whose actual MCP name is nested in serialized arguments, and failures hidden behind successful wrapper invocations.

Write `02-metrics.json` and `02-metrics.md`. Put parsing scripts in `$OUT_DIR/scripts/`.

## Phase 3: run controlled experiments

Run only experiments supported by the installed CLI version:

- Baseline tax: same minimal prompt, bare/ignore-user-config floor, one-component variants, then full config.
- Skill trigger accuracy: replay representative redacted first prompts; calculate precision and recall.
- Feedback-loop latency: time build, full test, focused test, lint, and typecheck when the user has not excluded business repositories.
- MCP handshake: initialize and tools/list per server with isolated temp/cache paths under `OUT_DIR`.

Keep prompts, model/account, cwd, and timing boundaries identical. Do not compare asynchronous or configuration-drifted runs as causal A/B. Label blocked experiments and missing API keys `UNVERIFIED`.

Write `03-experiments.md` with sanitized raw output.

## Phase 4: independent interpretation

When the user requests blind review and at least two independent CLIs are available:

1. Write the dispatch prompt before launching reviewers.
2. Give each reviewer only `01`, `02`, and `03` data, never the orchestrator's conclusions or the other reviewer's output.
3. Set bounded turns/time/budget and keep reviewers read-only.
4. Preserve disagreements. State the exact additional measurement needed to decide each one.

Skip this phase when independence cannot be established; record why.

## Phase 5: decide component by component

Build one row per MCP server, skill, command, plugin, hook, or memory component:

```text
| component | resident tokens | window calls | usage rate | error rate | ROI | decision |
```

Apply the hard thresholds from the metrics reference without softening them. If the user wants interactive cleanup, present one component at a time with its numbers and wait for a clear retain/remove/disable decision.

After an approved mutation:

1. Resolve the exact target with a read-only check.
2. Make the smallest structured edit; do not rewrite unrelated config.
3. Verify syntax, component count before/after, current runtime listing, and credential-field count without printing values.
4. Update the report immediately. Keep historical metrics labeled historical.

## Phase 6: safe artifact cleanup

Large runtime copies and dependency caches are audit waste once their evidence is embedded in reports. Before moving or deleting a candidate, report:

- real path and size
- file count and symlink count
- whether the target itself is a symlink
- Git metadata count
- report-reference count
- whether the artifact is reproducible

Use an exact validated target. Prefer moving one target to Trash over a broad permanent deletion. Never empty the user's whole Trash. If deletion is blocked by policy, report the block rather than bypassing it.

## Phase 7: final report and integrity

Produce `FINAL.md` with:

1. Component decisions and numeric evidence.
2. Baseline tax before/after, window percentage, and formula.
3. Instruction contradictions with evidence paths.
4. Independent-review disagreements and required follow-up measurements.
5. Proposed instruction files under `proposed/`, never overwriting originals without approval.
6. Three to five regression guards.
7. A separate `UNVERIFIED` list.

Run:

```bash
python3 "$OUT_DIR/scripts/finalize_audit.py" --out-dir "$OUT_DIR"
```

The finalizer refuses to create a manifest when non-runtime artifacts contain likely Authorization/Bearer values. It excludes reproducible `runtime/**`, writes `MANIFEST.sha256`, and reports the final artifact count and size.

Completion requires: zero pending user decisions in scope, all approved changes verified, credential residue count zero, core artifacts present, and manifest verification passing.
