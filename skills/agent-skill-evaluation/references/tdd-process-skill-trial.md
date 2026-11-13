# TDD / process-law skill temp trial

Class recipe when evaluating any **red-green / TDD-law** skill (e.g. mattpocock `tdd`, superpowers-style TDD clones).

## Hard rules

1. **Temp only** until user chooses A — never `npx skills add -g` during 测试/评估.
2. **Do not score from SKILL.md prose alone.**
3. **Usable trial ≠ install.** A green temp exercise proves readability/runnability, not a gap.
4. **Never dual always-on** two TDD laws unless user explicitly swaps (unload A, install B).

## Dual-law map (required)

Before recommending install, write:

| Axis                     | Candidate | Local alternative |
| ------------------------ | --------- | ----------------- |
| When to test             | …         | …                 |
| RED verify mandatory?    | …         | …                 |
| Refactor in-loop or out? | …         | …                 |
| Seams / ceremony         | …         | …                 |
| Mocking stance           | …         | …                 |

Hard conflicts (especially **refactor in-loop vs out-of-loop**) → default **B** if local already complete.

If the user later forces **keep exactly one**: keep the heavier complete local law (in-loop refactor + watched RED/GREEN). Do not swap to the thinner candidate unless they unload the local skill **and** accept its parked-refactor home (or install that companion). Steal unique bullets into the winner; never dual always-on.

## Exercise minimum

```text
/tmp/<skill>-eval-YYYYMMDD/
  <skill-copy>/
  trial-artifact/   # real package + tests
  EVAL.md
```

1. Lock one **public seam** (pure function or narrow API). If candidate requires pre-agreed seams, write them in BRIEF.md first.
2. Prefer **vertical slices**: one test → implement → next test (not bulk-all-tests-first).
3. For each slice: **watch RED** (real fail for missing behavior), then **GREEN** (minimal code). Prefer 2–3 slices.
4. Stack default for trials (example): TypeScript + Vitest under temp (pnpm).
5. Record intervention cost: how much steering beyond the skill text.

## Name-mismatch trap

Local job may already exist under another name:

| Candidate name | Local heavier alternative                    |
| -------------- | -------------------------------------------- |
| `tdd`          | `test-driven-development` (obra/superpowers) |

Name absent ≠ capability missing.

## Baseline pointer

`mattpocock/skills@tdd` → **B** (re-inventory 2026-09-08, still B). Latest: `references/mattpocock-tdd-trial-20260908.md`. Earlier: `references/mattpocock-tdd-trial-20260807.md`.

Catalog pages may still say “planning” / “red-green-refactor”; score the SKILL.md law (refactor out-of-loop) not the marketing blurb.

## Deliverable (chat-scannable)

```text
结论：B|C|A — …
状态：temporary-only | not installed | already present
证据：RED/GREEN 次数 + /tmp 路径
双法冲突：…
替代：≤3
风险：≤2
```
