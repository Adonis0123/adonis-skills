# Output-style skill screening (i-have-adhd class)

Use when the candidate is **pure response shaping** — not tools, not tracker/CI/PR workflow.
Canonical example: `ayghri/i-have-adhd` (trialed 2026-08-06).

## What counts as this class

| Signal                               | Example                                         |
| ------------------------------------ | ----------------------------------------------- |
| Body is 5–15 formatting rules        | lead with action, list cap 5, no preamble       |
| Optional always-on host hooks        | Claude `SessionStart` flag, GEMINI.md paste     |
| Multi-host packaging only            | Claude/Codex plugin + Cursor path + Hermes tags |
| Upstream evals about **reply shape** | actionability / concision / autonomy of wording |
| No required scripts for core value   | SKILL.md alone is the product                   |

If the package also ships setup/tracker/TDD chains, use the general package inventory + mattpocock notes instead.

## Example baseline (style already absorbed)

Do **not** treat missing skill name as a gap.

| Local surface                         | What already covers the job                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| User profile file（输出文风）         | 首尾可扫、列表≤5、多步 k/n、可验证胜利；**明确「自 i-have-adhd 仅吸风格，不吸流程」**          |
| Persona file 回答契约                 | 先结论、短、表、≤15 行                                                                         |
| Global `AGENTS.md` 「结构优先于篇幅」 | 可执行子集 + 触发短语「扫读加强 / ADHD 模式」；**有开放项才写 Next**（优于无条件 next-action） |
| 做事流程                              | 仍走领域 skill（lite-code / deliver / tracker / systematic-debugging）— 不把步骤推回用户       |

## Dual-track risks unique to style skills

| Risk                                           | Why it bites                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Profile + always-on skill double inject        | Same rules in profile files **and** skill → selection tax / model arbitration                                           |
| English Forbidden openers list vs 中文默认     | Upstream SKILL often English-first; can pull answers off Chinese default                                                |
| Rule “end with one next action for the reader” | Fights **agent autonomy**: the agent should tool-edit itself; “Next: you run npm test” pushes work back                 |
| Session-persistent until “stop adhd mode”      | Always-on or sticky mode outlives the task that needed scannable style                                                  |
| `disable-model-invocation: true`               | On hosts that honor it, skill is **manual slash only** — permanent install adds little if profiles already encode style |

Upstream evals often weight **Autonomy ~25%** — use that as a red flag when the skill’s default examples are user-run checklists.

## Mandatory exercise (do not score by README stars)

1. Temp clone only: `git clone --depth 1` → `/tmp/<pkg>-eval`.
2. Inventory: name present? content absorbed into profile files? always-on flag files?
3. **Style A/B on one locked brief** (same facts, two shapes):
   - Prefer a debug case from upstream `evals/cases.jsonl` if present (e.g. 401 missing Authorization).
   - Write baseline reply under **current** profile rules.
   - Rewrite under candidate rules without installing.
4. **Autonomy stress**: “You have repo access; fix the typo.” Good = agent acts. Bad skill use = numbered user steps only.
5. Peers (Claude/Codex/Grok) with inventory + dual-track + trial path — not stars.

## Decision defaults

| Option          | When                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| **B** (default) | Style already in profile files; thin checklist; always-on would dual-track                                       |
| **C**           | Rare: pure English on-demand slash on a host **without** local profile subset; never always-on during trial      |
| **A**           | Almost never. If profiles lose the style block, **write rules back into profile**, do not full always-on package |

## Cleanup confirmation (user said 删除)

```bash
cd /   # leave doomed tree first
rm -rf /tmp/<pkg>-eval
# confirm: path gone + no name in any global skills directory (e.g. ~/.agents/skills)
# confirm: no always-on flag file the package documents
# do NOT uninstall unrelated adopted skills
```

## i-have-adhd trial snapshot (2026-08-06)

| Fact             | Detail                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| Repo             | https://github.com/ayghri/i-have-adhd                                     |
| SKILL path       | `skills/i-have-adhd/SKILL.md` (hash then `77052fdc…`; re-hash on re-eval) |
| Local name match | Absent                                                                    |
| Content absorb   | Yes — user profile + global AGENTS.md structure rules                     |
| Peers            | Claude **B**, Grok **B**, Codex usage-limited n/a                         |
| Decision         | **B — do not install**; user deleted `/tmp/i-have-adhd-eval`              |
| Always-on        | Not recommended                                                           |

Re-inventory if profiles drop the style block or a host has **zero** scannable-output rules.
