

<!-- Source: .ruler/AGENTS.md -->

---
applyTo: '**'
---

# AI Collaboration Guidelines

The `.ruler/*.md` files are the single source of truth for repository AI rules.
Run `ruler apply --agents codex,claude` to generate root `AGENTS.md` and `CLAUDE.md`.

These baseline rules apply to both Codex and Claude:

- Communicate primarily in English unless project rules state otherwise.
- Read repository context before making implementation decisions.
- Keep changes minimal and focused on the task objective.



<!-- Source: .ruler/00-core-principles.md -->

---
applyTo: '**'
---

## Core Principles

- Goal oriented: deliver runnable outcomes for the active task.
- Verifiable: provide reproducible checks when behavior changes.
- Consistent: follow existing naming, structure, and style conventions.
- Safe by default: avoid destructive operations unless explicitly requested.



<!-- Source: .ruler/05-language.md -->

---
applyTo: '**'
---

## Language

- Always respond in Chinese (中文) unless the user explicitly writes in another language or requests a different language.



<!-- Source: .ruler/10-project-context.md -->

---
applyTo: '**'
---

## Project Context

- Stack: Node.js/TypeScript scripts + Python helper scripts + Turborepo monorepo + Next.js 16 web app (`apps/web`) + file-based skills catalog (`skills/*`).
- Package manager: pnpm (`pnpm@10.28.2`).
- Quality tools: ESLint, TypeScript typecheck, `scripts/validate-skills.mjs`, `scripts/generate-skills-index.mjs`, and repo-skill-creator Python helpers.

## Key Directories

- `skills/`: **public** skill definitions (for example `commit`, `staged-review-validator`, `weekly-report`) — indexed by web app, installable via `npx skills add`.
- `.agents/skills/`: **internal** agent skills and tooling — not published, synced locally to `.claude/skills/`.
- `.claude/skills/`: local mirror for Claude/Codex runtime testing (generated from `.agents/skills/`).
- `scripts/`: automation scripts:
  - `create-skill.ts` — interactive/CLI workflow for creating a new skill
  - `generate-skills-index.mjs` — scans `skills/`, generates `skills-index.json`
  - `validate-skills.mjs` — validates all skills' frontmatter (used by CI)
  - `install-local-skills.ts` — installs skills from `skills/` to `.agents/skills/` (supports `--all`, `--skill`, interactive mode)
  - `sync-llm-skills.ts` — atomically mirrors `.agents/skills/` to `.claude/skills/`
- `.agents/skills/repo-skill-creator/scripts/`:
  - `init_skill.py` — scaffolds a skill directory structure
  - `quick_validate.py` — validates a single skill quickly
  - `generate_openai_yaml.py` — generates `agents/openai.yaml` for skill metadata integration
- `apps/web/src/generated/skills-index.json`: generated skill index used by web UI (do not edit manually).
- `.ruler/`: source-of-truth rules that generate root `AGENTS.md` and `CLAUDE.md` via `pnpm ruler:apply`.



<!-- Source: .ruler/20-dev-commands.md -->

---
applyTo: '**'
---

## Development Commands

```bash
# Skills management
pnpm skills:new                                      # interactive: create + quick-validate + validate + index
pnpm skills:init <skill-name> --path skills          # scaffold skill directory only
pnpm skills:quick-validate skills/<skill-slug>       # validate single skill frontmatter
pnpm skills:openai-yaml skills/<skill-slug>          # generate skills/<slug>/agents/openai.yaml
pnpm skills:validate                                 # validate all skills (blocks CI on failure)
pnpm skills:index                                    # regenerate apps/web/src/generated/skills-index.json
pnpm skills:install:local [-- --all | --skill <name>] # install skills/ → .agents/skills/
pnpm skills:test:local [-- --all | --skill <name>]    # install + sync → .claude/skills/
pnpm skills:sync:llm                                 # sync .agents/skills/ → .claude/skills/

# AI rules
pnpm ruler:apply                                     # regenerate CLAUDE.md + AGENTS.md from .ruler/*.md

# Web app
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
```

## Recommended Local Validation Flow

