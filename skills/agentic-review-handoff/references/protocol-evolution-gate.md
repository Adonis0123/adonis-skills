# Protocol Evolution Gate (maintainer-only)

**Audience:** agents **maintaining or evolving this skill** (`scripts/`, contracts, integrity/recovery claims).

**Escape hatch:** if you are running an ordinary review-loop on some other repo (user code), **stop reading** — this file does not apply.

Not a runtime Protocol Gate and not a fourth product loop. Governs only how _this skill_ may change.

**Incident (v3.3.0→3.3.1):** half-built `pendingStage` journal claimed crash-safe dual-write but left tamper/recovery holes. Fix was subtract + fail-closed, not more phases.

## When you must read this

Before changing:

- `scripts/review-loop/**` state machine, persistence, adapters
- `references/auto-loop-contract.md` delivery / hash / lifecycle / ledger claims
- integrity, tamper-detection, recovery, atomicity, durability, exactly-once language (code or docs)
- DecisionConsult whose topic is **evolving this skill’s protocol** (not ordinary product consult)

Ordinary `run` / feedback validation / classic review → **do not** load this file.

## Promise classification (do not conflate)

| Say this only if true  | Is **not** the same as        |
| ---------------------- | ----------------------------- |
| tamper **detection**   | tamper-proof                  |
| crash **detection**    | crash **recovery**            |
| process-crash handling | OS/power-loss durability      |
| multi-file best effort | atomic multi-file transaction |
| idempotent retry       | exactly-once delivery         |
| hash mismatch refuse   | automatic repair              |

Packet Markdown = domain/audit truth; `auto-run-state.json` = rebuildable checkpoint. Do not dual-canonicalize.

## Hard gates

### G1 — Falsify before stronger promises

New or **strengthened** claims (tamper, recovery, atomicity, durability, exactly-once) need a **falsify** test: inject a fault where a wrong implementation **turns red**. Covers renames that re-imply a promise and new recovery-shaped code. Ship without it → drop the claim or the feature.

| Promise | Fault injected | Expected observable | Test / command | Explicitly unsupported |
| ------- | -------------- | ------------------- | -------------- | ---------------------- |

### G2 — Consult must review threat model

DecisionConsult about evolving **this** protocol must answer: invariant protected; adversary/fault class; between which durable ops; commit point; how intermediate state is **detected**; auto vs human recovery path; non-goals. “Should we do X?” alone is insufficient.

### G3 — No dual-write atomic / crash-safe claims without a real store

Do not advertise multi-file (packet + runtime JSON + archive `mv`) as atomic, crash-safe, or kill/power-loss exactly-once without a real transactional primitive **and** G1 proof. Half-WAL / auto-guess recovery → reject.

### G4 — Prefer subtract + fail-closed

Default: remove surface, fail closed, document non-goals. Half-transaction machines (pending auto-replay, phase enums without image digests, recovery without entrypoints) are **rejected by default**. If this file grows past ~120 lines of ceremony, apply G4 to the gate itself.

## Threat-model minimum (before implement)

1. Asset / invariant
2. Adversary or fault class
3. Fault point (between ops A and B)
4. Detectable failure mode
5. User-visible status
6. Manual non-destructive recovery

## Verification ladder

Canonical unit tests: `SKILL.md` § Tests (do not fork a second list).

**When G1 applies:**

```bash
node --test skills/agentic-review-handoff/scripts/test/adapters.test.mjs \
  skills/agentic-review-handoff/scripts/test/auto-run.test.mjs \
  skills/agentic-review-handoff/scripts/test/auto-run-negatives.test.mjs \
  skills/agentic-review-handoff/scripts/test/consult.test.mjs \
  skills/agentic-review-handoff/scripts/test/sessions.test.mjs
pnpm skills:quick-validate skills/agentic-review-handoff
```

Public index/frontmatter: also `pnpm skills:validate` + `pnpm skills:index`.

| Change                 | Extra                                                      |
| ---------------------- | ---------------------------------------------------------- |
| Install / load path    | `pnpm skills:test:local -- --skill agentic-review-handoff` |
| Description / triggers | install:local + trigger eval (pos+neg)                     |
| Real adapter / session | one real `run` for product, else `UNVERIFIED`              |
| **This gate doc only** | quick-validate enough                                      |

**Source of truth:** `skills/agentic-review-handoff/**` only. Sync with `pnpm skills:install:local -- --skill agentic-review-handoff` — never dual-master `.agents/skills/`.

Fake adapters never prove power-loss durability or third-party CLI fidelity.

## When a gate fails

Allowed: (1) drop/downgrade promise, (2) fail closed with clear recovery, (3) real transactional store + G1. Not allowed: ship integrity/recovery language as “harden later.”

## Changing this gate

Edits here also require DecisionConsult on evolving this skill. No meta-meta process beyond one consult + G1 if the gate gains enforceable claims.
