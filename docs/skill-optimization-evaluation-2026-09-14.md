# Skill optimization evaluation — 2026-09-14

## Decision

The full optimization objective is **not complete**. The inventory contains 22
owned public skills and the internal `repo-skill-creator`, rather than every skill
installed on the evaluation machine. External `coco-*` skills are excluded.

A selected 12-file implementation and regression-test batch passed 75 related
tests. That batch can be reviewed separately. Its result does not establish that
all changed skills, all native host workflows, or all performance claims pass.
No commit or push was performed by this evaluation.

Keep improvements supported by actual behavior. Retain an existing skill when no
defect or useful improvement has been demonstrated. Failed candidates, incomplete
runs, shorter instructions, and smaller answers do not establish an improvement.

## Evidence boundaries

- Native evaluations use Claude Code, Codex, and Grok Build. Each old/current pair
  uses the same host model and execution settings and frozen task inputs, with
  the selected skill as the intended input difference.
- A native process exit, actual task acceptance, parent-run checks, browser
  interaction, and IDE navigation are separate evidence layers. A component test
  cannot prove a complete workflow.
- Resource measurements below are individual sequential pairs. Cache state,
  host load, and order effects were not controlled. They are observations, not
  estimates of a stable causal effect or a success-rate improvement.
- Native token accounting differs between hosts. Compare old/current within a
  host; do not add cache subsets or reasoning fields to an already inclusive
  total. Missing terminal usage remains missing.
- Original traces and isolated fixtures are retained locally and are not included
  in this document. This is an audit snapshot, not a standalone reproducible
  benchmark package. No private runtime paths or credentials are required to read
  it.

## Per-skill assessment