1. For a new skill, run `pnpm skills:new` (or `pnpm skills:init ...`) and ensure frontmatter is complete.
2. If OpenAI skill metadata is needed, run `pnpm skills:openai-yaml skills/<skill-slug>`.
3. Run `pnpm skills:quick-validate skills/<skill-slug>`.
4. Run `pnpm skills:validate` for repository-wide checks.
5. Run `pnpm skills:index` to refresh `apps/web/src/generated/skills-index.json`.
6. If local agent testing is needed, run `pnpm skills:install:local` or `pnpm skills:test:local`.
7. For app/runtime changes, run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.

## Updating AI Rules

Edit files in `.ruler/*.md`, then run `pnpm ruler:apply` to regenerate `CLAUDE.md` and `AGENTS.md`. Never edit `CLAUDE.md` or `AGENTS.md` directly.



<!-- Source: .ruler/30-coding-conventions.md -->

---
applyTo: '**'
---

## Repository Conventions

- Keep changes minimal and aligned with existing script and file naming patterns.
- Prefer deterministic automation scripts over ad hoc manual steps for repeated workflows.
- When changing generated artifacts, update the source script and regenerate outputs.
- Prefer passing script arguments explicitly via `--` when invoking pnpm scripts in docs/CI to avoid ambiguity.

## Documentation Conventions

- Every directory with README documentation must include both `README.md` and `README.zh-CN.md`.
- `README.md` is the default and canonical English version.
- `README.zh-CN.md` is the Chinese mirror of `README.md`.
- Both README files must keep structural and semantic parity (same sections, same command examples, same meaning).
- Both README files should include reciprocal language switch links at the top.
- Any README update must modify both language files in the same change.

## Skill Authoring Conventions

- Use lowercase hyphen-case for skill directory names and frontmatter `name`.
- Ensure each `skills/<slug>/SKILL.md` has valid YAML frontmatter with non-empty `name` and `description`.
- Add optional directories (`scripts/`, `references/`, `assets/`) only when they are needed by the skill.
- Add `agents/openai.yaml` only when required by downstream OpenAI skill metadata integration; generate it via `pnpm skills:openai-yaml`.
- Avoid extra documentation files inside a skill unless they are operationally required.
- After creating or updating a skill, run `pnpm skills:validate` and `pnpm skills:index`.

**SKILL.md frontmatter schema:**

```yaml
---
name: skill-name          # required, lowercase hyphen-case
description: "..."        # required, non-empty; shown in web UI and tool selectors
allowed-tools: Read, Bash # optional; restrict which tools Claude may use
metadata:
  author: your-name       # optional
  version: "1.0.0"        # optional
---
```

Only `name` and `description` are validated by CI. Skills in `skills/` are public and appear in the web UI; skills in `.agents/skills/` are internal and not indexed.

## Web Coding Conventions (`apps/web/**`)

- Use TypeScript and function components.
- Keep imports and naming consistent with repository conventions.
- Keep tests close to changed modules when practical.
- Document non-obvious tradeoffs in PR descriptions.
- For localStorage persistence in `apps/web`, prefer `ahooks` `useLocalStorageState` over direct `window.localStorage` access.
- If direct localStorage access is required (e.g., non-React utility or special serialization flow), document the reason in code comments.
- Reference: https://ahooks.js.org/hooks/use-local-storage-state



<!-- Source: .ruler/35-plan-documentation.md -->

---
applyTo: '**'
---

## Plan Mode Major-Change Documentation

- This rule applies only when operating in Plan mode.
- A change is major if any one condition is true:
  - It changes behavior across multiple modules or directories.
  - It changes public interfaces, architecture, or core data flow.
  - It is expected to touch 5 or more files in a single implementation.
- For each major change, you MUST create one Markdown plan record in `.docs/`.
- If one Plan-mode session includes multiple major changes, create one file per major change.
- Plan record file names in `.docs/` MUST use `plan-YYYY-MM-DD-topic.md`.
- `topic` MUST be kebab-case and may contain only lowercase letters, digits, and hyphens.
- The file name SHOULD match this pattern: `^plan-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+\\.md$`.
- Each plan record SHOULD include: background, goals, scope, solution, risks, and acceptance criteria.



