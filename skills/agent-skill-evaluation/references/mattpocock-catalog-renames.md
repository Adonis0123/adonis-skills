# mattpocock catalog renames (skills.sh vs git tip)

Class rule: **skills.sh slug ≠ guaranteed on-disk skill path.**  
Before install/eval of any mattpocock name from a directory page, re-check the **git tip** and CHANGELOG.

## Verified renames (HEAD ~2026-08-07 `84fdeff`)

| Catalog / old name     | Live skill                   | Notes                                                                                                                                              |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to-prd`               | **`to-spec`**                | #464 rename; #734 drops “aka PRD” hedge. skills.sh may still host `/to-prd` with PRD wording + install counts. **No** `skills/**/to-prd/` on main. |
| `write-a-prd`          | gone / use **`to-spec`**     | skills.sh can 404 “isn’t available”; blogs still mention it.                                                                                       |
| `to-plan`, `to-issues` | **`to-tickets`**             | Merged in #464; old names deleted.                                                                                                                 |
| `diagnose` (skills.sh) | folder **`diagnosing-bugs`** | Same job; name mismatch in inventory.                                                                                                              |

## Eval steps when user asks for a renamed slug

1. Temp clone `mattpocock/skills` **or** `npx skills@latest add mattpocock/skills -l`.
2. `rg -i 'renamed|to-prd|to-spec' CHANGELOG.md` (or equivalent).
3. If successor already local and **hash-match** → **B**, status `already present` under **new** name; old name `not installed` (correct).
4. Do **not** invent a second permanent install under the old catalog name.
5. Exercise once under the **successor** skill template if the user needs an artifact (skip double peer review for pure rename/zero-delta cases).

## Adjacent phantom names

| User said | Reality                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `to-tdd`  | **Does not exist** in package. Nearest: `to-spec` (plan doc) + `tdd` (red-green law) + local `test-driven-development`. |

## Default

- Tracker-publish chain (`to-spec` / `to-tickets` / `triage` / setup) stays **B** unless GH Issues becomes system of record.
- Catalog popularity of stale `to-prd` page is **not** install evidence.
