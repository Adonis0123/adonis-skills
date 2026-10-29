# Grill: grill-autopilot-skill-creator

- Date: 2026-10-29
- Pairing: Interviewer claude/cc008 (host), Proxy codex, Red-team skipped: no hard-to-reverse decision
- Rounds: 2; stopped because the frontier is empty
- Duration: about 3 minutes
- Status: proposed (no decision here has been implemented)

## Plan

你让他们讨论看看要不要调用 skill-creater 优化

Target: the public skill `skills/grill-autopilot`, right after this session added the read-only Watch Page, the `--out` flag on `grill-ledger.mjs`, fixed run-file names, two glossary terms and two eval expectations. The `description` is unchanged.

## Decisions

| ID  | Question                                          | Decision                                                                                                      | Status     | Reversibility | Evidence                                                                                              |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| Q1  | Run skill-creator's description optimization?     | No; keep the description                                                                                      | Decided    | easy          | `skills/grill-autopilot/SKILL.md`; `~/.agents/skills/skill-creator/SKILL.md`                          |
| Q2  | Run skill-creator's with-skill vs baseline evals? | No; accept with one real session on the repo version instead                                                  | Decided    | easy          | `skills/grill-autopilot/evals/evals.json`; `skills/grill-autopilot/scripts/test/grill-watch.test.mjs` |
| Q3  | Review SKILL.md against the writing guide?        | Yes, read-only; SKILL.md is 108 lines, so no split; fix the opening sentence                                  | Decided    | easy          | `skills/grill-autopilot/SKILL.md`; `skills/grill-autopilot/GLOSSARY.md`                               |
| Q4  | How to reword the opening sentence?               | "adds only a deterministic ledger and a read-only Watch Page"                                                 | Assumption | easy          | `skills/grill-autopilot/SKILL.md`                                                                     |
| Q5  | When to update the global `~/.agents` copy?       | After an authorized commit and push, via `npx skills add adonis0123/adonis-skills --skill grill-autopilot -g` | Decided    | easy          | `CLAUDE.md`; `skills/grill-autopilot/SKILL.md`                                                        |
| Q6  | Add a dedicated Watch Page eval case?             | No; keep the two expectations on eval 0                                                                       | Decided    | easy          | `skills/grill-autopilot/evals/evals.json`                                                             |

## Reasons

### Q1 — Description optimization

- Reason: the change adds a viewer and leaves the trigger scope as it was; there is no evidence of wrong or missed triggers, so repeated trigger evals would not pay back.
- Revisit if: a concrete trigger failure shows up, or the skill's scope changes.

### Q2 — Eval runs

- Reason: the risk is whether the host writes the run files, `--out` output and done event, and whether the page shows them. One real session on the repo version checks that directly. The global copy is the old version, so the session must load the repo's SKILL.md and scripts. A later upgrade comparison should use the old version as the baseline.
- Revisit if: a real session misses a file, the page shows something wrong, or a change touches the question and ruling rules.

### Q3 — Writing-guide review

- Reason: 108 lines is far under the guide's 500-line advice. The review should look at instruction consistency, references and load timing; it found that the opening sentence still says the skill adds only a ledger.
- Revisit if: the review finds an ambiguous step or a behaviour gap; a read-only review is not a full optimization.

### Q4 — Opening sentence

- Reason: matches the component table and keeps the sentence's structure.
- Revisit if: the skill gains another independent component.

### Q5 — Global copy

- Reason: the installer keeps `.skill-lock.json` consistent; copying files by hand would not. Until then, test with the repo's paths. This decision does not authorize a commit, push or install.
- Revisit if: the global install must be verified before pushing; then consider an isolated install.

### Q6 — Eval coverage

- Reason: eval 0 already covers start, run files and close; another normal-path case adds a 15-minute session for little gain. Retry and failure branches are covered by deterministic tests.
- Revisit if: tests pass but a real session still renders wrongly.

## Escalations

- **Q5**: update the global `~/.agents/skills/grill-autopilot` copy after you authorize a commit and push, using `npx skills add adonis0123/adonis-skills --skill grill-autopilot -g`. Held because installing is a side effect. Your answer: commit and push, then install with the installer (recorded as Decided).

## Assumptions

- **Q4**: opening sentence becomes "A thin orchestrator. It composes existing skills and adds only a deterministic ledger and a read-only Watch Page."

## Glossary and decision records

- Terms added to `GLOSSARY.md`: none (Judge and Watch Page were added to the skill's own glossary before this grill).
- Decision records written (status proposed): none; no decision is hard to reverse.