<!-- Source: .ruler/40-architecture.md -->

---
applyTo: '**'
---

## Architecture and Data Flow

### Skill Creation Flow

```
pnpm skills:new
    ↓  scripts/create-skill.ts
.agents/skills/repo-skill-creator/scripts/init_skill.py
    ↓  .agents/skills/repo-skill-creator/scripts/quick_validate.py
pnpm skills:validate + pnpm skills:index
```

### Skills Publication Flow

```
skills/<slug>/SKILL.md
    ↓  scripts/generate-skills-index.mjs  (pnpm skills:index)
apps/web/src/generated/skills-index.json
    ↓  Next.js app router
apps/web (web UI — skill discovery & install commands)
```

### OpenAI Metadata Flow (Optional)

```
skills/<slug>/SKILL.md
    ↓  .agents/skills/repo-skill-creator/scripts/generate_openai_yaml.py  (pnpm skills:openai-yaml)
skills/<slug>/agents/openai.yaml
```

### Local Testing Flow

```
skills/<slug>/
    ↓  scripts/install-local-skills.ts  (pnpm skills:install:local)
.agents/skills/<slug>/
    ↓  scripts/sync-llm-skills.ts       (pnpm skills:sync:llm / pnpm skills:test:local)
.claude/skills/<slug>/
```

### AI Rules Flow

```
.ruler/*.md  (source of truth)
    ↓  pnpm ruler:apply  (@intellectronica/ruler)
CLAUDE.md + AGENTS.md  (generated — do not edit directly)
```

### Build Dependencies (Turbo)

`pnpm build` → requires `skills:validate` + `skills:index` to complete first. The `skills-index.json` is a build input to the web app; always regenerate after changing skills.

### postinstall Hook

`pnpm install` automatically runs `ruler:apply` and `skills:sync:llm` in local environments (skipped in CI via `is-ci`).



<!-- Source: .ruler/45-web-ui-style.md -->

---
applyTo: 'apps/web/src/**'
---

## Web UI Style Contract (apps/web only)

This rule applies only to source files under `apps/web/src/**`.
Do not apply these visual constraints to scripts, skills, or non-web packages.

### Visual Direction

- Keep the web UI in a **Soft 3D Claymorphism** direction with restrained contrast.
- Preserve the current clay palette anchors:
  - `--clay-peach: #fbaf77`
  - `--clay-blue: #87a6dd`
  - `--clay-cream: #efdbc0`
- Prefer subtle depth and material layering over high-contrast glossy effects.

### Surface and Shadow Rules

- Use shared clay tokens (`--shadow-clay-raised`, `--shadow-clay-inset`, `--shadow-clay-floating`) for depth.
- Do **not** introduce bottom outer highlight lines such as `0 1px 0 ...` in raised/floating shadows.
- If highlight accents are needed, prefer **inset** highlights or top-edge inner highlights.
- Keep `clay-surface` edges stable during hover/transform transitions and avoid visible seam artifacts.

### Layout Spacing Rules

- Keep page vertical spacing driven by safe-area utilities plus base spacing variables:
  - `--page-space-y-mobile`
  - `--page-space-y-desktop`
  - `--page-space-y`
- `safe-area-top` and `safe-area-bottom` should include both safe-area insets and base page spacing.
- Avoid duplicating top/bottom spacing with per-page `py-*` when safe-area utilities already provide vertical rhythm.

### Component Usage Rules

- Reuse primitives from `apps/web/src/components/ui/*` (`ClaySurface`, `ClayCard`, `ClayButton`, `ClayBadge`) instead of ad hoc visual wrappers.
- Keep radius, border, and shadow behavior token-driven.
- Preserve accessible focus states (`.clay-focus-ring`) for interactive elements.

### Motion Rules

- Maintain restrained motion with smooth cubic-bezier curves and reduced-motion fallback.
- Hover lift should avoid subpixel edge artifacts (`translate3d` is preferred over plain `translateY` when needed).
- Do not add decorative motion that changes layout flow or harms readability.
