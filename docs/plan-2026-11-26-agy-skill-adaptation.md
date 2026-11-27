# Plan: Adapt All Eligible `adonis-skills` Skills to Antigravity (AGY)

## Background

- `adonis-skills` publishes 35 skills in `skills/`. Four recent skills and the hook plugins already added partial Antigravity (`agy`) support, while 18 repository-owned skills either missed `agy` host routing/configuration/logging paths or still encoded another host's exclusive tool list (`weekly-report`).
- Users running skills inside Antigravity CLI (`agy`), Antigravity App, or Antigravity IDE hit missing runtime choices (`goal-gate` falling back to `unknown`, `review-loop --host=agy` throwing a product error, missing `agy mcp` setup in MCP skills, missing `~/.gemini/antigravity*` discovery in `disk-tidy` and `agent-practice-audit`, and missing `image-generator` / `run_command` reactive wakeup routing in `prompt-studio`).

## Goals

- Adapt all 18 repository-owned skills that benefit from Antigravity (`agy`) support cleanly without duplicating host-specific boilerplate or regressing Claude Code, Codex, Grok Build, Cursor CLI, Hermes, or WorkBuddy workflows.
- Validate every updated skill with its own unit/static tests and `skill-creator` paired baseline evaluations (`old_skill` vs `with_skill`), producing `benchmark.json`, `benchmark.md`, and static `eval-review.html` under `skills/<slug>-workspace/iteration-agy/`.
- Update `apps/web/content/skill-catalog.yaml`, regenerate `apps/web/src/generated/*.json`, align `AGENTS.md`, `README.md`, `README.zh-CN.md`, and `llms.txt`, and pass repository validation, script tests, i18n compilation, lint, and typecheck.

## Scope

- **In scope (18 repository-owned skills + catalog + docs)**:
  - Review, routing, and Goal orchestration (7): `goal-gate`, `agentic-review-handoff`, `architecture-hardening-loop`, `task-completion-loop`, `grill-autopilot`, `workflow-gate`, `open-code-review-loop`.
  - MCP and tool setup (5): `kimi-computer-use`, `figma-mcp`, `chrome-dev-mcp`, `ardot-mcp`, `uxc-facade`.
  - Local environment, setup, multimodal, and portability (6): `disk-tidy`, `agent-symlink-init`, `prompt-studio`, `web-performance-audit`, `agent-practice-audit` (full Python extractor, config scanner, source allowlist, and unit tests), `weekly-report`.
  - Repository docs and catalog: `apps/web/content/skill-catalog.yaml`, regenerated `apps/web/src/generated/*.json`, `README.md`, `README.zh-CN.md`, `AGENTS.md`, `llms.txt`.
- **Out of scope**:
  - The 4 skills managed by `.export-manifest.json` (`agent-dispatch`, `agent-skill-evaluation`, `desktop-agent-activity`, `dev-environment-roi-audit`), whose sources live in external private repositories; documented as a follow-up private-source backlog only.
  - The 13 already host-agnostic domain skills (`branch-creator`, `code-inspector-init`, `code-plugin-architecture`, `commit`, `commit-push`, `decision-first-technical-writing`, `delete-comment`, `design-system`, `file-tidy`, `lingui-workflow`, `local-web-surface`, `review-prompt-composer`, `worktree-tidy`).
  - `skill-creator/scripts/run_loop.py` description optimization loop, git commits, pushes, or external releases.

## Proposed Solution

- Snapshot each of the 18 target skills under `skills/<slug>-workspace/skill-snapshot-pre-agy/` (gitignored) before edits.
- Use `run_workflow` to fan out across disjoint `skills/<slug>/` directories for Stage 1 (skill adaptation, AGY eval prompt authoring in `evals/evals.json`, `pnpm skills:quick-validate`, and skill unit tests) and Stage 2 (`skill-creator` paired runs comparing `with_skill` vs `old_skill` baseline, objective grading into `grading.json`, `aggregate_benchmark.py`, and static `generate_review.py` HTML reports, iterating up to 2 times on any failing assertion).
- Apply shared cross-skill files (`apps/web/content/skill-catalog.yaml`, `README.md`, `README.zh-CN.md`, `AGENTS.md`, `llms.txt`, and synced dual-tracked `.agents/skills/` mirrors) sequentially in the main session, regenerate web indexes, run full repository checks, and complete an independent cross-model code review.

## Risks

- **Technical risks**:
  - Frozen assertions in `scripts/__tests__/*.test.ts` and per-skill checks (`check_scope.py`, `check_description_handoff.py`, `prefs.test.mjs`) must stay satisfied while expanding host support.
  - Adding `agy` log parsing in `agent-practice-audit` must preserve prompt privacy (zero prompt text persisted) and avoid breaking existing Claude/Codex/Grok/WorkBuddy metrics.
- **Delivery risks**:
  - Parallel subagent execution could exhaust rate limits if fan-out concurrency is unconstrained; mitigated by chunked `parallel(...)` waves and resumable per-skill outputs.
- **Mitigations**:
  - Snapshot every skill pre-edit, enforce disjoint directory ownership per worker, keep `run_workflow` evals strictly read-only/isolated under `/tmp` or workspace outputs, and verify with deterministic repo checks plus independent review.

## Acceptance Criteria

- [x] All 18 target skills adapted with verified AGY behavior and passing `pnpm skills:quick-validate` and skill-level unit/static tests.
- [x] All 18 target skills have `skills/<slug>-workspace/iteration-agy/benchmark.json`, `benchmark.md`, and `eval-review.html` with 100% `with_skill` expectation pass rate on the new AGY evals.
- [x] `.export-manifest.json` managed skills (`agent-dispatch`, `agent-skill-evaluation`, `desktop-agent-activity`, `dev-environment-roi-audit`) have zero git diff.
- [x] `pnpm skills:validate && pnpm skills:index && pnpm test:scripts && pnpm --filter @adonis-skills/web run i18n -- --compile && pnpm lint && pnpm typecheck && git diff --check` passes with exit code 0, and independent code review completes without open P0/P1/reproduced-P2 findings.
