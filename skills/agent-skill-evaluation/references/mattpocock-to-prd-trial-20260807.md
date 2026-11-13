# mattpocock `to-prd` trial (2026-08-07)

## Verdict

| Field  | Value                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------- |
| Choice | **B**                                                                                           |
| Status | `to-prd` **not installed** (correct); successor `to-spec` **already present** hash-match        |
| Why    | Catalog/discoverability slug only — GitHub renamed **`to-prd` → `to-spec`** (#464, finish #734) |

## Facts

- skills.sh still serves https://www.skills.sh/mattpocock/skills/to-prd (PRD wording, install counts).
- `git clone` tip @ `84fdeff`: **no** `skills/**/to-prd/`; `npx skills add mattpocock/skills -l` lists **to-spec**, not to-prd.
- Local `to-spec` SKILL.md sha `5d26479544b0` == upstream.
- `write-a-prd` skills.sh → 404.
- `to-plan` / `to-issues` → **`to-tickets`** (same PR family).

## Class rule

Do not permanent-install a skills.sh name until git tip proves the path. Alias + hash-match successor → **B**, not dual-name install.

Full rename table + phantom `to-tdd`: `references/mattpocock-catalog-renames.md`.  
Package baseline: `references/mattpocock-skills-screening.md`.  
Same-day shortlist: `references/mattpocock-shortlist-20260807.md`.

## Exercise (reuse to-spec)

`/tmp/to-prd-eval-20260807/trial-artifact/PRD-as-spec-sample.md` ≡ to-spec template; no tracker publish.

## Use instead

1. Installed `to-spec`
2. `discuss-before-plan` / `writing-plans`
3. A story in your primary tracker

## When to revisit

Never under name `to-prd`. Only if the team abandons its current tracker for GH Issues end-to-end Matt chain (setup + to-spec + to-tickets) — package decision, not this alias.
