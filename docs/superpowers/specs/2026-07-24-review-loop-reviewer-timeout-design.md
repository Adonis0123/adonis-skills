# Review Loop Reviewer Timeout Design

## Background

On 2026-07-24, a `review-loop run --reviewer=grok` process was still alive and
healthy after 4 minutes 36 seconds, but the driving Codex session manually
killed the Grok child because it had not produced stdout. A retry against the
same packet and frozen evidence remained silent for more than 6 minutes and
then returned a valid `PASS_WITH_CONCERNS`.

The adapter's current hard timeout is 10 minutes. The observed 4.5-minute
failure therefore came from a second, informal timeout policy in the driving
agent rather than from the adapter.

## Goals

- Give a healthy Reviewer up to 20 minutes for one invocation.
- Emit visible progress every 30 seconds while the Reviewer process is alive.
- Make process exit, STOP, or the configured deadline the only automatic stop
  signals; stdout silence alone is not failure.
- Preserve `DELIVERY_UNKNOWN` and no-retry behavior after a real timeout.
- Keep `REVIEW_LOOP_TIMEOUT_MS` as an advanced override, but reject invalid
  values instead of turning them into an accidental immediate timeout.

## Non-goals

- Detect whether a living model process is making semantic progress.
- Retry a gray-zone delivery automatically.
- Change the 5-second packet runtime lock timeout.
- Add product-specific timeout policies for Codex, Grok, and Claude.

## First-principles model

The child process owns the model request. While it remains alive, the
orchestrator can prove only liveness, not completion or semantic progress.
Silence on stdout is expected because the product CLIs return their structured
answer at the end. The safe state machine is therefore:

1. Spawn the read-only Reviewer.
2. Report liveness at a fixed interval.
3. Continue until the child exits, STOP is observed, or the deadline expires.
4. On deadline, kill the process group and return `DELIVERY_UNKNOWN` once.

## Boundaries

- `adapters.mjs` owns timeout resolution, child-process liveness, heartbeat
  events, STOP polling, and process termination.
- `review-loop.mjs` owns human-readable CLI progress formatting.
- `auto-run.mjs` continues to own packet/evidence/verdict transitions and does
  not gain a second timer.
- `SKILL.md` tells the driving agent to trust the adapter deadline and not kill
  a healthy Reviewer because stdout is quiet.

This keeps process policy cohesive in the adapter and prevents packet-domain
logic from depending on product-specific CLI output timing.

## Selected design

- Change the default from `600_000` to `1_200_000` milliseconds.
- Add `resolveTimeoutMs()` to validate the environment override and explicit
  adapter option as a positive finite number.
- Add optional `onProgress` and `progressIntervalMs` adapter options.
- Emit an immediate `active` event after spawn, then one event every 30
  seconds; clear the interval on every terminal path.
- Have the CLI print progress to stderr so stdout remains valid final JSON.
- Document that a healthy process must not be manually killed before its
  configured deadline. Users can still stop deliberately through the existing
  STOP files.

## Error handling

- Invalid timeout configuration fails before spawning a Reviewer.
- Exceptions thrown by a progress observer are ignored so observability cannot
  change delivery semantics.
- Timeout, STOP, non-zero exit, and empty output keep their current
  `DELIVERY_UNKNOWN` behavior.

## Verification

- Unit-test the 20-minute default and valid/invalid overrides.
- Unit-test that a silent healthy fake CLI emits progress and completes.
- Re-run adapter and auto-loop test suites.
- Run `pnpm skills:quick-validate`, `pnpm skills:validate`, and
  `pnpm skills:index`.
- Sync the public source to the local runtime skill and confirm source/runtime
  parity.
- If a real Reviewer run is practical, verify visible heartbeat output. If not,
  report that real-product timing remains `UNVERIFIED`.
