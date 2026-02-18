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
