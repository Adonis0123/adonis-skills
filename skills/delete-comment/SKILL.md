---
name: delete-comment
description: "Audit the code comments in a repository or a named path, sort each one into tautology, stale, excuse, decision record or directive, then delete the noise, turn excuses into tracked issues, move decisions into ADRs, and add a comment ratchet (a per-file baseline that may only shrink) so new noise cannot come back. Starts with a read-only report and a measured count of how many lines deleting would shed. Use when the user wants to clean up, prune or ban code comments, says comments mislead the coding agent, asks how many lines removing comments would save, or wants a lint or CI rule that stops comment growth, in any language, Chinese included. Not for writing docstrings or API docs, translating comments, or reviewing a diff for bugs."
metadata:
  author: adonis
  version: "1.0.0"
---

# Delete Comment

Comments are a second source of truth that nothing checks. A stale or excuse comment steers a coding agent toward the wrong code, so the default is: the code says what, a few marked comments say why, and the count only goes down.

Run from the target repository root. `scripts/comment_ratchet.py` (beside this file) needs `cloc` (`brew install cloc` / `apt install cloc`).

## Workflow

1. **Scope.** Take the path the user named, else the whole repo. Exclude vendored, generated and lockfile paths up front (for example `--exclude '^vendor/' --exclude '\.gen\.' --exclude '_pb2\.py$'`); never edit those.
2. **Measure.** `python3 <skill>/scripts/comment_ratchet.py report --top 30 [paths] [--exclude ...]`. Record `commentLines`, `allowedLines`, `countedLines`. `countedLines` is the upper bound of lines shed, not the estimate: in a well-kept repo most counted lines are decision records or code-coupled docs. Trailing comments on a code line are not counted (`cloc` treats them as code); say so.
3. **Classify.** Read the comments together with the adjacent code and tests in the top files (for more than ~40 files, fan out one read-only subagent per directory, each returning a table). Put every comment in exactly one class:

   | Class           | Test                                                                                                                               | Action                                                                                        |
   | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
   | Tautology       | Restates what the next line already says                                                                                           | Delete                                                                                        |
   | Stale           | Contradicts the adjacent code/tests, or names code, behavior, tickets or history that no longer exist                              | Delete                                                                                        |
   | Excuse          | Admits a shortcut (`TODO`, `FIXME`, `hack`, `temporary`, `for now`, `should be`)                                                   | Record an issue, then delete, or keep as `HACK(<issue>)` with the removal condition           |
   | Decision record | Explains a non-obvious why that the code cannot show                                                                               | Short: keep, prefix `WHY:`. Long or cross-file: move into an ADR, leave `ADR-<n>` at the site |
   | Directive       | Tool instruction or legal text (`eslint-disable`, `@ts-expect-error`, `noqa`, `type: ignore`, `pragma: no cover`, license headers) | Keep untouched                                                                                |

   When unsure between Tautology and Decision record, ask: would deleting it make someone reintroduce a bug? Yes means Decision record.

   **Looks like noise, keep it** (do not count these as deletable; note them as kept exceptions in the report so they are not confused with linter directives or noise):
   - A comment that is the only content of an empty block (`catch {}` or `except: pass`): linters or tests may require it, and it marks the swallow as deliberate.
   - Exported JSDoc (`/** ... */`) and runtime-consumed docstrings (e.g., Python `__doc__` read by `argparse`/CLI/OpenAPI, or `doctest`): `cloc` counts them as comments, and schema generators, tests, or IDE hovers may depend on them. Check codegen and tests before touching them.
   - Section headers in long files that carry a spec, RFC, or ADR pointer: they are navigation, not restatement (only flag as Stale if the referenced target is actually wrong or removed).

4. **Stop for the report.** Unless the user already said to apply changes, deliver the report (template below) and stop without editing or creating any repo files. Deletion is easy to undo in Git, but the class decisions are the user's call the first time.
5. **Apply.** Edit only the scoped files.
   - **Excuses:** record them before deleting so the file, original line/symbol, what is wrong, and removal condition stay accurate. Use the repo's external tracker only with the user's go-ahead for external posting; otherwise append one line each to `docs/comment-debt.md`.
   - **ADRs:** follow the repo's existing ADR directory and numbering (for example `docs/adr/0002-...md` if `0001-...md` exists); if the `domain-modeling` skill is installed, use it rather than inventing a format. Never edit another skill to make this work.
6. **Ratchet.** Copy `scripts/comment_ratchet.py` into the repo (for example `scripts/comment-ratchet.py`), run `snapshot` with the same scope and excludes, and wire `check` into the repo's existing gate: a `package.json` script, `pre-commit`, `lefthook` or CI step, whichever the repo already uses. Do not add a new hook framework.
   - **Exclude the ratchet script on repo-wide scopes:** `comment_ratchet.py` scans `git ls-files` and contains its own Python docstrings (~14 counted lines). If the script lives inside the snapshotted scope (e.g., repo-wide snapshot with no path limit), pass `--exclude '^scripts/comment-ratchet\.py$'` (matching its path) to `snapshot` so `check` will not fail after the user runs `git add`, and do not `git add` files or include the ratchet script itself in `.comment-baseline.json`.
   - **CI dependency:** if `check` will run in CI (directly or via an existing script such as `npm run lint` invoked by CI), ensure the CI job installs `cloc` (for example `apt-get install -y cloc` on `ubuntu-latest`) so CI does not fail with `cloc not found`.
   - **Ratchet rules:** `check` fails when the repo's total counted lines exceed the baseline total and lists regressed files as pointers; renames and moves pass, and `check` takes no paths because scope and excludes come from `.comment-baseline.json`. A contiguous comment block is exempt when any line in it carries `WHY:`, `HACK(`, `ADR-<n>`, a built-in tool directive, or a regex listed in `config.extraMarkers` (optional for repo-specific kept tags; otherwise kept JSDoc/docstrings/headers simply remain in the baseline). `check --tighten` rewrites the baseline after a drop; nobody raises it by hand.
7. **Verify.** Rerun `report` and give before/after `commentLines`, `allowedLines`, and `countedLines`; run the repo's tests or build for edited files (deleting a comment can break codegen, empty-catch lint, or docstring tests); run `check` once clean (exit 0), then add a throwaway comment to an **already-tracked in-scope file** (untracked files are ignored by `git ls-files`) to prove `check` fails (exit 1), then revert the throwaway and rerun `check` (exit 0).

Leave changes unstaged in the working tree (do not `git add`, commit, push, or open a PR unless asked).

## Report template

```markdown
## Comment audit: <repo or path>

- Comment lines: <commentLines> (allowed markers <allowedLines>, counted <countedLines>)
- Estimate of lines deleted (Tautology + Stale + Excuse): about <n> lines (sample: <k>/<m> files, <x>/<y> counted lines)
  | Class | Count (blocks / lines) | Examples (file:line, quoted) |
  | Tautology | | |
  | Stale | | |
  | Excuse | | |
  | Decision record | | |
  | Directive | | |
  | Kept exceptions (JSDoc / docstrings / headers / empty catch) | | |
- Proposed ADRs: <titles>
- Proposed issues: <one line each>
- Ratchet: <where check would run, including CI cloc note if applicable>
- Not covered: <excluded paths, trailing comments, languages cloc does not know>
```

Base the deletion estimate on **comment lines** (not block count) classified as Tautology, Stale, or Excuse in the read sample, scaled to `countedLines`. Keep raw deleted lines separate from any additional `countedLines` drop from adding `WHY:` or `ADR-<n>` markers. State clearly that it is an estimate and give the sample size.
