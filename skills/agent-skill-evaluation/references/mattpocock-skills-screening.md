# mattpocock/skills — package screening notes

Source of truth for **whether to full-install** this package on the owner’s machines.  
Not a substitute for re-inventory: re-clone and re-hash if evaluating months later.

## What the package is

- Repo: https://github.com/mattpocock/skills
- Philosophy: small, composable skills; explicitly against owning the whole process like GSD / BMAD / Spec-Kit.
- Main engineering chain (user-invoked):  
  `grill-me` / `grill-with-docs` → `to-spec` → `to-tickets` → `tdd` → `improve-codebase-architecture`
- Setup entry: `setup-matt-pocock-skills` (issue tracker + triage labels + domain doc layout under `docs/agents/*`, and an `## Agent skills` block in `CLAUDE.md`/`AGENTS.md`).

## Install surfaces (do not double-install)

| Path                                      | Effect                                                |
| ----------------------------------------- | ----------------------------------------------------- |
| Claude Code plugin `mattpocock-skills`    | Managed bundle; auto-updates                          |
| `npx skills@latest add mattpocock/skills` | Copies editable skills into project/global agent dirs |
| Both                                      | Upstream warns: **every skill appears twice**         |

CLI useful flags (skills@latest):

```bash
npx skills@latest add mattpocock/skills -l          # list only
npx skills@latest use mattpocock/skills@<skill>      # prompt only, no install
npx skills@latest add mattpocock/skills -s <name> -g # single skill global (only after user decision)
```

## Example owner baseline (verified 2026-08-03)

Already installed in the global skills directory with **SKILL.md hash == upstream tip** at evaluation time:

| Skill                           | Role                                        |
| ------------------------------- | ------------------------------------------- |
| `grill-me`                      | User entry → grilling                       |
| `grilling`                      | Relentless interview loop                   |
| `grill-with-docs`               | Grill + domain docs / ADR                   |
| `to-spec`                       | Conversation → spec (expects setup tracker) |
| `improve-codebase-architecture` | Deepening opportunities                     |
| `domain-modeling`               | Glossary / CONTEXT sharpening               |
| `codebase-design`               | Deep-module vocabulary                      |
| `handoff`                       | Session handoff doc                         |
| `teach`                         | Multi-session teaching                      |

Lock provenance also pointed at `source: mattpocock/skills` for the above.

### Not installed (and usually should stay off full-add)

| Skill                                  | Why careful                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup-matt-pocock-skills`             | Rewrites agent docs; forces tracker/domain layout                                                                                                                                                                                                                                                                                                                          |
| `to-tickets` / `triage`                | Dual-track vs the primary tracker + chat intake + code-host MR flow                                                                                                                                                                                                                                                                                                        |
| `tdd`                                  | Overlaps local `test-driven-development` (much heavier)                                                                                                                                                                                                                                                                                                                    |
| `diagnosing-bugs`                      | Real possible gap; may trial alone vs `systematic-debugging`                                                                                                                                                                                                                                                                                                               |
| `code-review`                          | Overlaps existing CR stack; often wants issue-tracker config                                                                                                                                                                                                                                                                                                               |
| `implement` / `prototype` / `ask-matt` | No proven gap; adds selection tax                                                                                                                                                                                                                                                                                                                                          |
| `implement-spec`                       | Do not install. Orchestrator only: setup gate, then per-ticket worktree calling `tdd`, a merger, and `code-review`. A throwaway graph that commits is not evidence the shell runs without those missing skills. Second queue vs the primary tracker. Use `task-completion-loop`, a lightweight surgical-change path, or `writing-plans` + local `test-driven-development`. |
| `wayfinder`                            | **Trialed 2026-09-09 — B, do not install** (`references/mattpocock-wayfinder-trial-20260909.md`); tracker-coupled decision map vs the primary tracker + discuss-before-plan                                                                                                                                                                                                |
| `research`                             | **Trialed 2026-08-03 — do not install by default** (see below)                                                                                                                                                                                                                                                                                                             |
| `loop-me`                              | **`in-progress/`**; trialed 2026-08-15 — do not install (see below)                                                                                                                                                                                                                                                                                                        |

## Dual-track / coupling map (example)

| Upstream assumption                     | Local reality                            | Full install effect                                         |
| --------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| GitHub/GitLab/local markdown issues     | Another tracker is primary               | Half-broken tracker skills or second queue                  |
| Root `CONTEXT.md` + `docs/adr/` default | Per-repo docs; avoid auto-create CONTEXT | Layout fight                                                |
| `ready-for-agent` triage labels         | Chat intake → tracker labels / owners    | Parallel triage vocabulary                                  |
| Composable skills still share setup     | Multi-host skill budget already large    | More trigger noise; Codex skill-description budget pressure |

## Recommended decision pattern

1. **Re-inventory** (clone + name diff + hash) — do not trust this note alone after long gaps.
2. If core list still hash-matches → **B: do not full install**.
3. If a **single** zero-setup skill has a proven gap (historically: `diagnosing-bugs`) → **C: temp trial only**.
4. Admission for permanent single install: real task evidence, ≤ mental load of local alternative, no setup side effects.
5. **Never A** solely because the package is popular or README is good.

## Minimal temp trial (diagnosing-bugs example)

```bash
# Prompt-only (preferred when CLI available)
npx skills@latest use mattpocock/skills@diagnosing-bugs

