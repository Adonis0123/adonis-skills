# mattpocock@tdd single-skill trial (2026-08-07)

Baseline for future evals of [skills.sh/mattpocock/skills/tdd](https://www.skills.sh/mattpocock/skills/tdd). **Superseded as latest verdict by** `references/mattpocock-tdd-trial-20260908.md` (still **B**; skill thinner, conflict unchanged). Re-inventory before treating as forever.

## Verdict

| Field  | Value                                                   |
| ------ | ------------------------------------------------------- |
| Choice | **B** — do not permanent install                        |
| Status | temporary-only `/tmp/tdd-eval-20260807/`                |
| Peers  | Claude **B** · Grok **B** · Codex **n/a** (usage limit) |

## Why B

- Local **`test-driven-development`** (obra/superpowers) already covers the job, heavier (Iron Law, verify RED/GREEN, refactor **in-loop**, `writing-good-tests.md`).
- Name `tdd` **absent** locally — not hash-match zero-delta, still dual-track if both always-on.
- Hard conflict: Matt puts refactor **outside** red-green (→ `code-review`); local keeps REFACTOR **inside** the loop.
- Real exercise proved **runnable**, not a **gap**: pure TS `lineTotal` + Vitest, 3 vertical slices each RED then GREEN.

## Unique deltas (not enough to dual-install)

- Pre-agree **seams** with user before tests
- Explicit **vertical vs horizontal** slicing anti-pattern
- Thin tautology / implementation-coupled notes (`tests.md`, `mocking.md`)

## Use instead

1. `test-driven-development`
2. `vitest`
3. `codebase-design` (seam / deep-module vocab — already installed from mattpocock)

## When to revisit A

- Unload local TDD and adopt Matt chain end-to-end, **or**
- ≥2 real cases where Iron Law blocks small surgical product fixes and a lighter RGR prompt is the proven need  
  **Never** dual always-on.

## Process-skill exercise recipe (class rule)

For any TDD-law candidate:

1. Temp clone only — no `npx skills add -g`
2. Lock one pure public seam (+ pre-agree seams if skill requires)
3. Run ≥1 real RED→GREEN under `trial-artifact/` (prefer 2–3 vertical slices)
4. Map dual-law conflicts vs local alternative
5. **Usable trial ≠ install**

## Peer CLI notes from this trial

| Peer   | Working pattern                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------- |
| Claude | stdin prompt; `--max-turns 8` (4 hit empty max-turns)                                           |
| Codex  | usage limit → **n/a** + recovery time; still ship A/B/C                                         |
| Grok   | neutral `/tmp/.../xai-cli`; **short** “no tools” prompt; long prompt + tools → max-turns thrash |

## Cleanup

```bash
cd / && rm -rf /tmp/tdd-eval-20260807
```

Do not uninstall adopted mattpocock subset (`grill-me`, `to-spec`, `codebase-design`, …).
