# Single-skill temp trial（URL / 测试一下）

For one skill link or `owner/repo@skill` when the user wants **evaluation**, not install.

## Triggers (this route)

- GitHub tree/blob under `…/skills/<name>`
- skills.sh page for one skill
- 测试一下 / 试一下 / 评估 / 值不值得装 + skill name or URL
- Explicit “先别装，先试”

Not this route: pure catalog discovery with no install judgment (may still use find-skills **search only**).

## Layout

```text
/tmp/<skill-or-pkg>-eval-YYYYMMDD/
  upstream/                 # optional full clone --depth 1
  <skill-name>/             # copy of skill dir only
  trial-artifact/           # exercise outputs (design, HTML, cited md)
  EVAL.md                   # inventory + dual-track + exercise notes
  PEER_REVIEW_PROMPT.md     # if peers run
  peer-*.md / PEER_SUMMARY.md
```

## Steps (minimum)

1. Confirm target skill name + upstream repo.
2. Clone or sparse-copy **only** that skill into `/tmp/...` (no write into global skills directories).
3. Light inventory:
   - same name local? (every global skills directory, e.g. `~/.agents/skills`)
   - hash of `SKILL.md` vs upstream tip
   - local alternatives (different name, same job)
4. Dual-track map (process skills especially): discuss/plan/grill/lite-code/debug stacks.
5. Exercise:
   - **Process / design-gate:** one locked brief → sample design or decision artifact under `trial-artifact/`; if scripts/companion exist, start→HTTP smoke→stop under temp `project-dir`.
   - **Research-thin:** one cited markdown under temp.
   - **Research pack (1 router + N specialists):** follow **Research-pack smoke** below — do not treat the repo as one skill and do not run the full volume gate.
   - **UI:** follow main A/B artifact path when comparing two.
6. Non-trivial → peers (`peer-review-cli.md`); Codex usage-limit → n/a, still ship A/B/C.
7. Deliver: Choice A/B/C for **this skill**, one-line reason, when→upgrade, use-instead ≤3, risks ≤2, install status precise.

## Research-pack smoke (1 router + N specialists)

When the GitHub URL is a **repo root** (or a `skills/` tree) whose `SKILL.md` names are a router plus TAM / chain / competition / finance / valuation specialists:

1. **Classify as package.** Inventory every `skills/*/SKILL.md`. Dual-track against local news/citation/digest skills. Package **A** (enable all) is almost never the 测试 outcome.
2. **Lock one theme the user already named** (e.g. a product category). That theme is the opening record. For the trial only, treat it as 「无需提问，直接开始」 — do not stop the eval on the router’s interview HARD-GATE. A real research engagement still owes that interview.
3. **C-smoke 1–2 specialists that match the theme**, using the pack’s own **单独专项 / 简版 / 有限披露** path. Typical pair: market-sizing + competitive-landscape. Copy those skill dirs under the eval tree; write artifacts under `trial-artifact/` in the pack’s project-folder shape if it has one.
4. **Do not** execute the pack’s full 8–13 module volume (multi-thousand-char specialists + a 25k–60k synthesis) as a 测试. Write the downgrade on the 交付清单 so the trial is not labelled 完整行业研究.
5. **Exercise the method that can fail**, not the template headings: keep conflicting TAM vs company ARR as a range; never average unlike denominators; never compute CR/HHI without a compatible market total; ARR ≠ FY revenue; user counts ≠ share. If the specialist defaults to a formula `.xlsx`, write real formulas (temp Python deps **inside** the eval tree) or mark the workbook 待生成 — a static markdown table is not a completed sizing trial.
6. **Score intervention cost** as: how much of the pack you had to override (opening Q&A, volume gate, Excel toolchain) to finish a chat-sized 测试. High override → lean **B**, keep **C** for a later real TAM/格局 report.
7. Deliver package A/B/C plus which **one** specialist would be the C copy if they later ask to install something.

## Accidental global install recovery（硬）

If `npx skills add -g` / enable already happened mid-eval:

1. `npx skills remove <skill> -g -y` (or your skill manager's remove, after showing the plan).
2. Verify gone: `~/.agents/skills/<name>` (or your global dir), per-host symlinks, `.skill-lock.json` entry.
3. Say so in the user-facing status (“误装已卸”).
4. Continue only from `/tmp` trial; do not treat the brief enable as adoption.

## Decision defaults (example)

| Finding                                                             | Lean                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Local alternative covers job; candidate adds ceremony               | **B**                                                                   |
| Unique tool (e.g. visual companion) but daily path is lite surgical | **B**, C only if that gap recurs                                        |
| Hash-match already installed                                        | **B** (zero delta)                                                      |
| Real gap + lower mental load after one real task                    | single-skill **A** after user says install                              |
| Whole package missing many skills user did not ask for              | package **A** almost never                                              |
| 1+N research pack; daily job is a quick chat 「查一下竞品」         | **B**; C = one specialist copy when a real TAM/格局 report is requested |

## Baseline: `obra/superpowers@brainstorming`（2026-08-07）

| Item                               | Note                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job                                | Design-before-code; one Q at a time; 2–3 approaches; spec path; handoff only to `writing-plans`                                                                       |
| Unique                             | Browser visual companion (`scripts/start-server.sh`, key-gated URL)                                                                                                   |
| Already from same pkg (hash match) | `systematic-debugging`, `test-driven-development`, `writing-plans`                                                                                                    |
| Local overlap                      | `discuss-before-plan`, `grilling`/`grill-me`/`grill-with-docs`, `workflow-gate` creative→Brainstorm pointer, a lightweight surgical-change path                       |
| Friction                           | HARD-GATE on every creative/behavior change; default `docs/superpowers/specs/` + commit; dual-track with discuss-before-plan                                          |
| Trial verdict                      | **B** (not worth permanent install for daily surgical product work). Package full add rejected. Optional later **C**/single A only if visual companion gap is proven. |
| Side finding                       | `workflow-gate` may point at missing `brainstorming` — fix gate target to `discuss-before-plan` is a separate edit; not a reason to force-install brainstorming.      |

Re-inventory before revisiting; do not treat this baseline as forever.

## Deliverable shape (chat-friendly)

```text
结论：B|C|A（单 skill）— …
纠正/状态：temporary-only | not installed | 误装已卸
证据：/tmp/… 路径 + 是否实跑
替代：≤3
风险：≤2
```