# Or file-only under /tmp
mkdir -p /tmp/mp-trial
cp -R /tmp/mattpocock-skills-eval/skills/engineering/diagnosing-bugs /tmp/mp-trial/
# feed that SKILL.md to the agent; do NOT run setup
```

Pass bar: must produce a **already-run red-capable repro command** before hypotheses; clean debug markers after fix; no new `docs/agents/*`.

## `research` single-skill trial (2026-08-03)

User re-scoped: evaluate **only** `research`, not the full package.

| Fact             | Detail                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill size       | ~12-line body: background agent + primary sources + one cited Markdown + save where repo keeps notes                                                                                                    |
| Coupling         | **Zero** setup / tracker / CONTEXT force-create                                                                                                                                                         |
| Local overlap    | Host already has web search / fetch + a standing “primary sources” rule                                                                                                                                 |
| Trial method     | `/tmp/mp-research-trial` with skill copied under `.claude/skills/research/`; produced `docs/research/2026-08-03-agent-skills-skillmd-frontmatter.md` from agentskills.io + Claude Platform primary docs |
| Install decision | **B for package, no permanent install of `research`** — thin checklist, not new capability                                                                                                              |
| Cleanup          | User asked to delete trial artifacts; removed `/tmp/mp-research-trial` (+ package eval temps). Did **not** touch installed Matt subset                                                                  |

Re-trial only if a real task shows cited-note discipline failing without the skill. Prefer remembering the checklist over occupying a skill slot.

## `wait-what` + `writing-beats` trial (2026-08-22)

User asked: skills.sh URLs + 测试一下 / 值不值得装. First turn accidentally `npx skills add -g` — **removed** (`npx skills remove … -g -y` + leftover dirs). Re-ran as `/tmp` eval.

| Fact          | Detail                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Layout        | `/tmp/mp-wait-beats-eval-20260822/` — hashes match upstream tip                                                 |
| wait-what     | 3-line user-invoked re-pitch; STE100 + CONTEXT.md; slash-only                                                   |
| writing-beats | `skills/in-progress/`; CYOA one-beat-then-stop + grounding                                                      |
| Dual-track    | wait-what → profile plain-language rules；writing-beats → report-writing / documentation-writer / writing-plans |
| Exercise      | jargon dump vs re-pitch; raw pile → only beat 1 on disk                                                         |
| Peers         | Claude (Opus) / Codex / Grok all **B+B**                                                                        |
| Install       | **B for both**. Package A still out of scope. Do not leave global copies.                                       |

Re-trial wait-what only if the agent’s 「说人话」 still dumps jargon ≥3 times after a profile line. Re-trial writing-beats only after it leaves `in-progress/` **and** a real IDE long-form session wants beat-by-beat picks.

## `loop-me` single-skill trial (2026-08-15)

User asked: `npx skills add … --skill loop-me` + 测试/值不值得装. **Did not add.** Temp clone only.

| Fact             | Detail                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Bucket           | `skills/in-progress/` — excluded from plugin + top README; can vanish                                                                    |
| Size             | 32-line wrapper around `/grilling` + vocab Trigger / Checkpoint / Push-right / Brief; workspace `workflows/*.md` + `NOTES.md`            |
| Coupling         | Zero setup/tracker/CONTEXT. High process coupling to already-installed `grilling`                                                        |
| Local overlap    | `grilling`/`grill-me`/`grill-with-docs` + `discuss-before-plan` + `workflow-gate` + host cron / a daily digest skill / `goal-gate`       |
| Trial            | `/tmp/loop-me-eval-20260815/` — specified an existing 09:00 digest job as a loop; substance came from the digest skill, not the 32 lines |
| Peers            | Claude (Opus) / Codex / Grok all **B**                                                                                                   |
| Install decision | **B** — no permanent install. Package A still out of scope                                                                               |

Re-trial only if the owner adopts `workflows/*.md` as cross-session SoT **and** 2–3 real unspecced life-loops fail under grilling + cron + the primary tracker.

## Cleanup checklist (after any mattpocock temp eval)

```bash
rm -rf /tmp/mp-research-trial /tmp/mattpocock-skills-eval /tmp/mattpocock-skills-peer-review /tmp/mp-trial /tmp/loop-me-eval-20260815
# leave installed grill-me, to-spec, ... alone unless user asks uninstall
```

## Peer-review note

When multi-agent review is requested (Claude / Codex / Grok), pass the inventory + coupling map from the main skill’s **Package Install Screening** section. Peers without disk access must be told what was hash-verified vs assumed.
