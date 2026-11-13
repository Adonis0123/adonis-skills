# mattpocock@tdd re-inventory (2026-09-08)

Re-eval of [skills.sh/mattpocock/skills/tdd](https://www.skills.sh/mattpocock/skills/tdd) after the 2026-08-07 **B**. Re-inventory again before treating as forever.

## Verdict

| Field    | Value                                                      |
| -------- | ---------------------------------------------------------- |
| Choice   | **B** — do not permanent install; cannot replace local TDD |
| Status   | temporary-only `/tmp/tdd-eval-20260908/`                   |
| Peers    | Claude **B** · Codex **B** · Grok **B**                    |
| Upstream | `3cca18b` 2026-09-04; SKILL.md sha256 `cb01f66b…8814c927`  |

## What changed vs 2026-08-07

- Skill got **thinner** (SKILL.md ~38 lines). Catalog still advertises planning + red-green-refactor; body has **no planning section** and **forbids** refactor in the loop.
- `agents/openai.yaml` still labels “red-green-refactor” — display copy, not the law.
- Dual-law conflict **unchanged**: Matt parks refactor in uninstalled `code-review`; local `test-driven-development` keeps REFACTOR in-loop.

## Why still B

- Local **`test-driven-development`** (obra/superpowers) is the heavier complete law (Iron Law, watch RED/GREEN, in-loop refactor, `writing-good-tests.md`).
- Name `tdd` still **absent** — not hash-match; dual always-on would be two TDD laws. Short name would likely out-trigger the local skill.
- Real exercise: `applyCoupon` public seam, 3 vertical slices, Vitest 3/3. **Usable ≠ gap.**

## Unique deltas (steal into local notes if they keep paying off; do not install)

- Pre-agree seams with the user
- Vertical vs horizontal slicing
- Tautology / boundary-mock (`tests.md`, `mocking.md`)

## Use instead

1. `test-driven-development`
2. `vitest`
3. `codebase-design` (already installed from mattpocock)

## Forced keep-one (same day follow-up)

User asked: if exactly one TDD law may stay always-on, which.

| Peer          | Keep  |
| ------------- | ----- |
| Claude (Opus) | Local |
| Codex         | Local |
| Grok          | Local |
| Host agent    | Local |

**Keep `test-driven-development`.** Steal vertical-slice + tautology/boundary-mock into local notes if they keep paying off; do not swap. Flip only if unloading Local **and** installing Matt `code-review` (or explicitly accepting no in-loop refactor).

## When to revisit A

Only if unloading local TDD **and** installing Matt `code-review` (or explicitly accepting no in-loop refactor). **Never** dual always-on.
