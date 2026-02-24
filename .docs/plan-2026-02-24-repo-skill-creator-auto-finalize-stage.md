# Repo Skill Creator: Auto Discover + Finalize + Stage

## Background

`repo-skill-creator` previously required an explicit `skills/<slug>` path for finalize mode.  
This added friction for the common workflow where a new skill is already copied or created under `skills/*`.

## Goals

1. Support direct execution that automatically finds new skills under `skills/*`.
2. Run standard finalize flow for each discovered skill.
3. Stage only related files after successful processing.
4. Keep existing `skills:finalize -- <skill-path>` behavior fully backward compatible.

## Scope

In scope:

- Add `scripts/finalize-new-skills.ts`.
- Add `pnpm skills:finalize:new`.
- Update `repo-skill-creator` skill instructions.
- Update `README.md` and `README.zh-CN.md` command/SOP docs.

Out of scope:

- Changing existing `skills:finalize` semantics.
- Running `skills:openai-yaml` automatically.
- Running local install/sync commands automatically.

## Solution

1. Discover candidates from `git status --short --untracked-files=all` using status `A` and `??`, but only when `skills/<slug>/SKILL.md` itself is newly added.
2. Extract unique `skills/<slug>` targets and verify the directory contains `skills/<slug>/SKILL.md`.
3. If targets exist:
   - run `pnpm skills:finalize -- skills/<slug>` in sorted order.
   - stop immediately on the first failure.
4. If no targets exist:
   - run `pnpm skills:new` (interactive),
   - rescan and continue if new skill appears.
5. Stage only related files:
   - `git add skills/<slug>` for processed slugs,
   - `git add apps/web/src/generated/skills-index.json` only when changed.
6. Support `--dry-run` to print planned commands without mutation.

## Risks

1. False-positive path detection in `skills/*`.
   - Mitigation: only treat directories with `SKILL.md` as valid skill targets.
2. Over-staging unrelated changes.
   - Mitigation: stage only explicit paths from processed slugs + index file.
3. Multi-skill flow takes longer.
   - Mitigation: keep stable sorted order and fail fast.

## Acceptance Criteria

1. `pnpm skills:finalize:new` can process new skills detected from `A + ??`.
2. Script auto-falls back to `pnpm skills:new` when no new skill is found.
3. Script stages only related files (not `git add -A`).
4. Existing `pnpm skills:finalize -- <skill-path>` remains unchanged.
5. README English/Chinese docs are semantically aligned and include new command usage.
