# Skill eval-harness trial

Use when the candidate is a **CLI that grades Agent Skills** (declarative YAML cases, a real Agent engine, rule/script/LLM judges, reports) plus an optional companion skill that drives that CLI. This is not a skill-install decision and not a UI A/B.

## Classify first

| Shape                                                                                        | Route                   |
| -------------------------------------------------------------------------------------------- | ----------------------- |
| One `SKILL.md` the user might enable                                                         | Single-skill temp trial |
| Router + specialist skills                                                                   | Package screen          |
| Binary + `eval.yaml` / `cases/` + engine adapters, companion skill only orchestrates the CLI | **This file**           |

The companion skill is not the product. Do not `npx skills add` it to try the harness. Keep the binary under `/tmp/<name>-eval/` and invoke it by absolute path.

## What job it actually does

It answers: **after this Skill is loaded into Claude Code / Codex / another engine, does the behavior still match the cases?**

It does **not** answer: should we install this Skill, is our install-screening skill worse, or does a keyword in the reply mean the Skill was followed.

Default lean **B** (do not enable the companion; do not put the binary on `PATH`) unless a recurring Skill already has cases and the user wants regression on every edit. Local install-screening stays the pre-install path.

## Smoke (do this, in order)

1. **Release binary into `/tmp` only.** Prefer the published checksummed archive for the host OS/arch over `go install` or `curl | bash` into `~/bin`. Confirm `command -v` does not resolve the new name, and that neither skill dir gained the companion.
2. **Write one tiny fixture Skill** under the trial tree: `SKILL.md` + `evals/eval.yaml` (`schema_version: v1alpha1`, `environment.type: none`, `engine.name` = a CLI already on the machine) + one `evals/cases/<id>.yaml`.
3. **`validate` then `run --dry-run`.** A valid suite prints the loaded case count. A deliberately broken `schema_version` must fail. Dry-run must list the case and must not start the engine.
4. **One live case, then stop.** Empty model + no API key is valid when the docs say the engine falls back to host login — the first real case is the login check, not `validate`. Do not loop cases to "get a better score."
5. **Read the graded response, not only PASS.** Open `result.json` `case_results[].response` (or the engine transcript). Record duration and token totals from that file.

## Pitfalls

- **A keyword assertion is not behavior proof.** `expect.must_contain` / `output_contains` passes if the token appears anywhere, including "I will not do that." Count the case only when the assertion would fail if the Skill were ignored.
- **`environment.type: none` is the host.** The engine CLI runs with its own tools and login. Inspect the transcript for reads or writes outside the trial workspace before claiming the run was contained. Isolated regression uses the harness's container/sandbox runtime, not `none`.
- **Do not treat the companion's "you do not need to install the CLI" as the trial path.** That sentence is for an agent that already has the companion loaded. A 测试 turn still proves the binary itself.
- **Token cost is part of the verdict.** One short case can spend a large input budget because the engine loads its own context. Report input/output tokens next to PASS/FAIL; do not recommend suite-wide runs from a dry-run alone.