| Skill                              | Evidence obtained                                                                                                                                                | Remaining limit / decision                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-symlink-init`               | Gitfile repair and a real Codex initialization/idempotence case passed.                                                                                          | Claude creation was denied in its tested environment; a complete Grok initialization remains unverified.                                                                                                                                                                                                                                                      |
| `agentic-review-handoff`           | Help-side-effect repair and a complete Claude-to-Codex representative workflow passed; Grok consultations also completed.                                        | Other complete host/branch combinations are not established by the component checks.                                                                                                                                                                                                                                                                          |
| `architecture-hardening-loop`      | Actual scan, diagram rendering, and reviewer input reads were observed.                                                                                          | The complete run timed out without final convergence. No complete paired benefit is established.                                                                                                                                                                                                                                                              |
| `branch-creator`                   | Claude created the branch while retaining existing dirty changes.                                                                                                | Other tested host paths encountered Git write or tool-permission restrictions. Do not infer a source defect from those failures.                                                                                                                                                                                                                              |
| `chrome-dev-mcp`                   | A native task read the skill, clicked the synthetic page, and obtained its Console error and HTTP 503.                                                           | Response-body retrieval failed; the run timed out without its report. Diagnostic workflow acceptance did not pass.                                                                                                                                                                                                                                            |
| `code-inspector-init`              | All three hosts completed old/current real-plugin configuration and transform tasks. See the paired results below.                                               | Native browser/IDE execution is not part of these pairs. Parent browser evidence is separate; IDE navigation remains incomplete.                                                                                                                                                                                                                              |
| `code-plugin-architecture`         | The current review explicitly required own-property membership before dispatch.                                                                                  | The old advice was underspecified, not a demonstrated executed exploit. No resource improvement was observed in the completed Grok pair.                                                                                                                                                                                                                      |
| `commit`                           | Claude and Codex message-generation representatives passed.                                                                                                      | The split candidates did not establish a useful cross-host improvement; preserve the existing behavior. The Grok Git query was cancelled.                                                                                                                                                                                                                     |
| `commit-push`                      | A real sensitive-file stop preflight was observed.                                                                                                               | Actual commit/push was outside the evaluation authorization. A preflight is not delivery acceptance.                                                                                                                                                                                                                                                          |
| `decision-first-technical-writing` | A current candidate removed unsupported guarantees in observed writing tasks; Codex old/current complete documents passed.                                       | Preserve the distinction between actual content defects and a mechanically missing final full-file read. No general resource claim is established.                                                                                                                                                                                                            |
| `figma-mcp`                        | Authentication/readiness calls succeeded on two hosts.                                                                                                           | No authorized accessible test file/node was supplied. Identity readiness does not prove a file workflow.                                                                                                                                                                                                                                                      |
| `goal-gate`                        | Native lint repair cases and a real Codex goal lifecycle passed.                                                                                                 | Hosts without native Goal support must not be represented as having the same lifecycle. Other routes are not all verified.                                                                                                                                                                                                                                    |
| `kimi-computer-use`                | Claude performed a real synthetic accessibility-tree task.                                                                                                       | Complete maintenance workflows and paired gains on the other hosts remain unverified.                                                                                                                                                                                                                                                                         |
| `lingui-workflow`                  | Three-host real compile/runtime representatives passed.                                                                                                          | No additional meaningful source improvement was identified. Do not force a change or duplicate the passing case.                                                                                                                                                                                                                                              |
| `local-web-surface`                | Claude and Grok completed real HTTP red/green cases.                                                                                                             | The tested Codex context denied network access. Parent HTTP success cannot substitute for native execution.                                                                                                                                                                                                                                                   |
| `open-code-review-loop`            | Validator repairs and complete review/fix/review representatives were observed.                                                                                  | A specified adapter-reference reading requirement was missed. Keep protocol compliance separate from the working repair result.                                                                                                                                                                                                                               |
| `review-prompt-composer`           | Writer/freshness fixes were tested; Claude completed a quality case and Codex completed old/current repeat-use workflows, including fresh/stale/restored checks. | Grok's exact allowlisted read-only Git identity query was cancelled before prompt creation. No new Grok prompt or freshness acceptance resulted.                                                                                                                                                                                                              |
| `task-completion-loop`             | Required consultation capabilities were exercised.                                                                                                               | A fresh full workflow stopped before implementation: Grok completed its first consultation in 163.161 seconds; Claude timed out at 180.010 seconds. Two attempted cross-review commands were rejected before model launch because the first consultation was incomplete; downstream gates did not run. No complete workflow or paired benefit is established. |
| `uxc-facade`                       | Installed-runtime analysis established the daemon's shared-state boundary.                                                                                       | The tested version does not provide the required independent daemon directory. Complete isolated packaging remains unverified.                                                                                                                                                                                                                                |
| `web-performance-audit`            | A native candidate delivered a real report and event ledger. Parent inspection found and corrected specific reporting errors.                                    | The native report contained unsupported claims; the correction is parent work. The old run lacked a completed comparison report. No native paired gain is established.                                                                                                                                                                                        |
| `weekly-report`                    | Native analyzer fixes and a complete Markdown representative were verified.                                                                                      | Equivalent passing cases need not be rerun solely because another evaluation prompt was added. No broader unmeasured claim is made.                                                                                                                                                                                                                           |
| `workflow-gate`                    | Downstream business tasks completed in tested cases.                                                                                                             | Some host cases omitted the required gate block or emitted it after execution; the corresponding Codex compact-pair protocol checks passed. Readiness decisions correctly rejected the failing test. Compact and reminder candidates did not establish an improvement.                                                                                        |
| `repo-skill-creator`               | Initialization/validation fixes and real creation tasks were tested.                                                                                             | An extra inspection-instruction candidate introduced a Decimal precision regression and increased resource use. Reject that candidate; passing held-out examples did not cover the counterexample.                                                                                                                                                            |

## Inspector: completed three-host representative pairs

The task was to change an already installed plugin from Alt+Shift to Alt, preserve
the other settings, execute the real Vite transform test, and read back the final
configuration. Both variants passed on every host. The tested runtime used
`code-inspector-plugin@1.4.2` and `vite@7.3.1`.

Grok used a fully task-contained dependency graph; the other host pairs used
their existing frozen dependency layout. Dependency layout was identical within
each pair. These measurements do not compare host efficiency against one another.

| Host / model                     | Old → current seconds | Old → current reported tokens | Observed result                                                                                                                                               |
| -------------------------------- | --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code / `claude-fable-5-1` | 75.721 → 85.591       | 117697 → 131171               | Current rollback guidance stayed within the shortcut change. Old guidance additionally described uninstalling the existing plugin. Time and tokens increased. |
| Codex / `gpt-6-astra`, medium    | 42.487 → 39.385       | 124057 → 189042               | Both preserved task scope. Current time decreased 7.30%, while tokens increased 52.38%.                                                                       |
| Grok Build / `grok-4.6-build`    | 76.117 → 43.753       | 71203 → 49988                 | Both preserved task scope and gave local rollback guidance. Current time decreased 42.52% and tokens decreased 29.80% in this pair.                           |

Only the requested configuration line changed among frozen inputs. The plugin
also generated its permitted task-local runtime record; “only one file changed”
must therefore refer to implementation edits, not every filesystem write.

Earlier invalid runs remain invalid: a preparation assertion was wrong, a test
did not initially exclude HMR listening, and an external dependency link failed
inside the Grok child. Subsequent valid pairs do not turn those attempts into
successful measurements.

## Selected implementation batch

The 12-file batch contains six implementation files and their focused regression
tests. The verified fixes cover:

| Implementation                                                | Verified repair                                       |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `.agents/skills/repo-skill-creator/scripts/init_skill.py`     | Preserve author values through YAML generation.       |
| `.agents/skills/repo-skill-creator/scripts/quick_validate.py` | Reject empty required frontmatter values.             |
| `scripts/finalize-skill.ts`                                   | Check canonical path containment before finalization. |
| `skills/agentic-review-handoff/scripts/review-loop.mjs`       | Handle help before mutation or subprocess startup.    |
| `skills/open-code-review-loop/scripts/validate_round.py`      | Return structured failure for invalid path input.     |
| `skills/goal-gate/scripts/lint-goal-prompt.py`                | Reject empty or incorrectly borrowed required fields. |

The 75 related tests passed against the recorded implementation bytes; those
bytes were checked again during closing reviews. This count excludes unrelated
checks and does not replace the per-skill native evidence above.

## Follow-up: untested capability repair

The ledger initializer previously marked a capability `unavailable` while all
three discovery/handshake/call checks were still false. The repaired initializer
uses `untested`. Validation and rendering accept that disclosure, but machine
findings still require an `available` capability with complete proof. The routing
and report references now describe the distinction.

This is a separate four-file repair batch. Three new regression tests were added;
all 27 ledger and portability tests passed. Real CLI initialization, validation,
and Markdown rendering passed, and a finding citing an untested capability was
correctly rejected. An independent review also passed 10 boundary probes. The
repository-local runtime copy was synchronized and passed the same 27 tests;
that repeat is not an additional 27 distinct tests. Older statuses remain valid
in the new validator; an old validator does not recognize the new `untested`
status, so consumers of new ledgers need the updated script.

A separate native Codex report-analysis experiment tested the existing skill
against saved synthetic runtime evidence. Its old variant timed out after
180.015 seconds without a complete report or terminal token total. The candidate
was not run or adopted. This failure establishes no instruction-quality or
performance gain and is separate from the verified program repair.

Repository validation and index generation passed. Lint passed with 32 generated
catalog warnings; typecheck used matching cached results. A fresh production
build passed. These checks establish repository consistency, not completion of
the missing native workflows.

## Completion conditions still open

Full acceptance still requires the missing authorized targets or execution
capabilities, complete native workflows where only components passed, and
evidence for any further proposed improvement. Do not relax sandbox protections,
perform unauthorized delivery, or label missing evidence as a pass to close this
objective. Keep the verified implementation batch separate from that broader
completion claim.

## Follow-up: complete native runs after the second optimization pass

A later pass on the same day revised `architecture-hardening-loop` (1.8.0),
`chrome-dev-mcp` (1.4.0), and `figma-mcp` (1.3.0) and then ran each skill for
real on Claude Code with the revised text. These runs close three of the gaps
listed above; they are single observations, not benchmarks.

| Skill                         | Real run                                                                                                                                                                     | Result                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architecture-hardening-loop` | Full loop on a throwaway clone, scope `scripts/**`, Grok reviewer, 2-round budget. Real scanner passes, 7 Grok round trips (3 consults, 2 review runs, 2 continued reviews). | `NO_ACTIONABLE_FINDINGS`, stop reason `post-fix-rescan-zero`, evidence identity matched. 59 min wall-clock, of which about 40 min was Grok latency (consults 3 to 7 min, review runs 10 to 11 min each). 1 Architecture Fix and 5 Local Fixes applied in the clone; 52 tests pass.            |
| `chrome-dev-mcp`              | Synthetic local page returning HTTP 503 on a button click; new page created in the managed Chrome, clicked, Console and Network read, page closed.                           | Status, headers, and body retrieved through `list_network_requests` and `get_network_request`; about 100 s with the revised skill, 64 s with the previous skill. The revised run hit two documentation errors (flag placement, `responseFilePath` path restriction) that were then corrected. |
| `figma-mcp`                   | Bare `/figma-mcp` readiness, and a read of a file the account cannot access.                                                                                                 | Readiness: one `whoami`, `FIGMA_MCP_READY`, no identity in output. Forbidden file: `get_metadata` first, stop with `FILE_ACCESS: UNVERIFIED` and one missing item, no other probes.                                                                                                           |

The `duplicate-only` verdict-reuse branch added in 1.8.0 was not exercised:
both rescans produced new fingerprints, so both took the terminal-consult
branch. Its behavior is covered only by a read-only behavior eval so far.
