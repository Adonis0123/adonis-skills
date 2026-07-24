# Review Loop Reviewer Timeout Implementation Plan

> **For agentic workers:** Execute this plan inline with test-driven
> development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent healthy silent Reviewers from being manually terminated
around five minutes by making the 20-minute deadline and 30-second liveness
progress explicit.

**Architecture:** Keep timeout and child-process liveness in
`adapters.mjs`; expose progress through a callback and format it in the CLI on
stderr. Keep packet/verdict transitions unchanged.

**Tech Stack:** Node.js ESM, `node:test`, repository skill validation scripts.

## Global Constraints

- Preserve `DELIVERY_UNKNOWN` and no-retry semantics.
- Do not change the packet runtime lock timeout.
- Do not commit, push, or modify the user's untracked `.claude/commands/`.
- Treat `skills/agentic-review-handoff/` as the source of truth and sync only
  after tests pass.

---

### Task 1: Specify timeout resolution and liveness progress

**Files:**

- Modify: `skills/agentic-review-handoff/scripts/test/adapters.test.mjs`
- Modify: `skills/agentic-review-handoff/scripts/review-loop/adapters.mjs`

**Interfaces:**

- Consumes: `REVIEW_LOOP_TIMEOUT_MS`, `createAdapter(product, options)`
- Produces: `resolveTimeoutMs(value)`, `onProgress(event)`,
  `progressIntervalMs`

- [ ] **Step 1: Write failing timeout configuration tests**

Add assertions that `resolveTimeoutMs(undefined)` returns `1_200_000`, a valid
numeric override is accepted, and zero, negative, non-numeric, or non-finite
values throw `REVIEW_LOOP_TIMEOUT_MS must be a positive finite number`.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
node --test --test-name-pattern="timeout configuration" \
  skills/agentic-review-handoff/scripts/test/adapters.test.mjs
```

Expected: failure because `resolveTimeoutMs` is not exported and the default is
still `600_000`.

- [ ] **Step 3: Implement minimal timeout resolution**

Export:

```js
export const DEFAULT_TIMEOUT_MS = 1_200_000;

export function resolveTimeoutMs(value = process.env.REVIEW_LOOP_TIMEOUT_MS) {
  if (value == null || value === "") return DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("REVIEW_LOOP_TIMEOUT_MS must be a positive finite number");
  }
  return timeoutMs;
}
```

Resolve both the environment default and an explicit `timeoutMs` option through
this function before spawning.

- [ ] **Step 4: Write a failing silent-process progress test**

Run a fake CLI that sleeps briefly before returning valid output. Configure a
short `progressIntervalMs`, collect `onProgress` events, and assert that at
least one `active` event contains the product, elapsed time, timeout, and PID
before the successful result.

- [ ] **Step 5: Run the focused test and confirm RED**

Run:

```bash
node --test --test-name-pattern="silent healthy reviewer emits progress" \
  skills/agentic-review-handoff/scripts/test/adapters.test.mjs
```

Expected: failure because the adapter does not emit progress.

- [ ] **Step 6: Implement progress emission and cleanup**

Pass `onProgress` and `progressIntervalMs` into `invokeProduct()`. Emit an
immediate `active` event after spawn and repeat it at the configured interval.
Ignore observer exceptions and clear the interval in the shared `finish()`
path.

- [ ] **Step 7: Run adapter tests and confirm GREEN**

Run:

```bash
node --test skills/agentic-review-handoff/scripts/test/adapters.test.mjs
```

Expected: all adapter tests pass.

### Task 2: Surface the deadline and forbid premature manual kills

**Files:**

- Modify: `skills/agentic-review-handoff/scripts/review-loop.mjs`
- Modify: `skills/agentic-review-handoff/SKILL.md`
- Modify: `skills/agentic-review-handoff/references/auto-loop-contract.md`
- Modify: `skills/agentic-review-handoff/evals/evals.json`

**Interfaces:**

- Consumes: adapter `onProgress` events
- Produces: stderr heartbeat
  `[review-loop] reviewer=<product> status=active elapsed=<duration> timeout=<duration>`

- [ ] **Step 1: Add CLI progress formatting**

Pass an adapter progress callback from the `run` command. Write heartbeats to
stderr every 30 seconds so final stdout remains JSON.

- [ ] **Step 2: Document the operator invariant**

State in `SKILL.md` and `auto-loop-contract.md`:

```text
stdout silence is not failure; while the Reviewer process is alive, do not
kill, retry, or start a second Reviewer before the configured deadline
```

Document the 20-minute default, 30-second heartbeat, STOP override, and
`REVIEW_LOOP_TIMEOUT_MS` advanced override.

- [ ] **Step 3: Add an evaluation case**

Add a prompt where Grok has produced no stdout for five minutes but the process
is healthy. The expected behavior is to keep waiting for the adapter deadline,
not kill or retry.

- [ ] **Step 4: Run behavior and repository validation**

Run:

```bash
node --test \
  skills/agentic-review-handoff/scripts/test/adapters.test.mjs \
  skills/agentic-review-handoff/scripts/test/auto-run.test.mjs \
  skills/agentic-review-handoff/scripts/test/auto-run-negatives.test.mjs \
  skills/agentic-review-handoff/scripts/test/consult.test.mjs \
  skills/agentic-review-handoff/scripts/test/sessions.test.mjs
pnpm skills:quick-validate skills/agentic-review-handoff
pnpm skills:validate
pnpm skills:index
git diff --check
```

Expected: all commands exit successfully.

### Task 3: Sync and verify runtime behavior

**Files:**

- Regenerate: `apps/web/src/generated/skills-index-lite.json`
- Regenerate: `apps/web/src/generated/skills-detail-index.json`
- Sync: `.agents/skills/agentic-review-handoff/**`

**Interfaces:**

- Consumes: validated public skill source
- Produces: identical installed runtime skill

- [ ] **Step 1: Sync the local runtime skill**

Run:

```bash
pnpm skills:test:local -- --skill agentic-review-handoff
```

Expected: installation and symlink verification pass.

- [ ] **Step 2: Confirm source/runtime parity**

Run:

```bash
diff -qr \
  skills/agentic-review-handoff \
  .agents/skills/agentic-review-handoff
```

Expected: no differences.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff --check
git diff -- \
  skills/agentic-review-handoff \
  apps/web/src/generated/skills-index-lite.json \
  apps/web/src/generated/skills-detail-index.json \
  docs/superpowers/specs/2026-07-24-review-loop-reviewer-timeout-design.md \
  docs/superpowers/plans/2026-07-24-review-loop-reviewer-timeout.md
```

Expected: only timeout/progress behavior, its tests, docs, eval, and generated
indexes change; `.claude/commands/` remains untouched.
