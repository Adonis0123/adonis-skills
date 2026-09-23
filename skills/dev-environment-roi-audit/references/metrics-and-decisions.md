# Metrics and decisions

## Window

Use the most recent 90 days by default. Report:

- requested window
- actual earliest/latest timestamp
- session count per host
- files parsed, skipped, and schema-mismatched

If timestamps are absent, do not silently substitute mtime. Mark mtime-based windowing as a proxy.

## M1-M8

### M1 — Calls by tool

Count structured tool invocations. Keep host-qualified tool identities. Report current exposed tools with zero observed calls separately.

### M2 — Error rate

```text
error_rate = failed_calls / total_calls
```

List tools above 20% with sample sanitized errors. A wrapper returning successfully does not prove the nested MCP call succeeded.

### M3 — Server usage rate

```text
usage_rate = distinct_called_exposed_tools / exposed_tools
```

Use the currently exposed tool set. Label historical tool sets separately.

### M4 — Server ROI

```text
resident_tokens = measured_ablation_delta
fallback_resident_tokens = total_schema_bytes / 4
ROI = total_calls / (resident_tokens / 1000)
```

The byte/4 fallback is a lower-confidence estimate, not an empirical token measurement. Rank all servers and state the cost method.

### M5 — Skill utility

Count explicit structured triggers where available. Inspect the following messages/tool actions to decide whether the body affected execution. Separate trigger count from useful-trigger count.

### M6 — Session pressure

Calculate token/session p50 and p95, plus context-compaction sessions / total sessions. Do not mix input, output, cache creation, and cached-input fields without documenting the formula.

### M7 — Rework

Measure repeated edits to the same file within a session and retry-loop lengths after consecutive failures. Do not infer rework from repeated reads.

### M8 — Latency

Calculate p50/p95 only when start/end timestamps define the same boundary. Otherwise write `UNVERIFIED`.

## Decisions

Apply these hard rules first:

- **Remove**: zero calls in the measured window.
- **Remove**: resident cost above 2,000 tokens and fewer than 5 calls.
- **Narrow**: the component has value, but the exposed tool set greatly exceeds the called subset. Flag usage rate at or below 25% for explicit review.
- **On demand**: value is demonstrated, but startup/resident cost need not be paid every session.
- **Keep**: measured ROI is positive and no harder remove rule applies.

User decisions can override the recommendation. Record both the threshold result and the user's decision; never rewrite the metric to match the preference.

## Baseline bill

For each host, report:

```text
floor = bare or ignore-user-config minimal prompt
full = identical prompt with current config
fixed_tax = full - floor
window_share = fixed_tax / context_window
```

Only call the difference causal when the prompt, model, account, cwd, timing, and all non-tested config are held constant.
